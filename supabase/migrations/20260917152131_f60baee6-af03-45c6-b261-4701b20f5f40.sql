-- ============================================================
-- NÚCLEO COMERCIAL — ETAPA 3: vitrine individual e pedidos
-- ============================================================

-- ---------- vitrine da consultora ----------
CREATE TABLE IF NOT EXISTS public.consultant_showcases (
  party_id uuid PRIMARY KEY REFERENCES public.parties(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  headline text,
  bio text,
  whatsapp text,
  avatar_media_id uuid REFERENCES public.media_assets(id),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.consultant_showcases TO authenticated;
GRANT ALL ON public.consultant_showcases TO service_role;
ALTER TABLE public.consultant_showcases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "showcase_owner_manage" ON public.consultant_showcases
  FOR ALL TO authenticated
  USING (party_id = public.my_party_id() OR public.has_capability(auth.uid(),'kit.manage'))
  WITH CHECK (party_id = public.my_party_id() OR public.has_capability(auth.uid(),'kit.manage'));

CREATE TRIGGER trg_consultant_showcases_updated
  BEFORE UPDATE ON public.consultant_showcases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- peças da maleta visíveis (ou não) na vitrine
ALTER TABLE public.kit_balances
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true;

-- ---------- pedidos ----------
DO $$ BEGIN
  CREATE TYPE public.sales_order_status AS ENUM
    ('aguardando_atendimento','em_atendimento','aguardando_pagamento','concluido','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sales_payment_status AS ENUM ('nao_iniciado','pendente','pago','estornado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sales_delivery_status AS ENUM ('nao_iniciado','combinada','entregue','devolvida');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SEQUENCE IF NOT EXISTS public.sales_order_code_seq;

CREATE TABLE IF NOT EXISTS public.sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT ('PED-' || lpad(nextval('public.sales_order_code_seq')::text, 6, '0')),
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id),
  customer_party_id uuid REFERENCES public.parties(id),
  customer_name text NOT NULL,
  customer_phone text,
  customer_email text,
  customer_note text,
  channel text NOT NULL DEFAULT 'vitrine',
  status public.sales_order_status NOT NULL DEFAULT 'aguardando_atendimento',
  payment_status public.sales_payment_status NOT NULL DEFAULT 'nao_iniciado',
  delivery_status public.sales_delivery_status NOT NULL DEFAULT 'nao_iniciado',
  subtotal_cents bigint NOT NULL DEFAULT 0,
  items_count integer NOT NULL DEFAULT 0,
  reserve_expires_at timestamptz,
  offer_valid_until timestamptz,
  idempotency_key text UNIQUE,
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  cycle_id uuid REFERENCES public.kit_cycles(id),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  product_name text NOT NULL,
  variant_label text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, cycle_id, variant_id)
);

CREATE TABLE IF NOT EXISTS public.sales_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  kind text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id uuid,
  note text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_consultora ON public.sales_orders (consultora_party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_order ON public.sales_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_events_order ON public.sales_order_events (order_id, created_at DESC);

GRANT SELECT ON public.sales_orders, public.sales_order_items, public.sales_order_events TO authenticated;
GRANT ALL ON public.sales_orders, public.sales_order_items, public.sales_order_events TO service_role;

ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_scope_read" ON public.sales_orders
  FOR SELECT TO authenticated
  USING (consultora_party_id = public.my_party_id() OR public.has_capability(auth.uid(),'kit.manage'));

CREATE POLICY "order_items_scope_read" ON public.sales_order_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.id = order_id
                 AND (o.consultora_party_id = public.my_party_id()
                      OR public.has_capability(auth.uid(),'kit.manage'))));

CREATE POLICY "order_events_scope_read" ON public.sales_order_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.id = order_id
                 AND (o.consultora_party_id = public.my_party_id()
                      OR public.has_capability(auth.uid(),'kit.manage'))));

CREATE TRIGGER trg_sales_orders_updated
  BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_sales_order_events_immutable
  BEFORE UPDATE OR DELETE ON public.sales_order_events
  FOR EACH ROW EXECUTE FUNCTION public.block_audit_mutation();

