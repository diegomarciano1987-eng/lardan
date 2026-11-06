-- 0246 — Acertos do representante e "Informações da remessa" (05/11/2026).

create table if not exists public.remessa_informacoes (
  id uuid primary key default gen_random_uuid(),
  remessa_id uuid not null references public.remessas(id) on delete cascade,
  consultora_party_id uuid not null references public.parties(id),
  cycle_id uuid references public.kit_cycles(id),
  sem_maleta_motivo text check (sem_maleta_motivo is null or sem_maleta_motivo in ('inadimplente','pausa','sem_estoque','desistiu','outro')),
  info_acerto text check (info_acerto is null or length(info_acerto) <= 2000),
  atualizado_por uuid,
  atualizado_por_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (remessa_id, consultora_party_id)
);
create index if not exists remessa_informacoes_cycle_idx on public.remessa_informacoes (cycle_id);
alter table public.remessa_informacoes enable row level security;
revoke all on public.remessa_informacoes from anon, authenticated;
grant all on public.remessa_informacoes to service_role;

create table if not exists public.rep_acerto_checklist (
  remessa_id uuid not null references public.remessas(id) on delete cascade,
  consultora_party_id uuid not null references public.parties(id),
  rep_party_id uuid not null references public.parties(id),
  feito_em timestamptz not null default now(),
  feito_por uuid,
  primary key (remessa_id, consultora_party_id)
);
alter table public.rep_acerto_checklist enable row level security;
revoke all on public.rep_acerto_checklist from anon, authenticated;
grant all on public.rep_acerto_checklist to service_role;

create or replace function public.kit_data_acerto(_c public.kit_cycles)
returns date language sql stable security definer set search_path to 'public' as $$
  select coalesce((_c.due_at at time zone 'America/Sao_Paulo')::date,
                  ((_c.received_at at time zone 'America/Sao_Paulo') + interval '42 days')::date,
                  (select r.data_acerto from remessas r where r.id = _c.remessa_id))
$$;
revoke all on function public.kit_data_acerto(public.kit_cycles) from public, anon;
grant execute on function public.kit_data_acerto(public.kit_cycles) to authenticated, service_role;

create or replace function public.remessa_informacoes_lista(_remessa uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare r record;
begin
  if not public.can_manage_kits(auth.uid()) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into r from remessas where id = _remessa;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  return coalesce((select jsonb_agg(x order by x.tem_maleta desc, x.nome) from (
    select p.id as party_id, p.display_name as nome, p.code as codigo,
           k.id as cycle_id, kt.code as maleta, k.status::text as status_maleta, (k.id is not null) as tem_maleta,
           i.sem_maleta_motivo, i.info_acerto, i.atualizado_por_nome, i.updated_at,
           public.kit_debito_vencido(p.id) as debito_vencido_cents
      from (select cp.party_id from consultant_profiles cp join parties pa on pa.id = cp.party_id
             where cp.praca_id = r.praca_id and pa.status not in ('desligado','bloqueado','inativo','rascunho')
            union
            select kc.consultora_party_id from kit_cycles kc where kc.remessa_id = _remessa and kc.status <> 'cancelada' and kc.consultora_party_id is not null) base
      join parties p on p.id = base.party_id
      left join lateral (select kc.* from kit_cycles kc where kc.remessa_id = _remessa and kc.consultora_party_id = p.id and kc.status <> 'cancelada'
                           order by kc.created_at desc limit 1) k on true
      left join kits kt on kt.id = k.kit_id
      left join remessa_informacoes i on i.remessa_id = _remessa and i.consultora_party_id = p.id
  ) x), '[]'::jsonb);
end $$;
revoke all on function public.remessa_informacoes_lista(uuid) from public, anon;
grant execute on function public.remessa_informacoes_lista(uuid) to authenticated;

create or replace function public.kit_debito_vencido(_party uuid)
returns bigint language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(public.fin_installment_saldo(i.id)), 0)::bigint
    from financial_installments i join financial_titles t on t.id = i.title_id
   where t.direction = 'receivable' and t.status in ('ativo','aprovado')
     and coalesce(t.pagador_party_id, t.party_id) = _party
     and i.vencimento < (now() at time zone 'America/Sao_Paulo')::date
     and public.fin_installment_saldo(i.id) > 0
