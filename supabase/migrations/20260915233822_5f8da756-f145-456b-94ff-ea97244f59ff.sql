create or replace function public.fin_settlement_create(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dir fin_direction; v_valor bigint; v_soma bigint := 0; v_id uuid; v_key text; e jsonb;
  v_inst uuid; v_ex uuid;
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
  values ((_payload->>'financial_account_id')::uuid,
      (case when v_dir='payable' then 'saida' else 'entrada' end)::fin_movement_kind,
      coalesce(nullif(_payload->>'data','')::date, current_date),
      case when v_dir='payable' then -v_valor else v_valor end, v_id,
      nullif(_payload->>'referencia',''), auth.uid());

  return jsonb_build_object('id', v_id, 'repetido', false, 'nao_alocado_cents', v_valor - v_soma);
end $$;
revoke execute on function public.fin_settlement_create(jsonb) from public, anon;
grant execute on function public.fin_settlement_create(jsonb) to authenticated;