
-- 1. Capacidade de leitura global, separada de "abrir o módulo"
INSERT INTO public.role_capabilities (role, capability)
SELECT r::public.app_role, 'kit.view.all'
  FROM unnest(ARRAY['master','diretoria','financeiro','estoque','montagem']) r
ON CONFLICT DO NOTHING;

-- 2. Identidade: perfil precisa estar ativo
CREATE OR REPLACE FUNCTION public.my_party_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.party_id FROM public.profiles p
   WHERE p.id = auth.uid() AND p.is_active AND p.party_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.kit_scope_all()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.has_capability(auth.uid(),'kit.view.all'), false)
      OR coalesce(public.has_capability(auth.uid(),'kit.manage'), false)
$$;

CREATE OR REPLACE FUNCTION public.can_view_kits(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.has_capability(_user_id,'kit.view'), false)
$$;

CREATE OR REPLACE FUNCTION public.can_manage_kits(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.has_capability(_user_id,'kit.manage'), false)
$$;

CREATE OR REPLACE FUNCTION public.kit_cycle_in_scope(_cycle_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kit_cycles c
    WHERE c.id = _cycle_id
      AND (
        public.kit_scope_all()
        OR (public.my_party_id() IS NOT NULL AND (
              c.consultora_party_id = public.my_party_id()
           OR c.representante_party_id = public.my_party_id()
           OR c.custodian_party_id = public.my_party_id()
           OR EXISTS (SELECT 1 FROM public.kit_transfers t
                       WHERE t.cycle_id = c.id
                         AND public.my_party_id() IN (t.from_party_id, t.to_party_id))
        ))
      )
  )
$$;

-- 3. Listas com escopo, paginação e ordenação estável
CREATE OR REPLACE FUNCTION public.kit_board(_filtros jsonb DEFAULT '{}'::jsonb,
                                            _limit integer DEFAULT 200,
                                            _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); eu uuid := public.my_party_id(); tudo boolean;
        lim integer := least(greatest(coalesce(_limit,200),1), 500);
        off integer := greatest(coalesce(_offset,0),0);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  IF public.has_capability(uid,'kit.view') IS NOT TRUE
     AND public.has_capability(uid,'kit.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem permissão para ver maletas.' USING errcode='42501';
  END IF;
  tudo := public.kit_scope_all();
  IF tudo IS NOT TRUE AND eu IS NULL THEN
    RAISE EXCEPTION 'Seu usuário não está vinculado a uma pessoa.' USING errcode='42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'criada_em') DESC, x->>'cycle_id'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'cycle_id', c.id, 'kit_id', c.kit_id, 'codigo', k.code, 'ciclo', c.cycle_no,
        'situacao', c.status, 'pecas', c.quantity_total,
        'valor_cents', c.reference_total_cents,
        'consultora', (SELECT display_name FROM public.parties WHERE id = c.consultora_party_id),
        'consultora_party_id', c.consultora_party_id,
        'representante', (SELECT display_name FROM public.parties WHERE id = c.representante_party_id),
        'custodia', (SELECT display_name FROM public.parties WHERE id = c.custodian_party_id),
        'prazo', c.due_at, 'expedida_em', c.shipped_at, 'recebida_em', c.received_at,
        'criada_em', c.created_at) AS x
      FROM public.kit_cycles c JOIN public.kits k ON k.id = c.kit_id
      WHERE (tudo IS TRUE
             OR (eu IS NOT NULL AND (c.consultora_party_id = eu
                                  OR c.representante_party_id = eu
                                  OR c.custodian_party_id = eu)))
        AND (nullif(_filtros->>'situacao','') IS NULL
             OR c.status = (_filtros->>'situacao')::public.kit_status)
      ORDER BY c.created_at DESC, c.id
      LIMIT lim OFFSET off
    ) s);
END $$;

-- 4. Detalhe com rejeição explícita
CREATE OR REPLACE FUNCTION public.kit_require_cycle(_cycle uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  IF public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem permissão para ver esta maleta.' USING errcode='42501';
  END IF;
  RETURN uid;
END $$;

-- 5. Bloqueio de escrita direta (defesa em profundidade além do RLS)
CREATE OR REPLACE FUNCTION public.kit_block_direct_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Maletas só podem ser alteradas pelas operações oficiais.' USING errcode='42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.kit_block_frozen_composition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE comp uuid := coalesce(NEW.composition_id, OLD.composition_id); congelada timestamptz;
BEGIN
  SELECT frozen_at INTO congelada FROM public.kit_compositions WHERE id = comp;
  IF congelada IS NOT NULL
     AND coalesce(current_setting('lardan.kit_freeze_bypass', true),'') <> 'on' THEN
    RAISE EXCEPTION 'Composição já conferida: use um novo ciclo ou procedimento de exceção.'
      USING errcode='42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kits','kit_cycles','kit_compositions','kit_composition_items',
                           'kit_transfers','kit_balances','kit_acceptances',
                           'kit_acceptance_items','kit_events'] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'zz_block_direct_' || t, t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.kit_block_direct_write()', 'zz_block_direct_' || t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS kits_write ON public.kits;
