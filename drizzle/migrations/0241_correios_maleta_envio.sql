-- 0236 — Maleta pelos Correios (pacote lardan-0235-0236). Bucket "correios" (privado) criado pela ferramenta de storage.

create table if not exists public.correios_envios (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.kit_cycles(id) on delete restrict,
  direcao text not null check (direcao in ('ida','volta')),
  ambiente text not null check (ambiente in ('homologacao','producao')),
  servico text not null,
  status text not null default 'criando'
    check (status in ('criando','pre_postada','postada','em_transito','entregue','erro','cancelada','expirada')),
  codigo_objeto text,
  prepostagem_id text,
  valor_declarado_cents bigint not null default 0,
  frete_cents bigint,
  prazo_dias int,
  previsto_entrega date,
  postado_em timestamptz,
  entregue_em timestamptz,
  codigo_enviado_em timestamptz,
  limite_postagem date,
  rotulo_path text,
  debito_liberado_motivo text,
  debito_cents bigint,
  payload jsonb not null default '{}'::jsonb,
  resposta jsonb,
  eventos jsonb not null default '[]'::jsonb,
  erro text,
  rastreado_em timestamptz,
  criado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists correios_envios_um_vivo_uq on public.correios_envios (cycle_id, direcao)
  where status not in ('erro','cancelada','expirada');
create unique index if not exists correios_envios_objeto_uq on public.correios_envios (codigo_objeto) where codigo_objeto is not null;
create index if not exists correios_envios_status_idx on public.correios_envios (status, direcao);
alter table public.correios_envios enable row level security;
revoke all on public.correios_envios from anon, authenticated;
grant select on public.correios_envios to authenticated;
grant all on public.correios_envios to service_role;
drop policy if exists "correios envios leitura" on public.correios_envios;
create policy "correios envios leitura" on public.correios_envios for select to authenticated
  using (public.can_manage_kits(auth.uid()) or public.has_capability(auth.uid(),'finance.receivable.view'));

create or replace function public.correios_eh_servidor()
returns boolean language sql stable set search_path to 'public' as $$
  select coalesce(auth.role(), '') = 'service_role' and auth.uid() is null
$$;
revoke all on function public.correios_eh_servidor() from public, anon, authenticated;
grant execute on function public.correios_eh_servidor() to service_role;

create or replace function public.correios_pode()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.can_manage_kits(auth.uid())
$$;
revoke all on function public.correios_pode() from public, anon;
grant execute on function public.correios_pode() to authenticated;

create or replace function public.correios_debito_vencido(_party uuid)
returns bigint language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(public.fin_installment_saldo(i.id)), 0)::bigint
    from financial_installments i join financial_titles t on t.id = i.title_id
   where t.direction = 'receivable' and t.status in ('ativo','aprovado')
     and coalesce(t.pagador_party_id, t.party_id) = _party
     and i.vencimento < (now() at time zone 'America/Sao_Paulo')::date
     and public.fin_installment_saldo(i.id) > 0
$$;
revoke all on function public.correios_debito_vencido(uuid) from public, anon, authenticated;
grant execute on function public.correios_debito_vencido(uuid) to service_role;