-- ---------- slug ----------
CREATE OR REPLACE FUNCTION public.showcase_slug_reserved(_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(_slug) = ANY (ARRAY[
    'admin','api','acesso','carrinho','contato','colecoes','colares','brincos','aneis',
    'pulseiras','semijoias','produto','seja-lardan','a-lardan','consultora','vitrine',
    'sitemap.xml','robots.txt','llms.txt','assets','static','login','sair','painel','app'])
$$;

CREATE OR REPLACE FUNCTION public.showcase_save(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  eu uuid := public.my_party_id();
  alvo uuid := coalesce(nullif(_payload->>'party_id','')::uuid, eu);
  s text := lower(regexp_replace(coalesce(_payload->>'slug',''), '[^a-zA-Z0-9-]', '', 'g'));
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  IF alvo IS NULL THEN RAISE EXCEPTION 'Cadastro de pessoa não vinculado ao seu usuário.'; END IF;
  IF alvo <> eu AND NOT public.has_capability(uid,'kit.manage') THEN
    RAISE EXCEPTION 'Sem permissão para alterar a vitrine de outra consultora.' USING errcode='42501';
  END IF;
  IF length(s) < 3 THEN RAISE EXCEPTION 'Escolha um endereço com pelo menos 3 letras.'; END IF;
  IF public.showcase_slug_reserved(s) THEN RAISE EXCEPTION 'Este endereço é reservado pelo site.'; END IF;
  IF EXISTS (SELECT 1 FROM public.consultant_showcases WHERE slug = s AND party_id <> alvo) THEN
    RAISE EXCEPTION 'Este endereço já está em uso.';
  END IF;

  INSERT INTO public.consultant_showcases (party_id, slug, headline, bio, whatsapp, is_public)
  VALUES (alvo, s, nullif(_payload->>'headline',''), nullif(_payload->>'bio',''),
          regexp_replace(coalesce(_payload->>'whatsapp',''),'[^0-9]','','g'),
          coalesce((_payload->>'is_public')::boolean, false))
  ON CONFLICT (party_id) DO UPDATE SET
    slug = excluded.slug, headline = excluded.headline, bio = excluded.bio,
    whatsapp = excluded.whatsapp, is_public = excluded.is_public;

  RETURN jsonb_build_object('slug', s);
END $$;

CREATE OR REPLACE FUNCTION public.kit_item_publish(_cycle uuid, _variant uuid, _publicar boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.kit_cycles;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo não encontrado.'; END IF;
  IF NOT (public.has_capability(uid,'kit.manage') OR c.consultora_party_id = public.my_party_id()) THEN
    RAISE EXCEPTION 'Sem permissão sobre esta maleta.' USING errcode='42501';
  END IF;
  UPDATE public.kit_balances SET is_published = coalesce(_publicar,true), updated_at = now()
   WHERE cycle_id = _cycle AND variant_id = _variant;
  RETURN jsonb_build_object('ok', true, 'publicado', coalesce(_publicar,true));
END $$;

-- ---------- vitrine pública ----------
CREATE OR REPLACE FUNCTION public.showcase_public(_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sh public.consultant_showcases; p public.parties; itens jsonb;
BEGIN
  SELECT * INTO sh FROM public.consultant_showcases WHERE slug = lower(_slug) AND is_public;
  IF sh.party_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.parties WHERE id = sh.party_id;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'produto'), '[]'::jsonb) INTO itens FROM (
    SELECT jsonb_build_object(
      'cycle_id', b.cycle_id,
      'variant_id', b.variant_id,
      'produto', pr.name,
      'slug', pr.slug,
      'variante', v.label,
      'tamanho', v.size,
      'cor', v.color,
      'categoria', cat.name,
      'disponivel', b.qty_available,
      'preco_cents', public.kit_reference_price(b.variant_id),
      'media_id', (SELECT pm.media_id FROM public.product_media pm
                    WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1)
    ) AS x
    FROM public.kit_balances b
    JOIN public.kit_cycles c ON c.id = b.cycle_id
    JOIN public.product_variants v ON v.id = b.variant_id
    JOIN public.products pr ON pr.id = v.product_id
    LEFT JOIN public.categories cat ON cat.id = pr.category_id
    WHERE c.consultora_party_id = sh.party_id
      AND c.status IN ('recebida','operacao')
      AND b.is_published
      AND b.qty_available > 0
      AND v.is_active
      AND pr.status = 'publicado'
  ) s;

  RETURN jsonb_build_object(
    'slug', sh.slug,
    'nome', coalesce(p.social_name, p.display_name),
    'headline', sh.headline,
    'bio', sh.bio,
    'whatsapp', sh.whatsapp,
    'itens', itens);
END $$;

REVOKE ALL ON FUNCTION public.showcase_public(text) FROM public;
GRANT EXECUTE ON FUNCTION public.showcase_public(text) TO anon, authenticated, service_role;

-- ---------- criação do pedido (transacional) ----------
CREATE OR REPLACE FUNCTION public.showcase_order_create(
  _slug text, _cliente jsonb, _itens jsonb, _idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sh public.consultant_showcases; existente public.sales_orders;
  pedido uuid; item jsonb; vid uuid; cyc uuid; q integer; preco integer;
  b public.kit_balances; total bigint := 0; contagem integer := 0;
  nome text := nullif(trim(coalesce(_cliente->>'nome','')),'');
  validade timestamptz := now() + interval '48 hours';
BEGIN
  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO existente FROM public.sales_orders WHERE idempotency_key = _idempotency_key;
    IF existente.id IS NOT NULL THEN
      RETURN jsonb_build_object('order_id', existente.id, 'codigo', existente.code, 'repetido', true);
    END IF;
  END IF;

  SELECT * INTO sh FROM public.consultant_showcases WHERE slug = lower(_slug) AND is_public;
  IF sh.party_id IS NULL THEN RAISE EXCEPTION 'Vitrine não encontrada.'; END IF;
  IF nome IS NULL THEN RAISE EXCEPTION 'Informe o seu nome.'; END IF;
  IF jsonb_array_length(coalesce(_itens,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Escolha pelo menos uma peça.';
  END IF;

  INSERT INTO public.sales_orders (consultora_party_id, customer_name, customer_phone,
    customer_email, customer_note, channel, reserve_expires_at, offer_valid_until, idempotency_key)
  VALUES (sh.party_id, nome,
    regexp_replace(coalesce(_cliente->>'telefone',''),'[^0-9]','','g'),
    nullif(_cliente->>'email',''), nullif(_cliente->>'observacao',''),
    coalesce(nullif(_cliente->>'canal',''),'vitrine'), validade, validade, _idempotency_key)
  RETURNING id INTO pedido;

  FOR item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    vid := (item->>'variant_id')::uuid;
    cyc := (item->>'cycle_id')::uuid;
    q := greatest(coalesce((item->>'quantidade')::integer, 1), 1);

    SELECT * INTO b FROM public.kit_balances
     WHERE cycle_id = cyc AND variant_id = vid FOR UPDATE;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Peça indisponível nesta vitrine.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.kit_cycles c
                    WHERE c.id = cyc AND c.consultora_party_id = sh.party_id
                      AND c.status IN ('recebida','operacao')) THEN
      RAISE EXCEPTION 'Peça indisponível nesta vitrine.';
    END IF;
    IF NOT b.is_published OR b.qty_available < q THEN
      RAISE EXCEPTION 'Restam apenas % unidade(s) desta peça.', greatest(b.qty_available,0);
    END IF;

    preco := public.kit_reference_price(vid);

    UPDATE public.kit_balances SET qty_reserved = qty_reserved + q, updated_at = now()
     WHERE id = b.id;

    INSERT INTO public.sales_order_items (order_id, cycle_id, variant_id, product_name,
      variant_label, quantity, unit_price_cents)
    SELECT pedido, cyc, vid, pr.name, v.label, q, preco
      FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id
     WHERE v.id = vid;

    total := total + (preco::bigint * q);
    contagem := contagem + q;
  END LOOP;

  UPDATE public.sales_orders SET subtotal_cents = total, items_count = contagem WHERE id = pedido;

  INSERT INTO public.sales_order_events (order_id, kind, to_status, payload, note)
  VALUES (pedido, 'pedido.recebido', 'aguardando_atendimento',
          jsonb_build_object('canal', coalesce(nullif(_cliente->>'canal',''),'vitrine'),
                             'itens', contagem), NULL);

  RETURN jsonb_build_object('order_id', pedido,
    'codigo', (SELECT code FROM public.sales_orders WHERE id = pedido),
    'total_cents', total, 'reserva_ate', validade);
END $$;

REVOKE ALL ON FUNCTION public.showcase_order_create(text, jsonb, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.showcase_order_create(text, jsonb, jsonb, text)
  TO anon, authenticated, service_role;

-- ---------- atendimento do pedido ----------
CREATE OR REPLACE FUNCTION public.order_detail(_order uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.sales_orders; uid uuid := auth.uid();
BEGIN
  SELECT * INTO o FROM public.sales_orders WHERE id = _order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF NOT (public.has_capability(uid,'kit.manage') OR o.consultora_party_id = public.my_party_id()) THEN
    RAISE EXCEPTION 'Sem permissão para ver este pedido.' USING errcode='42501';
  END IF;
  RETURN jsonb_build_object(
    'pedido', to_jsonb(o),
    'consultora', (SELECT display_name FROM public.parties WHERE id = o.consultora_party_id),
    'itens', (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.created_at),'[]'::jsonb)
                FROM public.sales_order_items i WHERE i.order_id = o.id),
    'eventos', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC),'[]'::jsonb)
                FROM public.sales_order_events e WHERE e.order_id = o.id));
END $$;

CREATE OR REPLACE FUNCTION public.orders_list(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); eu uuid := public.my_party_id(); tudo boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  tudo := public.has_capability(uid,'kit.manage');
  RETURN (
    SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC),'[]'::jsonb)
      FROM public.sales_orders o
     WHERE (tudo OR o.consultora_party_id = eu)
       AND (nullif(_filtros->>'status','') IS NULL
            OR o.status = (_filtros->>'status')::public.sales_order_status));
