-- 0306b — espelho do cadastro: primeira conferência não sobrescreve contato que o Lardan não conhece;
-- "Usar o do Lardan" (pessoa com contas a receber) força o envio; mensagem clara quando a entrega já está registrada.

ALTER TABLE public.asaas_cliente_espelho ADD COLUMN IF NOT EXISTS forcar boolean NOT NULL DEFAULT false;
ALTER TABLE public.asaas_cliente_espelho ADD COLUMN IF NOT EXISTS forcado_por uuid;

CREATE OR REPLACE FUNCTION public.asaas_cliente_espelho_proximos(_worker text, _limite int DEFAULT 15, _party uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r jsonb;
BEGIN
  IF coalesce(btrim(_worker), '') = '' THEN RAISE EXCEPTION 'Worker obrigatório.'; END IF;
  WITH alvo AS (
    SELECT e.customer_id FROM asaas_cliente_espelho e
     WHERE (_party IS NULL OR e.party_id = _party)
       AND (e.estado = 'pendente'
            OR (e.estado = 'processando' AND e.reservado_em < now() - interval '10 minutes')
            OR (e.estado = 'erro' AND e.tentativas < 5 AND e.atualizado_em < now() - make_interval(mins => 15 * greatest(e.tentativas, 1))))
     ORDER BY e.pedido_em
     LIMIT greatest(1, least(coalesce(_limite, 15), 50))
     FOR UPDATE SKIP LOCKED),
  marcado AS (
    UPDATE asaas_cliente_espelho e SET estado = 'processando', worker = _worker, reservado_em = clock_timestamp(), tentativas = e.tentativas + 1
      FROM alvo WHERE e.customer_id = alvo.customer_id
    RETURNING e.customer_id, e.party_id, e.account_id, e.motivo, e.forcar, e.forcado_por)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'customer_id', m.customer_id, 'party_id', m.party_id, 'account_id', m.account_id, 'external_id', c.external_id,
           'primeira', coalesce(m.motivo, '') LIKE 'primeira conferência%', 'forcar', m.forcar, 'forcado_por', m.forcado_por,
           'lardan', public.asaas_cliente_dados_lardan(m.party_id),
           'conhecidos', coalesce((SELECT jsonb_agg(DISTINCT regexp_replace(cp.value, '\D', '', 'g')) FROM contact_points cp
                                    WHERE cp.party_id = m.party_id AND cp.kind::text IN ('whatsapp','telefone')), '[]'::jsonb),
           'celular_compartilhado', EXISTS (
              SELECT 1 FROM contact_points o
               WHERE o.party_id <> m.party_id AND o.kind::text IN ('whatsapp','telefone')
                 AND right(regexp_replace(o.value, '\D', '', 'g'), 11) = public.asaas_cliente_dados_lardan(m.party_id)->>'mobilePhone'
                 AND NOT EXISTS (SELECT 1 FROM party_unificacoes u WHERE u.duplicado_id = o.party_id)))), '[]'::jsonb) INTO r
    FROM marcado m JOIN asaas_customers c ON c.id = m.customer_id;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_espelho_proximos(text, int, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_espelho_proximos(text, int, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_cliente_espelho_registrar(_customer uuid, _worker text, _estado text, _diferencas jsonb,
  _enviados jsonb DEFAULT '{}'::jsonb, _erro text DEFAULT NULL, _actor uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE e asaas_cliente_espelho; v text; v_ext text; v_actor uuid;
BEGIN
  IF _estado NOT IN ('igual','atualizado','diferente','excluido_no_asaas','erro') THEN RAISE EXCEPTION 'Estado inválido: %', _estado; END IF;
  SELECT * INTO e FROM asaas_cliente_espelho WHERE customer_id = _customer FOR UPDATE;
  IF e.customer_id IS NULL OR e.estado <> 'processando' OR e.worker IS DISTINCT FROM _worker THEN RETURN 'ignorado'; END IF;
  v_actor := coalesce(_actor, e.forcado_por);
  v := CASE WHEN e.pedido_em > e.reservado_em THEN 'pendente' ELSE _estado END;
  UPDATE asaas_cliente_espelho
     SET estado = v, diferencas = coalesce(_diferencas, '[]'::jsonb), erro = left(_erro, 500), worker = NULL,
         conferido_em = now(), atualizado_em = now(),
         tentativas = CASE WHEN _estado = 'erro' THEN tentativas ELSE 0 END,
         forcar = CASE WHEN _estado = 'erro' THEN forcar ELSE false END,
         forcado_por = CASE WHEN _estado = 'erro' THEN forcado_por ELSE NULL END,
         -- depois da primeira conferência, toda mudança do cadastro manda (Lardan manda)
         motivo = CASE WHEN _estado = 'erro' THEN motivo ELSE 'conferido' END,
         enviado_em = CASE WHEN coalesce(_enviados, '{}'::jsonb) <> '{}'::jsonb THEN now() ELSE enviado_em END
   WHERE customer_id = _customer;
  IF coalesce(_enviados, '{}'::jsonb) <> '{}'::jsonb THEN
    SELECT external_id INTO v_ext FROM asaas_customers WHERE id = _customer;
    INSERT INTO asaas_cliente_espelho_log (customer_id, party_id, external_id, campos, origem, actor_id)
    VALUES (_customer, e.party_id, v_ext, _enviados, CASE WHEN v_actor IS NULL THEN 'rotina' ELSE 'botao' END, v_actor);
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (v_actor, 'asaas.cliente_espelho', 'parties', e.party_id::text, jsonb_build_object('cliente', v_ext, 'campos', _enviados));
  END IF;
  RETURN v;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_espelho_registrar(uuid, text, text, jsonb, jsonb, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_espelho_registrar(uuid, text, text, jsonb, jsonb, text, uuid) TO service_role;

-- botão da ficha: conferir de novo agora; com _forcar, "Usar o do Lardan" também nos pontos para conferir (fica registrado quem pediu)
CREATE OR REPLACE FUNCTION public.asaas_cliente_espelho_solicitar(_party uuid, _forcar boolean DEFAULT false)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(), 'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Somente quem cuida de contas a receber atualiza o cadastro no Asaas.' USING errcode = '42501';
  END IF;
  n := public.asaas_cliente_espelho_pedir(_party, CASE WHEN _forcar THEN 'botão: usar o do Lardan' ELSE 'botão: conferir agora' END);
  IF coalesce(_forcar, false) THEN
    UPDATE asaas_cliente_espelho SET forcar = true, forcado_por = auth.uid() WHERE party_id = _party;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'asaas.cliente_espelho_pedido', 'parties', _party::text, jsonb_build_object('forcar', coalesce(_forcar, false), 'clientes', n));
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_espelho_solicitar(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_espelho_solicitar(uuid, boolean) TO authenticated, service_role;

-- mensagem clara quando o próprio representante já registrou a entrega em mãos
CREATE OR REPLACE FUNCTION public.maleta_entregue_em_maos(_cycle uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles; v_motivo text := btrim(coalesce(_motivo, '')); r jsonb; v_rep text; v_cons text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  IF public.has_capability(uid, 'kit.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'Somente a equipe de maletas registra a entrega em mãos.' USING errcode = '42501';
  END IF;
  IF length(v_motivo) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.consultora_party_id IS NULL THEN RAISE EXCEPTION 'A maleta não tem consultora para receber.'; END IF;
  IF EXISTS (SELECT 1 FROM kit_acceptances a WHERE a.cycle_id = c.id) THEN RAISE EXCEPTION 'Esta maleta já foi aceita.'; END IF;
  IF c.status <> 'transito' THEN
    RAISE EXCEPTION '%', CASE WHEN c.status = 'recebida' THEN 'Ela já confirmou o recebimento: falta só o aceite das peças no app.'
                              ELSE 'A maleta precisa estar a caminho (em trânsito) com o representante.' END;
  END IF;
  IF EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.status = 'transito' AND t.to_party_id = c.consultora_party_id) THEN
    RAISE EXCEPTION 'A entrega para ela já está registrada: falta ela confirmar o recebimento e aceitar as peças no app.';
  END IF;
  IF c.custodian_party_id IS NULL OR EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.status IN ('pendente','transito')) THEN
    RAISE EXCEPTION 'O representante ainda não confirmou que recebeu esta maleta. Ele confirma primeiro no app dele; depois registre a entrega.';
  END IF;
  SELECT display_name INTO v_rep FROM parties WHERE id = c.custodian_party_id;
  SELECT display_name INTO v_cons FROM parties WHERE id = c.consultora_party_id;
  r := public.kit_transfer_forward(_cycle, jsonb_build_object('note',
         left('Entregue em mãos por ' || coalesce(v_rep, 'representante') || ' — registrado pela equipe: ' || v_motivo, 500)));
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, reason, payload)
  VALUES (_cycle, 'entrega.em_maos_registrada', uid, v_motivo,
          jsonb_build_object('representante', c.custodian_party_id, 'consultora', c.consultora_party_id, 'entrega', r));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.entregue_em_maos', 'kit_cycles', _cycle::text,
          jsonb_build_object('consultora', c.consultora_party_id, 'representante', c.custodian_party_id, 'motivo', v_motivo, 'entrega', r));
  RETURN coalesce(r, '{}'::jsonb) || jsonb_build_object('consultora', v_cons, 'representante', v_rep);
END $function$;
REVOKE ALL ON FUNCTION public.maleta_entregue_em_maos(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.maleta_entregue_em_maos(uuid, text) TO authenticated, service_role;
