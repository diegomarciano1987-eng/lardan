-- Assinatura Clicksign do Termo de Recebimento e Conferência de Maleta (aditivo).
-- Modo 'desligado' (padrão) mantém o aceite atual intacto.

CREATE TABLE IF NOT EXISTS public.clicksign_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  modo text NOT NULL DEFAULT 'desligado' CHECK (modo IN ('desligado','sandbox','producao')),
  termo_versao text NOT NULL DEFAULT 'rascunho-v0',
  termo_aprovado boolean NOT NULL DEFAULT false,
  autenticacao text NOT NULL DEFAULT 'email' CHECK (autenticacao IN ('email','whatsapp')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.clicksign_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.clicksign_settings TO authenticated;
GRANT ALL ON public.clicksign_settings TO service_role;
ALTER TABLE public.clicksign_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leitura do modo" ON public.clicksign_settings FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.kit_signature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id),
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id),
  signer_user_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'preparado'
    CHECK (estado IN ('preparado','enviado','assinado','finalizado','recusado','cancelado','expirado','falha')),
  modo text NOT NULL CHECK (modo IN ('sandbox','producao')),
  termo_versao text NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_sha256 text NOT NULL,
  idempotency_key text NOT NULL,
  pdf_path text,
  pdf_sha256 text,
  signed_path text,
  signed_sha256 text,
  envelope_id text UNIQUE,
  document_id text,
  signer_id text,
  motivo text,
  tentativas_download integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  assinado_em timestamptz,
  finalizado_em timestamptz,
  acceptance_id uuid,
  UNIQUE (cycle_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS kit_signature_requests_um_ativo
  ON public.kit_signature_requests (cycle_id) WHERE estado IN ('preparado','enviado','assinado');
GRANT SELECT ON public.kit_signature_requests TO authenticated;
GRANT ALL ON public.kit_signature_requests TO service_role;
ALTER TABLE public.kit_signature_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "termo no escopo da maleta" ON public.kit_signature_requests FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(cycle_id));

CREATE TABLE IF NOT EXISTS public.clicksign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  envelope_id text,
  evento text NOT NULL,
  request_id uuid REFERENCES public.kit_signature_requests(id),
  resultado text,
  recebido_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.clicksign_events TO service_role;
ALTER TABLE public.clicksign_events ENABLE ROW LEVEL SECURITY;

