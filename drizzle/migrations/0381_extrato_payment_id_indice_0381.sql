CREATE INDEX IF NOT EXISTS fsl_raw_payment_id ON public.financial_statement_lines ((raw->>'paymentId')) WHERE raw ? 'paymentId';
CREATE OR REPLACE FUNCTION public.asaas_nome_pix(_charge_external text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT nullif(btrim(regexp_replace(l.historico,'^.*fatura nr\.\s*\d+\s*','')),'')
        FROM financial_statement_lines l WHERE l.raw ? 'paymentId' AND l.raw->>'paymentId' = _charge_external AND l.historico ILIKE '%fatura nr.%'
       ORDER BY l.data DESC LIMIT 1 $function$;