DROP POLICY IF EXISTS kit_cycles_write ON public.kit_cycles;
DROP POLICY IF EXISTS kit_compositions_write ON public.kit_compositions;
DROP POLICY IF EXISTS kit_composition_items_write ON public.kit_composition_items;
DROP POLICY IF EXISTS kit_transfers_write ON public.kit_transfers;

DROP POLICY IF EXISTS kits_read ON public.kits;
CREATE POLICY kits_read ON public.kits FOR SELECT TO authenticated
USING (public.kit_scope_all()
       OR EXISTS (SELECT 1 FROM public.kit_cycles c
                   WHERE c.kit_id = kits.id AND public.kit_cycle_in_scope(c.id)));

DROP TRIGGER IF EXISTS zz_block_frozen_items ON public.kit_composition_items;
CREATE TRIGGER zz_block_frozen_items
BEFORE INSERT OR UPDATE OR DELETE ON public.kit_composition_items
FOR EACH ROW EXECUTE FUNCTION public.kit_block_frozen_composition();

-- 6. Montagem: depósito de origem explícito quando há mais de um
CREATE OR REPLACE FUNCTION public.kit_cycle_create(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  v_kit uuid := nullif(_payload->>'kit_id','')::uuid;
  k public.kits; n integer; cyc uuid; comp uuid; origem uuid; depositos integer;
BEGIN
  origem := nullif(_payload->>'origin_location_id','')::uuid;
  SELECT count(*) INTO depositos FROM public.locations WHERE kind = 'deposito' AND is_active;
  IF origem IS NULL THEN
    IF depositos = 0 THEN RAISE EXCEPTION 'Nenhum depósito ativo para montar a maleta.'; END IF;
    IF depositos > 1 THEN
      RAISE EXCEPTION 'Escolha o depósito de origem: há % depósitos ativos.', depositos;
    END IF;
    SELECT id INTO origem FROM public.locations WHERE kind = 'deposito' AND is_active;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.locations
                    WHERE id = origem AND kind = 'deposito' AND is_active) THEN
      RAISE EXCEPTION 'Depósito de origem inválido ou inativo.';
    END IF;
  END IF;

  IF v_kit IS NULL THEN
    INSERT INTO public.kits (label, notes, created_by, updated_by)
    VALUES (nullif(_payload->>'label',''), nullif(_payload->>'notes',''), uid, uid)
    RETURNING * INTO k;
  ELSE
    SELECT * INTO k FROM public.kits WHERE id = v_kit;
    IF k.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
    IF EXISTS (SELECT 1 FROM public.kit_cycles c
                WHERE c.kit_id = k.id AND c.status NOT IN ('encerrada','cancelada')) THEN
      RAISE EXCEPTION 'Esta maleta já possui um ciclo em aberto.';
    END IF;
  END IF;

  SELECT coalesce(max(c.cycle_no),0) + 1 INTO n FROM public.kit_cycles c WHERE c.kit_id = k.id;

  INSERT INTO public.kit_cycles (
    kit_id, cycle_no, status, consultora_party_id, representante_party_id,
    origin_location_id, current_location_id, due_at, notes, created_by, updated_by)
  VALUES (
    k.id, n, 'montagem',
    nullif(_payload->>'consultora_party_id','')::uuid,
    nullif(_payload->>'representante_party_id','')::uuid,
    origem, origem,
    nullif(_payload->>'due_at','')::timestamptz,
    nullif(_payload->>'notes',''), uid, uid)
  RETURNING id INTO cyc;

  INSERT INTO public.kit_compositions (cycle_id, version, created_by)
  VALUES (cyc, 1, uid) RETURNING id INTO comp;

  INSERT INTO public.kit_events (cycle_id, kind, to_status, actor_user_id, payload)
  VALUES (cyc, 'ciclo.criado', 'montagem', uid,
          jsonb_build_object('maleta', k.code, 'ciclo', n, 'origem', origem));

  RETURN jsonb_build_object('cycle_id', cyc, 'kit_id', k.id, 'code', k.code,
                            'qr_token', k.qr_token, 'cycle_no', n, 'composition_id', comp);