-- Trava do aceite direto quando a assinatura é exigida.
CREATE OR REPLACE FUNCTION public.kit_aceite_exige_assinatura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF (SELECT modo FROM public.clicksign_settings WHERE id = 1) <> 'desligado'
     AND coalesce(current_setting('lardan.assinatura_finalizando', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Esta maleta só é liberada depois do termo de recebimento assinado. Use "Gerar termo e assinar".'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kit_acceptances_exige_assinatura ON public.kit_acceptances;
CREATE TRIGGER kit_acceptances_exige_assinatura BEFORE INSERT ON public.kit_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.kit_aceite_exige_assinatura();

-- Modo (somente master). Nunca troca sozinho.
CREATE OR REPLACE FUNCTION public.clicksign_modo_definir(_modo text, _autenticacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); s public.clicksign_settings;
BEGIN
  IF uid IS NULL OR public.has_role(uid, 'master') IS NOT TRUE THEN
    RAISE EXCEPTION 'Somente o master altera a assinatura eletrônica.' USING errcode='42501';
  END IF;
  IF _modo NOT IN ('desligado','sandbox','producao') THEN RAISE EXCEPTION 'Modo inválido.'; END IF;
  SELECT * INTO s FROM public.clicksign_settings WHERE id = 1 FOR UPDATE;
  IF _modo = 'producao' AND s.termo_aprovado IS NOT TRUE THEN
    RAISE EXCEPTION 'O texto do termo ainda não foi aprovado pelo jurídico. Produção bloqueada.';
  END IF;
  UPDATE public.clicksign_settings
     SET modo = _modo, autenticacao = coalesce(_autenticacao, autenticacao),
         updated_by = uid, updated_at = now()
   WHERE id = 1;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'clicksign.modo', 'clicksign_settings', '1', jsonb_build_object('de', s.modo, 'para', _modo));
  RETURN jsonb_build_object('modo', _modo);
END $$;

-- Preparação: guarda a conferência imutável SEM liberar saldo.
CREATE OR REPLACE FUNCTION public.kit_assinatura_preparar(_cycle uuid, _itens jsonb, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  s public.clicksign_settings; c public.kit_cycles; comp public.kit_compositions;
  r public.kit_signature_requests; item jsonb; esperado integer; aceito integer; divergente integer;
  snap jsonb; linhas jsonb := '[]'::jsonb; sha text; k public.kits; nome text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  SELECT * INTO s FROM public.clicksign_settings WHERE id = 1;
  IF s.modo = 'desligado' THEN RAISE EXCEPTION 'Assinatura eletrônica não está ativa.'; END IF;
  IF nullif(trim(coalesce(_idempotency_key,'')),'') IS NULL THEN RAISE EXCEPTION 'Chave da operação ausente.'; END IF;

  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  -- Só a consultora destinatária. Gestão e representante não assinam no lugar dela.
  IF eu IS NULL OR c.consultora_party_id IS DISTINCT FROM eu THEN
    RAISE EXCEPTION 'Somente a consultora destinatária pode gerar e assinar este termo.' USING errcode='42501';
  END IF;

  SELECT * INTO r FROM public.kit_signature_requests WHERE cycle_id = _cycle AND idempotency_key = _idempotency_key;
  IF r.id IS NOT NULL THEN
    RETURN jsonb_build_object('request_id', r.id, 'repetida', true, 'estado', r.estado,
                              'snapshot', r.snapshot, 'sha256', r.snapshot_sha256);
  END IF;
  IF EXISTS (SELECT 1 FROM public.kit_signature_requests
              WHERE cycle_id = _cycle AND estado IN ('enviado','assinado')) THEN
    RAISE EXCEPTION 'Já existe um termo em assinatura para esta maleta.';
  END IF;
  -- Preparado que não chegou a ser enviado é substituído (fica guardado como cancelado).
  UPDATE public.kit_signature_requests SET estado = 'cancelado', motivo = 'Substituído por nova conferência'
   WHERE cycle_id = _cycle AND estado = 'preparado';

  IF c.status <> 'recebida' OR c.custodian_party_id IS DISTINCT FROM c.consultora_party_id THEN
    RAISE EXCEPTION 'A maleta precisa estar recebida pela consultora.';
  END IF;
  SELECT * INTO comp FROM public.kit_compositions WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  IF comp.frozen_at IS NULL THEN RAISE EXCEPTION 'Composição não conferida.'; END IF;
  IF jsonb_typeof(coalesce(_itens,'null'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Informe a conferência peça por peça.'; END IF;
  IF (SELECT count(DISTINCT x->>'variant_id') FROM jsonb_array_elements(_itens) x)
     <> (SELECT count(*) FROM public.kit_composition_items WHERE composition_id = comp.id)
     OR (SELECT count(*) FROM jsonb_array_elements(_itens) x)
     <> (SELECT count(*) FROM public.kit_composition_items WHERE composition_id = comp.id) THEN
    RAISE EXCEPTION 'A conferência precisa classificar todas as peças enviadas, uma vez cada.';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(_itens) ORDER BY value->>'variant_id' LOOP
    SELECT quantity INTO esperado FROM public.kit_composition_items
     WHERE composition_id = comp.id AND variant_id = (item->>'variant_id')::uuid;
    IF esperado IS NULL THEN RAISE EXCEPTION 'Peça informada não faz parte desta maleta.'; END IF;
    aceito := (item->>'qty_accepted')::integer; divergente := (item->>'qty_divergent')::integer;
    IF aceito IS NULL OR divergente IS NULL OR aceito < 0 OR divergente < 0 OR aceito + divergente <> esperado THEN
      RAISE EXCEPTION 'Quantidades da conferência não fecham com o que foi enviado.';
    END IF;
    IF divergente > 0 AND (coalesce(item->>'tipo_divergencia','') NOT IN ('faltante','defeito')
       OR nullif(trim(coalesce(item->>'motivo','')),'') IS NULL) THEN
      RAISE EXCEPTION 'Divergência precisa de tipo (faltante/defeito) e justificativa.';
    END IF;
    linhas := linhas || jsonb_build_array(jsonb_build_object(
      'variant_id', item->>'variant_id',
      'produto', (SELECT p.name FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
                   WHERE pv.id = (item->>'variant_id')::uuid),
      'sku', (SELECT pv.sku FROM public.product_variants pv WHERE pv.id = (item->>'variant_id')::uuid),
      'enviado', esperado, 'qty_accepted', aceito, 'qty_divergent', divergente,
      'tipo_divergencia', CASE WHEN divergente > 0 THEN item->>'tipo_divergencia' END,
      'motivo', CASE WHEN divergente > 0 THEN trim(item->>'motivo') END));
  END LOOP;

  SELECT * INTO k FROM public.kits WHERE id = c.kit_id;
  SELECT coalesce(display_name, legal_name) INTO nome FROM public.parties WHERE id = c.consultora_party_id;
  snap := jsonb_build_object(
    'termo_versao', s.termo_versao, 'termo_aprovado', s.termo_aprovado, 'modo', s.modo,
    'maleta', k.code, 'ciclo', c.cycle_no, 'cycle_id', c.id, 'composicao', comp.id,
    'consultora_party_id', c.consultora_party_id, 'consultora_nome', nome,
    'recebida_em', c.received_at, 'gerado_em', now(), 'itens', linhas,
    'total_enviado', (SELECT sum((x->>'enviado')::int) FROM jsonb_array_elements(linhas) x),
    'total_aceito', (SELECT sum((x->>'qty_accepted')::int) FROM jsonb_array_elements(linhas) x),
    'total_divergente', (SELECT sum((x->>'qty_divergent')::int) FROM jsonb_array_elements(linhas) x));
  sha := encode(digest(snap::text, 'sha256'), 'hex');

  INSERT INTO public.kit_signature_requests (cycle_id, consultora_party_id, signer_user_id, modo,
    termo_versao, snapshot, snapshot_sha256, idempotency_key)
  VALUES (_cycle, c.consultora_party_id, uid, s.modo, s.termo_versao, snap, sha, _idempotency_key)
  RETURNING * INTO r;

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'termo.gerado', uid, jsonb_build_object('termo', r.id, 'sha256', sha, 'versao', s.termo_versao));

  RETURN jsonb_build_object('request_id', r.id, 'estado', r.estado, 'snapshot', snap, 'sha256', sha);
END $$;

-- Servidor registra o envio (só service_role).
CREATE OR REPLACE FUNCTION public.kit_assinatura_registrar_envio(_request uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.kit_signature_requests;
BEGIN
  SELECT * INTO r FROM public.kit_signature_requests WHERE id = _request FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Termo não encontrado.'; END IF;
  IF r.estado = 'enviado' THEN RETURN jsonb_build_object('estado', r.estado, 'repetida', true); END IF;
  IF r.estado <> 'preparado' THEN RAISE EXCEPTION 'Termo não está pronto para envio.'; END IF;
  UPDATE public.kit_signature_requests
     SET estado = 'enviado', enviado_em = now(),
         pdf_path = _payload->>'pdf_path', pdf_sha256 = _payload->>'pdf_sha256',
         envelope_id = _payload->>'envelope_id', document_id = _payload->>'document_id',
         signer_id = _payload->>'signer_id'
   WHERE id = r.id;
  INSERT INTO public.kit_events (cycle_id, kind, payload)
  VALUES (r.cycle_id, 'termo.enviado', jsonb_build_object('termo', r.id, 'pdf_sha256', _payload->>'pdf_sha256'));
  RETURN jsonb_build_object('estado', 'enviado');
END $$;

CREATE OR REPLACE FUNCTION public.kit_assinatura_falha(_request uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.kit_signature_requests;
BEGIN
  SELECT * INTO r FROM public.kit_signature_requests WHERE id = _request FOR UPDATE;
  IF r.id IS NULL OR r.estado NOT IN ('preparado','enviado') THEN RETURN jsonb_build_object('ignorado', true); END IF;
  UPDATE public.kit_signature_requests SET estado = 'falha', motivo = left(_motivo, 300) WHERE id = r.id;
  INSERT INTO public.kit_events (cycle_id, kind, payload, reason)
  VALUES (r.cycle_id, 'termo.falha', jsonb_build_object('termo', r.id), left(_motivo, 300));
  RETURN jsonb_build_object('estado', 'falha');
END $$;

-- Evento do aviso Clicksign (só service_role). Deduplica antes de qualquer efeito.
CREATE OR REPLACE FUNCTION public.kit_assinatura_evento(_dedupe text, _envelope text, _evento text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.kit_signature_requests; novo text; ev uuid;
BEGIN
  INSERT INTO public.clicksign_events (dedupe_key, envelope_id, evento)
  VALUES (_dedupe, _envelope, _evento) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id INTO ev;
  IF ev IS NULL THEN RETURN jsonb_build_object('repetido', true); END IF;

  SELECT * INTO r FROM public.kit_signature_requests WHERE envelope_id = _envelope FOR UPDATE;
  IF r.id IS NULL THEN
    UPDATE public.clicksign_events SET resultado = 'envelope_desconhecido' WHERE id = ev;
    RETURN jsonb_build_object('ignorado', true);
  END IF;
  UPDATE public.clicksign_events SET request_id = r.id WHERE id = ev;

  novo := CASE
    WHEN _evento IN ('sign','auto_close','close','document_closed') THEN 'assinado'
    WHEN _evento IN ('refusal') THEN 'recusado'
    WHEN _evento IN ('cancel') THEN 'cancelado'
    WHEN _evento IN ('deadline') THEN 'expirado'
    ELSE NULL END;

  IF novo IS NULL OR r.estado NOT IN ('enviado','assinado') OR (novo = 'assinado' AND r.estado = 'assinado') THEN
    UPDATE public.clicksign_events SET resultado = 'registrado' WHERE id = ev;
    INSERT INTO public.kit_events (cycle_id, kind, payload)
    VALUES (r.cycle_id, 'termo.evento', jsonb_build_object('termo', r.id, 'evento', _evento));
    RETURN jsonb_build_object('request_id', r.id, 'estado', r.estado, 'baixar', r.estado = 'assinado');
  END IF;

  UPDATE public.kit_signature_requests
     SET estado = novo, assinado_em = CASE WHEN novo = 'assinado' THEN now() ELSE assinado_em END,
         motivo = CASE WHEN novo <> 'assinado' THEN 'Clicksign: ' || _evento ELSE motivo END
   WHERE id = r.id;
  UPDATE public.clicksign_events SET resultado = novo WHERE id = ev;
  INSERT INTO public.kit_events (cycle_id, kind, payload)
  VALUES (r.cycle_id, 'termo.' || novo, jsonb_build_object('termo', r.id, 'evento', _evento));
  RETURN jsonb_build_object('request_id', r.id, 'estado', novo, 'baixar', novo = 'assinado');
END $$;

-- Finalização atômica: arquivo assinado guardado → aceite oficial → operação.
CREATE OR REPLACE FUNCTION public.kit_assinatura_finalizar(_request uuid, _signed_path text, _signed_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.kit_signature_requests; res jsonb; itens jsonb;
BEGIN
  SELECT * INTO r FROM public.kit_signature_requests WHERE id = _request FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Termo não encontrado.'; END IF;
  IF r.estado = 'finalizado' THEN RETURN jsonb_build_object('estado','finalizado','repetida',true); END IF;
  IF r.estado <> 'assinado' THEN RAISE EXCEPTION 'Termo ainda não assinado.'; END IF;
  IF nullif(_signed_path,'') IS NULL OR coalesce(length(_signed_sha256),0) <> 64 THEN
    RAISE EXCEPTION 'Arquivo assinado não foi guardado.';
  END IF;

  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'variant_id', x->>'variant_id', 'qty_accepted', (x->>'qty_accepted')::int,
           'qty_divergent', (x->>'qty_divergent')::int,
           'tipo_divergencia', x->>'tipo_divergencia', 'motivo', x->>'motivo')))
    INTO itens FROM jsonb_array_elements(r.snapshot->'itens') x;

  -- O aceite é da consultora que assinou: roda como ela, pela rotina oficial.
  PERFORM set_config('lardan.assinatura_finalizando', 'on', true);
  PERFORM set_config('request.jwt.claim.sub', r.signer_user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', r.signer_user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('lardan.test_uid', r.signer_user_id::text, true);
  res := public.kit_aceitar(r.cycle_id, itens, 'assinatura:' || r.id::text);
  PERFORM set_config('lardan.assinatura_finalizando', '', true);

  UPDATE public.kit_signature_requests
     SET estado = 'finalizado', finalizado_em = now(), signed_path = _signed_path,
         signed_sha256 = _signed_sha256, acceptance_id = (res->>'acceptance_id')::uuid
   WHERE id = r.id;
  INSERT INTO public.kit_events (cycle_id, kind, payload)
  VALUES (r.cycle_id, 'termo.finalizado', jsonb_build_object('termo', r.id, 'signed_sha256', _signed_sha256,
          'aceite', res->>'acceptance_id'));
  RETURN jsonb_build_object('estado','finalizado','aceite', res);
END $$;

CREATE OR REPLACE FUNCTION public.kit_assinatura_falha_download(_request uuid, _motivo text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.kit_signature_requests
     SET tentativas_download = tentativas_download + 1, motivo = left(_motivo, 300)
   WHERE id = _request AND estado = 'assinado';
$$;

-- Situação para telas (respeita o escopo da maleta).
CREATE OR REPLACE FUNCTION public.kit_assinatura_situacao(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  IF public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem acesso a esta maleta.' USING errcode='42501';
  END IF;
  RETURN jsonb_build_object(
    'modo', (SELECT modo FROM public.clicksign_settings WHERE id = 1),
    'termos', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'estado', estado, 'modo', modo, 'versao', termo_versao, 'sha256', snapshot_sha256,
        'pdf_sha256', pdf_sha256, 'signed_sha256', signed_sha256, 'tem_pdf', pdf_path IS NOT NULL,
        'tem_assinado', signed_path IS NOT NULL, 'motivo', motivo, 'criado_em', created_at,
        'enviado_em', enviado_em, 'assinado_em', assinado_em, 'finalizado_em', finalizado_em,
        'total_aceito', snapshot->'total_aceito', 'total_divergente', snapshot->'total_divergente')
        ORDER BY created_at DESC) FROM public.kit_signature_requests WHERE cycle_id = _cycle), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.clicksign_modo_definir(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_assinatura_preparar(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_assinatura_situacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_modo_definir(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_assinatura_preparar(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_assinatura_situacao(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.kit_assinatura_registrar_envio(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kit_assinatura_falha(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kit_assinatura_evento(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kit_assinatura_finalizar(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kit_assinatura_falha_download(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kit_aceite_exige_assinatura() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kit_assinatura_registrar_envio(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.kit_assinatura_falha(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kit_assinatura_evento(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kit_assinatura_finalizar(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kit_assinatura_falha_download(uuid, text) TO service_role;
