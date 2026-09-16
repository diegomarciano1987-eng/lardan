create or replace function public.fin_reconcile_undo(_reconciliation uuid, _motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r financial_reconciliations%rowtype; v_new uuid; a record;
begin
  if not has_capability(auth.uid(),'finance.reconcile.undo') then raise exception 'Sem permissão para desfazer conciliação'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Desfazer conciliação exige motivo'; end if;
  select * into r from financial_reconciliations where id = _reconciliation for update;
  if r.id is null then raise exception 'Conciliação não encontrada'; end if;
  if r.status <> 'ativa' then raise exception 'Esta conciliação já foi desfeita'; end if;

  perform fin_settlement_reverse(r.settlement_id, _motivo);

  insert into financial_reconciliations (financial_account_id, settlement_id, status, motivo, reversed_of, is_reversal, created_by)
  values (r.financial_account_id, r.settlement_id, 'estorno', _motivo, r.id, true, auth.uid())
  returning id into v_new;
  update financial_reconciliations set status = 'estornada', motivo = _motivo where id = r.id;

  for a in select * from financial_reconciliation_allocations where reconciliation_id = r.id loop
    update financial_statement_lines l
       set conciliado_cents = greatest(l.conciliado_cents - a.valor_cents, 0),
           status = (case when greatest(l.conciliado_cents - a.valor_cents, 0) = 0 then 'pendente' else 'parcial' end)::fin_statement_line_status,
           updated_at = now()
     where l.id = a.line_id;
  end loop;

  insert into financial_reconciliation_events (reconciliation_id, evento, motivo, payload, actor_id)
  values (r.id, 'desfeita', _motivo, jsonb_build_object('estorno_id', v_new), auth.uid());
  return v_new;
end $$;
revoke all on function public.fin_reconcile_undo(uuid,text) from public, anon;
grant execute on function public.fin_reconcile_undo(uuid,text) to authenticated;