END $$;

-- 7. Aceite exato
ALTER TABLE public.kit_acceptances ADD COLUMN IF NOT EXISTS payload_hash text;
ALTER TABLE public.kit_acceptance_items ADD COLUMN IF NOT EXISTS divergence_kind text;
DO $$ BEGIN
  ALTER TABLE public.kit_acceptance_items
    ADD CONSTRAINT kit_acceptance_items_divergence_kind_chk
    CHECK (divergence_kind IS NULL OR divergence_kind IN ('faltante','defeito'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.kit_aceitar(_cycle uuid, _itens jsonb,
                                              _idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  c public.kit_cycles; comp public.kit_compositions; ac uuid; item jsonb;
  vid uuid; esperado integer; aceito integer; divergente integer; tipo_div text;
  total_aceito integer := 0; total_div integer := 0; tipo public.kit_acceptance_kind;
  existente public.kit_acceptances; hash text; informados integer; esperados integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR c.consultora_party_id IS DISTINCT FROM eu) THEN
    RAISE EXCEPTION 'Somente a consultora desta maleta pode aceitá-la.' USING errcode='42501';
  END IF;

  IF jsonb_typeof(coalesce(_itens,'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Informe a conferência peça por peça.';
  END IF;
  hash := md5(_cycle::text || ':' || (
    SELECT coalesce(string_agg(format('%s|%s|%s|%s',
             x->>'variant_id', x->>'qty_accepted', x->>'qty_divergent',
             coalesce(x->>'tipo_divergencia','')), ',' ORDER BY x->>'variant_id'), '')
    FROM jsonb_array_elements(_itens) x));

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO existente FROM public.kit_acceptances
     WHERE cycle_id = _cycle AND idempotency_key = _idempotency_key;
    IF existente.id IS NOT NULL THEN
      IF existente.payload_hash IS NOT NULL AND existente.payload_hash <> hash THEN
        RAISE EXCEPTION 'Esta conferência já foi registrada com outro conteúdo.';
      END IF;
      RETURN jsonb_build_object('acceptance_id', existente.id, 'repetida', true,
                                'situacao', c.status);
    END IF;
  END IF;

  IF c.status IN ('operacao','acerto','encerrada') THEN
    RAISE EXCEPTION 'Esta maleta já foi aceita.';
  END IF;
  IF c.status NOT IN ('transito','recebida') THEN
    RAISE EXCEPTION 'A maleta ainda não foi expedida.';
  END IF;
  IF c.custodian_party_id IS DISTINCT FROM c.consultora_party_id THEN
    RAISE EXCEPTION 'A maleta ainda não chegou à consultora.';
  END IF;

  SELECT * INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  IF comp.frozen_at IS NULL THEN RAISE EXCEPTION 'Composição não conferida.'; END IF;

  SELECT count(*) INTO esperados FROM public.kit_composition_items WHERE composition_id = comp.id;
  SELECT count(DISTINCT x->>'variant_id'), count(*) INTO informados, informados
    FROM jsonb_array_elements(_itens) x;
  IF (SELECT count(DISTINCT x->>'variant_id') FROM jsonb_array_elements(_itens) x)
     <> (SELECT count(*) FROM jsonb_array_elements(_itens) x) THEN
    RAISE EXCEPTION 'Há peças repetidas na conferência.';
  END IF;
  IF informados <> esperados THEN
    RAISE EXCEPTION 'A conferência precisa classificar todas as % peças enviadas.', esperados;
  END IF;

  INSERT INTO public.kit_acceptances (cycle_id, composition_id, kind, party_id, actor_user_id,
    context, idempotency_key, payload_hash)
  VALUES (_cycle, comp.id, 'integral', c.consultora_party_id, uid, '{}'::jsonb,
          _idempotency_key, hash)
  RETURNING id INTO ac;

  FOR item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    vid := (item->>'variant_id')::uuid;
    SELECT quantity INTO esperado FROM public.kit_composition_items
     WHERE composition_id = comp.id AND variant_id = vid;
    IF esperado IS NULL THEN
      RAISE EXCEPTION 'Peça informada não faz parte desta maleta.';
    END IF;
    aceito := (item->>'qty_accepted')::integer;
    divergente := (item->>'qty_divergent')::integer;
    tipo_div := nullif(item->>'tipo_divergencia','');
    IF aceito IS NULL OR divergente IS NULL OR aceito < 0 OR divergente < 0 THEN
      RAISE EXCEPTION 'Quantidades inválidas na conferência.';
    END IF;
    IF aceito + divergente <> esperado THEN
      RAISE EXCEPTION 'Peça com % unidades enviadas: informe aceitas e divergentes somando %.',
        esperado, esperado;
    END IF;
    IF divergente > 0 THEN
      IF tipo_div IS NULL OR tipo_div NOT IN ('faltante','defeito') THEN
        RAISE EXCEPTION 'Diga se a peça divergente não veio (faltante) ou veio com defeito.';
      END IF;
      IF nullif(trim(coalesce(item->>'motivo','')),'') IS NULL THEN
        RAISE EXCEPTION 'Divergência precisa de justificativa.';
      END IF;
    END IF;

    INSERT INTO public.kit_acceptance_items (acceptance_id, variant_id, qty_expected,
      qty_accepted, qty_divergent, divergence_reason, divergence_kind, photos)
    VALUES (ac, vid, esperado, aceito, divergente,
            nullif(item->>'motivo',''), CASE WHEN divergente > 0 THEN tipo_div END,
            coalesce(item->'fotos','[]'::jsonb));

    UPDATE public.kit_balances
       SET qty_accepted = qty_accepted + aceito,
           qty_divergent = qty_divergent + divergente,
           updated_at = now()
     WHERE cycle_id = _cycle AND variant_id = vid;

    total_aceito := total_aceito + aceito;
    total_div := total_div + divergente;
  END LOOP;

  tipo := CASE WHEN total_div > 0 THEN 'parcial'::public.kit_acceptance_kind
               ELSE 'integral'::public.kit_acceptance_kind END;
  UPDATE public.kit_acceptances SET kind = tipo WHERE id = ac;

  UPDATE public.kit_cycles
     SET status = 'operacao', received_at = coalesce(received_at, now()), updated_by = uid
   WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'maleta.aceita', c.status, 'operacao', uid,
          jsonb_build_object('aceite', ac, 'tipo', tipo, 'aceitas', total_aceito,
                             'divergentes', total_div, 'composicao', comp.id));

  RETURN jsonb_build_object('acceptance_id', ac, 'tipo', tipo, 'aceitas', total_aceito,
                            'divergentes', total_div, 'situacao','operacao');
END $$;

-- 8. Demais operações: recusa explícita quando não há identidade
CREATE OR REPLACE FUNCTION public.kit_item_publish(_cycle uuid, _variant uuid, _publicar boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); eu uuid := public.my_party_id(); c public.kit_cycles;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo não encontrado.'; END IF;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR c.consultora_party_id IS DISTINCT FROM eu) THEN
    RAISE EXCEPTION 'Sem permissão sobre esta maleta.' USING errcode='42501';
  END IF;
  UPDATE public.kit_balances SET is_published = coalesce(_publicar,true), updated_at = now()
   WHERE cycle_id = _cycle AND variant_id = _variant;
  RETURN jsonb_build_object('ok', true, 'publicado', coalesce(_publicar,true));
END $$;

CREATE OR REPLACE FUNCTION public.kit_transfer_confirm(_transfer uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid(); t public.kit_transfers; c public.kit_cycles;
  recusar boolean := coalesce((_payload->>'recusar')::boolean, false);
  eu uuid := public.my_party_id();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  SELECT * INTO t FROM public.kit_transfers WHERE id = _transfer FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transferência não encontrada.'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = t.cycle_id FOR UPDATE;

  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR t.to_party_id IS DISTINCT FROM eu) THEN
    RAISE EXCEPTION 'Somente quem está recebendo pode confirmar esta entrega.' USING errcode='42501';
  END IF;

  IF t.status IN ('entregue','recusada') THEN
    RETURN jsonb_build_object('situacao', t.status, 'repetida', true);
  END IF;

  IF recusar THEN
    UPDATE public.kit_transfers
       SET status = 'recusada', refused_at = now(),
           refusal_reason = nullif(_payload->>'motivo',''), updated_by = uid
     WHERE id = t.id;
    INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload, reason)
    VALUES (c.id, 'entrega.recusada', uid, jsonb_build_object('transferencia', t.id),
            nullif(_payload->>'motivo',''));
    RETURN jsonb_build_object('situacao','recusada');
  END IF;

  UPDATE public.kit_transfers
     SET status = 'entregue', delivered_at = now(),
         evidence = coalesce(_payload->'evidencia', evidence), updated_by = uid
   WHERE id = t.id;

  UPDATE public.kit_cycles
     SET custodian_party_id = t.to_party_id,
         status = CASE WHEN t.to_party_id = c.consultora_party_id THEN 'recebida'::kit_status
                       ELSE c.status END,
         received_at = CASE WHEN t.to_party_id = c.consultora_party_id THEN now() ELSE received_at END,
         updated_by = uid
   WHERE id = c.id;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (c.id, 'entrega.confirmada', c.status,
          CASE WHEN t.to_party_id = c.consultora_party_id THEN 'recebida'::kit_status ELSE c.status END,
          uid, jsonb_build_object('transferencia', t.id, 'responsavel', t.to_party_id));

  RETURN jsonb_build_object('situacao','entregue','custodia', t.to_party_id);
END $$;

CREATE OR REPLACE FUNCTION public.kit_transfer_forward(_cycle uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid(); c public.kit_cycles; eu uuid := public.my_party_id();
  n integer; novo uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR c.custodian_party_id IS DISTINCT FROM eu) THEN
    RAISE EXCEPTION 'Somente quem está com a maleta pode encaminhá-la.' USING errcode='42501';
  END IF;
  IF c.consultora_party_id IS NULL THEN
    RAISE EXCEPTION 'Defina a consultora destinatária antes de encaminhar.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kit_transfers
              WHERE cycle_id = _cycle AND to_party_id = c.consultora_party_id
                AND status IN ('pendente','transito')) THEN
    RETURN jsonb_build_object('repetida', true, 'mensagem','Já existe uma entrega em andamento para a consultora.');
  END IF;

  SELECT coalesce(max(seq),0) + 1 INTO n FROM public.kit_transfers WHERE cycle_id = _cycle;
  INSERT INTO public.kit_transfers (cycle_id, seq, status, from_party_id, to_party_id,
    from_location_id, to_location_id, carrier, tracking_code, shipped_at, note, created_by, updated_by)
  VALUES (_cycle, n, 'transito', c.custodian_party_id, c.consultora_party_id,
    c.current_location_id, c.current_location_id,
    nullif(_payload->>'carrier',''), nullif(_payload->>'tracking_code',''), now(),
    nullif(_payload->>'note',''), uid, uid)
  RETURNING id INTO novo;

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'entrega.encaminhada', uid,
          jsonb_build_object('transferencia', novo, 'de', c.custodian_party_id,
                             'para', c.consultora_party_id));

  RETURN jsonb_build_object('transfer_id', novo, 'situacao','transito');