$$;
revoke all on function public.kit_debito_vencido(uuid) from public, anon, authenticated;

create or replace function public.remessa_informacao_salvar(_remessa uuid, _party uuid, _motivo text, _info text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; ciclo uuid; nome text; linha public.remessa_informacoes;
begin
  if not public.can_manage_kits(auth.uid()) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into r from remessas where id = _remessa;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  if r.status = 'cancelada' then raise exception 'Remessa cancelada.'; end if;
  select kc.id into ciclo from kit_cycles kc where kc.remessa_id = _remessa and kc.consultora_party_id = _party and kc.status <> 'cancelada'
   order by kc.created_at desc limit 1;
  if ciclo is null and not exists (select 1 from consultant_profiles cp where cp.party_id = _party and cp.praca_id = r.praca_id) then
    raise exception 'Esta consultora não é da praça da remessa.';
  end if;
  _motivo := nullif(btrim(coalesce(_motivo, '')), '');
  if ciclo is not null then _motivo := null; end if;
  if _motivo is not null and _motivo not in ('inadimplente','pausa','sem_estoque','desistiu','outro') then raise exception 'Motivo inválido.'; end if;
  if _motivo = 'outro' and coalesce(btrim(_info), '') = '' then raise exception 'Em "Outro", escreva o motivo na observação.'; end if;
  select coalesce(pa.display_name, pr.full_name) into nome from profiles pr left join parties pa on pa.id = pr.party_id where pr.id = auth.uid();
  insert into remessa_informacoes (remessa_id, consultora_party_id, cycle_id, sem_maleta_motivo, info_acerto, atualizado_por, atualizado_por_nome)
  values (_remessa, _party, ciclo, _motivo, nullif(btrim(coalesce(_info, '')), ''), auth.uid(), nome)
  on conflict (remessa_id, consultora_party_id) do update
     set cycle_id = excluded.cycle_id, sem_maleta_motivo = excluded.sem_maleta_motivo, info_acerto = excluded.info_acerto,
         atualizado_por = excluded.atualizado_por, atualizado_por_nome = excluded.atualizado_por_nome, updated_at = now()
  returning * into linha;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'remessa.informacao', 'remessa_informacoes', linha.id::text,
          jsonb_build_object('remessa', _remessa, 'party', _party, 'motivo', _motivo, 'tamanho', length(coalesce(_info, ''))));
  return to_jsonb(linha);
end $$;
revoke all on function public.remessa_informacao_salvar(uuid, uuid, text, text) from public, anon;
grant execute on function public.remessa_informacao_salvar(uuid, uuid, text, text) to authenticated;

create or replace function public.rep_remessas(_rep uuid, _de date, _ate date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.rep_portal_pode(_rep) then raise exception 'Sem acesso a esta carteira.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.data_emissao desc, x.numero desc) from (
    select r.id, r.numero, r.status, r.data_emissao, r.data_acerto, coalesce(pc.nome, '—') as praca,
           (r.representante_party_id = _rep) as em_meu_nome,
           (select count(*) from kit_cycles k where k.remessa_id = r.id and k.status <> 'cancelada') as maletas,
           (select coalesce(sum(k.reference_total_cents), 0) from kit_cycles k where k.remessa_id = r.id and k.status <> 'cancelada') as valor_cents,
           (select count(*) from remessa_informacoes i where i.remessa_id = r.id and (i.info_acerto is not null or i.sem_maleta_motivo is not null)) as informacoes,
           (select count(*) from rep_acerto_checklist ck where ck.remessa_id = r.id
              and exists (select 1 from kit_cycles k where k.remessa_id = r.id and k.consultora_party_id = ck.consultora_party_id and k.status <> 'cancelada')) as acertos_feitos
      from remessas r left join cob_pracas pc on pc.id = r.praca_id
     where r.status <> 'cancelada'
       and (r.representante_party_id = _rep or r.praca_id = any(public.rep_praca_ids(_rep)))
       and (r.data_emissao between _de and _ate or r.data_acerto between _de and _ate)
  ) x), '[]'::jsonb);
