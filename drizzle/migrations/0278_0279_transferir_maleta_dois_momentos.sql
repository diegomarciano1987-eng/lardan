-- 0279 (Diego, 11/11/2026): transferir uma maleta de uma consultora para outra em dois momentos —
-- (1) depois da montagem, antes da nota; (2) já na rua, a caminho dela, com nota e promissória.
-- Vale para a equipe (Daniel/Master e montagem) e para o representante. Trava só o que é irreversível
-- sem acerto: aceite, termo assinado, pedido de cliente, pré-baixa, Correios ativo, nota sendo emitida agora.
-- Entrega em mãos ainda não confirmada é cancelada; se ela já confirmou o recebimento (sem aceite),
-- a maleta volta para a custódia do representante. Promissória pendente da anterior é cancelada
-- (e pedida a recusa na ZapSign); a assinada fica guardada como prova, marcada como substituída.
-- Nota autorizada em nome da anterior vira pendência fiscal para a montagem (devolução + nota nova).

ALTER TABLE public.assinaturas_digitais
  ADD COLUMN IF NOT EXISTS invalidada_em timestamptz,
  ADD COLUMN IF NOT EXISTS invalidada_motivo text,
  ADD COLUMN IF NOT EXISTS zapsign_cancelar_em timestamptz,
  ADD COLUMN IF NOT EXISTS zapsign_cancelado_em timestamptz;
COMMENT ON COLUMN public.assinaturas_digitais.invalidada_em IS 'Documento substituído porque a maleta foi transferida para outra consultora (0279). Nunca é cobrado.';
COMMENT ON COLUMN public.assinaturas_digitais.zapsign_cancelar_em IS 'Pedido de recusa na ZapSign ainda não confirmado (rotina de 10 min tenta de novo).';

ALTER TABLE public.maleta_troca_pendencias
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'representante',
  ADD COLUMN IF NOT EXISTS motivo text;

CREATE INDEX IF NOT EXISTS assinaturas_zapsign_cancelar_idx ON public.assinaturas_digitais (zapsign_cancelar_em)
  WHERE zapsign_cancelar_em IS NOT NULL AND zapsign_cancelado_em IS NULL;

