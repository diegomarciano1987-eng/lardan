-- 0294: o "refazer" manual (Master/financeiro) de um Pix desfeito passa pela regra nova; o automático continua sem refazer.
-- Mesma trava da Mesa: só abre chave nova (asaas:baixa:<conta>:rN:<pay_>) quando nenhuma baixa da cobrança está ativa.
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_receber_nucleo(uuid,uuid,boolean)'::regprocedure);
  IF position($q$  IF EXISTS (SELECT 1 FROM public.financial_settlements
              WHERE idempotency_key = chave OR idempotency_key LIKE 'asaas:baixa:' || c.account_id || ':r%:' || c.external_id) THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','ja_tem_baixa');
  END IF;$q$ IN def) = 0 THEN RAISE EXCEPTION '0294: trecho da baixa existente não encontrado'; END IF;
  novo := replace(def, $q$  IF EXISTS (SELECT 1 FROM public.financial_settlements
              WHERE idempotency_key = chave OR idempotency_key LIKE 'asaas:baixa:' || c.account_id || ':r%:' || c.external_id) THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','ja_tem_baixa');
  END IF;$q$, $q$  IF EXISTS (SELECT 1 FROM public.financial_settlements s
              WHERE (s.idempotency_key = chave OR s.idempotency_key LIKE 'asaas:baixa:' || c.account_id || ':r%:' || c.external_id)
                AND NOT s.is_reversal AND NOT EXISTS (SELECT 1 FROM public.financial_settlements x WHERE x.reversed_of = s.id)) THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','ja_tem_baixa');
  ELSIF EXISTS (SELECT 1 FROM public.financial_settlements
                 WHERE idempotency_key = chave OR idempotency_key LIKE 'asaas:baixa:' || c.account_id || ':r%:' || c.external_id) THEN
    -- 0294: baixa anterior estornada (desfeita). O automático não refaz; o refazer manual abre chave nova, como a Mesa.
    IF NOT _manual THEN RETURN jsonb_build_object('acao','ignorado','motivo','ja_tem_baixa'); END IF;
    PERFORM set_config('lardan.asaas_refazer', 'on', true);
  END IF;$q$);
  EXECUTE novo;
END $patch$;
