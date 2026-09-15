create or replace function public.fin_account_create(_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_saldo bigint;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para cadastrar contas'; end if;
  if coalesce(nullif(_payload->>'nome',''),'') = '' then raise exception 'Informe o nome da conta'; end if;
  v_saldo := coalesce((_payload->>'saldo_inicial_cents')::bigint, 0);
  insert into financial_accounts (nome, kind, banco, business_entity_id, saldo_inicial_cents, data_corte, created_by)
  values (_payload->>'nome', coalesce(nullif(_payload->>'kind','')::fin_account_kind,'conta_corrente'),
          nullif(_payload->>'banco',''), nullif(_payload->>'business_entity_id','')::uuid,
          v_saldo, current_date, auth.uid())
  returning id into v_id;
  if v_saldo <> 0 then
    insert into financial_account_movements (financial_account_id, kind, data, valor_cents, descricao, created_by)
    values (v_id, 'saldo_inicial', current_date, 0, 'Saldo inicial registrado na criação da conta', auth.uid());
  end if;
  return v_id;
end $$;
revoke execute on function public.fin_account_create(jsonb) from public, anon;
grant execute on function public.fin_account_create(jsonb) to authenticated;