END $$;

CREATE OR REPLACE FUNCTION public.orders_list(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); eu uuid := public.my_party_id(); tudo boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  tudo := coalesce(public.has_capability(uid,'kit.manage'), false);
  IF tudo IS NOT TRUE AND eu IS NULL THEN
    RAISE EXCEPTION 'Seu usuário não está vinculado a uma pessoa.' USING errcode='42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC, o.id),'[]'::jsonb)
      FROM public.sales_orders o
     WHERE (tudo IS TRUE OR (eu IS NOT NULL AND o.consultora_party_id = eu))
       AND (nullif(_filtros->>'status','') IS NULL
            OR o.status = (_filtros->>'status')::public.sales_order_status));
END $$;

CREATE OR REPLACE FUNCTION public.order_detail(_order uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o public.sales_orders; uid uuid := auth.uid(); eu uuid := public.my_party_id();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  SELECT * INTO o FROM public.sales_orders WHERE id = _order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR o.consultora_party_id IS DISTINCT FROM eu) THEN
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

-- 9. Índices de escopo
CREATE INDEX IF NOT EXISTS kit_cycles_consultora_idx ON public.kit_cycles (consultora_party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kit_cycles_representante_idx ON public.kit_cycles (representante_party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kit_cycles_custodia_idx ON public.kit_cycles (custodian_party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_orders_consultora_idx ON public.sales_orders (consultora_party_id, created_at DESC);

REVOKE EXECUTE ON FUNCTION public.kit_board(jsonb, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_aceitar(uuid, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_cycle_create(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_transfer_confirm(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_transfer_forward(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_item_publish(uuid, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.orders_list(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.order_detail(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_party_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_cycle_in_scope(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_scope_all() FROM anon;