-- Situação da maleta para transferir (sem trava): o que impede e o que vai acontecer.
CREATE OR REPLACE FUNCTION public.maleta_transferir_situacao(_cycle uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c kit_cycles; nome text; rep_nome text; v_bloq text; v_nf_num text; v_prom text; v_entrega boolean; v_maleta text;
BEGIN
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  SELECT display_name INTO nome FROM parties WHERE id = c.consultora_party_id;
  SELECT display_name INTO rep_nome FROM parties WHERE id = c.representante_party_id;
  SELECT code INTO v_maleta FROM kits WHERE id = c.kit_id;
  nome := coalesce(nome, 'a consultora');

  IF c.status::text NOT IN ('rascunho','montagem','conferida','expedida','transito','recebida') THEN
    v_bloq := 'Esta maleta já está em uso pela consultora. Para passar as peças para outra, ela precisa voltar e passar pelo acerto.';
  ELSIF EXISTS (SELECT 1 FROM kit_acceptances a WHERE a.cycle_id = c.id) THEN
    v_bloq := format('%s já aceitou esta maleta. Com aceite feito, só pelo acerto (devolução das peças).', nome);
  ELSIF EXISTS (SELECT 1 FROM kit_signature_requests s WHERE s.cycle_id = c.id AND s.estado IN ('assinado','finalizado')) THEN
    v_bloq := format('%s já assinou o termo de aceite desta maleta. Com aceite feito, só pelo acerto.', nome);
  ELSIF EXISTS (SELECT 1 FROM sales_order_items i WHERE i.cycle_id = c.id) THEN
    v_bloq := 'Já existe pedido de cliente com peças desta maleta. Não dá para transferir.';
  ELSIF EXISTS (SELECT 1 FROM kit_pre_baixas p WHERE p.cycle_id = c.id) THEN
    v_bloq := 'Esta maleta já tem acerto começado. Não dá para transferir.';
  ELSIF EXISTS (SELECT 1 FROM correios_envios e WHERE e.cycle_id = c.id AND e.status NOT IN ('cancelada','expirada','erro')) THEN
    v_bloq := format('Esta maleta tem envio pelos Correios para %s. Cancele o envio antes de transferir.', nome);
  ELSIF EXISTS (SELECT 1 FROM fiscal_focus_envios e WHERE e.cycle_id = c.id AND e.operacao = 'remessa'
                 AND e.status NOT IN ('autorizado','cancelado','erro_autorizacao','erro_envio','erro','denegado')) THEN
    v_bloq := 'A nota fiscal desta maleta está sendo emitida agora. Espere terminar (1 a 2 minutos) e tente de novo.';
  ELSIF c.status = 'recebida' AND c.representante_party_id IS NULL THEN
    v_bloq := format('%s já recebeu a maleta e a remessa não tem representante: ela precisa devolver a maleta à empresa.', nome);
  END IF;

  IF c.consultora_party_id IS NOT NULL THEN
    SELECT e.numero::text INTO v_nf_num FROM fiscal_focus_envios e
     WHERE e.cycle_id = c.id AND e.operacao = 'remessa' AND e.status = 'autorizado' ORDER BY e.created_at DESC LIMIT 1;
    IF v_nf_num IS NULL THEN
      SELECT coalesce(f.number::text, f.access_key) INTO v_nf_num FROM fiscal_documents f
       WHERE f.cycle_id = c.id AND f.status::text NOT ILIKE 'cancel%' AND f.status::text NOT ILIKE 'rejeit%'
       ORDER BY f.created_at DESC LIMIT 1;
    END IF;
    SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_or(status = 'assinado') THEN 'assinada' ELSE 'pendente' END INTO v_prom FROM assinaturas_digitais
     WHERE cycle_id = c.id AND party_id = c.consultora_party_id AND tipo = 'promissoria' AND status IN ('pendente','assinado') AND invalidada_em IS NULL;
  END IF;
  v_entrega := EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.status IN ('pendente','transito')
                        AND t.to_party_id IS NOT DISTINCT FROM c.consultora_party_id AND c.consultora_party_id IS NOT NULL);

  RETURN jsonb_build_object(
    'cycle_id', c.id, 'maleta', v_maleta, 'status', c.status, 'remessa_id', c.remessa_id,
    'consultora_party_id', c.consultora_party_id, 'consultora', CASE WHEN c.consultora_party_id IS NULL THEN NULL ELSE nome END,
    'representante_party_id', c.representante_party_id, 'representante', rep_nome, 'abertura_numero', c.abertura_numero,
    'entrega_pendente', v_entrega, 'ja_recebeu', c.status = 'recebida',
    'promissoria', v_prom, 'nota_numero', v_nf_num,
    'momento', CASE WHEN v_nf_num IS NOT NULL THEN 'com_nota' ELSE 'antes_da_nota' END,
    'bloqueio', v_bloq);
END $function$;
REVOKE ALL ON FUNCTION public.maleta_transferir_situacao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maleta_transferir_situacao(uuid) TO service_role;

