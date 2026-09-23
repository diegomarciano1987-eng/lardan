-- ============================================================
-- Acerto comercial da maleta (kit_acertos) e evidência de venda
-- da consultora (sales_evidences).
--
-- "Acerto" é conferência comercial. NÃO é baixa financeira: quem representa
-- baixa continua sendo financial_settlements, intocado aqui.
-- Nesta preparação só existem rascunho, conferência e bloqueio.
-- ============================================================

-- ---------------- evidência de venda da consultora ----------------
CREATE TABLE IF NOT EXISTS public.sales_evidences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id) ON DELETE RESTRICT,
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  currency text NOT NULL DEFAULT 'BRL',
  sold_at date NOT NULL,
  origem text NOT NULL CHECK (origem IN ('vitrine','consultora','importado','correcao')),
  order_item_id uuid REFERENCES public.sales_order_items(id),
  customer_party_id uuid REFERENCES public.parties(id),
  status text NOT NULL DEFAULT 'registrada'
    CHECK (status IN ('registrada','confirmada','cancelada','devolvida')),
  compensated_by uuid REFERENCES public.sales_evidences(id),
  compensates_id uuid REFERENCES public.sales_evidences(id),
  evidence_ref text,
  note text,
  content_hash text,
  idempotency_key text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_evidences_idem_uidx
  ON public.sales_evidences (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_evidences_cycle_idx ON public.sales_evidences (cycle_id, variant_id);
GRANT SELECT ON public.sales_evidences TO authenticated;
GRANT ALL ON public.sales_evidences TO service_role;
ALTER TABLE public.sales_evidences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_evidences_read ON public.sales_evidences;
CREATE POLICY sales_evidences_read ON public.sales_evidences FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(cycle_id) OR public.has_capability(auth.uid(),'finance.view'));

CREATE TABLE IF NOT EXISTS public.sales_evidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.sales_evidences(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  from_status text,
  to_status text,
  reason text,
  actor_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_evidence_events TO authenticated;
GRANT ALL ON public.sales_evidence_events TO service_role;
ALTER TABLE public.sales_evidence_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_evidence_events_read ON public.sales_evidence_events;
CREATE POLICY sales_evidence_events_read ON public.sales_evidence_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_evidences e WHERE e.id = evidence_id
                  AND (public.kit_cycle_in_scope(e.cycle_id) OR public.has_capability(auth.uid(),'finance.view'))));

