-- 1. Impressão digital canônica da intenção -------------------------------
alter table public.financial_settlements add column if not exists payload_fingerprint text;
alter table public.financial_transfers  add column if not exists payload_fingerprint text;

create or replace function public.fin_fingerprint(_intent jsonb)
returns text language sql immutable set search_path = public as $$
  select md5(_intent::text)
$$;

revoke all on function public.fin_fingerprint(jsonb) from public, anon;

-- 2. Razão, baixas e alocações são imutáveis -------------------------------
create or replace function public.fin_block_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Registro financeiro histórico não pode ser alterado nem apagado (%). Use estorno.', TG_TABLE_NAME
    using errcode = '42501';
end $$;

drop trigger if exists fin_movements_immutable on public.financial_account_movements;
create trigger fin_movements_immutable before update or delete on public.financial_account_movements
  for each row execute function public.fin_block_mutation();

drop trigger if exists fin_settlements_immutable on public.financial_settlements;
create trigger fin_settlements_immutable before update or delete on public.financial_settlements
  for each row execute function public.fin_block_mutation();

drop trigger if exists fin_allocations_immutable on public.financial_allocations;
create trigger fin_allocations_immutable before update or delete on public.financial_allocations
  for each row execute function public.fin_block_mutation();

-- 3. Baixa com idempotência forte ------------------------------------------
create or replace function public.fin_settlement_create(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dir fin_direction; v_valor bigint; v_soma bigint := 0; v_id uuid; v_key text; e jsonb;
  v_inst uuid; v_ex financial_settlements%rowtype; v_fp text; v_intent jsonb;
begin
  if not has_capability(auth.uid(),'finance.settlement.create') then raise exception 'Sem permissão para registrar baixa'; end if;
  v_dir := (_payload->>'direction')::fin_direction;
  v_valor := (_payload->>'valor_cents')::bigint;
  v_key := nullif(_payload->>'idempotency_key','');
  if v_valor is null or v_valor <= 0 then raise exception 'Valor da baixa deve ser maior que zero'; end if;

  -- intenção canônica: alocações ordenadas, sem campos cosméticos
  select jsonb_build_object(
    'direction', _payload->>'direction',
    'account', _payload->>'financial_account_id',
    'data', coalesce(nullif(_payload->>'data',''), current_date::text),
    'valor_cents', v_valor,
    'alocacoes', coalesce(jsonb_agg(x order by x->>'installment_id', x->>'valor_cents'), '[]'::jsonb))
  into v_intent
  from jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb)) x;
  v_fp := fin_fingerprint(v_intent);

  if v_key is not null then
    select * into v_ex from financial_settlements where idempotency_key = v_key;
    if found then
      if v_ex.payload_fingerprint is not null and v_ex.payload_fingerprint <> v_fp then
        raise exception 'Colisão de chave de idempotência: a chave % já foi usada com outro conteúdo.', v_key
          using errcode = '23505';
      end if;
      return jsonb_build_object('id', v_ex.id, 'repetido', true,
        'nao_alocado_cents', v_ex.valor_cents - coalesce((select sum(valor_cents) from financial_allocations where settlement_id = v_ex.id),0));
    end if;
  end if;

  for e in select * from jsonb_array_elements(_payload->'alocacoes') loop
    v_inst := (e->>'installment_id')::uuid;
    perform 1 from financial_installments where id = v_inst for update;
    if (e->>'valor_cents')::bigint <= 0 then raise exception 'Alocação com valor inválido'; end if;
    v_soma := v_soma + (e->>'valor_cents')::bigint;
  end loop;
  if v_soma <= 0 then raise exception 'Informe ao menos uma parcela para alocar'; end if;
  if v_soma > v_valor then raise exception 'Alocação (%) maior que o valor da baixa (%)', v_soma, v_valor; end if;

  insert into financial_settlements (direction, financial_account_id, data, valor_cents, payment_method_id,
      referencia, observacao, idempotency_key, payload_fingerprint, created_by)
  values (v_dir, (_payload->>'financial_account_id')::uuid, coalesce(nullif(_payload->>'data','')::date, current_date),
      v_valor, nullif(_payload->>'payment_method_id','')::uuid, nullif(_payload->>'referencia',''),
      nullif(_payload->>'observacao',''), v_key, v_fp, auth.uid())
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
  values ((_payload->>'financial_account_id')::uuid,
      (case when v_dir='payable' then 'saida' else 'entrada' end)::fin_movement_kind,
      coalesce(nullif(_payload->>'data','')::date, current_date),
      case when v_dir='payable' then -v_valor else v_valor end, v_id,
      nullif(_payload->>'referencia',''), auth.uid());

  return jsonb_build_object('id', v_id, 'repetido', false, 'nao_alocado_cents', v_valor - v_soma);
end $$;