END $$;

CREATE OR REPLACE FUNCTION public.order_set_status(_order uuid, _status text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.sales_orders; uid uuid := auth.uid(); novo public.sales_order_status;
        it record;
BEGIN
  SELECT * INTO o FROM public.sales_orders WHERE id = _order FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF NOT (public.has_capability(uid,'kit.manage') OR o.consultora_party_id = public.my_party_id()) THEN
    RAISE EXCEPTION 'Sem permissão para atender este pedido.' USING errcode='42501';
  END IF;
  novo := _status::public.sales_order_status;
  IF o.status = novo THEN
    RETURN jsonb_build_object('situacao', o.status, 'repetido', true);
  END IF;
  IF o.status IN ('concluido','cancelado') THEN
    RAISE EXCEPTION 'Este pedido já foi encerrado.';
  END IF;

  IF novo = 'cancelado' THEN
    FOR it IN SELECT * FROM public.sales_order_items WHERE order_id = o.id LOOP
      UPDATE public.kit_balances
         SET qty_reserved = greatest(qty_reserved - it.quantity, 0), updated_at = now()
       WHERE cycle_id = it.cycle_id AND variant_id = it.variant_id;
    END LOOP;
    UPDATE public.sales_orders SET status = novo, cancelled_at = now(), cancel_reason = _note
     WHERE id = o.id;
  ELSIF novo = 'concluido' THEN
    UPDATE public.sales_orders SET status = novo, closed_at = now() WHERE id = o.id;
  ELSE
    UPDATE public.sales_orders SET status = novo WHERE id = o.id;
  END IF;

  INSERT INTO public.sales_order_events (order_id, kind, from_status, to_status, actor_user_id, note)
  VALUES (o.id, 'pedido.situacao', o.status::text, novo::text, uid, _note);

  RETURN jsonb_build_object('situacao', novo);
END $$;

-- ---------- painéis de maleta ----------
CREATE OR REPLACE FUNCTION public.kit_board(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); eu uuid := public.my_party_id(); tudo boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  tudo := public.has_capability(uid,'kit.view') OR public.has_capability(uid,'kit.manage');
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'cycle_id', c.id, 'kit_id', c.kit_id, 'codigo', k.code, 'ciclo', c.cycle_no,
      'situacao', c.status, 'pecas', c.quantity_total,
      'valor_cents', c.reference_total_cents,
      'consultora', (SELECT display_name FROM public.parties WHERE id = c.consultora_party_id),
      'consultora_party_id', c.consultora_party_id,
      'representante', (SELECT display_name FROM public.parties WHERE id = c.representante_party_id),
      'custodia', (SELECT display_name FROM public.parties WHERE id = c.custodian_party_id),
      'prazo', c.due_at, 'expedida_em', c.shipped_at, 'recebida_em', c.received_at,
      'criada_em', c.created_at) ORDER BY c.created_at DESC), '[]'::jsonb)
    FROM public.kit_cycles c JOIN public.kits k ON k.id = c.kit_id
   WHERE (tudo OR c.consultora_party_id = eu OR c.representante_party_id = eu
          OR c.custodian_party_id = eu)
     AND (nullif(_filtros->>'situacao','') IS NULL
          OR c.status = (_filtros->>'situacao')::public.kit_status));
