-- 0302: reemissão pelo saldo não trava quando a cobrança anterior foi excluída direto no Asaas.
CREATE OR REPLACE FUNCTION public.asaas_saldo_preparar(_job uuid, _worker text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; v_saldo bigint; t record; it jsonb; v_venc date; v_x record; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO s FROM public.asaas_saldo_sync WHERE id = _job FOR UPDATE;
  IF s.id IS NULL OR s.estado <> 'processando' OR s.worker IS DISTINCT FROM _worker THEN RAISE EXCEPTION 'Tarefa fora da posse deste trabalhador.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s.cobrancas) e WHERE coalesce(e->>'resultado','') NOT IN ('cancelada','ja_excluida')) THEN
    RAISE EXCEPTION 'Ainda há cobrança antiga a cancelar.'; END IF;
  IF s.intent_id IS NOT NULL AND (SELECT x.state FROM public.asaas_charge_intents x WHERE x.id = s.intent_id) NOT IN ('rejeitada','cancelada') THEN
    RETURN jsonb_build_object('executar', true, 'intent_id', s.intent_id); END IF;
  IF s.acao = 'cancelar' THEN
    UPDATE public.asaas_saldo_sync SET estado = 'concluida', lease_until = NULL, concluida_em = now(), updated_at = now(), erro = NULL WHERE id = _job;
    RETURN jsonb_build_object('executar', false, 'estado', 'concluida');
  END IF;
  SELECT * INTO t FROM public.financial_titles WHERE id = s.title_id;
  v_saldo := CASE WHEN t.status = 'ativo' THEN greatest(coalesce(public.fin_installment_saldo(s.installment_id),0),0) ELSE 0 END;
  IF v_saldo < 500 THEN
    UPDATE public.asaas_saldo_sync SET estado = 'concluida', lease_until = NULL, concluida_em = now(), updated_at = now(), novo_valor_cents = NULL,
      motivo = CASE WHEN v_saldo = 0 THEN 'quitada' ELSE 'saldo_abaixo_minimo' END,
      erro = CASE WHEN v_saldo = 0 THEN NULL ELSE 'Saldo abaixo do mínimo do Asaas (R$ 5,00): cobrar por fora.' END WHERE id = _job;
    RETURN jsonb_build_object('executar', false, 'estado', 'concluida');
  END IF;
  v_venc := greatest(hoje, coalesce(s.novo_vencimento, hoje));
  PERFORM set_config('lardann.asaas_saldo','on', true);
  PERFORM set_config('lardann.asaas_intent','on', true);
  FOR v_x IN SELECT x.id, x.state FROM public.asaas_charge_intents x JOIN public.asaas_charges c ON c.id = x.charge_id
              WHERE x.installment_id = s.installment_id AND x.acordo_simulacao_id IS NULL
                AND x.state IN ('criada','conciliacao') AND c.external_status = 'DELETED'
              FOR UPDATE OF x LOOP
    UPDATE public.asaas_charge_intents SET state = 'cancelada', resolved_at = now(),
           last_error = 'Cobrança excluída no Asaas; intenção fechada para reemitir pelo saldo.' WHERE id = v_x.id;
    INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
    VALUES (v_x.id, v_x.state, 'cancelada', jsonb_build_object('motivo', 'cobranca_excluida_no_asaas', 'tarefa', s.id), NULL);
  END LOOP;
  PERFORM set_config('lardann.asaas_intent','off', true);
  PERFORM set_config('lardann.asaas_saldo','off', true);
  BEGIN
    it := public.asaas_cobranca_preparar_nucleo(jsonb_build_object('installment_id', s.installment_id, 'billing_type', coalesce(s.novo_billing_type,'UNDEFINED'),
      'due_date', v_venc, 'idempotency_key', 'saldo:' || s.id || ':' || v_saldo || ':' || (SELECT count(*) FROM public.asaas_charge_intents x WHERE x.idempotency_key LIKE 'saldo:' || s.id || ':%' AND x.state IN ('rejeitada','cancelada')), 'criar_cliente', false), NULL, true);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.asaas_saldo_sync SET estado = 'excecao', motivo = 'nova_cobranca_recusada', lease_until = NULL, updated_at = now(),
      erro = left('Cobrança antiga cancelada, mas a nova não pôde ser preparada: ' || SQLERRM, 500) WHERE id = _job;
    RETURN jsonb_build_object('executar', false, 'estado', 'excecao');
  END;
  IF coalesce((it->>'reaproveitada')::boolean, false) THEN
    UPDATE public.asaas_saldo_sync SET estado = 'excecao', motivo = 'cobranca_viva_encontrada', lease_until = NULL, updated_at = now(),
      erro = 'Já existe outra cobrança aberta para a parcela: conferir.' WHERE id = _job;
    RETURN jsonb_build_object('executar', false, 'estado', 'excecao');
  END IF;
  UPDATE public.asaas_saldo_sync SET intent_id = (it->>'id')::uuid, novo_valor_cents = v_saldo, novo_vencimento = v_venc, progresso = true, updated_at = now()
   WHERE id = _job;
  RETURN jsonb_build_object('executar', true, 'intent_id', (it->>'id')::uuid);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_preparar(uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_preparar(uuid,text) TO service_role;