end $$;
revoke all on function public.rep_remessas(uuid, date, date) from public, anon;
grant execute on function public.rep_remessas(uuid, date, date) to authenticated;

create or replace function public.rep_remessa_informacoes(_rep uuid, _remessa uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare r record;
begin
  if not public.rep_portal_pode(_rep) then raise exception 'Sem acesso a esta carteira.' using errcode = '42501'; end if;
  select * into r from remessas where id = _remessa;
  if not found or not (r.representante_party_id = _rep or r.praca_id = any(public.rep_praca_ids(_rep))) then
    raise exception 'Remessa fora da sua carteira.' using errcode = '42501';
  end if;
  return jsonb_build_object('numero', r.numero, 'data_emissao', r.data_emissao, 'data_acerto', r.data_acerto,
    'praca', (select nome from cob_pracas where id = r.praca_id),
    'itens', coalesce((select jsonb_agg(x order by x.tem_maleta desc, x.nome) from (
      select p.id as party_id, p.display_name as nome, p.code as codigo, kt.code as maleta, (k.id is not null) as tem_maleta,
             case when k.id is not null then public.kit_data_acerto(k) end as acerto,
             (select regexp_replace(cp2.value, '[^0-9]', '', 'g') from contact_points cp2 where cp2.party_id = p.id and cp2.kind = 'whatsapp' order by cp2.is_primary desc limit 1) as whatsapp,
             i.sem_maleta_motivo, i.info_acerto, i.atualizado_por_nome, i.updated_at,
             ck.feito_em
        from (select kc.consultora_party_id as party_id from kit_cycles kc where kc.remessa_id = _remessa and kc.status <> 'cancelada' and kc.consultora_party_id is not null
              union select ri.consultora_party_id from remessa_informacoes ri where ri.remessa_id = _remessa) base
        join parties p on p.id = base.party_id
        left join lateral (select kc.* from kit_cycles kc where kc.remessa_id = _remessa and kc.consultora_party_id = p.id and kc.status <> 'cancelada'
                            order by kc.created_at desc limit 1) k on true
        left join kits kt on kt.id = k.kit_id
        left join remessa_informacoes i on i.remessa_id = _remessa and i.consultora_party_id = p.id
        left join rep_acerto_checklist ck on ck.remessa_id = _remessa and ck.consultora_party_id = p.id
    ) x), '[]'::jsonb));
end $$;
revoke all on function public.rep_remessa_informacoes(uuid, uuid) from public, anon;
grant execute on function public.rep_remessa_informacoes(uuid, uuid) to authenticated;

create or replace function public.rep_acertos(_rep uuid, _de date, _ate date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; afazer jsonb; feitos jsonb;
begin
  if not public.rep_portal_pode(_rep) then raise exception 'Sem acesso a esta carteira.' using errcode = '42501'; end if;
  if _de is null or _ate is null or _ate < _de then raise exception 'Período inválido.'; end if;
  select coalesce(jsonb_agg(x order by (x->>'acerto') nulls last, x->>'consultora'), '[]'::jsonb) into afazer from (
    select e || jsonb_build_object('acerto', ac.d, 'dias', ac.d - hoje, 'vencida', coalesce(ac.d < hoje, false),
             'info_acerto', i.info_acerto, 'info_por', i.atualizado_por_nome,
             'whatsapp', (select regexp_replace(cp2.value, '[^0-9]', '', 'g') from contact_points cp2 where cp2.party_id = (e->>'party_id')::uuid and cp2.kind = 'whatsapp' order by cp2.is_primary desc limit 1)) as x
      from jsonb_array_elements(public.rep_maletas_carteira(_rep)) e
      left join kit_cycles kc on e->>'cycle_id' is not null and kc.id = (e->>'cycle_id')::uuid
      cross join lateral (select case when kc.id is not null then public.kit_data_acerto(kc) else (e->>'acerto')::date end as d) ac
      left join remessa_informacoes i on kc.id is not null and i.remessa_id = kc.remessa_id and i.consultora_party_id = kc.consultora_party_id
     where ac.d is not null and ac.d <= _ate
       and coalesce(e->>'pre_baixa', '') not in ('encerrada','conferida')
  ) s;
  select coalesce(jsonb_agg(jsonb_build_object('cycle_id', pb.cycle_id, 'consultora', p.display_name, 'maleta', k.code,
            'data', (coalesce(pb.fechada_em, pb.conferida_em, pb.encerrada_em) at time zone 'America/Sao_Paulo')::date,
            'situacao', pb.status, 'vendido_cents', coalesce(pb.vendido_final_cents, pb.total_vendido_cents, 0),
            'pagar_cents', coalesce(pb.valor_final_cents, pb.valor_pagar_cents, 0))
          order by coalesce(pb.fechada_em, pb.conferida_em, pb.encerrada_em) desc), '[]'::jsonb) into feitos
    from kit_pre_baixas pb
    join kit_cycles c on c.id = pb.cycle_id
    join kits k on k.id = c.kit_id
    join parties p on p.id = pb.consultora_party_id
   where (exists (select 1 from consultant_profiles cp where cp.party_id = pb.consultora_party_id and cp.representative_party_id = _rep)
          or c.representante_party_id = _rep)
     and coalesce(pb.fechada_em, pb.conferida_em, pb.encerrada_em) is not null
     and (coalesce(pb.fechada_em, pb.conferida_em, pb.encerrada_em) at time zone 'America/Sao_Paulo')::date between _de and _ate;
  return jsonb_build_object('de', _de, 'ate', _ate, 'hoje', hoje,
    'a_fazer', afazer,
    'a_fazer_qtd', jsonb_array_length(afazer),
    'atrasados_qtd', (select count(*) from jsonb_array_elements(afazer) x where (x->>'acerto')::date < hoje),
    'feitos', feitos,
    'feitos_qtd', jsonb_array_length(feitos),
    'venda_bruta_cents', coalesce((select sum((x->>'vendido_cents')::bigint) from jsonb_array_elements(feitos) x), 0),
    'remessas', public.rep_remessas(_rep, _de, _ate));
end $$;
revoke all on function public.rep_acertos(uuid, date, date) from public, anon;
grant execute on function public.rep_acertos(uuid, date, date) to authenticated;

create or replace function public.rep_acerto_marcar(_rep uuid, _remessa uuid, _party uuid, _feito boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if not public.rep_portal_pode(_rep) then raise exception 'Sem acesso a esta carteira.' using errcode = '42501'; end if;
  select * into r from remessas where id = _remessa;
  if not found or not (r.representante_party_id = _rep or r.praca_id = any(public.rep_praca_ids(_rep))) then
    raise exception 'Remessa fora da sua carteira.' using errcode = '42501';
  end if;
  if not exists (select 1 from kit_cycles k where k.remessa_id = _remessa and k.consultora_party_id = _party and k.status <> 'cancelada') then
    raise exception 'Esta consultora não tem maleta nesta remessa.';
  end if;
  if coalesce(_feito, false) then
    insert into rep_acerto_checklist (remessa_id, consultora_party_id, rep_party_id, feito_por)
    values (_remessa, _party, _rep, auth.uid()) on conflict (remessa_id, consultora_party_id) do nothing;
  else
    delete from rep_acerto_checklist where remessa_id = _remessa and consultora_party_id = _party;
  end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), case when _feito then 'rep.acerto.feito' else 'rep.acerto.desfeito' end, 'rep_acerto_checklist', _remessa::text,
          jsonb_build_object('party', _party, 'rep', _rep));
  return jsonb_build_object('feito', coalesce(_feito, false),
    'feitos', (select count(*) from rep_acerto_checklist where remessa_id = _remessa),
    'total', (select count(*) from kit_cycles k where k.remessa_id = _remessa and k.status <> 'cancelada' and k.consultora_party_id is not null));
end $$;
revoke all on function public.rep_acerto_marcar(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.rep_acerto_marcar(uuid, uuid, uuid, boolean) to authenticated;