END $$;

CREATE OR REPLACE FUNCTION public.kit_detail(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.kit_cycles; uid uuid := auth.uid(); eu uuid := public.my_party_id();
        comp uuid; k public.kits;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo não encontrado.'; END IF;
  IF NOT (public.has_capability(uid,'kit.view') OR public.has_capability(uid,'kit.manage')
          OR c.consultora_party_id = eu OR c.representante_party_id = eu
          OR c.custodian_party_id = eu) THEN
    RAISE EXCEPTION 'Sem permissão para ver esta maleta.' USING errcode='42501';
  END IF;
  SELECT * INTO k FROM public.kits WHERE id = c.kit_id;
  SELECT id INTO comp FROM public.kit_compositions WHERE cycle_id = _cycle
   ORDER BY version DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ciclo', to_jsonb(c),
    'maleta', jsonb_build_object('id', k.id, 'codigo', k.code, 'etiqueta', k.label,
                                 'qr_token', k.qr_token),
    'consultora', (SELECT display_name FROM public.parties WHERE id = c.consultora_party_id),
    'representante', (SELECT display_name FROM public.parties WHERE id = c.representante_party_id),
    'custodia', (SELECT display_name FROM public.parties WHERE id = c.custodian_party_id),
    'composicao', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'variant_id', ci.variant_id, 'produto', pr.name, 'variante', v.label,
        'sku', v.sku, 'quantidade', ci.quantity, 'valor_unitario', ci.unit_reference_cents,
        'media_id', (SELECT pm.media_id FROM public.product_media pm
                      WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1)
      ) ORDER BY pr.name), '[]'::jsonb)
      FROM public.kit_composition_items ci
      JOIN public.product_variants v ON v.id = ci.variant_id
      JOIN public.products pr ON pr.id = v.product_id
      WHERE ci.composition_id = comp),
    'saldos', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'variant_id', b.variant_id, 'produto', pr.name, 'variante', v.label,
        'alocado', b.qty_allocated, 'aceito', b.qty_accepted, 'divergente', b.qty_divergent,
        'vendido', b.qty_sold, 'reservado', b.qty_reserved, 'disponivel', b.qty_available,
        'publicado', b.is_published,
        'media_id', (SELECT pm.media_id FROM public.product_media pm
                      WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1)
      ) ORDER BY pr.name), '[]'::jsonb)
      FROM public.kit_balances b
      JOIN public.product_variants v ON v.id = b.variant_id
      JOIN public.products pr ON pr.id = v.product_id
      WHERE b.cycle_id = _cycle),
    'entregas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'seq', t.seq, 'situacao', t.status,
        'de', (SELECT display_name FROM public.parties WHERE id = t.from_party_id),
        'para', (SELECT display_name FROM public.parties WHERE id = t.to_party_id),
        'para_party_id', t.to_party_id,
        'transportadora', t.carrier, 'rastreio', t.tracking_code,
        'enviada_em', t.shipped_at, 'entregue_em', t.delivered_at,
        'recusada_em', t.refused_at, 'motivo', t.refusal_reason) ORDER BY t.seq), '[]'::jsonb)
      FROM public.kit_transfers t WHERE t.cycle_id = _cycle),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'de', e.from_status, 'para', e.to_status,
        'quando', e.created_at, 'payload', e.payload, 'motivo', e.reason)
        ORDER BY e.created_at DESC), '[]'::jsonb)
      FROM public.kit_events e WHERE e.cycle_id = _cycle));
END $$;

REVOKE ALL ON FUNCTION public.showcase_save(jsonb) FROM public;
REVOKE ALL ON FUNCTION public.kit_item_publish(uuid, uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public.order_detail(uuid) FROM public;
REVOKE ALL ON FUNCTION public.orders_list(jsonb) FROM public;
REVOKE ALL ON FUNCTION public.order_set_status(uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.kit_board(jsonb) FROM public;
REVOKE ALL ON FUNCTION public.kit_detail(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.showcase_save(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kit_item_publish(uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.orders_list(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_set_status(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kit_board(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kit_detail(uuid) TO authenticated, service_role;
