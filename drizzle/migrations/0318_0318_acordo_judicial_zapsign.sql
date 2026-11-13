-- 0318: acordo judicial assinado pela ZapSign a partir da minuta em PDF anexada na aba Judicial.

ALTER TABLE public.cob_judicial_docs DROP CONSTRAINT IF EXISTS cob_judicial_docs_tipo_check;
ALTER TABLE public.cob_judicial_docs ADD CONSTRAINT cob_judicial_docs_tipo_check
  CHECK (tipo = ANY (ARRAY['minuta_acordo','termo_assinado','peticao','certidao','sentenca','comprovante','outro']));

ALTER TABLE public.assinaturas_digitais DROP CONSTRAINT IF EXISTS assinaturas_digitais_tipo_check;
ALTER TABLE public.assinaturas_digitais ADD CONSTRAINT assinaturas_digitais_tipo_check
  CHECK (tipo = ANY (ARRAY['contrato','promissoria','avulso','confissao','acordo_judicial']));

ALTER TABLE public.assinaturas_digitais
  ADD COLUMN IF NOT EXISTS judicial_acordo_id uuid REFERENCES public.cob_judicial_acordos(id),
  ADD COLUMN IF NOT EXISTS judicial_doc_id uuid REFERENCES public.cob_judicial_docs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assinantes jsonb;

ALTER TABLE public.assinaturas_digitais ADD CONSTRAINT assinaturas_acordo_judicial_vinculo
  CHECK (tipo <> 'acordo_judicial' OR judicial_acordo_id IS NOT NULL) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_acordo_judicial_pendente_unica
  ON public.assinaturas_digitais (judicial_acordo_id) WHERE status = 'pendente' AND tipo = 'acordo_judicial';

