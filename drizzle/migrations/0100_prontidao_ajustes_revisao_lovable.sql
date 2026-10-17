-- ============================================================================
-- 0100 — Ajustes apontados na aplicação da 0099 (revisão do Lovable, 16/10)
--
--  1. Varredura do crédito de cartão: ignora baixa estornada já na consulta e
--     segue a ordem da data de crédito. Antes, até 500 baixas estornadas podiam
--     ocupar todas as vagas e travar a fila para sempre.
--  2. fiscal_prontidao: peça em maleta ativa sem preço de referência também é
--     bloqueio (sem preço não existe valor na nota).
-- ============================================================================

-- 1. Varredura do crédito de cartão --------------------------------------------------
CREATE OR REPLACE FUNCTION public.asaas_baixa_pendentes(_executar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE x record; r jsonb; itens jsonb := '[]'::jsonb; feitas int := 0; creditos int := 0;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
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

  -- Cartão já baixado na conta "cartão a receber", crédito chegou, ainda não transferido
  -- e baixa NÃO estornada. Mais antigo primeiro.
  FOR x IN
    SELECT c.id, c.external_id
      FROM public.asaas_charges c
      JOIN public.asaas_accounts a ON a.id = c.account_id
       AND a.financial_account_id IS NOT NULL AND a.conta_cartao_receber_id IS NOT NULL
      JOIN public.financial_settlements s
        ON s.idempotency_key = 'asaas:baixa:' || c.account_id || ':' || c.external_id
       AND s.financial_account_id = a.conta_cartao_receber_id
     WHERE c.billing_type = 'CREDIT_CARD' AND c.external_status = 'RECEIVED'
       AND c.credit_date IS NOT NULL AND c.credit_date <= hoje
       AND NOT EXISTS (SELECT 1 FROM public.financial_settlements rev WHERE rev.reversed_of = s.id)
       AND NOT EXISTS (SELECT 1 FROM public.financial_transfers t
                        WHERE t.idempotency_key = 'asaas:credito:' || c.account_id || ':' || c.external_id)
     ORDER BY c.credit_date, c.external_id
     LIMIT 500
  LOOP
    IF _executar THEN
      r := public.asaas_cartao_creditar(x.id);
      IF coalesce((r->>'transferido')::boolean, false) THEN creditos := creditos + 1; END IF;
    ELSE r := null; END IF;
    itens := itens || jsonb_build_object('cobranca', x.external_id, 'credito_cartao', true, 'resultado', r);
  END LOOP;

  RETURN jsonb_build_object('executado', _executar, 'encontradas', jsonb_array_length(itens),
    'baixadas', feitas, 'creditos_cartao', creditos, 'itens', itens);
END $function$;

-- 2. Prontidão: preço de referência ausente também bloqueia ---------------------------
DO $pront$
DECLARE d text; n text;
  ancora text := '  IF to_regclass(''public.fiscal_outbox'') IS NULL THEN';
  novo text := '  IF (pecas->>''sem_preco_referencia'')::int > 0 THEN
    bloqueios := bloqueios || format(''%s peças em maletas ativas sem preço de referência.'', (pecas->>''sem_preco_referencia'')::int);
  END IF;
';
BEGIN
  d := pg_get_functiondef('public.fiscal_prontidao()'::regprocedure);
  IF position('sem preço de referência.' in d) > 0 THEN RETURN; END IF;  -- já aplicado
  IF position(ancora in d) = 0 THEN RAISE EXCEPTION 'Definição inesperada de fiscal_prontidao; nada alterado.'; END IF;
  n := replace(d, ancora, novo || ancora);
  EXECUTE n;
END $pront$;
