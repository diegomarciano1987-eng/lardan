CREATE OR REPLACE FUNCTION public.asaas_baixa_pendentes(_executar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE x record; r jsonb; itens jsonb := '[]'::jsonb; feitas int := 0;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN
    RAISE EXCEPTION 'Sem permissão para registrar baixa.';
  END IF;
  FOR x IN
    SELECT c.id, c.external_id, coalesce(c.received_cents, c.value_cents) v,
           coalesce(c.installment_id, m.installment_id) parcela
      FROM public.asaas_charges c
      JOIN public.asaas_accounts a ON a.id = c.account_id AND a.financial_account_id IS NOT NULL
      LEFT JOIN LATERAL (SELECT installment_id FROM public.asaas_charge_matches
                          WHERE charge_id = c.id AND status = 'confirmado' LIMIT 1) m ON true
     WHERE c.external_status = 'RECEIVED'
       AND coalesce(c.installment_id, m.installment_id) IS NOT NULL
       AND public.fin_installment_saldo(coalesce(c.installment_id, m.installment_id)) > 0
       AND NOT EXISTS (SELECT 1 FROM public.financial_settlements s
                        WHERE s.idempotency_key = 'asaas:baixa:' || c.account_id || ':' || c.external_id)
     LIMIT 500
  LOOP
    IF _executar THEN
      r := public.asaas_baixa_automatica(x.id);
      IF (r->>'baixa')::boolean THEN feitas := feitas + 1; END IF;
    ELSE r := null; END IF;
    itens := itens || jsonb_build_object('cobranca', x.external_id, 'valor_cents', x.v, 'installment_id', x.parcela, 'resultado', r);
  END LOOP;
  RETURN jsonb_build_object('executado', _executar, 'encontradas', jsonb_array_length(itens), 'baixadas', feitas, 'itens', itens);
END $function$;