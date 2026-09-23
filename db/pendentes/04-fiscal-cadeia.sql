-- ============================================================
-- Fiscal: cadeia auditável, imutável e DESLIGADA.
-- Documento fiscal não movimenta estoque e não cria obrigação financeira.
-- Nenhum provedor, CFOP, CST, CSOSN, NCM, CEST, alíquota ou natureza é
-- escolhido aqui: os campos nascem vazios e pendentes.
-- ============================================================

-- ---------------- cabeçalho: estados, ambiente, snapshots ----------------
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'nenhum',
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS layout_version text,
  ADD COLUMN IF NOT EXISTS correlation_id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS emitter_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recipient_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS xml_hash text,
  ADD COLUMN IF NOT EXISTS xml_size integer,
  ADD COLUMN IF NOT EXISTS rejection_code text,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS acerto_id uuid REFERENCES public.kit_acertos(id),
  ADD COLUMN IF NOT EXISTS simulado boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS precision_digits integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS rounding text NOT NULL DEFAULT 'half_up',
  ADD COLUMN IF NOT EXISTS pricing_policy_id uuid REFERENCES public.pricing_policies(id);

ALTER TABLE public.fiscal_documents DROP CONSTRAINT IF EXISTS fiscal_documents_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_status_ck') THEN
    ALTER TABLE public.fiscal_documents ADD CONSTRAINT fiscal_documents_status_ck CHECK (status IN (
      'rascunho','preparacao','bloqueado_pendencia','validado','na_fila','enviando','processando',
      'enviado','autorizado','rejeitado','denegado','cancelamento_solicitado','cancelado',
      'contingencia','erro_tecnico'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_env_ck') THEN
    ALTER TABLE public.fiscal_documents ADD CONSTRAINT fiscal_documents_env_ck
      CHECK (environment IN ('nenhum','homologacao','producao'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_chave_ck') THEN
    ALTER TABLE public.fiscal_documents ADD CONSTRAINT fiscal_documents_chave_ck
      CHECK (access_key IS NULL OR access_key ~ '^[0-9]{44}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_numeracao_uidx
  ON public.fiscal_documents (emitter_entity_id, environment, model, series, number)
  WHERE number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_idem_uidx
  ON public.fiscal_documents (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ---------------- referências entre documentos (cadeia, não coluna única) --------
CREATE TABLE IF NOT EXISTS public.fiscal_document_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  referenced_document_id uuid NOT NULL REFERENCES public.fiscal_documents(id),
  relation text NOT NULL CHECK (relation IN
    ('remessa_origem','acrescimo_origem','retorno_de','devolucao_de','substitui','complementa')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, referenced_document_id, relation)
);
GRANT SELECT ON public.fiscal_document_references TO authenticated;
GRANT ALL ON public.fiscal_document_references TO service_role;
ALTER TABLE public.fiscal_document_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_document_references_read ON public.fiscal_document_references;
CREATE POLICY fiscal_document_references_read ON public.fiscal_document_references FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view'));

-- ---------------- eventos, tentativas e fila ----------------
CREATE TABLE IF NOT EXISTS public.fiscal_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  from_status text,
  to_status text,
  reason text,
  code text,
  actor_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fiscal_document_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL,
  provider text,
  environment text,
  request_hash text,
  request_payload jsonb,
  response_payload jsonb,
  status text NOT NULL CHECK (status IN ('enviada','respondida','timeout','erro')),
  code text,
  message text,
  simulado boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (document_id, attempt_no)
);
CREATE TABLE IF NOT EXISTS public.fiscal_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila','processando','concluida','erro','cancelada')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  locked_by text,
  locked_at timestamptz,
  last_error text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id)
);
GRANT SELECT ON public.fiscal_document_events, public.fiscal_document_attempts, public.fiscal_outbox TO authenticated;
GRANT ALL ON public.fiscal_document_events, public.fiscal_document_attempts, public.fiscal_outbox TO service_role;
ALTER TABLE public.fiscal_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_document_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_events_read ON public.fiscal_document_events;
CREATE POLICY fiscal_events_read ON public.fiscal_document_events FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view'));
DROP POLICY IF EXISTS fiscal_attempts_read ON public.fiscal_document_attempts;
CREATE POLICY fiscal_attempts_read ON public.fiscal_document_attempts FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.audit.view'));
DROP POLICY IF EXISTS fiscal_outbox_read ON public.fiscal_outbox;
CREATE POLICY fiscal_outbox_read ON public.fiscal_outbox FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view'));

-- ---------------- itens: snapshot fiscal e origem ----------------
ALTER TABLE public.fiscal_document_items
  ADD COLUMN IF NOT EXISTS descricao_fiscal text,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS unidade text,
  ADD COLUMN IF NOT EXISTS total_cents bigint,
  ADD COLUMN IF NOT EXISTS desconto_cents bigint,
  ADD COLUMN IF NOT EXISTS outras_despesas_cents bigint,
  ADD COLUMN IF NOT EXISTS ncm text,
  ADD COLUMN IF NOT EXISTS cest text,
  ADD COLUMN IF NOT EXISTS origem_mercadoria text,
  ADD COLUMN IF NOT EXISTS cst text,
  ADD COLUMN IF NOT EXISTS csosn text,
  ADD COLUMN IF NOT EXISTS gtin text,
  ADD COLUMN IF NOT EXISTS info_adicional text,
  ADD COLUMN IF NOT EXISTS tributos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS layout_version text,
  ADD COLUMN IF NOT EXISTS price_snapshot_id uuid REFERENCES public.price_snapshots(id),
  ADD COLUMN IF NOT EXISTS acerto_item_id uuid REFERENCES public.kit_acerto_items(id),
  ADD COLUMN IF NOT EXISTS sale_evidence_id uuid REFERENCES public.sales_evidences(id),
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.sales_order_items(id),
  ADD COLUMN IF NOT EXISTS pendencias text[] NOT NULL DEFAULT '{}';

-- ao menos uma origem válida; origens incompatíveis simultâneas recusadas
CREATE OR REPLACE FUNCTION public.fiscal_item_origem_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE doc record; fontes integer; disponivel integer; ja integer; var uuid;
BEGIN
  SELECT * INTO doc FROM public.fiscal_documents WHERE id = NEW.document_id;
  IF doc.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  IF doc.status = 'autorizado' THEN
    RAISE EXCEPTION 'Documento autorizado não recebe nem altera itens.';
  END IF;

  fontes := (CASE WHEN NEW.composition_item_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN NEW.movement_item_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN NEW.acerto_item_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN NEW.sale_evidence_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN NEW.order_item_id IS NOT NULL THEN 1 ELSE 0 END);
  IF fontes = 0 THEN
    RAISE EXCEPTION 'Todo item fiscal precisa de origem: composição, acréscimo, retorno, venda comprovada ou linha do acerto.';
  END IF;
  IF fontes > 1 THEN
    RAISE EXCEPTION 'Origens incompatíveis no mesmo item fiscal.';
  END IF;

  -- variante coerente com a origem e quantidade dentro do disponível
  IF NEW.composition_item_id IS NOT NULL THEN
    SELECT variant_id, quantity INTO var, disponivel
      FROM public.kit_composition_items WHERE id = NEW.composition_item_id;
  ELSIF NEW.movement_item_id IS NOT NULL THEN
    SELECT variant_id, coalesce(qty_approved, quantity) INTO var, disponivel
      FROM public.kit_movement_items WHERE id = NEW.movement_item_id;
  ELSIF NEW.acerto_item_id IS NOT NULL THEN
    SELECT variant_id, qty_venda_comprovada INTO var, disponivel
      FROM public.kit_acerto_items WHERE id = NEW.acerto_item_id;
  ELSIF NEW.sale_evidence_id IS NOT NULL THEN
    SELECT variant_id, quantity INTO var, disponivel
      FROM public.sales_evidences WHERE id = NEW.sale_evidence_id AND status IN ('registrada','confirmada');
  ELSE
    SELECT variant_id, quantity INTO var, disponivel
      FROM public.sales_order_items WHERE id = NEW.order_item_id;
  END IF;

  IF var IS NULL THEN RAISE EXCEPTION 'Origem inexistente ou não comprovada.'; END IF;
  IF var <> NEW.variant_id THEN RAISE EXCEPTION 'A variante não corresponde à origem informada.'; END IF;

  SELECT coalesce(sum(i.quantity),0) INTO ja
    FROM public.fiscal_document_items i
    JOIN public.fiscal_documents d ON d.id = i.document_id
   WHERE i.id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND d.status NOT IN ('cancelado','rejeitado','denegado')
     AND (i.composition_item_id IS NOT DISTINCT FROM NEW.composition_item_id)
     AND (i.movement_item_id IS NOT DISTINCT FROM NEW.movement_item_id)
     AND (i.acerto_item_id IS NOT DISTINCT FROM NEW.acerto_item_id)
     AND (i.sale_evidence_id IS NOT DISTINCT FROM NEW.sale_evidence_id)
     AND (i.order_item_id IS NOT DISTINCT FROM NEW.order_item_id);

  IF ja + NEW.quantity > coalesce(disponivel,0) THEN
    RAISE EXCEPTION 'Quantidade fiscal (% já faturada + %) excede a origem (%).', ja, NEW.quantity, coalesce(disponivel,0);
  END IF;

  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS fiscal_item_origem_guard ON public.fiscal_document_items;
CREATE TRIGGER fiscal_item_origem_guard BEFORE INSERT OR UPDATE ON public.fiscal_document_items
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_item_origem_guard();

-- ---------------- escrita direta revogada ----------------
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_documents FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_document_items FROM authenticated;
DROP POLICY IF EXISTS "fiscal_documents_write" ON public.fiscal_documents;
DROP POLICY IF EXISTS "fiscal_document_items_write" ON public.fiscal_document_items;

CREATE OR REPLACE FUNCTION public.zz_block_direct_fiscal()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF current_user IN ('authenticated','anon') AND current_setting('lardann.fiscal', true) <> 'on' THEN
    RAISE EXCEPTION 'Documentos fiscais só são gravados pelas rotinas oficiais.' USING errcode = '42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END $fn$;
DROP TRIGGER IF EXISTS zz_block_direct_fiscal_doc ON public.fiscal_documents;
CREATE TRIGGER zz_block_direct_fiscal_doc BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION public.zz_block_direct_fiscal();
DROP TRIGGER IF EXISTS zz_block_direct_fiscal_item ON public.fiscal_document_items;
CREATE TRIGGER zz_block_direct_fiscal_item BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_document_items
  FOR EACH ROW EXECUTE FUNCTION public.zz_block_direct_fiscal();

-- imutabilidade após autorização + cancelamento é evento
CREATE OR REPLACE FUNCTION public.fiscal_document_imutavel()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'autorizado' THEN
    IF NEW.emitter_entity_id IS DISTINCT FROM OLD.emitter_entity_id
       OR NEW.recipient_party_id IS DISTINCT FROM OLD.recipient_party_id
       OR NEW.emitter_snapshot IS DISTINCT FROM OLD.emitter_snapshot
       OR NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot
       OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
       OR NEW.series IS DISTINCT FROM OLD.series
       OR NEW.number IS DISTINCT FROM OLD.number
       OR NEW.access_key IS DISTINCT FROM OLD.access_key
       OR NEW.protocol IS DISTINCT FROM OLD.protocol
       OR NEW.xml_path IS DISTINCT FROM OLD.xml_path
       OR NEW.xml_hash IS DISTINCT FROM OLD.xml_hash
       OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id
       OR NEW.acerto_id IS DISTINCT FROM OLD.acerto_id THEN
      RAISE EXCEPTION 'Documento autorizado é imutável; cancelamento é evento, não edição.';
    END IF;
    IF NEW.status NOT IN ('autorizado','cancelamento_solicitado','cancelado') THEN
      RAISE EXCEPTION 'De autorizado só se vai para cancelamento.';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'autorizado' AND NEW.status = 'autorizado'
     AND current_setting('lardann.fiscal_autorizar', true) <> 'on' THEN
    RAISE EXCEPTION 'Autorização só pela rotina oficial, com retorno do provedor registrado.';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS fiscal_document_imutavel ON public.fiscal_documents;
CREATE TRIGGER fiscal_document_imutavel BEFORE UPDATE ON public.fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_document_imutavel();

CREATE OR REPLACE FUNCTION public.fiscal_historico_imutavel()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  RAISE EXCEPTION 'Histórico fiscal não é editado nem apagado.';
END $fn$;
DROP TRIGGER IF EXISTS fiscal_events_imutavel ON public.fiscal_document_events;
CREATE TRIGGER fiscal_events_imutavel BEFORE UPDATE OR DELETE ON public.fiscal_document_events
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_historico_imutavel();
DROP TRIGGER IF EXISTS fiscal_attempts_imutavel ON public.fiscal_document_attempts;
CREATE TRIGGER fiscal_attempts_imutavel BEFORE UPDATE OR DELETE ON public.fiscal_document_attempts
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_historico_imutavel();

-- ---------------- rotinas oficiais ----------------
CREATE OR REPLACE FUNCTION public.fiscal_require(_cap text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  IF NOT public.has_capability(uid, _cap) THEN
    RAISE EXCEPTION 'Sem permissão fiscal.' USING errcode='42501';
  END IF;
  RETURN uid;
END $fn$;

/** Prepara um rascunho com snapshot das partes. Não emite nada. */
CREATE OR REPLACE FUNCTION public.fiscal_doc_preparar(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := public.fiscal_require('finance.settings.manage');
        cfg record; novo uuid; kind text := _payload->>'kind';
        chave text := _payload->>'idempotency_key'; ja record;
        emissor jsonb; destinatario jsonb; pend text[] := '{}';
BEGIN
  IF kind IS NULL THEN RAISE EXCEPTION 'Tipo de documento obrigatório.'; END IF;
  SELECT * INTO cfg FROM public.fiscal_settings WHERE id;

  IF chave IS NOT NULL THEN
    SELECT * INTO ja FROM public.fiscal_documents WHERE idempotency_key = chave;
    IF ja.id IS NOT NULL THEN
      RETURN jsonb_build_object('id', ja.id, 'repetida', true, 'status', ja.status);
    END IF;
  END IF;

  SELECT to_jsonb(b) INTO emissor FROM public.business_entities b
   WHERE b.id = (_payload->>'emitter_entity_id')::uuid;
  SELECT to_jsonb(p) INTO destinatario FROM public.parties p
   WHERE p.id = (_payload->>'recipient_party_id')::uuid;

  IF emissor IS NULL THEN pend := pend || 'emissor não definido'; END IF;
  IF destinatario IS NULL THEN pend := pend || 'destinatário fiscal não definido'; END IF;
  pend := pend || 'natureza da operação pendente' || 'CFOP pendente' || 'regime tributário pendente'
               || 'valor fiscal pendente (proporção de "um terço" sem efeito)';

  PERFORM set_config('lardann.fiscal','on', true);
  INSERT INTO public.fiscal_documents
    (kind, status, cycle_id, movement_id, acerto_id, emitter_entity_id, recipient_party_id,
     custodian_party_id, debtor_party_id, environment, provider, emitter_snapshot,
     recipient_snapshot, idempotency_key, blocked_reason, created_by, simulado)
  VALUES (kind, 'rascunho', (_payload->>'cycle_id')::uuid, (_payload->>'movement_id')::uuid,
          (_payload->>'acerto_id')::uuid, (_payload->>'emitter_entity_id')::uuid,
          (_payload->>'recipient_party_id')::uuid, (_payload->>'custodian_party_id')::uuid,
          (_payload->>'debtor_party_id')::uuid, coalesce(cfg.environment,'nenhum'), cfg.provider,
          coalesce(emissor,'{}'::jsonb), coalesce(destinatario,'{}'::jsonb), chave,
          array_to_string(pend, '; '), uid, true)
  RETURNING id INTO novo;
  INSERT INTO public.fiscal_document_events (document_id, kind, to_status, actor_user_id, payload)
  VALUES (novo, 'preparacao', 'rascunho', uid, jsonb_build_object('pendencias', to_jsonb(pend)));
  PERFORM set_config('lardann.fiscal','off', true);

  RETURN jsonb_build_object('id', novo, 'repetida', false, 'status', 'rascunho',
    'pendencias', to_jsonb(pend),
    'aviso', 'Documento NÃO emitido. Emissão fiscal desligada e sem provedor.');
END $fn$;

/** Validação: aponta pendências; nunca "aprova" tributação por suposição. */
CREATE OR REPLACE FUNCTION public.fiscal_doc_validar(_doc uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := public.fiscal_require('finance.settings.manage');
        d record; pend text[] := '{}'; soma bigint; itens integer;
BEGIN
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  SELECT count(*), coalesce(sum(coalesce(total_cents, quantity * coalesce(unit_value_cents,0))),0)
    INTO itens, soma FROM public.fiscal_document_items WHERE document_id = _doc;

  IF itens = 0 THEN pend := pend || 'documento sem itens'; END IF;
  IF d.emitter_entity_id IS NULL THEN pend := pend || 'emissor'; END IF;
  IF d.recipient_party_id IS NULL THEN pend := pend || 'destinatário'; END IF;
  IF EXISTS (SELECT 1 FROM public.fiscal_document_items WHERE document_id = _doc
              AND (cfop IS NULL OR ncm IS NULL OR (cst IS NULL AND csosn IS NULL))) THEN
    pend := pend || 'CFOP, NCM e CST/CSOSN não definidos (dependem do contador)';
  END IF;
  IF d.total_cents <> soma THEN pend := pend || 'total do documento diferente da soma dos itens'; END IF;
  IF d.environment = 'producao' THEN pend := pend || 'ambiente de produção indisponível nesta preparação'; END IF;

  PERFORM set_config('lardann.fiscal','on', true);
  UPDATE public.fiscal_documents
     SET status = CASE WHEN array_length(pend,1) IS NULL THEN 'validado' ELSE 'bloqueado_pendencia' END,
         blocked_reason = array_to_string(pend,'; ')
   WHERE id = _doc;
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_doc, 'validacao', d.status,
          CASE WHEN array_length(pend,1) IS NULL THEN 'validado' ELSE 'bloqueado_pendencia' END,
          uid, jsonb_build_object('pendencias', to_jsonb(pend)));
  PERFORM set_config('lardann.fiscal','off', true);

  RETURN jsonb_build_object('id', _doc, 'pendencias', to_jsonb(pend),
    'status', CASE WHEN array_length(pend,1) IS NULL THEN 'validado' ELSE 'bloqueado_pendencia' END);
END $fn$;

CREATE OR REPLACE FUNCTION public.fiscal_doc_enfileirar(_doc uuid, _idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := public.fiscal_require('finance.settings.manage'); d record; cfg record;
BEGIN
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  IF d.status <> 'validado' THEN
    RAISE EXCEPTION 'Só documento validado entra na fila (situação atual: %).', d.status;
  END IF;
  SELECT * INTO cfg FROM public.fiscal_settings WHERE id;
  IF coalesce(cfg.emission_active,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Emissão fiscal desligada: a fila não envia nada.';
  END IF;

  PERFORM set_config('lardann.fiscal','on', true);
  INSERT INTO public.fiscal_outbox (document_id, idempotency_key)
  VALUES (_doc, coalesce(_idempotency_key, _doc::text))
  ON CONFLICT (document_id) DO NOTHING;
  UPDATE public.fiscal_documents SET status = 'na_fila' WHERE id = _doc;
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, actor_user_id)
  VALUES (_doc, 'fila', d.status, 'na_fila', uid);
  PERFORM set_config('lardann.fiscal','off', true);
  RETURN jsonb_build_object('id', _doc, 'status', 'na_fila');
END $fn$;

/** Registra o retorno de uma tentativa (inclusive simulada). */
CREATE OR REPLACE FUNCTION public.fiscal_doc_registrar_retorno(
  _doc uuid, _status text, _payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := public.fiscal_require('finance.settings.manage'); d record; n integer;
BEGIN
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  IF _status NOT IN ('respondida','timeout','erro','enviada') THEN
    RAISE EXCEPTION 'Situação de tentativa inválida.';
  END IF;
  SELECT coalesce(max(attempt_no),0) + 1 INTO n FROM public.fiscal_document_attempts WHERE document_id = _doc;
  INSERT INTO public.fiscal_document_attempts
    (document_id, attempt_no, provider, environment, request_hash, response_payload, status, code, message, simulado)
  VALUES (_doc, n, d.provider, d.environment, md5(coalesce(_payload::text,'')), _payload, _status,
          _payload->>'code', _payload->>'message', true);
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_doc, 'tentativa', d.status, d.status, uid, jsonb_build_object('tentativa', n, 'situacao', _status));
  RETURN jsonb_build_object('id', _doc, 'tentativa', n, 'simulado', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.fiscal_doc_autorizar(
  _doc uuid, _access_key text, _protocol text, _xml_path text, _xml_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := public.fiscal_require('finance.settings.manage'); d record; cfg record;
BEGIN
  SELECT * INTO cfg FROM public.fiscal_settings WHERE id;
  IF coalesce(cfg.emission_active,false) IS NOT TRUE OR cfg.provider IS NULL THEN
    RAISE EXCEPTION 'Sem emissão ativa e sem provedor não existe autorização. Resposta simulada nunca é autorização real.';
  END IF;
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc;
  IF d.status NOT IN ('na_fila','enviando','processando','enviado') THEN
    RAISE EXCEPTION 'Autorização exige documento enviado ao provedor.';
  END IF;
  PERFORM set_config('lardann.fiscal','on', true);
  PERFORM set_config('lardann.fiscal_autorizar','on', true);
  UPDATE public.fiscal_documents
     SET status='autorizado', access_key=_access_key, protocol=_protocol, xml_path=_xml_path,
         xml_hash=_xml_hash, authorized_at=now(), simulado=false
   WHERE id=_doc;
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, actor_user_id)
  VALUES (_doc, 'autorizacao', d.status, 'autorizado', uid);
  PERFORM set_config('lardann.fiscal_autorizar','off', true);
  PERFORM set_config('lardann.fiscal','off', true);
  RETURN jsonb_build_object('id', _doc, 'status','autorizado');
END $fn$;

CREATE OR REPLACE FUNCTION public.fiscal_doc_rejeitar(_doc uuid, _codigo text, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := public.fiscal_require('finance.settings.manage'); d record;
BEGIN
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  PERFORM set_config('lardann.fiscal','on', true);
  UPDATE public.fiscal_documents
     SET status='rejeitado', rejection_code=_codigo, rejected_reason=_motivo WHERE id=_doc;
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, code, reason, actor_user_id)
  VALUES (_doc,'rejeicao', d.status, 'rejeitado', _codigo, _motivo, uid);
  PERFORM set_config('lardann.fiscal','off', true);
  RETURN jsonb_build_object('id', _doc, 'status','rejeitado', 'tentativa_anterior_preservada', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.fiscal_doc_cancelar_solicitar(_doc uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := public.fiscal_require('finance.settings.manage'); d record;
BEGIN
  IF nullif(trim(coalesce(_motivo,'')),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatório.'; END IF;
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc;
  IF d.status <> 'autorizado' THEN RAISE EXCEPTION 'Só documento autorizado é cancelado.'; END IF;
  PERFORM set_config('lardann.fiscal','on', true);
  UPDATE public.fiscal_documents SET status='cancelamento_solicitado',
         cancel_requested_at=now(), cancel_reason=_motivo WHERE id=_doc;
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, reason, actor_user_id)
  VALUES (_doc,'cancelamento_solicitado','autorizado','cancelamento_solicitado',_motivo, uid);
  PERFORM set_config('lardann.fiscal','off', true);
  RETURN jsonb_build_object('id', _doc, 'status','cancelamento_solicitado',
    'aviso','Cancelamento fiscal não é estorno financeiro nem retorno de estoque.');
END $fn$;

CREATE OR REPLACE FUNCTION public.fiscal_doc_cancelar_registrar(_doc uuid, _protocolo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := public.fiscal_require('finance.settings.manage'); d record;
BEGIN
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc;
  IF d.status <> 'cancelamento_solicitado' THEN
    RAISE EXCEPTION 'O cancelamento precisa ter sido solicitado.';
  END IF;
  PERFORM set_config('lardann.fiscal','on', true);
  UPDATE public.fiscal_documents SET status='cancelado', cancelled_at=now() WHERE id=_doc;
  INSERT INTO public.fiscal_document_events (document_id, kind, from_status, to_status, code, actor_user_id)
  VALUES (_doc,'cancelamento','cancelamento_solicitado','cancelado',_protocolo, uid);
  PERFORM set_config('lardann.fiscal','off', true);
  RETURN jsonb_build_object('id', _doc, 'status','cancelado');
END $fn$;

CREATE OR REPLACE FUNCTION public.fiscal_doc_historico(_doc uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE d record;
BEGIN
  PERFORM public.fiscal_require('finance.view');
  SELECT * INTO d FROM public.fiscal_documents WHERE id = _doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento inexistente.'; END IF;
  RETURN jsonb_build_object(
    'documento', to_jsonb(d),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM public.fiscal_document_items i WHERE i.document_id=_doc),'[]'::jsonb),
    'referencias', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.fiscal_document_references r WHERE r.document_id=_doc),'[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at) FROM public.fiscal_document_events e WHERE e.document_id=_doc),'[]'::jsonb),
    'tentativas', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.attempt_no) FROM public.fiscal_document_attempts t WHERE t.document_id=_doc),'[]'::jsonb));
END $fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'fiscal_doc_preparar(jsonb)','fiscal_doc_validar(uuid)','fiscal_doc_enfileirar(uuid,text)',
    'fiscal_doc_registrar_retorno(uuid,text,jsonb)',
    'fiscal_doc_autorizar(uuid,text,text,text,text)','fiscal_doc_rejeitar(uuid,text,text)',
    'fiscal_doc_cancelar_solicitar(uuid,text)','fiscal_doc_cancelar_registrar(uuid,text)',
    'fiscal_doc_historico(uuid)','fiscal_require(text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- pendências fiscais adicionais desta rodada
INSERT INTO public.fiscal_pendencias (escopo, descricao)
SELECT v.e, v.d FROM (VALUES
  ('numeracao','Série, numeração e modelo por emissor e ambiente não definidos.'),
  ('armazenamento','Local privado de XML e representação, retenção e auditoria de acesso a definir.'),
  ('certificado','Certificado digital e segredo do provedor não existem e não ficam no banco.')
) v(e,d)
WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_pendencias p WHERE p.escopo = v.e);