create or replace function public.correios_endereco(_party uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare p record; a record; email text; fone text; v_cep text; v_cidade text; v_uf text;
begin
  select * into p from parties where id = _party;
  if not found then return null; end if;
  select * into a from party_addresses where party_id = _party order by is_primary desc, created_at limit 1;
  select value into email from contact_points where party_id = _party and kind = 'email' order by is_primary desc, created_at limit 1;
  select regexp_replace(value, '[^0-9]', '', 'g') into fone from contact_points
   where party_id = _party and kind in ('whatsapp','telefone') order by (kind = 'whatsapp') desc, is_primary desc, created_at limit 1;
  v_cep := regexp_replace(coalesce(a.postal_code, ''), '[^0-9]', '', 'g');
  v_cidade := nullif(btrim(coalesce(a.city, '')), ''); v_uf := upper(nullif(btrim(coalesce(a.uf, '')), ''));
  if v_cidade is null and v_cep ~ '^[0-9]{8}$' then
    select c.cidade, c.uf into v_cidade, v_uf from cep_cidades c where c.cep = v_cep limit 1;
  end if;
  fone := regexp_replace(coalesce(fone,''), '^55(?=\d{10,11}$)', '');
  return jsonb_build_object('party_id', p.id, 'nome', p.display_name, 'doc', p.doc_digits, 'email', email,
    'ddd', nullif(substr(fone, 1, 2), ''), 'celular', case when length(fone) = 11 then substr(fone, 3) end,
    'telefone', case when length(fone) = 10 then substr(fone, 3) end,
    'cep', v_cep, 'logradouro', a.street, 'numero', coalesce(nullif(btrim(a.street_number), ''), 'S/N'),
    'complemento', a.complement, 'bairro', a.district, 'cidade', v_cidade, 'uf', v_uf);
end $$;
revoke all on function public.correios_endereco(uuid) from public, anon, authenticated;
grant execute on function public.correios_endereco(uuid) to service_role;

create or replace function public.correios_maleta_dados(_cycle uuid, _direcao text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare kc record; comp record; pend text[] := '{}'; dest jsonb; rem jsonb; valor bigint; emitente uuid;
  acerto text; debito bigint := 0; vivo record;
begin
  if not (public.can_manage_kits(auth.uid()) or public.correios_eh_servidor()) then
    raise exception 'Sem permissão para enviar maleta pelos Correios.' using errcode = '42501';
  end if;
  if _direcao not in ('ida','volta') then raise exception 'Direção inválida.'; end if;
  select * into kc from kit_cycles where id = _cycle;
  if not found then raise exception 'Maleta não encontrada.'; end if;
  if kc.consultora_party_id is null then raise exception 'Maleta sem consultora: vincule a consultora antes de enviar.'; end if;

  select be.party_id into emitente from fiscal_settings fs join business_entities be on be.id = fs.emitter_entity_id limit 1;
  if emitente is null then pend := array_append(pend, 'emissor sem cadastro (Integrações › Nota fiscal)'); end if;

  select * into vivo from correios_envios where cycle_id = _cycle and direcao = _direcao and status not in ('erro','cancelada','expirada')
   order by created_at desc limit 1;

  if _direcao = 'ida' then
    if kc.status::text not in ('conferida','expedida') then
      raise exception 'A maleta vai pelo correio depois de conferida (situação atual: %).', kc.status;
    end if;
    select * into comp from kit_compositions where cycle_id = _cycle order by version desc limit 1;
    select coalesce(sum(i.quantity * coalesce(v.finished_piece_cost_cents, 0)), 0) into valor
      from kit_composition_items i join product_variants v on v.id = i.variant_id where i.composition_id = comp.id;
    if exists (select 1 from kit_composition_items i join product_variants v on v.id = i.variant_id
                where i.composition_id = comp.id and coalesce(v.finished_piece_cost_cents, 0) <= 0) then
      pend := array_append(pend, 'peça sem custo cadastrado (o valor declarado sairia menor)');
    end if;
    debito := public.correios_debito_vencido(kc.consultora_party_id);
    dest := public.correios_endereco(kc.consultora_party_id);
    rem := public.correios_endereco(emitente);
  else
    select a.status into acerto from kit_acertos a where a.cycle_id = _cycle order by a.revision desc limit 1;
    if kc.status::text <> 'encerrada'
       and coalesce(acerto, '') not in ('conferido','aprovado','contabilizado','parcialmente_recebido','liquidado','ajustado') then
      raise exception 'A volta só é liberada com o acerto fechado (maleta %, acerto %).', kc.status, coalesce(acerto, 'nenhum');
    end if;
    select coalesce(sum(greatest(b.qty_accepted - b.qty_sold - b.qty_returned - b.qty_lost, 0) * coalesce(v.finished_piece_cost_cents, 0)), 0)
      into valor from kit_balances b join product_variants v on v.id = b.variant_id where b.cycle_id = _cycle;
    if coalesce(valor, 0) = 0 then
      select e.valor_declarado_cents into valor from correios_envios e
       where e.cycle_id = _cycle and e.direcao = 'ida' and e.status not in ('erro','cancelada') order by e.created_at desc limit 1;
      valor := coalesce(valor, 0);
    end if;
    rem := public.correios_endereco(kc.consultora_party_id);
    dest := public.correios_endereco(emitente);
    if coalesce(rem->>'email', '') = '' then pend := array_append(pend, 'consultora sem e-mail (a reversa dos Correios exige)'); end if;
  end if;

  if coalesce(dest->>'cep', '') !~ '^[0-9]{8}$' then pend := array_append(pend, 'CEP do destinatário inválido'); end if;
  if coalesce(btrim(dest->>'logradouro'), '') = '' or coalesce(btrim(dest->>'bairro'), '') = '' or coalesce(dest->>'cidade', '') = '' then
    pend := array_append(pend, 'endereço do destinatário incompleto'); end if;
  if coalesce(rem->>'cep', '') !~ '^[0-9]{8}$' or coalesce(btrim(rem->>'logradouro'), '') = '' then
    pend := array_append(pend, 'endereço do remetente incompleto'); end if;
  if length(coalesce(rem->>'doc', '')) not in (11, 14) then pend := array_append(pend, 'remetente sem CPF/CNPJ'); end if;

  return jsonb_build_object('cycle_id', _cycle, 'direcao', _direcao, 'consultora_party_id', kc.consultora_party_id,
    'destinatario', dest, 'remetente', rem, 'valor_declarado_cents', valor, 'debito_vencido_cents', debito,
    'pendencias', to_jsonb(pend),
    'envio_vivo', case when vivo.id is null then null else jsonb_build_object('id', vivo.id, 'status', vivo.status, 'codigo_objeto', vivo.codigo_objeto) end);
end $$;
revoke all on function public.correios_maleta_dados(uuid, text) from public, anon;
grant execute on function public.correios_maleta_dados(uuid, text) to authenticated, service_role;

create or replace function public.correios_envio_abrir(_cycle uuid, _direcao text, _ambiente text, _servico text,
  _valor_cents bigint, _payload jsonb, _ator uuid, _liberar_debito text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare d jsonb; id uuid; deb bigint;
begin
  if not public.correios_eh_servidor() then raise exception 'Só o servidor registra envio.' using errcode = '42501'; end if;
  d := public.correios_maleta_dados(_cycle, _direcao);
  if jsonb_array_length(d->'pendencias') > 0 and not (d->'pendencias' = '["peça sem custo cadastrado (o valor declarado sairia menor)"]'::jsonb) then
    raise exception 'Cadastro incompleto: %.', (select string_agg(x, '; ') from jsonb_array_elements_text(d->'pendencias') x);
  end if;
  if d->'envio_vivo' is not null and d->'envio_vivo' <> 'null'::jsonb then
    raise exception 'Esta maleta já tem envio de % (%).', _direcao, d->'envio_vivo'->>'status';
  end if;
  deb := coalesce((d->>'debito_vencido_cents')::bigint, 0);
  if _direcao = 'ida' and deb > 0 then
    if coalesce(btrim(_liberar_debito), '') = '' then
      raise exception 'Consultora com débito vencido de R$ %: a maleta não sai pelo correio. O Master pode liberar informando o motivo.',
        to_char(deb / 100.0, 'FM999G999G990D00');
    end if;
    if _ator is null or not public.has_role(_ator, 'master') then
      raise exception 'Só o Master libera envio com débito vencido.';
    end if;
  end if;
  insert into correios_envios (cycle_id, direcao, ambiente, servico, valor_declarado_cents, payload, criado_por,
                               debito_cents, debito_liberado_motivo)
  values (_cycle, _direcao, _ambiente, _servico, coalesce(_valor_cents, 0), coalesce(_payload, '{}'::jsonb), _ator,
          nullif(deb, 0), case when deb > 0 then btrim(_liberar_debito) end)
  returning correios_envios.id into id;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (_ator, 'correios.envio.abrir', 'correios_envios', id::text,
          jsonb_build_object('cycle_id', _cycle, 'direcao', _direcao, 'servico', _servico, 'valor_declarado_cents', _valor_cents,
                             'debito_cents', deb, 'liberado', _liberar_debito));
  return id;
end $$;
revoke all on function public.correios_envio_abrir(uuid, text, text, text, bigint, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.correios_envio_abrir(uuid, text, text, text, bigint, jsonb, uuid, text) to service_role;

create or replace function public.correios_envio_resultado(_id uuid, _ok boolean, _resposta jsonb, _codigo text,
  _prepostagem text, _frete_cents bigint, _prazo int, _erro text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare e record;
begin
  if not public.correios_eh_servidor() then raise exception 'Só o servidor.' using errcode = '42501'; end if;
  update correios_envios set
     status = case when _ok then 'pre_postada' else 'erro' end,
     resposta = _resposta, codigo_objeto = case when _ok then upper(nullif(btrim(_codigo), '')) end,
     prepostagem_id = _prepostagem, frete_cents = _frete_cents, prazo_dias = _prazo,
     previsto_entrega = case when _prazo is not null then (now() at time zone 'America/Sao_Paulo')::date + _prazo end,
     erro = case when _ok then null else left(_erro, 500) end, updated_at = now()
   where id = _id and status = 'criando'
  returning * into e;
  if not found then raise exception 'Envio inexistente ou já finalizado.'; end if;
  if _ok and e.direcao = 'ida' then
    update kit_cycles set notes = concat_ws(E'\n', nullif(notes, ''), 'Correios: ' || e.codigo_objeto), updated_at = now() where id = e.cycle_id;
  end if;
  return to_jsonb(e);
end $$;
revoke all on function public.correios_envio_resultado(uuid, boolean, jsonb, text, text, bigint, int, text) from public, anon, authenticated;
grant execute on function public.correios_envio_resultado(uuid, boolean, jsonb, text, text, bigint, int, text) to service_role;

create or replace function public.correios_envio_rotulo(_id uuid, _path text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.correios_eh_servidor() then raise exception 'Só o servidor.' using errcode = '42501'; end if;
  update correios_envios set rotulo_path = _path, updated_at = now() where id = _id;
end $$;
revoke all on function public.correios_envio_rotulo(uuid, text) from public, anon, authenticated;
grant execute on function public.correios_envio_rotulo(uuid, text) to service_role;

create or replace function public.correios_envio_rastro(_id uuid, _eventos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare e record; postado timestamptz; entregue timestamptz; novo text;
begin
  if not public.correios_eh_servidor() then raise exception 'Só o servidor.' using errcode = '42501'; end if;
  select * into e from correios_envios where id = _id for update;
  if not found then raise exception 'Envio inexistente.'; end if;
  _eventos := coalesce(_eventos, '[]'::jsonb);
  select min((x->>'dtHrCriado')::timestamp at time zone 'America/Sao_Paulo') into postado
    from jsonb_array_elements(_eventos) x where x->>'codigo' = 'PO';
  select min((x->>'dtHrCriado')::timestamp at time zone 'America/Sao_Paulo') into entregue
    from jsonb_array_elements(_eventos) x where x->>'codigo' in ('BDE','BDI','BDR') and x->>'tipo' in ('01','1');
  novo := case when entregue is not null then 'entregue'
               when postado is not null or jsonb_array_length(_eventos) > 0 then
                 case when e.status in ('pre_postada','postada') and postado is not null and jsonb_array_length(_eventos) <= 1 then 'postada' else 'em_transito' end
               else e.status end;
  if e.status in ('cancelada','erro','expirada') then novo := e.status; end if;
  update correios_envios set eventos = _eventos, rastreado_em = now(), status = novo,
         postado_em = coalesce(postado_em, postado), entregue_em = coalesce(entregue_em, entregue), updated_at = now()
   where id = _id returning * into e;
  if e.direcao = 'ida' and e.entregue_em is not null then
    update kit_cycles set due_at = e.entregue_em + interval '30 days', updated_at = now()
     where id = e.cycle_id and status::text not in ('encerrada','cancelada','acerto')
       and due_at is distinct from e.entregue_em + interval '30 days';
  end if;
  return to_jsonb(e);
end $$;
revoke all on function public.correios_envio_rastro(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.correios_envio_rastro(uuid, jsonb) to service_role;

create or replace function public.correios_volta_codigo_enviado(_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare e record;
begin
  if not public.can_manage_kits(auth.uid()) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update correios_envios set codigo_enviado_em = coalesce(codigo_enviado_em, now()),
         limite_postagem = coalesce(limite_postagem, (now() at time zone 'America/Sao_Paulo')::date + 5), updated_at = now()
   where id = _id and direcao = 'volta' and status in ('pre_postada','postada','em_transito','entregue')
  returning * into e;
  if not found then raise exception 'Volta não encontrada ou sem código.'; end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'correios.volta.codigo_enviado', 'correios_envios', _id::text, jsonb_build_object('limite', e.limite_postagem));
  return to_jsonb(e);
end $$;
revoke all on function public.correios_volta_codigo_enviado(uuid) from public, anon;
grant execute on function public.correios_volta_codigo_enviado(uuid) to authenticated;

create or replace function public.correios_painel(_cycle uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not (public.can_manage_kits(auth.uid()) or public.has_capability(auth.uid(),'finance.receivable.view')) then
    raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'envios', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'cycle_id', e.cycle_id, 'kit', k.label, 'consultora', p.display_name,
        'direcao', e.direcao, 'status', e.status, 'codigo_objeto', e.codigo_objeto, 'frete_cents', e.frete_cents,
        'valor_declarado_cents', e.valor_declarado_cents, 'previsto_entrega', e.previsto_entrega, 'postado_em', e.postado_em,
        'entregue_em', e.entregue_em, 'codigo_enviado_em', e.codigo_enviado_em, 'limite_postagem', e.limite_postagem,
        'tem_rotulo', e.rotulo_path is not null, 'erro', e.erro, 'ambiente', e.ambiente, 'debito_liberado_motivo', e.debito_liberado_motivo,
        'ultimo_evento', e.eventos->0->>'descricao', 'created_at', e.created_at,
        'whatsapp', (select regexp_replace(cp.value, '[^0-9]', '', 'g') from contact_points cp
                      where cp.party_id = kc.consultora_party_id and cp.kind in ('whatsapp','telefone')
                      order by (cp.kind = 'whatsapp') desc, cp.is_primary desc, cp.created_at limit 1)) order by e.created_at desc)
      from correios_envios e join kit_cycles kc on kc.id = e.cycle_id join kits k on k.id = kc.kit_id
      left join parties p on p.id = kc.consultora_party_id
     where (_cycle is null and e.created_at > now() - interval '120 days') or e.cycle_id = _cycle), '[]'::jsonb),
    'alertas_volta', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'cycle_id', e.cycle_id, 'kit', k.label, 'consultora', p.display_name,
        'codigo_objeto', e.codigo_objeto, 'limite_postagem', e.limite_postagem, 'dias_atraso', hoje - e.limite_postagem) order by e.limite_postagem)
      from correios_envios e join kit_cycles kc on kc.id = e.cycle_id join kits k on k.id = kc.kit_id
      left join parties p on p.id = kc.consultora_party_id
     where e.direcao = 'volta' and e.postado_em is null and e.limite_postagem is not null and e.limite_postagem < hoje
       and e.status in ('pre_postada') and (_cycle is null or e.cycle_id = _cycle)), '[]'::jsonb),
    'indicadores', (select jsonb_build_object(
        'em_transito', count(*) filter (where status in ('postada','em_transito')),
        'aguardando_postagem', count(*) filter (where status = 'pre_postada'),
        'entregues_90d', count(*) filter (where status = 'entregue' and entregue_em > now() - interval '90 days'),
        'frete_90d_cents', coalesce(sum(frete_cents) filter (where created_at > now() - interval '90 days' and status not in ('erro','cancelada')), 0),
        'prazo_medio_dias', round(avg(extract(epoch from entregue_em - postado_em) / 86400.0) filter (where entregue_em is not null and postado_em is not null), 1),
        'volta_no_prazo_pct', round(100.0 * count(*) filter (where direcao = 'volta' and postado_em is not null and postado_em::date <= limite_postagem)
                                   / nullif(count(*) filter (where direcao = 'volta' and codigo_enviado_em is not null and (postado_em is not null or limite_postagem < hoje)), 0), 0))
      from correios_envios where _cycle is null or cycle_id = _cycle)
  );
