-- Baixa financeira automática do Asaas (PAYMENT_RECEIVED de cobrança ligada a parcela).
-- Motor oficial fin_settlement_create_ajustes: bruto na parcela, tarifa como saída separada.
-- Idempotente pela chave asaas:baixa:<conta>:<cobrança>. Dinheiro, estornos e disputas seguem em revisão humana.

DO $do$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.fin_settlement_create(jsonb)'::regprocedure);
  novo := replace(def,
    $a$if not has_capability(auth.uid(),'finance.settlement.create') then raise exception 'Sem permissão para registrar baixa'; end if;$a$,
    $b$if not (has_capability(auth.uid(),'finance.settlement.create')
          or coalesce(current_setting('lardan.baixa_asaas', true),'off') = 'on') then raise exception 'Sem permissão para registrar baixa'; end if;$b$);
  IF novo = def AND position('lardan.baixa_asaas' in def) = 0 THEN
    RAISE EXCEPTION 'Trecho de permissão do motor de baixa não encontrado.';
  END IF;
  EXECUTE novo;
END $do$;

CREATE OR REPLACE FUNCTION public.asaas_baixa_automatica(_charge uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; conta uuid; parcela uuid; saldo bigint; valor bigint; tarifa bigint;
  dia date; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb; chave text;
BEGIN
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'cobranca_inexistente'); END IF;
  IF c.external_status NOT IN ('RECEIVED','CONFIRMED') THEN
    RETURN jsonb_build_object('baixa', false, 'motivo', 'nao_recebida');
  END IF;

  parcela := c.installment_id;
  IF parcela IS NULL THEN
    SELECT m.installment_id INTO parcela FROM public.asaas_charge_matches m
     WHERE m.charge_id = c.id AND m.status = 'confirmado' AND m.installment_id IS NOT NULL
     ORDER BY m.decidido_em DESC NULLS LAST LIMIT 1;
  END IF;
  IF parcela IS NULL THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'sem_parcela_vinculada'); END IF;

  SELECT financial_account_id INTO conta FROM public.asaas_accounts WHERE id = c.account_id;
  IF conta IS NULL THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'conta_asaas_sem_conta_financeira'); END IF;

  chave := 'asaas:baixa:' || c.account_id || ':' || c.external_id;
  IF EXISTS (SELECT 1 FROM public.financial_settlements WHERE idempotency_key = chave) THEN
    RETURN jsonb_build_object('baixa', false, 'motivo', 'ja_baixada_pelo_asaas', 'repetido', true);
  END IF;

  saldo := public.fin_installment_saldo(parcela);
  valor := coalesce(c.received_cents, c.value_cents);
  tarifa := greatest(coalesce(c.fee_cents, CASE WHEN c.net_value_cents IS NOT NULL THEN valor - c.net_value_cents END, 0), 0);
  IF coalesce(saldo,0) <= 0 THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'parcela_ja_quitada'); END IF;
  IF valor IS NULL OR valor <= 0 THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'valor_ausente'); END IF;
  IF valor > saldo THEN
    RETURN jsonb_build_object('baixa', false, 'motivo', 'valor_pago_maior_que_saldo', 'pago_cents', valor, 'saldo_cents', saldo);
  END IF;
  IF tarifa >= valor THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'tarifa_invalida'); END IF;

  dia := least(coalesce(c.payment_date, c.confirmed_date, hoje), hoje);

  PERFORM set_config('lardan.baixa_asaas', 'on', true);
  BEGIN
    r := public.fin_settlement_create_ajustes(jsonb_build_object(
      'direction', 'receivable',
      'financial_account_id', conta,
      'data', dia::text,
      'valor_cents', valor,
      'tarifa_cents', tarifa,
      'referencia', 'Asaas ' || c.external_id,
      'observacao', 'Baixa automática: recebimento confirmado pelo Asaas',
      'idempotency_key', chave,
      'alocacoes', jsonb_build_array(jsonb_build_object('installment_id', parcela, 'valor_cents', valor))));
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('lardan.baixa_asaas', 'off', true);
    RETURN jsonb_build_object('baixa', false, 'motivo', 'motor_recusou', 'erro', SQLERRM);
  END;
  PERFORM set_config('lardan.baixa_asaas', 'off', true);

  RETURN jsonb_build_object('baixa', true, 'settlement_id', r->>'id', 'repetido', coalesce((r->>'repetido')::boolean,false),
    'installment_id', parcela, 'valor_cents', valor, 'tarifa_cents', tarifa, 'data', dia);
END $function$;

