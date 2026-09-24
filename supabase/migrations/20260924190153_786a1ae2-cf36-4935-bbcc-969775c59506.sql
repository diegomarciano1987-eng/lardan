
CREATE SEQUENCE IF NOT EXISTS public.kit_entrada_seq;

CREATE TABLE public.kit_entradas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT ('ENT-' || lpad(nextval('public.kit_entrada_seq')::text, 5, '0')),
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  referencia text NOT NULL CHECK (length(btrim(referencia)) > 0),
  nota text,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','concluida','cancelada')),
  total_pecas integer NOT NULL DEFAULT 0 CHECK (total_pecas >= 0),
  consultora_status_anterior text,
  consultora_ativada boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  concluded_at timestamptz,
  concluded_by uuid
);
CREATE INDEX ON public.kit_entradas (consultora_party_id);
CREATE INDEX ON public.kit_entradas (created_at DESC);

CREATE TABLE public.kit_entrada_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entrada_id uuid NOT NULL REFERENCES public.kit_entradas(id),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  codigo_lido text NOT NULL,
  chave text NOT NULL UNIQUE,
  stock_movement_id uuid NOT NULL UNIQUE REFERENCES public.stock_movements(id),
  estorno_movement_id uuid UNIQUE REFERENCES public.stock_movements(id),
  estornado_em timestamptz,
  estornado_por uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.kit_entrada_itens (entrada_id, created_at DESC);

GRANT SELECT ON public.kit_entradas TO authenticated;
GRANT SELECT ON public.kit_entrada_itens TO authenticated;
GRANT ALL ON public.kit_entradas TO service_role;
GRANT ALL ON public.kit_entrada_itens TO service_role;
ALTER TABLE public.kit_entradas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_entrada_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operadores de estoque veem entradas" ON public.kit_entradas FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'stock.operate'));
CREATE POLICY "Operadores de estoque veem pecas de entradas" ON public.kit_entrada_itens FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'stock.operate'));

INSERT INTO public.stock_reasons (code, label, kind)
SELECT 'estorno_leitura', 'Estorno de leitura', 'saida'
WHERE NOT EXISTS (SELECT 1 FROM public.stock_reasons WHERE code = 'estorno_leitura');

CREATE OR REPLACE FUNCTION public.kit_entrada_exigir()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(), 'stock.operate') THEN
    RAISE EXCEPTION 'Sem permissão para dar entrada de maleta.' USING errcode = '42501';
  END IF;
  RETURN auth.uid();
END $$;

