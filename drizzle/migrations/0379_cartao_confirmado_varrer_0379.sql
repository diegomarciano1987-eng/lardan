CREATE OR REPLACE FUNCTION public.asaas_cartao_confirmado_varrer()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE c record; b jsonb; feitas int := 0; res jsonb := '[]'::jsonb;
BEGIN
  FOR c IN SELECT x.id, x.external_id FROM public.asaas_charges x
            WHERE x.billing_type = 'CREDIT_CARD' AND x.external_status IN ('CONFIRMED','RECEIVED')
              AND x.installment_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.financial_settlements s
                               WHERE s.idempotency_key = 'asaas:baixa:' || x.account_id || ':' || x.external_id)
  LOOP
    PERFORM set_config('lardann.asaas_link','on', true);
    UPDATE public.asaas_charges SET received_cents = coalesce(received_cents, value_cents),
           payment_date = coalesce(payment_date, confirmed_date,
             (SELECT min((e.event_at AT TIME ZONE 'America/Sao_Paulo')::date) FROM public.asaas_events e
               WHERE e.charge_external_id = asaas_charges.external_id AND e.event = 'PAYMENT_CONFIRMED'))
     WHERE id = c.id;
    b := public.asaas_baixa_automatica(c.id);
    PERFORM set_config('lardann.asaas_link','off', true);
    IF coalesce((b->>'baixa')::boolean, false) THEN feitas := feitas + 1; END IF;
    res := res || jsonb_build_array(jsonb_build_object('cobranca', c.external_id, 'resultado', b));
  END LOOP;
  RETURN jsonb_build_object('baixas', feitas, 'itens', res);
END $f$;
REVOKE ALL ON FUNCTION public.asaas_cartao_confirmado_varrer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cartao_confirmado_varrer() TO service_role;

CREATE TABLE IF NOT EXISTS public.asaas_cartao_varredura_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resultado jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.asaas_cartao_varredura_log TO service_role;
ALTER TABLE public.asaas_cartao_varredura_log ENABLE ROW LEVEL SECURITY;

INSERT INTO public.asaas_cartao_varredura_log (resultado) SELECT public.asaas_cartao_confirmado_varrer();