-- escrita direta proibida: só as rotinas oficiais gravam
CREATE OR REPLACE FUNCTION public.zz_block_direct_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF coalesce(current_setting('lardann.evidence', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Evidência de venda só é gravada pelas rotinas oficiais.';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS zz_block_direct_evidence ON public.sales_evidences;
CREATE TRIGGER zz_block_direct_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.sales_evidences
  FOR EACH ROW EXECUTE FUNCTION public.zz_block_direct_evidence();
DROP TRIGGER IF EXISTS zz_block_direct_evidence_ev ON public.sales_evidence_events;
CREATE TRIGGER zz_block_direct_evidence_ev BEFORE INSERT OR UPDATE OR DELETE ON public.sales_evidence_events
  FOR EACH ROW EXECUTE FUNCTION public.zz_block_direct_evidence();

CREATE OR REPLACE FUNCTION public.venda_evidencia_registrar(
  _cycle uuid, _variant uuid, _quantity integer, _sold_at date, _origem text,
  _unit_price_cents bigint DEFAULT NULL, _order_item uuid DEFAULT NULL,
  _evidence_ref text DEFAULT NULL, _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c record; ja record; novo uuid; hash text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo inexistente.'; END IF;
  IF NOT (public.kit_cycle_in_scope(_cycle) OR public.has_capability(auth.uid(),'kit.manage')) THEN
    RAISE EXCEPTION 'Sem acesso a esta maleta.';
  END IF;
  IF c.consultora_party_id IS NULL THEN
    RAISE EXCEPTION 'O ciclo não tem consultora vinculada; a evidência exige consultora, ciclo, variante, quantidade e data.';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
  IF _origem NOT IN ('vitrine','consultora','importado','correcao') THEN
    RAISE EXCEPTION 'Origem da venda inválida.';
  END IF;
  IF _origem = 'vitrine' AND _order_item IS NULL THEN
    RAISE EXCEPTION 'Venda da vitrine exige o item do pedido; associação por nome, preço ou data é proibida.';
  END IF;

  hash := md5(concat_ws('|', _cycle::text, _variant::text, _quantity::text, _sold_at::text,
                        _origem, coalesce(_order_item::text,''), coalesce(_unit_price_cents::text,'')));

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO ja FROM public.sales_evidences WHERE idempotency_key = _idempotency_key;
    IF ja.id IS NOT NULL THEN
      IF ja.content_hash <> hash THEN
        RAISE EXCEPTION 'A mesma chave de repetição foi usada com conteúdo diferente.';
      END IF;
      RETURN jsonb_build_object('id', ja.id, 'repetida', true, 'status', ja.status);
    END IF;
  END IF;

  PERFORM set_config('lardann.evidence','on', true);
  INSERT INTO public.sales_evidences
    (cycle_id, consultora_party_id, variant_id, quantity, unit_price_cents, sold_at, origem,
     order_item_id, evidence_ref, note, content_hash, idempotency_key, created_by)
  VALUES (_cycle, c.consultora_party_id, _variant, _quantity, _unit_price_cents, _sold_at, _origem,
          _order_item, _evidence_ref, _note, hash, _idempotency_key, auth.uid())
  RETURNING id INTO novo;
  INSERT INTO public.sales_evidence_events (evidence_id, kind, to_status, actor_user_id)
  VALUES (novo, 'registrada', 'registrada', auth.uid());
  PERFORM set_config('lardann.evidence','off', true);

  RETURN jsonb_build_object('id', novo, 'repetida', false, 'status', 'registrada',
    'aviso', 'Evidência registrada. Não altera estoque nem financeiro.');
END $fn$;

CREATE OR REPLACE FUNCTION public.venda_evidencia_compensar(
  _evidence uuid, _motivo text, _kind text DEFAULT 'cancelada'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE e record; comp uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  IF nullif(trim(coalesce(_motivo,'')),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatório.'; END IF;
  IF _kind NOT IN ('cancelada','devolvida') THEN RAISE EXCEPTION 'Tipo de compensação inválido.'; END IF;
  SELECT * INTO e FROM public.sales_evidences WHERE id = _evidence;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Evidência inexistente.'; END IF;
  IF NOT (public.kit_cycle_in_scope(e.cycle_id) OR public.has_capability(auth.uid(),'kit.manage')) THEN
    RAISE EXCEPTION 'Sem acesso a esta maleta.';
  END IF;
  IF e.status IN ('cancelada','devolvida') THEN
    RETURN jsonb_build_object('id', e.id, 'status', e.status, 'repetida', true);
  END IF;

  PERFORM set_config('lardann.evidence','on', true);
  INSERT INTO public.sales_evidences
    (cycle_id, consultora_party_id, variant_id, quantity, unit_price_cents, sold_at, origem,
     status, compensates_id, note, created_by, content_hash)
  VALUES (e.cycle_id, e.consultora_party_id, e.variant_id, e.quantity, e.unit_price_cents,
          current_date, 'correcao', _kind, e.id, _motivo, auth.uid(), md5(e.id::text || _kind))
  RETURNING id INTO comp;
  UPDATE public.sales_evidences
     SET status = _kind, compensated_by = comp, updated_at = now()
   WHERE id = e.id;
  INSERT INTO public.sales_evidence_events (evidence_id, kind, from_status, to_status, reason, actor_user_id)
  VALUES (e.id, 'compensacao', e.status, _kind, _motivo, auth.uid());
  PERFORM set_config('lardann.evidence','off', true);

  RETURN jsonb_build_object('id', e.id, 'compensacao', comp, 'status', _kind, 'repetida', false);
END $fn$;

-- ---------------- acerto comercial ----------------
CREATE TABLE IF NOT EXISTS public.kit_acertos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 1,
  previous_acerto_id uuid REFERENCES public.kit_acertos(id),
  consultora_party_id uuid REFERENCES public.parties(id),
  representante_party_id uuid REFERENCES public.parties(id),
  custodian_party_id uuid REFERENCES public.parties(id),
  owner_entity_id uuid REFERENCES public.business_entities(id),
  debtor_party_id uuid REFERENCES public.parties(id),
  fiscal_recipient_party_id uuid REFERENCES public.parties(id),
  payer_party_id uuid REFERENCES public.parties(id),
  period_start date,
  period_end date,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN (
    'rascunho','aguardando_comprovacao','com_divergencia','conferido',
    'aguardando_aprovacao','bloqueado_definicao_comercial','aprovado',
    'contabilizado','parcialmente_recebido','liquidado','ajustado','estornado')),
  blocked_reason text,
  content_hash text,
  idempotency_key text,
  pricing_policy_id uuid REFERENCES public.pricing_policies(id),
  total_vendido_cents bigint NOT NULL DEFAULT 0,
  total_devido_cents bigint,
  currency text NOT NULL DEFAULT 'BRL',
  created_by uuid,
  conferred_by uuid,
  approved_by uuid,
  conferred_at timestamptz,
  approved_at timestamptz,
  adjust_reason text,
  financial_title_id uuid REFERENCES public.financial_titles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS kit_acertos_idem_uidx
  ON public.kit_acertos (idempotency_key) WHERE idempotency_key IS NOT NULL;
GRANT SELECT ON public.kit_acertos TO authenticated;
GRANT ALL ON public.kit_acertos TO service_role;
ALTER TABLE public.kit_acertos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kit_acertos_read ON public.kit_acertos;
CREATE POLICY kit_acertos_read ON public.kit_acertos FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(cycle_id) OR public.has_capability(auth.uid(),'finance.view'));

CREATE TABLE IF NOT EXISTS public.kit_acerto_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acerto_id uuid NOT NULL REFERENCES public.kit_acertos(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  qty_remessa_inicial integer NOT NULL DEFAULT 0,
  qty_acrescimo_recebido integer NOT NULL DEFAULT 0,
  qty_acrescimo_transito integer NOT NULL DEFAULT 0,
  qty_venda_comprovada integer NOT NULL DEFAULT 0,
  qty_devolucao_aprovada integer NOT NULL DEFAULT 0,
  qty_mantida integer NOT NULL DEFAULT 0,
  qty_garantia integer NOT NULL DEFAULT 0,
  qty_perda integer NOT NULL DEFAULT 0,
  qty_divergencia integer NOT NULL DEFAULT 0,
  qty_sob_responsabilidade integer NOT NULL DEFAULT 0,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  price_snapshot_id uuid REFERENCES public.price_snapshots(id),
  unit_price_cents bigint,
  calculated_cents bigint,
  justificativa text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (acerto_id, variant_id)
);
GRANT SELECT ON public.kit_acerto_items TO authenticated;
GRANT ALL ON public.kit_acerto_items TO service_role;
ALTER TABLE public.kit_acerto_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kit_acerto_items_read ON public.kit_acerto_items;
CREATE POLICY kit_acerto_items_read ON public.kit_acerto_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.kit_acertos a WHERE a.id = acerto_id
                  AND (public.kit_cycle_in_scope(a.cycle_id) OR public.has_capability(auth.uid(),'finance.view'))));

CREATE TABLE IF NOT EXISTS public.kit_acerto_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acerto_id uuid NOT NULL REFERENCES public.kit_acertos(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  from_status text,
  to_status text,
  reason text,
  actor_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.kit_acerto_events TO authenticated;
GRANT ALL ON public.kit_acerto_events TO service_role;
ALTER TABLE public.kit_acerto_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kit_acerto_events_read ON public.kit_acerto_events;
CREATE POLICY kit_acerto_events_read ON public.kit_acerto_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.kit_acertos a WHERE a.id = acerto_id
                  AND (public.kit_cycle_in_scope(a.cycle_id) OR public.has_capability(auth.uid(),'finance.view'))));

