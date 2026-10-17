-- ============================================================================
-- 11 — Endurecimento da cadeia fiscal (complementa 04-fiscal-cadeia.sql)
--
-- Regra: o resultado do provedor (tentativa, autorização, rejeição e
-- cancelamento homologado) só entra pelo servidor (service_role), que é quem
-- conversa com a Focus. Nenhuma pessoa, nem o Master, "autoriza" nota pela tela.
--
-- Autorização exige chave de acesso válida (DV), do modelo 55 e do CNPJ do
-- emissor; série e número saem da própria chave, e o índice de numeração
-- impede número repetido.
--
-- Aplicar junto com 01, 02 e 04 quando a cadeia fiscal for promovida.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fiscal_servico()
RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $fn$
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Retorno do provedor fiscal só pelo servidor.' USING errcode = '42501';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_servico() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_servico() TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_doc_registrar_retorno(_doc uuid, _status text, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE d record; cfg record; n integer; simulado boolean;
BEGIN
  PERFORM public.fiscal_servico();
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  IF _status NOT IN ('respondida','timeout','erro','enviada') THEN RAISE EXCEPTION 'Situação de tentativa inválida.'; END IF;
  SELECT * INTO cfg FROM public.fiscal_settings WHERE id;
  simulado := NOT (coalesce(cfg.emission_active,false) AND cfg.provider IS NOT NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal-tentativa:' || _doc::text, 0));
  SELECT coalesce(max(attempt_no),0) + 1 INTO n FROM public.fiscal_document_attempts WHERE document_id = _doc;
  INSERT INTO public.fiscal_document_attempts
    (document_id, attempt_no, provider, environment, request_hash, response_payload, status, code, message, simulado, finished_at)
  VALUES (_doc, n, d.provider, d.environment, md5(coalesce(_payload::text,'')), _payload, _status,
          _payload->>'code', left(_payload->>'message', 2000), simulado, CASE WHEN _status <> 'enviada' THEN now() END);
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_doc, 'tentativa', d.status, d.status, NULL, jsonb_build_object('tentativa', n, 'situacao', _status, 'simulado', simulado));
  RETURN jsonb_build_object('id', _doc, 'tentativa', n, 'simulado', simulado);
END $function$;

CREATE OR REPLACE FUNCTION public.fiscal_doc_autorizar(_doc uuid, _access_key text, _protocol text, _xml_path text, _xml_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE d record; cfg record; cnpj text; modelo text;
BEGIN
  PERFORM public.fiscal_servico();
  SELECT * INTO cfg FROM public.fiscal_settings WHERE id;
  IF coalesce(cfg.emission_active,false) IS NOT TRUE OR cfg.provider IS NULL THEN
    RAISE EXCEPTION 'Sem emissão ativa e sem provedor não existe autorização. Resposta simulada nunca é autorização real.';
  END IF;
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  IF d.status = 'autorizado' AND d.access_key = _access_key THEN
    RETURN jsonb_build_object('id', _doc, 'status', 'autorizado', 'repetido', true);
  END IF;
  IF d.status NOT IN ('na_fila','enviando','processando','enviado','contingencia','erro_tecnico') THEN
    RAISE EXCEPTION 'Autorização exige documento enviado ao provedor (situação atual: %).', d.status;
  END IF;
  IF nullif(btrim(coalesce(_protocol,'')),'') IS NULL THEN RAISE EXCEPTION 'Protocolo de autorização obrigatório.'; END IF;
  cnpj := coalesce(d.emitter_snapshot->>'tax_id', (SELECT tax_id FROM public.business_entities WHERE id = d.emitter_entity_id));
  modelo := coalesce(d.model, '55');
  IF nullif(regexp_replace(coalesce(cnpj,''), '\D', '', 'g'), '') IS NULL THEN
    RAISE EXCEPTION 'Emissor sem CNPJ: não há como conferir a chave de acesso.';
  END IF;
  IF NOT public.nfe_chave_valida(_access_key, cnpj, modelo) THEN
    RAISE EXCEPTION 'Chave de acesso inválida para este emissor e modelo.';
  END IF;
  PERFORM set_config('lardann.fiscal','on', true);
  PERFORM set_config('lardann.fiscal_autorizar','on', true);
  UPDATE public.fiscal_documents
     SET status = 'autorizado', access_key = _access_key, protocol = _protocol, xml_path = _xml_path,
         xml_hash = _xml_hash, authorized_at = now(), simulado = false,
         model = modelo, series = ltrim(substr(_access_key, 23, 3), '0'), number = ltrim(substr(_access_key, 26, 9), '0')
   WHERE id = _doc;
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_doc, 'autorizacao', d.status, 'autorizado', NULL, jsonb_build_object('protocolo', _protocol));
  PERFORM set_config('lardann.fiscal_autorizar','off', true);
  PERFORM set_config('lardann.fiscal','off', true);
  RETURN jsonb_build_object('id', _doc, 'status', 'autorizado');
END $function$;

CREATE OR REPLACE FUNCTION public.fiscal_doc_rejeitar(_doc uuid, _codigo text, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE d record;
BEGIN
  PERFORM public.fiscal_servico();
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  IF d.status NOT IN ('na_fila','enviando','processando','enviado','contingencia','erro_tecnico') THEN
    RAISE EXCEPTION 'Só documento enviado ao provedor pode ser rejeitado (situação atual: %).', d.status;
  END IF;
  PERFORM set_config('lardann.fiscal','on', true);
  UPDATE public.fiscal_documents SET status = 'rejeitado', rejection_code = _codigo, rejected_reason = left(_motivo, 2000) WHERE id = _doc;
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, code, reason, actor_user_id)
  VALUES (_doc, 'rejeicao', d.status, 'rejeitado', _codigo, left(_motivo, 2000), NULL);
  PERFORM set_config('lardann.fiscal','off', true);
  RETURN jsonb_build_object('id', _doc, 'status', 'rejeitado', 'tentativa_anterior_preservada', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fiscal_doc_cancelar_registrar(_doc uuid, _protocolo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE d record;
BEGIN
  PERFORM public.fiscal_servico();
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  IF d.status = 'cancelado' THEN RETURN jsonb_build_object('id', _doc, 'status', 'cancelado', 'repetido', true); END IF;
  IF d.status <> 'cancelamento_solicitado' THEN RAISE EXCEPTION 'O cancelamento precisa ter sido solicitado.'; END IF;
  IF nullif(btrim(coalesce(_protocolo,'')),'') IS NULL THEN RAISE EXCEPTION 'Protocolo do cancelamento obrigatório.'; END IF;
  PERFORM set_config('lardann.fiscal','on', true);
  UPDATE public.fiscal_documents SET status = 'cancelado', cancelled_at = now() WHERE id = _doc;
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, code, actor_user_id)
  VALUES (_doc, 'cancelamento', 'cancelamento_solicitado', 'cancelado', _protocolo, NULL);
  PERFORM set_config('lardann.fiscal','off', true);
  RETURN jsonb_build_object('id', _doc, 'status', 'cancelado');
END $function$;

REVOKE ALL ON FUNCTION public.fiscal_doc_registrar_retorno(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_doc_autorizar(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_doc_rejeitar(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_doc_cancelar_registrar(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_doc_registrar_retorno(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_doc_autorizar(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_doc_rejeitar(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_doc_cancelar_registrar(uuid,text) TO service_role;
