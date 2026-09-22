CREATE OR REPLACE FUNCTION public.expire_stock_reservations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  servico boolean := uid IS NULL
                     AND current_user IN ('postgres','service_role','supabase_admin');
BEGIN
  -- caminho de serviço (rotina interna) OU usuário com a capacidade explícita.
  -- EXECUTE já é concedido apenas a postgres/service_role; a verificação abaixo
  -- é a segunda barreira e recusa qualquer sessão de usuário comum.
  IF servico IS NOT TRUE
     AND public.has_capability(uid,'stock.reservation.expire') IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem permissão para processar vencimentos.' USING errcode = '42501';
  END IF;
  RETURN public.expire_reservations_internal(NULL, NULL);
END $function$;

REVOKE EXECUTE ON FUNCTION public.expire_stock_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stock_reservations() TO service_role;