-- Busca de consultoras (ativas e inativas) para a entrada
CREATE OR REPLACE FUNCTION public.kit_entrada_consultoras(_busca text DEFAULT NULL, _limit integer DEFAULT 40)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE termo text := nullif(btrim(coalesce(_busca,'')), ''); canon text; r jsonb;
BEGIN
  PERFORM public.kit_entrada_exigir();
  canon := nullif(upper(regexp_replace(coalesce(termo,''), '[^0-9A-Za-z]', '', 'g')), '');
  IF canon IS NOT NULL AND length(canon) < 3 THEN canon := NULL; END IF;
  WITH base AS (
    SELECT p.id, p.display_name, p.code, p.doc_masked, pr.status::text AS situacao
    FROM public.parties p
    JOIN public.party_roles pr ON pr.party_id = p.id AND pr.role = 'consultora'
    WHERE termo IS NULL OR p.display_name ILIKE '%'||termo||'%' OR p.legal_name ILIKE '%'||termo||'%'
       OR p.social_name ILIKE '%'||termo||'%' OR p.code ILIKE '%'||termo||'%'
       OR (canon IS NOT NULL AND p.doc_canon LIKE '%'||canon||'%')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY (b.situacao = 'ativo') DESC, b.display_name)
                       FROM (SELECT * FROM base ORDER BY (situacao = 'ativo') DESC, display_name LIMIT greatest(coalesce(_limit,40),1)) b), '[]'::jsonb))
  INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.kit_entrada_abrir(_consultora uuid, _location uuid, _referencia text, _nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := public.kit_entrada_exigir(); papel record; loc record; e public.kit_entradas; nome text;
BEGIN
  IF _consultora IS NULL THEN RAISE EXCEPTION 'Escolha a consultora desta maleta.'; END IF;
  IF nullif(btrim(coalesce(_referencia,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a referência da entrada (ex.: número da maleta ou data).';
  END IF;
  SELECT * INTO loc FROM public.locations WHERE id = _location;
  IF loc.id IS NULL OR NOT loc.is_active THEN RAISE EXCEPTION 'Local de entrada inexistente ou inativo.'; END IF;
  IF loc.is_blocked THEN RAISE EXCEPTION 'Local bloqueado não recebe entrada de maleta.'; END IF;
  IF loc.kind NOT IN ('deposito','loja') THEN RAISE EXCEPTION 'A entrada de maleta vai para um depósito ou loja.'; END IF;

  SELECT pr.* INTO papel FROM public.party_roles pr
    WHERE pr.party_id = _consultora AND pr.role = 'consultora' FOR UPDATE;
  IF papel.id IS NULL THEN RAISE EXCEPTION 'Esta pessoa não está cadastrada como consultora.'; END IF;
  SELECT display_name INTO nome FROM public.parties WHERE id = _consultora;

  INSERT INTO public.kit_entradas (consultora_party_id, location_id, referencia, nota, consultora_status_anterior, consultora_ativada, created_by)
  VALUES (_consultora, _location, btrim(_referencia), nullif(btrim(coalesce(_nota,'')), ''), papel.status::text, papel.status <> 'ativo', uid)
  RETURNING * INTO e;

  IF papel.status <> 'ativo' THEN
    UPDATE public.party_roles SET status = 'ativo', ended_at = NULL,
      started_at = coalesce(started_at, current_date), updated_at = now()
    WHERE id = papel.id;
  END IF;
  UPDATE public.parties SET status = 'ativo', is_active = true, updated_at = now(), updated_by = uid
    WHERE id = _consultora AND (status <> 'ativo' OR NOT is_active);

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'kit.entrada.abrir', 'kit_entradas', e.id::text,
    jsonb_build_object('codigo', e.code, 'consultora', _consultora, 'local', _location, 'referencia', e.referencia));
  IF papel.status <> 'ativo' THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (uid, 'consultora.ativada', 'parties', _consultora::text,
      jsonb_build_object('status_anterior', papel.status, 'motivo', 'entrada de maleta', 'entrada', e.code));
  END IF;

  RETURN jsonb_build_object('id', e.id, 'codigo', e.code, 'consultora', nome,
    'ativada', e.consultora_ativada, 'status_anterior', e.consultora_status_anterior);
END $$;

CREATE OR REPLACE FUNCTION public.kit_entrada_bipar(_entrada uuid, _codigo text, _chave text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := public.kit_entrada_exigir(); e public.kit_entradas; achado jsonb; it public.kit_entrada_itens;
  mov uuid; nome text; cod text := btrim(coalesce(_codigo,''));
BEGIN
  IF cod = '' THEN RAISE EXCEPTION 'Código vazio.'; END IF;
  IF nullif(btrim(coalesce(_chave,'')), '') IS NULL THEN RAISE EXCEPTION 'Leitura sem chave.'; END IF;
  SELECT * INTO e FROM public.kit_entradas WHERE id = _entrada FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Entrada não encontrada.'; END IF;

  SELECT * INTO it FROM public.kit_entrada_itens WHERE chave = _chave;
  IF it.id IS NOT NULL THEN
    IF it.entrada_id <> e.id OR it.codigo_lido <> cod THEN RAISE EXCEPTION 'Chave de leitura já usada em outra operação.'; END IF;
    SELECT concat_ws(' · ', p.name, v.label) INTO nome FROM public.product_variants v JOIN public.products p ON p.id = v.product_id WHERE v.id = it.variant_id;
    RETURN jsonb_build_object('item_id', it.id, 'peca', nome, 'total', e.total_pecas, 'repetida', true);
  END IF;

  IF e.status <> 'aberta' THEN RAISE EXCEPTION 'Esta entrada já foi encerrada.'; END IF;

  achado := public.barcode_lookup(cod);
  IF coalesce((achado->>'encontrado')::boolean, false) IS NOT TRUE OR achado->>'variant_id' IS NULL THEN
    RAISE EXCEPTION 'Código não cadastrado: %', cod;
  END IF;

  mov := public.register_stock_movement('entrada', (achado->>'variant_id')::uuid, 1, NULL, e.location_id,
    'retorno_maleta', NULL, e.code || ' · ' || e.referencia, 'Entrada de maleta (retorno da consultora)', 'kitent:' || _chave, NULL);

  INSERT INTO public.kit_entrada_itens (entrada_id, variant_id, codigo_lido, chave, stock_movement_id, created_by)
  VALUES (e.id, (achado->>'variant_id')::uuid, cod, _chave, mov, uid) RETURNING * INTO it;
  UPDATE public.kit_entradas SET total_pecas = total_pecas + 1, updated_at = now() WHERE id = e.id RETURNING * INTO e;

  RETURN jsonb_build_object('item_id', it.id,
    'peca', concat_ws(' · ', achado->>'produto', achado->>'variante'), 'total', e.total_pecas, 'repetida', false);
END $$;

CREATE OR REPLACE FUNCTION public.kit_entrada_desfazer(_item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := public.kit_entrada_exigir(); it public.kit_entrada_itens; e public.kit_entradas; mov uuid;
BEGIN
  SELECT * INTO it FROM public.kit_entrada_itens WHERE id = _item;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Leitura não encontrada.'; END IF;
  SELECT * INTO e FROM public.kit_entradas WHERE id = it.entrada_id FOR UPDATE;
  SELECT * INTO it FROM public.kit_entrada_itens WHERE id = _item FOR UPDATE;
  IF it.estornado_em IS NOT NULL THEN RETURN jsonb_build_object('total', e.total_pecas, 'repetida', true); END IF;
  IF e.status <> 'aberta' THEN RAISE EXCEPTION 'Entrada encerrada: não é possível desfazer leituras.'; END IF;

  mov := public.register_stock_movement('saida', it.variant_id, 1, e.location_id, NULL,
    'estorno_leitura', NULL, e.code || ' · ' || e.referencia, 'Estorno de leitura na entrada de maleta', 'kitent-estorno:' || it.id, NULL);
  UPDATE public.kit_entrada_itens SET estorno_movement_id = mov, estornado_em = now(), estornado_por = uid WHERE id = it.id;
  UPDATE public.kit_entradas SET total_pecas = total_pecas - 1, updated_at = now() WHERE id = e.id RETURNING * INTO e;
  RETURN jsonb_build_object('total', e.total_pecas, 'repetida', false);
END $$;

CREATE OR REPLACE FUNCTION public.kit_entrada_concluir(_entrada uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := public.kit_entrada_exigir(); e public.kit_entradas;
BEGIN
  SELECT * INTO e FROM public.kit_entradas WHERE id = _entrada FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Entrada não encontrada.'; END IF;
  IF e.status <> 'aberta' THEN RETURN jsonb_build_object('status', e.status, 'total', e.total_pecas, 'repetida', true); END IF;
  UPDATE public.kit_entradas
    SET status = CASE WHEN total_pecas = 0 THEN 'cancelada' ELSE 'concluida' END,
        concluded_at = now(), concluded_by = uid, updated_at = now()
  WHERE id = e.id RETURNING * INTO e;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'kit.entrada.' || e.status, 'kit_entradas', e.id::text, jsonb_build_object('codigo', e.code, 'total', e.total_pecas));
  RETURN jsonb_build_object('status', e.status, 'total', e.total_pecas, 'repetida', false);
END $$;

CREATE OR REPLACE FUNCTION public.kit_entradas_listar(_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.kit_entrada_exigir();
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.criada_em DESC) FROM (
    SELECT e.id, e.code AS codigo, e.status, e.total_pecas, e.referencia, e.consultora_ativada,
           e.consultora_status_anterior, e.created_at AS criada_em, e.concluded_at AS concluida_em,
           p.display_name AS consultora, l.name AS local, pr.display_name AS aberta_por
    FROM public.kit_entradas e
    JOIN public.parties p ON p.id = e.consultora_party_id
    JOIN public.locations l ON l.id = e.location_id
    LEFT JOIN public.profiles pf ON pf.id = e.created_by
    LEFT JOIN LATERAL (SELECT coalesce(pf.full_name, pf.email) AS display_name) pr ON true
    ORDER BY e.created_at DESC LIMIT greatest(coalesce(_limit,50),1)) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.kit_entrada_detalhe(_entrada uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.kit_entrada_exigir();
  SELECT jsonb_build_object(
    'id', e.id, 'codigo', e.code, 'status', e.status, 'total_pecas', e.total_pecas, 'referencia', e.referencia,
    'consultora', p.display_name, 'consultora_ativada', e.consultora_ativada,
    'consultora_status_anterior', e.consultora_status_anterior, 'local', l.name, 'criada_em', e.created_at,
    'leituras', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'codigo', i.codigo_lido,
        'peca', concat_ws(' · ', pp.name, v.label), 'quando', i.created_at, 'estornada', i.estornado_em IS NOT NULL)
        ORDER BY i.created_at DESC)
      FROM public.kit_entrada_itens i JOIN public.product_variants v ON v.id = i.variant_id
      JOIN public.products pp ON pp.id = v.product_id WHERE i.entrada_id = e.id), '[]'::jsonb))
  INTO r
  FROM public.kit_entradas e JOIN public.parties p ON p.id = e.consultora_party_id
  JOIN public.locations l ON l.id = e.location_id WHERE e.id = _entrada;
  IF r IS NULL THEN RAISE EXCEPTION 'Entrada não encontrada.'; END IF;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.kit_entrada_exigir() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_entrada_consultoras(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_entrada_abrir(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_entrada_bipar(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_entrada_desfazer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_entrada_concluir(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_entradas_listar(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kit_entrada_detalhe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_entrada_exigir(), public.kit_entrada_consultoras(text, integer),
  public.kit_entrada_abrir(uuid, uuid, text, text), public.kit_entrada_bipar(uuid, text, text),
  public.kit_entrada_desfazer(uuid), public.kit_entrada_concluir(uuid), public.kit_entradas_listar(integer),
  public.kit_entrada_detalhe(uuid) TO authenticated;