REVOKE ALL ON FUNCTION public.asaas_baixa_automatica(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_baixa_automatica(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_evento_processar(_evento uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE e record; tipo record; c record; p jsonb; atrasado boolean := false; b jsonb := null;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT public.has_capability(auth.uid(),'finance.reconcile') THEN
    RAISE EXCEPTION 'Sem permissão para conciliar eventos.';
  END IF;
  SELECT * INTO e FROM public.asaas_events WHERE id=_evento FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Evento inexistente.'; END IF;
  IF e.processed_at IS NOT NULL THEN
    RETURN jsonb_build_object('id', e.id, 'repetido', true, 'status', e.status);
  END IF;
  SELECT * INTO tipo FROM public.asaas_event_types WHERE event = e.event;
  p := coalesce(e.payload,'{}'::jsonb);

  SELECT * INTO c FROM public.asaas_charges
    WHERE account_id = e.account_id AND external_id = e.charge_external_id FOR UPDATE;

  IF tipo.event IS NULL THEN
    UPDATE public.asaas_events SET status='na_fila', classification='desconhecido',
      last_error='Tipo de evento não catalogado.', attempts = attempts + 1 WHERE id=e.id;
    RETURN jsonb_build_object('id', e.id, 'status','na_fila','motivo','tipo_desconhecido');
  END IF;

  IF c.id IS NULL THEN
    UPDATE public.asaas_events SET status='na_fila', classification='revisao',
      last_error='Evento sem cobrança espelhada.', attempts = attempts + 1 WHERE id=e.id;
    RETURN jsonb_build_object('id', e.id, 'status','na_fila','motivo','sem_cobranca');
  END IF;

  IF c.updated_at > e.event_at AND c.external_status IS DISTINCT FROM tipo.estado_externo
     AND EXISTS (SELECT 1 FROM public.asaas_events z
                  WHERE z.account_id=e.account_id AND z.charge_external_id=e.charge_external_id
                    AND z.processed_at IS NOT NULL AND z.event_at > e.event_at) THEN
    atrasado := true;
  END IF;

  PERFORM set_config('lardann.asaas_link','on', true);
  IF atrasado THEN
    UPDATE public.asaas_events SET status='na_fila', classification='revisao',
      last_error='Evento anterior a uma situação mais recente: exige conciliação.',
      processed_at=now() WHERE id=e.id;
  ELSE
    UPDATE public.asaas_charges SET
      external_status = tipo.estado_externo,
      received_cents = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN coalesce((p->>'valuePaidCents')::bigint, received_cents) ELSE received_cents END,
      fee_cents      = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN coalesce((p->>'feeCents')::bigint, fee_cents) ELSE fee_cents END,
      net_value_cents= CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN coalesce((p->>'netValueCents')::bigint, net_value_cents) ELSE net_value_cents END,
      refunded_cents = CASE WHEN tipo.estorno IN ('total','parcial')
                            THEN coalesce((p->>'refundedCents')::bigint, refunded_cents) ELSE refunded_cents END,
      payment_date   = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN coalesce(nullif(p->>'paymentDate','')::date, payment_date)
                            ELSE payment_date END,
      credit_date    = CASE WHEN tipo.efeito_caixa = 'credita_conta_asaas'
                            THEN coalesce(nullif(p->>'creditDate','')::date, credit_date)
                            ELSE credit_date END
    WHERE id = c.id;

    IF tipo.efeito_caixa = 'credita_conta_asaas' AND tipo.efeito_recebivel = 'recebimento_registrado'
       AND NOT tipo.revisao_manual THEN
      b := public.asaas_baixa_automatica(c.id);
    END IF;

    UPDATE public.asaas_events SET
      status = CASE WHEN b IS NOT NULL AND ((b->>'baixa')::boolean OR b->>'motivo' IN ('ja_baixada_pelo_asaas','parcela_ja_quitada'))
                      THEN 'processado'
                    WHEN tipo.revisao_manual OR tipo.efeito_recebivel <> 'espelha'
                      THEN 'na_fila' ELSE 'processado' END,
      classification = CASE WHEN tipo.revisao_manual THEN 'revisao' ELSE 'conhecido' END,
      processed_at = now(),
      last_error = CASE
        WHEN b IS NOT NULL AND (b->>'baixa')::boolean THEN NULL
        WHEN b IS NOT NULL AND b->>'motivo' IN ('ja_baixada_pelo_asaas','parcela_ja_quitada') THEN NULL
        WHEN b IS NOT NULL AND b->>'motivo' = 'sem_parcela_vinculada'
          THEN 'Recebido no Asaas, mas a cobrança não está ligada a nenhum título: vincule para dar baixa.'
        WHEN b IS NOT NULL AND b->>'motivo' = 'valor_pago_maior_que_saldo'
          THEN 'Recebido no Asaas acima do saldo da parcela: revisar juros/multa antes da baixa.'
        WHEN b IS NOT NULL THEN 'Baixa automática não realizada: ' || coalesce(b->>'erro', b->>'motivo')
        WHEN tipo.revisao_manual THEN 'Ocorrência pendente de decisão humana.'
        ELSE NULL END
     WHERE id = e.id;
  END IF;
  PERFORM set_config('lardann.asaas_link','off', true);

  RETURN jsonb_build_object('id', e.id, 'atrasado', atrasado,
    'estado_externo', tipo.estado_externo, 'efeito_recebivel', tipo.efeito_recebivel,
    'efeito_caixa', tipo.efeito_caixa, 'estorno', tipo.estorno,
    'revisao_manual', tipo.revisao_manual,
    'baixa_criada', coalesce((b->>'baixa')::boolean, false), 'baixa', b);
END $function$;

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
      JOIN public.asaas_accounts a ON a.id = c.account_id AND a.is_active
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

REVOKE ALL ON FUNCTION public.asaas_baixa_pendentes(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_baixa_pendentes(boolean) TO authenticated, service_role;
