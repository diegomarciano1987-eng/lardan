CREATE OR REPLACE FUNCTION public.fin_transfer_reverse(_transfer uuid, _motivo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t financial_transfers%rowtype; v_id uuid;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para estornar transferência'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Estorno exige motivo'; end if;
  select * into t from financial_transfers where id = _transfer for update;
  if not found then raise exception 'Transferência não encontrada'; end if;
  if t.is_reversal then raise exception 'Não é possível estornar um estorno'; end if;
  if exists (select 1 from financial_transfers where reversed_of = _transfer) then
    raise exception 'Esta transferência já foi estornada';
  end if;
  -- estorno usa a mesma data da transferência original para não distorcer os meses
  insert into financial_transfers (from_account_id, to_account_id, data, valor_cents, motivo,
      reversed_of, is_reversal, created_by)
  values (t.to_account_id, t.from_account_id, t.data, t.valor_cents, 'Estorno: ' || _motivo,
      t.id, true, auth.uid())
  returning id into v_id;
  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, transfer_id, descricao, created_by)
  values (t.to_account_id, 'transferencia_saida', t.data, -t.valor_cents, v_id, 'Estorno: ' || _motivo, auth.uid()),
         (t.from_account_id, 'transferencia_entrada', t.data, t.valor_cents, v_id, 'Estorno: ' || _motivo, auth.uid());
  return v_id;
end $function$;