-- Núcleo único da transferência (equipe e representante). Só é chamado pelas rotinas abaixo.
CREATE OR REPLACE FUNCTION public.maleta_transferir_exec(_cycle uuid, _consultora uuid, _lead uuid, _abertura boolean,
                                                         _motivo text, _rep uuid, _origem text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles; r remessas; s jsonb; anterior uuid; anterior_nome text; v_maleta text;
        v_nf_num text; v_nf_chave text; v_num int; res jsonb := '{}'::jsonb; nova uuid; nova_nome text;
        v_tokens text[] := '{}'; v_tinha_prom boolean := false; v_pend uuid; n_entregas int := 0; n_termos int := 0;
        n int; tid uuid; st party_status; v_recebida boolean := false; v_motivo text := btrim(coalesce(_motivo, ''));
BEGIN
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  s := public.maleta_transferir_situacao(_cycle);
  IF s->>'bloqueio' IS NOT NULL THEN RAISE EXCEPTION '%', s->>'bloqueio'; END IF;
  anterior := c.consultora_party_id;
  IF _lead IS NULL AND anterior IS NOT DISTINCT FROM _consultora THEN
    RAISE EXCEPTION '%', CASE WHEN anterior IS NULL THEN 'A maleta já está sem consultora.' ELSE 'A maleta já é desta consultora.' END;
  END IF;
  SELECT display_name INTO anterior_nome FROM parties WHERE id = anterior;
  SELECT code INTO v_maleta FROM kits WHERE id = c.kit_id;
  SELECT * INTO r FROM remessas WHERE id = c.remessa_id;

  -- destino da equipe: validar antes de mexer em qualquer coisa
  IF _rep IS NULL THEN
    IF _consultora IS NOT NULL THEN
      SELECT status INTO st FROM parties WHERE id = _consultora;
      IF NOT FOUND THEN RAISE EXCEPTION 'Consultora não encontrada.'; END IF;
      IF st IN ('bloqueado','desligado') THEN RAISE EXCEPTION 'Consultora bloqueada ou desligada não recebe maleta.'; END IF;
      IF r.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM consultant_profiles cp WHERE cp.party_id = _consultora
           AND (cp.praca_id = r.praca_id OR (r.representante_party_id IS NOT NULL AND cp.representative_party_id = r.representante_party_id))) THEN
        RAISE EXCEPTION 'Esta consultora não é da praça da remessa nem da carteira do representante.';
      END IF;
      IF r.id IS NOT NULL AND EXISTS (SELECT 1 FROM kit_cycles k WHERE k.remessa_id = r.id AND k.consultora_party_id = _consultora
           AND k.status <> 'cancelada' AND k.id <> c.id) THEN
        RAISE EXCEPTION 'Esta consultora já tem maleta nesta remessa.';
      END IF;
    ELSIF coalesce(r.representante_party_id, c.representante_party_id) IS NULL THEN
      RAISE EXCEPTION 'A remessa não tem representante para ficar com a maleta de abertura.';
    END IF;
  END IF;

  -- 1. ela já tinha confirmado o recebimento (sem aceite): a maleta volta para a custódia do representante
  IF c.status = 'recebida' THEN
    v_recebida := true;
    SELECT coalesce(max(seq), 0) + 1 INTO n FROM kit_transfers WHERE cycle_id = c.id;
    INSERT INTO kit_transfers (cycle_id, seq, status, from_party_id, to_party_id, from_location_id, to_location_id, shipped_at, delivered_at, note, created_by, updated_by)
    VALUES (c.id, n, 'entregue', c.custodian_party_id, c.representante_party_id, c.current_location_id, c.current_location_id, now(), now(),
            'Transferência da maleta: volta para o representante. ' || v_motivo, uid, uid)
    RETURNING id INTO tid;
    UPDATE kit_cycles SET status = 'transito', custodian_party_id = c.representante_party_id, received_at = NULL, updated_by = uid WHERE id = c.id;
    INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
    VALUES (c.id, 'custodia.devolvida_representante', 'recebida', 'transito', uid,
            jsonb_build_object('transferencia', tid, 'representante', c.representante_party_id, 'motivo', 'maleta.transferida'), v_motivo);
  END IF;

  -- 2. entrega em mãos ainda não confirmada por ela: cancelada
  IF anterior IS NOT NULL THEN
    UPDATE kit_transfers SET status = 'cancelada', refusal_reason = 'Maleta transferida para outra consultora. ' || v_motivo,
           updated_by = uid, updated_at = now()
     WHERE cycle_id = c.id AND status IN ('pendente','transito') AND to_party_id = anterior;
    GET DIAGNOSTICS n_entregas = ROW_COUNT;
  END IF;

  -- 3. termo de aceite ainda não assinado: cancelado
  UPDATE kit_signature_requests SET estado = 'cancelado', motivo = 'Maleta transferida para outra consultora. ' || v_motivo
   WHERE cycle_id = c.id AND estado IN ('preparado','enviado','falha');
  GET DIAGNOSTICS n_termos = ROW_COUNT;

  -- 4. promissória da anterior: pendente é cancelada (recusa na ZapSign); assinada fica como prova, substituída
  IF anterior IS NOT NULL THEN
    SELECT coalesce(array_agg(doc_token) FILTER (WHERE status = 'pendente' AND doc_token IS NOT NULL), '{}'), count(*) > 0
      INTO v_tokens, v_tinha_prom
      FROM assinaturas_digitais
     WHERE cycle_id = c.id AND party_id = anterior AND tipo = 'promissoria' AND status IN ('pendente','assinado') AND invalidada_em IS NULL;
    UPDATE assinaturas_digitais
       SET status = CASE WHEN status = 'pendente' THEN 'cancelado' ELSE status END,
           zapsign_cancelar_em = CASE WHEN status = 'pendente' AND doc_token IS NOT NULL THEN now() END,
           invalidada_em = now(), invalidada_motivo = 'Maleta ' || coalesce(v_maleta, '') || ' transferida para outra consultora. ' || v_motivo,
           atualizado_em = now()
     WHERE cycle_id = c.id AND party_id = anterior AND tipo = 'promissoria' AND status IN ('pendente','assinado') AND invalidada_em IS NULL;

    -- 5. nota de remessa já autorizada em nome da anterior
    SELECT e.numero::text, e.chave_nfe INTO v_nf_num, v_nf_chave FROM fiscal_focus_envios e
     WHERE e.cycle_id = c.id AND e.operacao = 'remessa' AND e.status = 'autorizado' ORDER BY e.created_at DESC LIMIT 1;
    IF v_nf_num IS NULL AND v_nf_chave IS NULL THEN
      SELECT f.number::text, f.access_key INTO v_nf_num, v_nf_chave FROM fiscal_documents f
       WHERE f.cycle_id = c.id AND f.status::text NOT ILIKE 'cancel%' AND f.status::text NOT ILIKE 'rejeit%'
       ORDER BY f.created_at DESC LIMIT 1;
    END IF;
  END IF;

  -- 6. sai da anterior
  UPDATE kit_cycles SET consultora_party_id = NULL, updated_by = uid, updated_at = now() WHERE id = c.id;
  UPDATE remessa_informacoes SET cycle_id = NULL, updated_at = now() WHERE cycle_id = c.id;

  -- número de ABERTURA quando vira abertura (equipe) ou quando o representante usa para abertura (0273)
  v_num := c.abertura_numero;
  IF (_abertura OR _rep IS NOT NULL) AND c.abertura_numero IS NULL AND c.remessa_id IS NOT NULL THEN
    SELECT coalesce(max(abertura_numero), 0) + 1 INTO v_num FROM kit_cycles
     WHERE remessa_id = c.remessa_id AND representante_party_id IS NOT DISTINCT FROM c.representante_party_id;
    UPDATE kit_cycles SET abertura_numero = v_num WHERE id = c.id;
  END IF;

  -- 7. entra na nova
  IF _rep IS NOT NULL THEN
    BEGIN
      res := public.rep_maleta_repassar(_rep, c.id, _consultora, _lead);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Ela já tem uma maleta nesta remessa.';
    END;
    nova := (res->>'consultora_party_id')::uuid;
  ELSIF _consultora IS NOT NULL THEN
    BEGIN
      UPDATE kit_cycles SET consultora_party_id = _consultora, updated_by = uid, updated_at = now() WHERE id = c.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Esta consultora já tem maleta nesta remessa.';
    END;
    nova := _consultora;
  END IF;
  SELECT display_name INTO nova_nome FROM parties WHERE id = nova;

  -- 8. pendência fiscal: a montagem faz a devolução da anterior e a nota nova
  IF v_nf_num IS NOT NULL OR v_nf_chave IS NOT NULL THEN
    -- a fila automática não tenta nota nova enquanto a antiga não for resolvida
    DELETE FROM fiscal_fila WHERE cycle_id = c.id AND etapa = 'remessa' AND status = 'pendente' AND criado_em = now();
    -- já existe pendência aberta (a nota continua em nome da primeira): só muda quem ficou com a maleta
    UPDATE maleta_troca_pendencias
       SET consultora_nova_party_id = nova,
           consultora_nova_nome = coalesce(nova_nome, CASE WHEN v_num IS NOT NULL THEN 'ABERTURA ' || lpad(v_num::text, 2, '0') ELSE 'abertura' END),
           motivo = concat_ws(' · ', motivo, nullif(v_motivo, ''))
     WHERE cycle_id = c.id AND status = 'aberta'
    RETURNING id INTO v_pend;
    IF v_pend IS NULL THEN
    INSERT INTO maleta_troca_pendencias (cycle_id, remessa_id, maleta, consultora_anterior_party_id, consultora_anterior_nome,
                                         consultora_nova_party_id, consultora_nova_nome, nota_numero, nota_chave, criado_por, origem, motivo)
    VALUES (c.id, c.remessa_id, v_maleta, anterior, anterior_nome, nova,
            coalesce(nova_nome, CASE WHEN v_num IS NOT NULL THEN 'ABERTURA ' || lpad(v_num::text, 2, '0') ELSE 'abertura' END),
            v_nf_num, v_nf_chave, uid, _origem, nullif(v_motivo, ''))
    RETURNING id INTO v_pend;
    END IF;
  END IF;

  INSERT INTO kit_events (cycle_id, kind, actor_user_id, reason, payload)
  VALUES (c.id, CASE WHEN _rep IS NOT NULL THEN 'maleta.trocada_para_abertura' ELSE 'maleta.transferida' END, uid, nullif(v_motivo, ''),
          jsonb_build_object('origem', _origem, 'representante', _rep, 'consultora_anterior', anterior, 'consultora_nova', nova,
                             'candidata', _lead, 'abertura_numero', v_num, 'status_antes', c.status, 'pendencia_fiscal', v_pend,
                             'entregas_canceladas', n_entregas, 'termos_cancelados', n_termos, 'voltou_do_recebimento', v_recebida,
                             'promissorias_substituidas', v_tinha_prom));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, CASE WHEN _rep IS NOT NULL THEN 'maleta.trocada_para_abertura' ELSE 'maleta.transferida' END, 'kit_cycles', c.id::text,
          jsonb_build_object('origem', _origem, 'representante', _rep, 'consultora_anterior', anterior, 'consultora_anterior_nome', anterior_nome,
                             'consultora_nova', nova, 'consultora_nova_nome', nova_nome, 'candidata', _lead, 'abertura_numero', v_num,
                             'status_antes', c.status, 'motivo', nullif(v_motivo, ''), 'nota_anterior', v_nf_num, 'pendencia_fiscal', v_pend,
                             'entregas_canceladas', n_entregas, 'termos_cancelados', n_termos, 'voltou_do_recebimento', v_recebida,
                             'promissorias_canceladas_zapsign', coalesce(array_length(v_tokens, 1), 0), 'promissorias_substituidas', v_tinha_prom));

  RETURN res || jsonb_build_object(
    'consultora_party_id', nova, 'consultora_nova', nova_nome, 'consultora_anterior', anterior_nome,
    'nova_consultora', coalesce((res->>'nova_consultora')::boolean, false),
    'abertura_numero', v_num, 'pendencia_fiscal', v_pend IS NOT NULL, 'nota_numero', v_nf_num,
    'zapsign_cancelar', to_jsonb(v_tokens), 'tinha_promissoria', v_tinha_prom,
    'entregas_canceladas', n_entregas, 'voltou_do_recebimento', v_recebida);
