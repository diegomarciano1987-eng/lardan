
CREATE OR REPLACE FUNCTION public.fin_homolog_purge()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_contas int; v_mov int;
begin
  -- Alcança exclusivamente massa sintética marcada; jamais dados reais.
  alter table financial_account_movements disable trigger fin_movements_immutable;
  with alvo as (select id from financial_accounts where nome like 'HOMOLOG%')
  delete from financial_account_movements m using alvo a where m.financial_account_id = a.id;
  get diagnostics v_mov = row_count;
  alter table financial_account_movements enable trigger fin_movements_immutable;

  delete from financial_accounts where nome like 'HOMOLOG%';
  get diagnostics v_contas = row_count;
  return jsonb_build_object('movimentos_removidos', v_mov, 'contas_removidas', v_contas);
end $function$;

REVOKE EXECUTE ON FUNCTION public.fin_homolog_purge() FROM anon, authenticated, public;

SELECT public.fin_homolog_purge();
