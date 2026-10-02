create or replace function public.fin_mesa_titulo_da_parcela(_inst uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  return (select jsonb_build_object('title_id', t.id, 'updated_at', t.updated_at, 'cost_center_id', t.cost_center_id,
      'chart_account_id', t.chart_account_id, 'payment_method_id', t.payment_method_id, 'party_id', t.party_id,
      'business_entity_id', t.business_entity_id, 'financial_account_id', t.financial_account_id)
    from financial_installments i join financial_titles t on t.id = i.title_id where i.id = _inst);
end $$;
revoke all on function public.fin_mesa_titulo_da_parcela(uuid) from public, anon;
grant execute on function public.fin_mesa_titulo_da_parcela(uuid) to authenticated;