end $$;
revoke all on function public.correios_painel(uuid) from public, anon;
grant execute on function public.correios_painel(uuid) to authenticated;

create or replace function public.correios_para_rastrear(_limite int default 40)
returns setof public.correios_envios language sql stable security definer set search_path to 'public' as $$
  select * from correios_envios
   where public.correios_eh_servidor() and codigo_objeto is not null and status in ('pre_postada','postada','em_transito')
     and (rastreado_em is null or rastreado_em < now() - interval '1 hour')
   order by rastreado_em nulls first limit greatest(least(_limite, 200), 1)
$$;
revoke all on function public.correios_para_rastrear(int) from public, anon, authenticated;
grant execute on function public.correios_para_rastrear(int) to service_role;

create or replace function public.correios_envio_cancelar(_id uuid, _motivo text, _ator uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.correios_eh_servidor() then raise exception 'Só o servidor.' using errcode = '42501'; end if;
  if coalesce(btrim(_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  update correios_envios set status = 'cancelada', erro = left('Cancelado: ' || btrim(_motivo), 500), updated_at = now()
   where id = _id and status in ('criando','pre_postada');
  if not found then raise exception 'Só envio ainda não postado pode ser cancelado.'; end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (_ator, 'correios.envio.cancelar', 'correios_envios', _id::text, jsonb_build_object('motivo', _motivo));
end $$;
revoke all on function public.correios_envio_cancelar(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.correios_envio_cancelar(uuid, text, uuid) to service_role;