-- escrita direta proibida + estados liberados nesta preparação + imutabilidade
CREATE OR REPLACE FUNCTION public.zz_block_direct_acerto()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF coalesce(current_setting('lardann.acerto', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'O acerto só é gravado pelas rotinas oficiais.';
  END IF;
  IF TG_TABLE_NAME = 'kit_acertos' THEN
    IF TG_OP = 'UPDATE' AND OLD.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'Acerto aprovado não é editado: crie nova revisão ou evento compensatório.';
    END IF;
    IF NEW.status NOT IN ('rascunho','aguardando_comprovacao','com_divergencia','conferido','bloqueado_definicao_comercial') THEN
      RAISE EXCEPTION 'Estado "%" indisponível: a regra comercial do acerto (quanto a consultora deve à Lardan) ainda não foi definida.', NEW.status;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS zz_block_direct_acerto ON public.kit_acertos;
CREATE TRIGGER zz_block_direct_acerto BEFORE INSERT OR UPDATE OR DELETE ON public.kit_acertos
  FOR EACH ROW EXECUTE FUNCTION public.zz_block_direct_acerto();
DROP TRIGGER IF EXISTS zz_block_direct_acerto_items ON public.kit_acerto_items;
CREATE TRIGGER zz_block_direct_acerto_items BEFORE INSERT OR UPDATE OR DELETE ON public.kit_acerto_items
  FOR EACH ROW EXECUTE FUNCTION public.zz_block_direct_acerto();
DROP TRIGGER IF EXISTS zz_block_direct_acerto_events ON public.kit_acerto_events;
CREATE TRIGGER zz_block_direct_acerto_events BEFORE INSERT OR UPDATE OR DELETE ON public.kit_acerto_events
  FOR EACH ROW EXECUTE FUNCTION public.zz_block_direct_acerto();

/**
 * Abre (ou devolve) o rascunho do acerto de um ciclo a partir da conciliação
 * física já existente. Não cria dívida, não gera título e não vende nada.
 */
CREATE OR REPLACE FUNCTION public.kit_acerto_abrir(
  _cycle uuid, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c record; ja record; novo uuid; rev integer; hash text; linha record; total_resp integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo inexistente.'; END IF;
  IF NOT (public.has_capability(auth.uid(),'kit.manage') OR public.has_capability(auth.uid(),'finance.view')) THEN
    RAISE EXCEPTION 'Sem permissão para abrir acerto.';
  END IF;

  hash := md5('acerto|' || _cycle::text);
  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO ja FROM public.kit_acertos WHERE idempotency_key = _idempotency_key;
    IF ja.id IS NOT NULL THEN
      IF ja.cycle_id <> _cycle THEN
        RAISE EXCEPTION 'A mesma chave de repetição foi usada em outra maleta.';
      END IF;
      RETURN jsonb_build_object('id', ja.id, 'repetida', true, 'status', ja.status);
    END IF;
  END IF;

  SELECT * INTO ja FROM public.kit_acertos
    WHERE cycle_id = _cycle AND approved_at IS NULL ORDER BY revision DESC LIMIT 1;
  IF ja.id IS NOT NULL THEN
    RETURN jsonb_build_object('id', ja.id, 'repetida', true, 'status', ja.status);
  END IF;

  SELECT coalesce(max(revision),0) + 1 INTO rev FROM public.kit_acertos WHERE cycle_id = _cycle;

  PERFORM set_config('lardann.acerto','on', true);
  INSERT INTO public.kit_acertos
    (cycle_id, revision, previous_acerto_id, consultora_party_id, representante_party_id,
     custodian_party_id, period_start, period_end, status, content_hash, idempotency_key, created_by,
     blocked_reason)
  VALUES (_cycle, rev,
          (SELECT id FROM public.kit_acertos WHERE cycle_id = _cycle ORDER BY revision DESC LIMIT 1),
          c.consultora_party_id, c.representante_party_id, c.custodian_party_id,
          c.shipped_at::date, current_date, 'rascunho', hash, _idempotency_key, auth.uid(),
          'Regra comercial pendente: quanto a consultora deve à Lardan não está definida.')
  RETURNING id INTO novo;

  FOR linha IN
    WITH remessa AS (
      SELECT i.variant_id, sum(i.quantity)::integer q
        FROM public.kit_composition_items i
        JOIN public.kit_compositions comp ON comp.id = i.composition_id
       WHERE comp.cycle_id = _cycle
       GROUP BY 1
    ),
    acres AS (
      SELECT i.variant_id,
             sum(i.quantity) FILTER (WHERE m.status = 'confirmado')::integer q_conf,
             sum(i.quantity) FILTER (WHERE m.status = 'pendente')::integer q_transito
        FROM public.kit_movement_items i
        JOIN public.kit_movements m ON m.id = i.movement_id
       WHERE m.cycle_id = _cycle AND m.kind = 'acrescimo'
       GROUP BY 1
    )
    SELECT b.variant_id,
           coalesce(r.q,0) AS enviado,
           coalesce(a.q_conf,0) AS acrescido,
           coalesce(a.q_transito,0) AS acrescido_transito,
           b.qty_returned AS devolvido,
           b.qty_retained AS mantida,
           b.qty_warranty AS garantia,
           b.qty_lost AS perda,
           coalesce(b.qty_return_divergent,0) AS divergencia,
           b.qty_sold AS vendido_saldo
      FROM public.kit_balances b
      LEFT JOIN remessa r ON r.variant_id = b.variant_id
      LEFT JOIN acres a ON a.variant_id = b.variant_id
     WHERE b.cycle_id = _cycle
  LOOP
    INSERT INTO public.kit_acerto_items
      (acerto_id, variant_id, qty_remessa_inicial, qty_acrescimo_recebido, qty_acrescimo_transito,
       qty_devolucao_aprovada, qty_mantida, qty_garantia, qty_perda, qty_divergencia,
       qty_venda_comprovada, qty_sob_responsabilidade, justificativa)
    VALUES (novo, linha.variant_id, linha.enviado, linha.acrescido, linha.acrescido_transito,
            linha.devolvido, linha.mantida, linha.garantia, linha.perda, linha.divergencia,
            coalesce((SELECT sum(e.quantity)::int FROM public.sales_evidences e
                       WHERE e.cycle_id = _cycle AND e.variant_id = linha.variant_id
                         AND e.status IN ('registrada','confirmada') AND e.compensates_id IS NULL), 0),
            greatest(linha.enviado + linha.acrescido - linha.devolvido - linha.mantida
                     - linha.garantia - linha.perda - linha.vendido_saldo, 0),
            'Saldo sob responsabilidade não é venda nem dívida.');
    total_resp := total_resp + greatest(linha.enviado + linha.acrescido - linha.devolvido
                   - linha.mantida - linha.garantia - linha.perda - linha.vendido_saldo, 0);
  END LOOP;

  INSERT INTO public.kit_acerto_events (acerto_id, kind, to_status, actor_user_id, payload)
  VALUES (novo, 'abertura', 'rascunho', auth.uid(),
          jsonb_build_object('sob_responsabilidade', total_resp));
  PERFORM set_config('lardann.acerto','off', true);

  RETURN jsonb_build_object('id', novo, 'repetida', false, 'status', 'rascunho',
    'sob_responsabilidade', total_resp,
    'aviso', 'Peças sob responsabilidade não comprovam venda e não geram dívida.');
END $fn$;

/** Conferência: separa comprovado de pendente; nunca aprova nem cobra. */
CREATE OR REPLACE FUNCTION public.kit_acerto_conferir(_acerto uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a record; pend integer; div integer; novo text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  SELECT * INTO a FROM public.kit_acertos WHERE id = _acerto;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Acerto inexistente.'; END IF;
  IF NOT public.has_capability(auth.uid(),'kit.manage') THEN
    RAISE EXCEPTION 'Sem permissão para conferir o acerto.';
  END IF;

  SELECT coalesce(sum(qty_sob_responsabilidade),0), coalesce(sum(qty_divergencia),0)
    INTO pend, div FROM public.kit_acerto_items WHERE acerto_id = _acerto;

  novo := CASE WHEN div > 0 THEN 'com_divergencia'
               WHEN pend > 0 THEN 'aguardando_comprovacao'
               ELSE 'conferido' END;

  PERFORM set_config('lardann.acerto','on', true);
  UPDATE public.kit_acertos
     SET status = novo, conferred_by = auth.uid(), conferred_at = now()
   WHERE id = _acerto;
  INSERT INTO public.kit_acerto_events (acerto_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_acerto, 'conferencia', a.status, novo, auth.uid(),
          jsonb_build_object('sob_responsabilidade', pend, 'divergencia', div));
  PERFORM set_config('lardann.acerto','off', true);

  RETURN jsonb_build_object('id', _acerto, 'status', novo,
    'sob_responsabilidade', pend, 'divergencia', div,
    'aviso', 'Conferência física. Não gera título, venda, nota nem cobrança.');
END $fn$;

CREATE OR REPLACE FUNCTION public.kit_acerto_bloquear(_acerto uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  IF nullif(trim(coalesce(_motivo,'')),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatório.'; END IF;
  SELECT * INTO a FROM public.kit_acertos WHERE id = _acerto;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Acerto inexistente.'; END IF;
  IF NOT public.has_capability(auth.uid(),'kit.manage') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  PERFORM set_config('lardann.acerto','on', true);
  UPDATE public.kit_acertos SET status = 'bloqueado_definicao_comercial', blocked_reason = _motivo
   WHERE id = _acerto;
  INSERT INTO public.kit_acerto_events (acerto_id, kind, from_status, to_status, reason, actor_user_id)
  VALUES (_acerto, 'bloqueio', a.status, 'bloqueado_definicao_comercial', _motivo, auth.uid());
  PERFORM set_config('lardann.acerto','off', true);
  RETURN jsonb_build_object('id', _acerto, 'status', 'bloqueado_definicao_comercial');
END $fn$;

/** Aprovação financeira: indisponível enquanto a regra comercial estiver aberta. */
CREATE OR REPLACE FUNCTION public.kit_acerto_aprovar(_acerto uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  RAISE EXCEPTION 'Aprovação do acerto bloqueada: falta definir quanto a consultora deve à Lardan, o momento em que a dívida nasce e o tratamento de perda, garantia e divergência. Sem isso não há título, venda Lardan→consultora, documento fiscal nem cobrança.';
END $fn$;

CREATE OR REPLACE FUNCTION public.kit_acerto_detalhe(_acerto uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public' AS $fn$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.kit_acertos WHERE id = _acerto;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Acerto inexistente.'; END IF;
  IF NOT (public.kit_cycle_in_scope(a.cycle_id) OR public.has_capability(auth.uid(),'finance.view')) THEN
    RAISE EXCEPTION 'Sem acesso a este acerto.';
  END IF;
  RETURN jsonb_build_object(
    'acerto', to_jsonb(a),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
                         FROM public.kit_acerto_items i WHERE i.acerto_id = _acerto), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at)
                         FROM public.kit_acerto_events e WHERE e.acerto_id = _acerto), '[]'::jsonb),
    'bloqueios', jsonb_build_array(
      'Preço real Lardan→consultora não definido.',
      'Momento em que a dívida nasce não definido.',
      'Tratamento de perda, garantia, mantida e divergência não definido.',
      'Proporção de "um terço" pendente, sem percentual e sem efeito.'));
END $fn$;

REVOKE ALL ON FUNCTION public.venda_evidencia_registrar(uuid,uuid,integer,date,text,bigint,uuid,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.venda_evidencia_compensar(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_acerto_abrir(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_acerto_conferir(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_acerto_bloquear(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_acerto_aprovar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_acerto_detalhe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venda_evidencia_registrar(uuid,uuid,integer,date,text,bigint,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.venda_evidencia_compensar(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_acerto_abrir(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_acerto_conferir(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_acerto_bloquear(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_acerto_aprovar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_acerto_detalhe(uuid) TO authenticated;