END $function$;
REVOKE ALL ON FUNCTION public.maleta_transferir_exec(uuid, uuid, uuid, boolean, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maleta_transferir_exec(uuid, uuid, uuid, boolean, text, uuid, text) TO service_role;

-- Prévia para a tela (equipe ou o representante da maleta).
CREATE OR REPLACE FUNCTION public.maleta_transferir_previa(_cycle uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles;
BEGIN
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF NOT (((public.can_manage_kits(uid) OR public.has_role(uid, 'master')) AND public.kit_cycle_in_scope(_cycle))
          OR (c.representante_party_id IS NOT NULL AND public.rep_portal_pode(c.representante_party_id))
          OR (c.custodian_party_id IS NOT NULL AND public.rep_portal_pode(c.custodian_party_id))) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN public.maleta_transferir_situacao(_cycle);
END $function$;
REVOKE ALL ON FUNCTION public.maleta_transferir_previa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_transferir_previa(uuid) TO authenticated, service_role;

-- Equipe (Daniel/Master e montagem): para outra consultora da praça ou deixa como ABERTURA com o representante.
CREATE OR REPLACE FUNCTION public.remessa_maleta_transferir(_cycle uuid, _consultora uuid, _motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT (public.can_manage_kits(uid) OR public.has_role(uid, 'master')) THEN
    RAISE EXCEPTION 'Sem permissão para transferir maletas.' USING errcode = '42501';
  END IF;
  IF public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da transferência (mínimo 5 letras).'; END IF;
  RETURN public.maleta_transferir_exec(_cycle, _consultora, NULL, _consultora IS NULL, _motivo, NULL, 'equipe');
END $function$;
REVOKE ALL ON FUNCTION public.remessa_maleta_transferir(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_maleta_transferir(uuid, uuid, text) TO authenticated, service_role;

-- Representante: qualquer maleta da carteira dele ainda sem aceite (com ele, entregue em mãos sem
-- confirmação ou já recebida sem aceite) passa para outra consultora ou candidata dele.
CREATE OR REPLACE FUNCTION public.rep_maleta_trocar_destino(_rep uuid, _cycle uuid, _consultora uuid DEFAULT NULL, _lead uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c kit_cycles;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF (_consultora IS NULL) = (_lead IS NULL) THEN RAISE EXCEPTION 'Escolha uma consultora ou uma candidata.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL OR NOT (c.custodian_party_id = _rep OR (c.status = 'recebida' AND c.representante_party_id = _rep)) THEN
    RAISE EXCEPTION 'Esta maleta não está com você.';
  END IF;
  IF c.status NOT IN ('transito','recebida') THEN RAISE EXCEPTION 'Confirme o recebimento da maleta antes de passar.'; END IF;
  IF c.consultora_party_id IS NULL THEN
    RETURN public.rep_maleta_repassar(_rep, _cycle, _consultora, _lead);
  END IF;
  IF c.consultora_party_id = _consultora THEN RAISE EXCEPTION 'Esta maleta já é dela.'; END IF;
  RETURN public.maleta_transferir_exec(_cycle, _consultora, _lead, false, 'Troca feita pelo representante no app', _rep, 'representante');
END $function$;
REVOKE ALL ON FUNCTION public.rep_maleta_trocar_destino(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_maleta_trocar_destino(uuid, uuid, uuid, uuid) TO authenticated, service_role;

-- ZapSign: fila de recusas pedidas (o servidor tenta na hora; a rotina de 10 min tenta de novo).
CREATE OR REPLACE FUNCTION public.assinaturas_zapsign_cancelar_fila(_limite integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r jsonb;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  WITH alvo AS (
    SELECT id FROM assinaturas_digitais
     WHERE zapsign_cancelar_em IS NOT NULL AND zapsign_cancelado_em IS NULL AND doc_token IS NOT NULL
     ORDER BY zapsign_cancelar_em
     LIMIT least(greatest(coalesce(_limite, 10), 1), 50)
     FOR UPDATE SKIP LOCKED
  ), marcados AS (
    UPDATE assinaturas_digitais a SET zapsign_cancelar_em = now() FROM alvo WHERE a.id = alvo.id
    RETURNING a.doc_token, a.invalidada_motivo
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('doc_token', doc_token, 'motivo', invalidada_motivo)), '[]'::jsonb) INTO r FROM marcados;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.assinaturas_zapsign_cancelar_fila(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinaturas_zapsign_cancelar_fila(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.assinatura_zapsign_cancelada(_doc_token text, _resultado text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE x assinaturas_digitais;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  SELECT * INTO x FROM assinaturas_digitais WHERE doc_token = _doc_token FOR UPDATE;
  IF x.id IS NULL THEN RETURN jsonb_build_object('ignorado', true); END IF;
  IF x.zapsign_cancelado_em IS NOT NULL THEN RETURN jsonb_build_object('repetida', true); END IF;
  UPDATE assinaturas_digitais SET zapsign_cancelado_em = now(), atualizado_em = now() WHERE id = x.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (NULL, 'assinatura.recusada_zapsign', 'assinaturas_digitais', x.id::text,
          jsonb_build_object('tipo', x.tipo, 'party_id', x.party_id, 'cycle_id', x.cycle_id, 'resultado', _resultado));
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.assinatura_zapsign_cancelada(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_zapsign_cancelada(text, text) TO service_role;

-- Retorno da ZapSign nunca "ressuscita" documento substituído pela transferência.
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
  END IF;
  RETURN jsonb_build_object('id', x.id, 'status', st);
END $function$;

-- A tela de documentos mostra quando a promissória foi substituída pela transferência.
CREATE OR REPLACE FUNCTION public.assinaturas_da_consultora(_party uuid, _rep uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.assinatura_pode(_party, _rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'documentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'titulo', x.titulo, 'status', x.status, 'ambiente', x.ambiente,
        'sign_url', CASE WHEN x.status = 'pendente' THEN x.sign_url END, 'cycle_id', x.cycle_id, 'maleta', k.code, 'valor_cents', x.valor_cents,
        'criado_em', x.criado_em, 'assinado_em', x.assinado_em, 'enviado_whatsapp', x.enviado_whatsapp, 'erro', x.erro,
        'invalidada_em', x.invalidada_em, 'invalidada_motivo', x.invalidada_motivo) ORDER BY x.criado_em DESC)
      FROM assinaturas_digitais x LEFT JOIN kit_cycles kc ON kc.id = x.cycle_id LEFT JOIN kits k ON k.id = kc.kit_id
     WHERE x.party_id = _party), '[]'::jsonb),
    'maletas', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', kc.id, 'maleta', k.code, 'status', kc.status, 'remessa', r.numero,
        'valor_cents', (SELECT coalesce(sum(i.quantity::bigint * public.kit_preco(kc.id, i.variant_id)), 0) FROM kit_composition_items i
                         WHERE i.composition_id = (SELECT id FROM kit_compositions WHERE cycle_id = kc.id ORDER BY version DESC LIMIT 1)))
        ORDER BY kc.created_at DESC)
      FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id LEFT JOIN remessas r ON r.id = kc.remessa_id
     WHERE kc.consultora_party_id = _party AND kc.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao', 'acerto')), '[]'::jsonb));
END $function$;