-- 4. Transferência com idempotência forte ----------------------------------
create or replace function public.fin_transfer_create(_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_ex financial_transfers%rowtype; v_valor bigint; v_data date; v_fp text;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para transferir'; end if;
  v_valor := (_payload->>'valor_cents')::bigint;
  if v_valor is null or v_valor <= 0 then raise exception 'Valor da transferência deve ser maior que zero'; end if;
  if (_payload->>'from_account_id') = (_payload->>'to_account_id') then
    raise exception 'Origem e destino da transferência precisam ser contas diferentes';
  end if;
  v_data := coalesce(nullif(_payload->>'data','')::date, current_date);
  v_key := nullif(_payload->>'idempotency_key','');
  v_fp := fin_fingerprint(jsonb_build_object('from',_payload->>'from_account_id','to',_payload->>'to_account_id',
            'data',v_data::text,'valor_cents',v_valor));
  if v_key is not null then
    select * into v_ex from financial_transfers where idempotency_key = v_key;
    if found then
      if v_ex.payload_fingerprint is not null and v_ex.payload_fingerprint <> v_fp then
        raise exception 'Colisão de chave de idempotência: a chave % já foi usada com outro conteúdo.', v_key
          using errcode = '23505';
      end if;
      return v_ex.id;
    end if;
  end if;
  insert into financial_transfers (from_account_id, to_account_id, data, valor_cents, referencia, motivo,
      idempotency_key, payload_fingerprint, created_by)
  values ((_payload->>'from_account_id')::uuid, (_payload->>'to_account_id')::uuid, v_data, v_valor,
      nullif(_payload->>'referencia',''), nullif(_payload->>'motivo',''), v_key, v_fp, auth.uid())
  returning id into v_id;
  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, transfer_id, descricao, created_by)
  values ((_payload->>'from_account_id')::uuid, 'transferencia_saida', v_data, -v_valor, v_id, nullif(_payload->>'motivo',''), auth.uid()),
         ((_payload->>'to_account_id')::uuid, 'transferencia_entrada', v_data, v_valor, v_id, nullif(_payload->>'motivo',''), auth.uid());
  return v_id;
end $$;

-- 5. Estorno atômico da transferência --------------------------------------
create or replace function public.fin_transfer_reverse(_transfer uuid, _motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t financial_transfers%rowtype; v_id uuid;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para estornar transferência'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Estorno exige motivo'; end if;
  select * into t from financial_transfers where id = _transfer for update;
  if not found then raise exception 'Transferência não encontrada'; end if;
  if exists (select 1 from financial_transfers where reversed_of = _transfer) then
    raise exception 'Esta transferência já foi estornada';
  end if;
  insert into financial_transfers (from_account_id, to_account_id, data, valor_cents, motivo,
      reversed_of, is_reversal, created_by)
  values (t.to_account_id, t.from_account_id, current_date, t.valor_cents, 'Estorno: ' || _motivo,
      t.id, true, auth.uid())
  returning id into v_id;
  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, transfer_id, descricao, created_by)
  values (t.to_account_id, 'transferencia_saida', current_date, -t.valor_cents, v_id, 'Estorno: ' || _motivo, auth.uid()),
         (t.from_account_id, 'transferencia_entrada', current_date, t.valor_cents, v_id, 'Estorno: ' || _motivo, auth.uid());
  return v_id;
end $$;

-- 6. Submissão e recusa de título ------------------------------------------
create or replace function public.fin_title_submit(_title uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t financial_titles%rowtype; v_cap text;
begin
  select * into t from financial_titles where id = _title;
  if not found then raise exception 'Título não encontrado'; end if;
  v_cap := case when t.direction='payable' then 'finance.payable.manage' else 'finance.receivable.manage' end;
  if not has_capability(auth.uid(), v_cap) then raise exception 'Sem permissão para submeter este título'; end if;
  if t.status = 'cancelado' then raise exception 'Título cancelado não pode ser submetido'; end if;
  update financial_titles set status='submetido', approval_status='pendente', updated_at=now() where id=_title;
  insert into financial_title_events (title_id, evento, actor_id) values (_title,'submetido',auth.uid());
end $$;

create or replace function public.fin_title_reject(_title uuid, _motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_capability(auth.uid(),'finance.title.approve') then raise exception 'Sem permissão para recusar'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Recusa exige motivo'; end if;
  update financial_titles set approval_status='recusada', status='rascunho', updated_at=now() where id=_title;
  insert into financial_title_events (title_id, evento, motivo, actor_id) values (_title,'recusado',_motivo,auth.uid());
end $$;

revoke all on function public.fin_transfer_reverse(uuid,text) from public, anon;
revoke all on function public.fin_title_submit(uuid) from public, anon;
revoke all on function public.fin_title_reject(uuid,text) from public, anon;
grant execute on function public.fin_transfer_reverse(uuid,text) to authenticated;
grant execute on function public.fin_title_submit(uuid) to authenticated;
grant execute on function public.fin_title_reject(uuid,text) to authenticated;

-- 7. Parcelas só para quem pode ver o título -------------------------------
drop policy if exists "fin installments read" on public.financial_installments;
create policy "fin installments read" on public.financial_installments for select to authenticated
using (exists (
  select 1 from financial_titles t where t.id = financial_installments.title_id
    and ((t.direction='payable' and has_capability(auth.uid(),'finance.payable.view'))
      or (t.direction='receivable' and has_capability(auth.uid(),'finance.receivable.view')))
));