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
  -- O estorno usa a data da baixa original, para não deslocar o resultado para o mês atual.
  insert into financial_settlements (direction, financial_account_id, data, valor_cents, payment_method_id,
      referencia, observacao, reversed_of, is_reversal, reversal_reason, created_by)
  values (s.direction, s.financial_account_id, s.data, -s.valor_cents, s.payment_method_id,
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
  values (s.financial_account_id, 'ajuste', s.data,
      case when s.direction='payable' then s.valor_cents else -s.valor_cents end, v_new,
      'Estorno: ' || _motivo, auth.uid());
  return v_new;
end $$;
revoke execute on function public.fin_settlement_reverse(uuid, text) from public, anon;
grant execute on function public.fin_settlement_reverse(uuid, text) to authenticated;