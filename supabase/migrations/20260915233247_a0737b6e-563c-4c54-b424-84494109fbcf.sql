-- Situação de liquidação recalculada a partir das alocações e ajustes.
create or replace function public.fin_installment_refresh(_installment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_valor bigint; v_ajuste bigint; v_aloc bigint; v_devido bigint; v_st fin_settlement_status;
begin
  select valor_cents into v_valor from financial_installments where id = _installment;
  if v_valor is null then return; end if;
  select coalesce(sum(case when kind in ('juros','multa','tarifa') then valor_cents
                           when kind in ('desconto','abatimento') then -valor_cents
                           else 0 end),0)
    into v_ajuste from financial_adjustments where installment_id = _installment;
  select coalesce(sum(valor_cents),0) into v_aloc from financial_allocations where installment_id = _installment;
  v_devido := v_valor + v_ajuste;
  v_st := case when v_aloc <= 0 then 'nao_liquidado'
               when v_aloc < v_devido then 'parcial'
               when v_aloc = v_devido then 'liquidado'
               else 'excedente' end;
  update financial_installments set settlement_status = v_st, updated_at = now() where id = _installment;
end $$;
revoke execute on function public.fin_installment_refresh(uuid) from public, anon;

-- Criação de título com parcelas.
create or replace function public.fin_title_create(_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_dir fin_direction; v_id uuid; v_total bigint; v_soma bigint := 0; p jsonb; v_cap text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_dir := (_payload->>'direction')::fin_direction;
  v_cap := case when v_dir = 'payable' then 'finance.payable.manage' else 'finance.receivable.manage' end;
  if not has_capability(auth.uid(), v_cap) then raise exception 'Sem permissão para este tipo de título'; end if;
  v_total := (_payload->>'valor_cents')::bigint;
  if v_total is null or v_total <= 0 then raise exception 'Valor do título deve ser maior que zero'; end if;
  if jsonb_typeof(_payload->'parcelas') <> 'array' or jsonb_array_length(_payload->'parcelas') = 0 then
    raise exception 'Informe ao menos uma parcela';
  end if;
  for p in select * from jsonb_array_elements(_payload->'parcelas') loop
    if (p->>'valor_cents')::bigint <= 0 then raise exception 'Parcela com valor inválido'; end if;
    if (p->>'vencimento') is null then raise exception 'Parcela sem vencimento'; end if;
    v_soma := v_soma + (p->>'valor_cents')::bigint;
  end loop;
  if v_soma <> v_total then raise exception 'Soma das parcelas (%) difere do total do título (%)', v_soma, v_total; end if;

  insert into financial_titles (direction, business_entity_id, party_id, pagador_party_id, descricao, documento,
      emissao, competencia, valor_cents, chart_account_id, cost_center_id, payment_method_id, financial_account_id,
      origem, sistema_origem, id_externo, observacao, status, created_by)
  values (v_dir, nullif(_payload->>'business_entity_id','')::uuid, (_payload->>'party_id')::uuid,
      nullif(_payload->>'pagador_party_id','')::uuid, _payload->>'descricao', nullif(_payload->>'documento',''),
      coalesce(nullif(_payload->>'emissao','')::date, current_date), nullif(_payload->>'competencia','')::date,
      v_total, nullif(_payload->>'chart_account_id','')::uuid, nullif(_payload->>'cost_center_id','')::uuid,
      nullif(_payload->>'payment_method_id','')::uuid, nullif(_payload->>'financial_account_id','')::uuid,
      coalesce(nullif(_payload->>'origem',''),'manual'), nullif(_payload->>'sistema_origem',''),
      nullif(_payload->>'id_externo',''), nullif(_payload->>'observacao',''),
      coalesce(nullif(_payload->>'status','')::fin_title_status,'ativo'), auth.uid())
  returning id into v_id;

  insert into financial_installments (title_id, numero, total_parcelas, vencimento, valor_cents)
  select v_id, (row_number() over ())::int, jsonb_array_length(_payload->'parcelas'),
         (e->>'vencimento')::date, (e->>'valor_cents')::bigint
  from jsonb_array_elements(_payload->'parcelas') e;

  insert into financial_title_events (title_id, evento, payload, actor_id)
  values (v_id, 'criado', jsonb_build_object('valor_cents', v_total), auth.uid());
  return v_id;
end $$;
revoke execute on function public.fin_title_create(jsonb) from public, anon;
grant execute on function public.fin_title_create(jsonb) to authenticated;

-- Aprovar título.
create or replace function public.fin_title_approve(_title uuid, _motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_capability(auth.uid(),'finance.title.approve') then raise exception 'Sem permissão para aprovar'; end if;
  update financial_titles set status = 'ativo', approval_status = 'aprovada', updated_at = now() where id = _title;
  insert into financial_title_events (title_id, evento, motivo, actor_id) values (_title,'aprovado',_motivo,auth.uid());
end $$;
revoke execute on function public.fin_title_approve(uuid, text) from public, anon;
grant execute on function public.fin_title_approve(uuid, text) to authenticated;

-- Cancelar título (nunca apaga).
create or replace function public.fin_title_cancel(_title uuid, _motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_dir fin_direction; v_pago bigint;
begin
  select direction into v_dir from financial_titles where id = _title;
  if v_dir is null then raise exception 'Título não encontrado'; end if;
  if not has_capability(auth.uid(), case when v_dir='payable' then 'finance.payable.manage' else 'finance.receivable.manage' end)
    then raise exception 'Sem permissão'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Cancelamento exige motivo'; end if;
  select coalesce(sum(a.valor_cents),0) into v_pago from financial_allocations a
    join financial_installments i on i.id = a.installment_id where i.title_id = _title;
  if v_pago <> 0 then raise exception 'Título com baixas registradas não pode ser cancelado; estorne primeiro'; end if;
  update financial_titles set status='cancelado', cancel_reason=_motivo, updated_at=now() where id=_title;
  insert into financial_title_events (title_id, evento, motivo, actor_id) values (_title,'cancelado',_motivo,auth.uid());
end $$;
revoke execute on function public.fin_title_cancel(uuid, text) from public, anon;
grant execute on function public.fin_title_cancel(uuid, text) to authenticated;

-- Baixa (pagamento/recebimento) com alocações, idempotente e transacional.
create or replace function public.fin_settlement_create(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dir fin_direction; v_valor bigint; v_soma bigint := 0; v_id uuid; v_key text; e jsonb;
  v_inst uuid; v_ex uuid; v_devido bigint; v_aloc bigint;
begin
  if not has_capability(auth.uid(),'finance.settlement.create') then raise exception 'Sem permissão para registrar baixa'; end if;
  v_dir := (_payload->>'direction')::fin_direction;
  v_valor := (_payload->>'valor_cents')::bigint;
  v_key := nullif(_payload->>'idempotency_key','');
  if v_valor is null or v_valor <= 0 then raise exception 'Valor da baixa deve ser maior que zero'; end if;
  if v_key is not null then
    select id into v_ex from financial_settlements where idempotency_key = v_key;
    if v_ex is not null then return jsonb_build_object('id', v_ex, 'repetido', true); end if;
  end if;

  for e in select * from jsonb_array_elements(_payload->'alocacoes') loop
    v_inst := (e->>'installment_id')::uuid;
    perform 1 from financial_installments where id = v_inst for update;
    v_soma := v_soma + (e->>'valor_cents')::bigint;
  end loop;
  if v_soma <= 0 then raise exception 'Informe ao menos uma parcela para alocar'; end if;
  if v_soma > v_valor then raise exception 'Alocação (%) maior que o valor da baixa (%)', v_soma, v_valor; end if;

  insert into financial_settlements (direction, financial_account_id, data, valor_cents, payment_method_id,
      referencia, observacao, idempotency_key, created_by)
  values (v_dir, (_payload->>'financial_account_id')::uuid, coalesce(nullif(_payload->>'data','')::date, current_date),
      v_valor, nullif(_payload->>'payment_method_id','')::uuid, nullif(_payload->>'referencia',''),
      nullif(_payload->>'observacao',''), v_key, auth.uid())
  returning id into v_id;

  for e in select * from jsonb_array_elements(_payload->'alocacoes') loop
    v_inst := (e->>'installment_id')::uuid;
    insert into financial_allocations (settlement_id, installment_id, valor_cents)
    values (v_id, v_inst, (e->>'valor_cents')::bigint);
    perform fin_installment_refresh(v_inst);
    insert into financial_title_events (title_id, evento, payload, actor_id)
    select i.title_id, case when v_dir='payable' then 'pagamento' else 'recebimento' end,
           jsonb_build_object('settlement_id', v_id, 'valor_cents', (e->>'valor_cents')::bigint), auth.uid()
    from financial_installments i where i.id = v_inst;
  end loop;

  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao, created_by)
  values ((_payload->>'financial_account_id')::uuid, case when v_dir='payable' then 'saida' else 'entrada' end,
      coalesce(nullif(_payload->>'data','')::date, current_date),
      case when v_dir='payable' then -v_valor else v_valor end, v_id,
      nullif(_payload->>'referencia',''), auth.uid());

  return jsonb_build_object('id', v_id, 'repetido', false, 'nao_alocado_cents', v_valor - v_soma);
end $$;
revoke execute on function public.fin_settlement_create(jsonb) from public, anon;
grant execute on function public.fin_settlement_create(jsonb) to authenticated;

-- Estorno de baixa: evento compensatório, nunca exclusão.
create or replace function public.fin_settlement_reverse(_settlement uuid, _motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare s financial_settlements%rowtype; v_new uuid; a record;
begin
  if not has_capability(auth.uid(),'finance.settlement.reverse') then raise exception 'Sem permissão para estornar'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Estorno exige motivo'; end if;
  select * into s from financial_settlements where id = _settlement for update;
  if s.id is null then raise exception 'Baixa não encontrada'; end if;
  if exists (select 1 from financial_settlements where reversed_of = _settlement) then
    raise exception 'Esta baixa já foi estornada';
  end if;
  insert into financial_settlements (direction, financial_account_id, data, valor_cents, payment_method_id,
      referencia, observacao, reversed_of, is_reversal, reversal_reason, created_by)
  values (s.direction, s.financial_account_id, current_date, -s.valor_cents, s.payment_method_id,
      s.referencia, s.observacao, s.id, true, _motivo, auth.uid())
  returning id into v_new;

  for a in select * from financial_allocations where settlement_id = s.id loop
    insert into financial_allocations (settlement_id, installment_id, valor_cents)
    values (v_new, a.installment_id, -a.valor_cents);
    perform fin_installment_refresh(a.installment_id);
    insert into financial_title_events (title_id, evento, motivo, payload, actor_id)
    select i.title_id, 'estorno', _motivo, jsonb_build_object('settlement_id', s.id, 'estorno_id', v_new), auth.uid()
    from financial_installments i where i.id = a.installment_id;
  end loop;

  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao, created_by)
  values (s.financial_account_id, 'ajuste', current_date,
      case when s.direction='payable' then s.valor_cents else -s.valor_cents end, v_new,
      'Estorno: ' || _motivo, auth.uid());
  return v_new;
end $$;
revoke execute on function public.fin_settlement_reverse(uuid, text) from public, anon;
grant execute on function public.fin_settlement_reverse(uuid, text) to authenticated;

-- Transferência entre contas (atômica).
create or replace function public.fin_transfer_create(_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_ex uuid; v_valor bigint; v_data date;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para transferir'; end if;
  v_valor := (_payload->>'valor_cents')::bigint;
  if v_valor is null or v_valor <= 0 then raise exception 'Valor da transferência deve ser maior que zero'; end if;
  v_key := nullif(_payload->>'idempotency_key','');
  if v_key is not null then
    select id into v_ex from financial_transfers where idempotency_key = v_key;
    if v_ex is not null then return v_ex; end if;
  end if;
  v_data := coalesce(nullif(_payload->>'data','')::date, current_date);
  insert into financial_transfers (from_account_id, to_account_id, data, valor_cents, referencia, motivo, idempotency_key, created_by)
  values ((_payload->>'from_account_id')::uuid, (_payload->>'to_account_id')::uuid, v_data, v_valor,
      nullif(_payload->>'referencia',''), nullif(_payload->>'motivo',''), v_key, auth.uid())
  returning id into v_id;
  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, transfer_id, descricao, created_by)
  values ((_payload->>'from_account_id')::uuid, 'transferencia_saida', v_data, -v_valor, v_id, nullif(_payload->>'motivo',''), auth.uid()),
         ((_payload->>'to_account_id')::uuid, 'transferencia_entrada', v_data, v_valor, v_id, nullif(_payload->>'motivo',''), auth.uid());
  return v_id;
end $$;
revoke execute on function public.fin_transfer_create(jsonb) from public, anon;
grant execute on function public.fin_transfer_create(jsonb) to authenticated;

-- Reconhecimento de dívida (reconhecido x contestado).
create or replace function public.fin_acknowledge(_title uuid, _reconhecido bigint, _contestado bigint, _motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_capability(auth.uid(),'finance.receivable.manage') then raise exception 'Sem permissão'; end if;
  if coalesce(_reconhecido,0) < 0 or coalesce(_contestado,0) < 0 then raise exception 'Valores não podem ser negativos'; end if;
  insert into financial_acknowledgements (title_id, reconhecido_cents, contestado_cents, motivo, created_by)
  values (_title, coalesce(_reconhecido,0), coalesce(_contestado,0), _motivo, auth.uid())
  returning id into v_id;
  insert into financial_title_events (title_id, evento, motivo, payload, actor_id)
  values (_title,'reconhecimento',_motivo,
    jsonb_build_object('reconhecido_cents',coalesce(_reconhecido,0),'contestado_cents',coalesce(_contestado,0)), auth.uid());
  return v_id;
end $$;
revoke execute on function public.fin_acknowledge(uuid, bigint, bigint, text) from public, anon;
grant execute on function public.fin_acknowledge(uuid, bigint, bigint, text) to authenticated;

-- Saldo das contas, calculado pelo razão.
create or replace function public.fin_accounts_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', a.id, 'nome', a.nome, 'kind', a.kind, 'banco', a.banco, 'is_active', a.is_active,
      'saldo_cents', a.saldo_inicial_cents + coalesce((select sum(m.valor_cents) from financial_account_movements m where m.financial_account_id = a.id),0),
      'ultimo_movimento', (select max(m.data) from financial_account_movements m where m.financial_account_id = a.id)
    ) as x
    from financial_accounts a
    where has_capability(auth.uid(),'finance.bank.view')
  ) s;
$$;
revoke execute on function public.fin_accounts_overview() from public, anon;
grant execute on function public.fin_accounts_overview() to authenticated;

-- Painel: números reais, zero é zero.
create or replace function public.fin_overview(_de date default null, _ate date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_de date := coalesce(_de, date_trunc('month', current_date)::date);
        v_ate date := coalesce(_ate, (date_trunc('month', current_date) + interval '1 month - 1 day')::date);
        r jsonb;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  with aberto as (
    select t.direction,
           i.vencimento,
           i.valor_cents
             + coalesce((select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                                         when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end)
                         from financial_adjustments j where j.installment_id = i.id),0)
             - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0) as saldo
    from financial_installments i
    join financial_titles t on t.id = i.title_id
    where t.status in ('ativo','aprovado')
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'a_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0),0),
    'a_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0),0),
    'vencido_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0 and vencimento < current_date),0),
    'vencido_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0 and vencimento < current_date),0),
    'proj30_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0 and vencimento between current_date and current_date + 30),0),
    'proj30_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0 and vencimento between current_date and current_date + 30),0),
    'proj60_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0 and vencimento between current_date and current_date + 60),0),
    'proj60_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0 and vencimento between current_date and current_date + 60),0),
    'proj90_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0 and vencimento between current_date and current_date + 90),0),
    'proj90_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0 and vencimento between current_date and current_date + 90),0),
    'recebido_periodo_cents', coalesce((select sum(valor_cents) from financial_settlements where direction='receivable' and data between v_de and v_ate),0),
    'pago_periodo_cents', coalesce((select sum(-valor_cents) from financial_settlements where direction='payable' and data between v_de and v_ate),0) * -1,
    'saldo_contas_cents', coalesce((select sum(a.saldo_inicial_cents) from financial_accounts a where a.is_active),0)
      + coalesce((select sum(m.valor_cents) from financial_account_movements m join financial_accounts a on a.id=m.financial_account_id where a.is_active),0),
    'titulos_pendentes_aprovacao', coalesce((select count(*) from financial_titles where approval_status='pendente'),0)
  ) into r;
  return r;
end $$;
revoke execute on function public.fin_overview(date, date) from public, anon;
grant execute on function public.fin_overview(date, date) to authenticated;

-- Lista de títulos com paginação e busca no servidor.
create or replace function public.fin_titles_list(_direction text, _search text default null,
  _status text default null, _situacao text default null, _limit int default 50, _offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_dir fin_direction := _direction::fin_direction; v_cap text; v_rows jsonb; v_total bigint; v_soma bigint;
begin
  v_cap := case when v_dir='payable' then 'finance.payable.view' else 'finance.receivable.view' end;
  if not has_capability(auth.uid(), v_cap) then raise exception 'Sem permissão'; end if;

  with base as (
    select t.id, t.descricao, t.documento, t.status, t.emissao, t.competencia, t.valor_cents,
           coalesce(p.display_name, p.legal_name, p.code) as contraparte,
           (select min(i.vencimento) from financial_installments i where i.title_id = t.id
              and i.settlement_status in ('nao_liquidado','parcial')) as proximo_vencimento,
           coalesce((select sum(a.valor_cents) from financial_allocations a
                     join financial_installments i on i.id = a.installment_id where i.title_id = t.id),0) as pago_cents,
           (select count(*) from financial_installments i where i.title_id = t.id) as parcelas
    from financial_titles t
    join parties p on p.id = t.party_id
    where t.direction = v_dir
      and (_status is null or t.status::text = _status)
      and (_search is null or _search = '' or
           t.descricao ilike '%'||_search||'%' or coalesce(t.documento,'') ilike '%'||_search||'%'
           or coalesce(p.display_name,'') ilike '%'||_search||'%' or coalesce(p.legal_name,'') ilike '%'||_search||'%')
  ), filtrado as (
    select * from base
    where _situacao is null or _situacao = ''
       or (_situacao = 'aberto' and pago_cents < valor_cents and status <> 'cancelado')
       or (_situacao = 'vencido' and proximo_vencimento < current_date and status <> 'cancelado')
       or (_situacao = 'liquidado' and pago_cents >= valor_cents)
  )
  select coalesce(jsonb_agg(to_jsonb(f) order by f.proximo_vencimento nulls last, f.emissao desc), '[]'::jsonb),
         (select count(*) from filtrado), (select coalesce(sum(valor_cents),0) from filtrado)
    into v_rows, v_total, v_soma
  from (select * from filtrado order by proximo_vencimento nulls last, emissao desc
        limit greatest(_limit,1) offset greatest(_offset,0)) f;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'soma_cents', v_soma);
end $$;
revoke execute on function public.fin_titles_list(text, text, text, text, int, int) from public, anon;
grant execute on function public.fin_titles_list(text, text, text, text, int, int) to authenticated;

-- Ficha completa do título.
create or replace function public.fin_title_detail(_title uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_dir fin_direction; r jsonb;
begin
  select direction into v_dir from financial_titles where id = _title;
  if v_dir is null then raise exception 'Título não encontrado'; end if;
  if not has_capability(auth.uid(), case when v_dir='payable' then 'finance.payable.view' else 'finance.receivable.view' end)
    then raise exception 'Sem permissão'; end if;

  select jsonb_build_object(
    'titulo', to_jsonb(t) || jsonb_build_object('contraparte', coalesce(p.display_name,p.legal_name,p.code)),
    'parcelas', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object(
        'pago_cents', coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id=i.id),0),
        'ajustes_cents', coalesce((select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                                                   when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end)
                                   from financial_adjustments j where j.installment_id=i.id),0))
        order by i.numero) from financial_installments i where i.title_id = t.id), '[]'::jsonb),
    'baixas', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'data', s.data, 'valor_cents', a.valor_cents,
        'conta', ac.nome, 'estorno', s.is_reversal, 'parcela', i.numero, 'settlement_id', s.id) order by s.created_at)
        from financial_allocations a join financial_settlements s on s.id = a.settlement_id
        join financial_installments i on i.id = a.installment_id
        left join financial_accounts ac on ac.id = s.financial_account_id
        where i.title_id = t.id), '[]'::jsonb),
    'reconhecimentos', coalesce((select jsonb_agg(to_jsonb(k) order by k.created_at)
        from financial_acknowledgements k where k.title_id = t.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(to_jsonb(ev) order by ev.created_at desc)
        from financial_title_events ev where ev.title_id = t.id), '[]'::jsonb)
  ) into r
  from financial_titles t join parties p on p.id = t.party_id where t.id = _title;
  return r;
end $$;
revoke execute on function public.fin_title_detail(uuid) from public, anon;
grant execute on function public.fin_title_detail(uuid) to authenticated;