-- Dados para o envio: só quem cobra; acordo vigente; PDF da mesma pessoa.
CREATE OR REPLACE FUNCTION public.cob_judicial_assinatura_dados(_acordo uuid, _doc uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; d record; p record; j record; zap text; mail text; pend jsonb := '[]'; pendente jsonb;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança' USING errcode='42501'; END IF;
  SELECT * INTO a FROM cob_judicial_acordos WHERE id=_acordo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acordo judicial não encontrado.'; END IF;
  IF a.status <> 'vigente' THEN RAISE EXCEPTION 'Só acordo vigente vai para assinatura.'; END IF;
  SELECT * INTO d FROM cob_judicial_docs WHERE id=_doc;
  IF NOT FOUND OR d.party_id <> a.party_id THEN RAISE EXCEPTION 'Escolha um PDF anexado na ficha desta pessoa.'; END IF;
  IF d.content_type <> 'application/pdf' THEN RAISE EXCEPTION 'A assinatura precisa de um arquivo PDF.'; END IF;
  SELECT * INTO p FROM parties WHERE id=a.party_id;
  SELECT * INTO j FROM cob_judicial WHERE party_id=a.party_id;
  SELECT regexp_replace(value,'\D','','g') INTO zap FROM contact_points WHERE party_id=a.party_id AND kind='whatsapp' ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT value INTO mail FROM contact_points WHERE party_id=a.party_id AND kind='email' ORDER BY is_primary DESC, created_at LIMIT 1;
  IF (zap IS NULL OR length(zap) < 10) AND mail IS NULL THEN pend := pend || '["WhatsApp ou e-mail"]'; END IF;
  IF p.doc_digits IS NULL OR length(p.doc_digits) <> 11 THEN pend := pend || '["CPF"]'; END IF;
  SELECT to_jsonb(x) INTO pendente FROM (SELECT id, sign_url FROM assinaturas_digitais
    WHERE judicial_acordo_id=_acordo AND tipo='acordo_judicial' AND status='pendente' ORDER BY criado_em DESC LIMIT 1) x;
  RETURN jsonb_build_object(
    'party_id', a.party_id, 'pendente', pendente, 'pendencias', pend,
    'total_cents', a.total_cents, 'data_acordo', a.data_acordo,
    'doc', jsonb_build_object('id', d.id, 'titulo', d.titulo, 'storage_path', d.storage_path),
    'processo', coalesce(j.processo,''), 'comarca', coalesce(j.comarca,''), 'advogado', coalesce(j.advogado,''),
    'signer', jsonb_build_object('nome', p.display_name, 'cpf', p.doc_digits, 'whatsapp', zap, 'email', mail));
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_assinatura_dados(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_assinatura_dados(uuid, uuid) TO authenticated;

-- Lista para a tela (aba Judicial).
CREATE OR REPLACE FUNCTION public.cob_judicial_assinaturas(_party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança' USING errcode='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'acordo_id', s.judicial_acordo_id, 'status', s.status, 'titulo', s.titulo, 'ambiente', s.ambiente,
      'sign_url', CASE WHEN s.status='pendente' THEN s.sign_url END, 'criado_em', s.criado_em, 'assinado_em', s.assinado_em,
      'tem_copia', s.arquivo_path IS NOT NULL, 'whatsapp', s.enviado_whatsapp, 'assinantes', s.assinantes,
      'doc_titulo', d.titulo, 'invalidada_motivo', s.invalidada_motivo) ORDER BY s.criado_em DESC)
    FROM assinaturas_digitais s LEFT JOIN cob_judicial_docs d ON d.id=s.judicial_doc_id
    WHERE s.party_id=_party AND s.tipo='acordo_judicial'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_assinaturas(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_assinaturas(uuid) TO authenticated;

-- Registro (somente servidor): novos vínculos do acordo judicial; substituição recusa o link antigo na ZapSign.
CREATE OR REPLACE FUNCTION public.assinatura_registrar(_d jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  IF _d->>'tipo' = 'acordo_judicial' THEN
    INSERT INTO cob_interacoes(party_id, tipo, observacao, autor_id)
    VALUES ((_d->>'party_id')::uuid, 'anotacao', 'Acordo judicial enviado para assinatura (ZapSign): ' || left(coalesce(_d->>'titulo',''), 200), nullif(_d->>'ator','')::uuid);
  END IF;
  RETURN jsonb_build_object('id', novo);
END $function$;

-- Retorno da ZapSign: acordo judicial assinado vira anotação na ficha de cobrança.
CREATE OR REPLACE FUNCTION public.assinatura_retorno(_doc_token text, _status text, _assinado_em timestamp with time zone)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    IF x.tipo = 'acordo_judicial' THEN
      INSERT INTO cob_interacoes(party_id, tipo, observacao, autor_id)
      VALUES (x.party_id, 'anotacao', 'Acordo judicial ' || CASE st WHEN 'assinado' THEN 'assinado' WHEN 'recusado' THEN 'recusado' ELSE st END || ' na ZapSign: ' || left(x.titulo, 200), NULL);
    END IF;
  END IF;
  RETURN jsonb_build_object('id', x.id, 'status', st);
END $function$;

-- Cancelar o acordo judicial também cancela o link de assinatura pendente (a rotina recusa na ZapSign).
CREATE OR REPLACE FUNCTION public.cob_judicial_acordo_status(_id uuid, _status text, _motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r cob_judicial_acordos;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF _status NOT IN ('cumprido','descumprido','cancelado') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  IF nullif(trim(_motivo),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  SELECT * INTO r FROM cob_judicial_acordos WHERE id=_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Acordo não encontrado'; END IF;
  IF r.status <> 'vigente' THEN RAISE EXCEPTION 'Acordo já encerrado'; END IF;
  UPDATE cob_judicial_acordos SET status=_status, status_motivo=left(_motivo,500), updated_at=now() WHERE id=_id;
  IF _status='cancelado' AND r.simulacao_id IS NOT NULL THEN
    UPDATE cob_simulacoes SET status='cancelada', updated_at=now() WHERE id=r.simulacao_id AND status IN ('simulada','aguardando_entrada','efetivada');
  END IF;
  IF _status='cancelado' THEN
    UPDATE assinaturas_digitais SET status='cancelado', atualizado_em=now(), invalidada_em=now(),
           invalidada_motivo='Acordo judicial cancelado: '||left(_motivo,200),
           zapsign_cancelar_em=CASE WHEN doc_token IS NOT NULL THEN now() END
     WHERE judicial_acordo_id=_id AND tipo='acordo_judicial' AND status='pendente';
  END IF;
  INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id) VALUES(r.party_id,'anotacao','Acordo judicial '||_status||': '||left(_motivo,500),auth.uid());
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload) VALUES (auth.uid(), 'cob_judicial_acordo_status', 'cob_judicial_acordos', _id::text, jsonb_build_object('status',_status,'motivo',_motivo));
END $function$;