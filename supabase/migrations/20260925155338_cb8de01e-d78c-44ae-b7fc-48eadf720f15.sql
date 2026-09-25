DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.asaas_cobranca_preparar(jsonb)'::regprocedure);
  d := replace(d, $x$state IN('simulada','sandbox_conectada')$x$, $x$state IN('simulada','sandbox_conectada','producao_conectada')$x$);
  EXECUTE d;
  d := pg_get_functiondef('public.asaas_receber_contas()'::regprocedure);
  d := replace(d, $x$state IN('simulada','sandbox_conectada')$x$, $x$state IN('simulada','sandbox_conectada','producao_conectada')$x$);
  EXECUTE d;
END $$;

CREATE OR REPLACE FUNCTION public.asaas_fatura_url_valida(_account uuid, _external_id text, _url text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT coalesce((SELECT CASE
  WHEN _url IS NULL OR _external_id IS NULL THEN false
  WHEN a.state='simulada' THEN _external_id~'^sim_[A-Za-z0-9_-]{1,160}$' AND _url='/financeiro/simulacao/'||_external_id
  WHEN a.state='sandbox_conectada' AND a.invoice_host_confirmed THEN _url~'^https://sandbox\.asaas\.com/i/[A-Za-z0-9]{6,64}$'
  WHEN a.state='producao_conectada' AND a.ambiente_provedor='producao' AND a.is_active THEN _url~'^https://(www\.)?asaas\.com/i/[A-Za-z0-9]{6,64}$'
  ELSE false END FROM public.asaas_accounts a WHERE a.id=_account),false)
$function$;