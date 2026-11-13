CREATE OR REPLACE FUNCTION public.assinatura_registrar(_d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE novo uuid; jud uuid := nullif(_d->>'judicial_acordo_id','')::uuid;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF nullif(_d->>'substitui', '') IS NOT NULL THEN
    UPDATE assinaturas_digitais SET status = 'cancelado', atualizado_em = now(),
           invalidada_em = CASE WHEN tipo = 'acordo_judicial' THEN now() ELSE invalidada_em END,
           invalidada_motivo = CASE WHEN tipo = 'acordo_judicial' THEN 'Substituído por novo envio do acordo.' ELSE invalidada_motivo END,
           zapsign_cancelar_em = CASE WHEN tipo = 'acordo_judicial' AND doc_token IS NOT NULL THEN now() ELSE zapsign_cancelar_em END
     WHERE id = (_d->>'substitui')::uuid AND status = 'pendente';
  END IF;
  INSERT INTO assinaturas_digitais (ambiente, tipo, party_id, cycle_id, representante_party_id, doc_token, signer_token, sign_url,
                                    status, titulo, texto_hash, valor_cents, enviado_whatsapp, erro, criado_por, simulacao_id,
                                    judicial_acordo_id, judicial_doc_id, assinantes)
  VALUES (_d->>'ambiente', _d->>'tipo', (_d->>'party_id')::uuid, nullif(_d->>'cycle_id', '')::uuid, nullif(_d->>'rep', '')::uuid,
          _d->>'doc_token', _d->>'signer_token', _d->>'sign_url', coalesce(_d->>'status', 'pendente'), _d->>'titulo', _d->>'texto_hash',
          nullif(_d->>'valor_cents', '')::bigint, coalesce((_d->>'whatsapp')::boolean, false), _d->>'erro', nullif(_d->>'ator', '')::uuid,
          nullif(_d->>'simulacao_id','')::uuid, jud, nullif(_d->>'judicial_doc_id','')::uuid, _d->'assinantes')
  RETURNING id INTO novo;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (nullif(_d->>'ator', '')::uuid, 'assinatura.enviada', 'assinaturas_digitais', novo::text,
          jsonb_build_object('tipo', _d->>'tipo', 'party_id', _d->>'party_id', 'cycle_id', _d->>'cycle_id', 'simulacao_id', _d->>'simulacao_id',
                             'judicial_acordo_id', jud, 'ambiente', _d->>'ambiente'));
  IF _d->>'tipo' = 'acordo_judicial' AND nullif(_d->>'ator','') IS NOT NULL THEN
    INSERT INTO cob_interacoes(party_id, tipo, observacao, autor_id)
    VALUES ((_d->>'party_id')::uuid, 'anotacao', 'Acordo judicial enviado para assinatura (ZapSign): ' || left(coalesce(_d->>'titulo',''), 200), nullif(_d->>'ator','')::uuid);
  END IF;
  RETURN jsonb_build_object('id', novo);
END $function$;

CREATE OR REPLACE FUNCTION public.assinatura_retorno(_doc_token text, _status text, _assinado_em timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE x record; st text;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  SELECT * INTO x FROM assinaturas_digitais WHERE doc_token = _doc_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ignorado', true); END IF;
  IF x.invalidada_em IS NOT NULL THEN
    IF _status = 'signed' AND x.status <> 'assinado' THEN
      INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
      VALUES (NULL, 'assinatura.assinada_apos_transferencia', 'assinaturas_digitais', x.id::text,
              jsonb_build_object('tipo', x.tipo, 'party_id', x.party_id, 'cycle_id', x.cycle_id));
    END IF;
    RETURN jsonb_build_object('id', x.id, 'status', x.status, 'invalidada', true);
  END IF;
  st := CASE _status WHEN 'signed' THEN 'assinado' WHEN 'refused' THEN 'recusado' WHEN 'deleted' THEN 'cancelado' ELSE x.status END;
  IF x.status = 'assinado' THEN st := 'assinado'; END IF;
  UPDATE assinaturas_digitais SET status = st, assinado_em = CASE WHEN st = 'assinado' THEN coalesce(assinado_em, _assinado_em, now()) END,
         atualizado_em = now() WHERE id = x.id;
  IF st IS DISTINCT FROM x.status THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'assinatura.' || st, 'assinaturas_digitais', x.id::text, jsonb_build_object('tipo', x.tipo, 'party_id', x.party_id));
    -- autor obrigatório no histórico: quem enviou o acordo para assinar
    IF x.tipo = 'acordo_judicial' AND x.criado_por IS NOT NULL THEN
      INSERT INTO cob_interacoes(party_id, tipo, observacao, autor_id)
      VALUES (x.party_id, 'anotacao', 'Acordo judicial ' || st || ' na ZapSign: ' || left(x.titulo, 200), x.criado_por);
    END IF;
  END IF;
  RETURN jsonb_build_object('id', x.id, 'status', st);
END $function$;