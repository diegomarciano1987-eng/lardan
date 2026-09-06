-- ============ R1.1 capacidades exigem conta ativa ============
CREATE OR REPLACE FUNCTION public.has_capability(_user_id uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _user_id IS NOT NULL
     AND _user_id = auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.user_roles ur
       JOIN public.role_capabilities rc ON rc.role = ur.role
       JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.user_id = _user_id AND rc.capability = _cap AND p.is_active
     );
$$;

CREATE OR REPLACE FUNCTION public.my_capabilities()
RETURNS TABLE(capability text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT rc.capability
  FROM public.user_roles ur
  JOIN public.role_capabilities rc ON rc.role = ur.role
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id = auth.uid() AND p.is_active;
$$;

-- ============ R1.2 validação de documento no servidor ============
CREATE OR REPLACE FUNCTION public.doc_is_valid(_digits text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE d text; s int; i int; r int; w int;
BEGIN
  d := regexp_replace(coalesce(_digits,''), '\D', '', 'g');
  IF d = '' THEN RETURN true; END IF;
  IF length(d) = 11 THEN
    IF d ~ '^(\d)\1{10}$' THEN RETURN false; END IF;
    s := 0; FOR i IN 1..9 LOOP s := s + substr(d,i,1)::int * (11 - i); END LOOP;
    r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
    IF r <> substr(d,10,1)::int THEN RETURN false; END IF;
    s := 0; FOR i IN 1..10 LOOP s := s + substr(d,i,1)::int * (12 - i); END LOOP;
    r := (s * 10) % 11; IF r = 10 THEN r := 0; END IF;
    RETURN r = substr(d,11,1)::int;
  ELSIF length(d) = 14 THEN
    IF d ~ '^(\d)\1{13}$' THEN RETURN false; END IF;
    s := 0; w := 5;
    FOR i IN 1..12 LOOP s := s + substr(d,i,1)::int * w; w := CASE WHEN w = 2 THEN 9 ELSE w - 1 END; END LOOP;
    r := s % 11; r := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
    IF r <> substr(d,13,1)::int THEN RETURN false; END IF;
    s := 0; w := 6;
    FOR i IN 1..13 LOOP s := s + substr(d,i,1)::int * w; w := CASE WHEN w = 2 THEN 9 ELSE w - 1 END; END LOOP;
    r := s % 11; r := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
    RETURN r = substr(d,14,1)::int;
  END IF;
  RETURN false;
END $$;

ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS doc_masked text;

CREATE OR REPLACE FUNCTION public.parties_privacy_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.doc_digits := nullif(regexp_replace(coalesce(NEW.doc,''), '\D', '', 'g'), '');
  IF NEW.doc_digits IS NOT NULL AND NOT public.doc_is_valid(NEW.doc_digits) THEN
    RAISE EXCEPTION 'Documento inválido: os dígitos verificadores de CPF/CNPJ não conferem.';
  END IF;
  NEW.doc_masked := public.mask_doc(NEW.doc);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_parties_privacy_guard ON public.parties;
CREATE TRIGGER zz_parties_privacy_guard
BEFORE INSERT OR UPDATE ON public.parties
FOR EACH ROW EXECUTE FUNCTION public.parties_privacy_guard();

UPDATE public.parties SET doc_masked = public.mask_doc(doc) WHERE doc_masked IS NULL AND doc IS NOT NULL;

-- Colunas sensíveis saem da API para o papel comum
REVOKE SELECT ON public.parties FROM authenticated;
GRANT SELECT (id, kind, code, display_name, legal_name, social_name, doc_masked,
              doc_verified_at, birth_date, profession, marital_status, avatar_url,
              notes, status, is_active, created_by, updated_by, created_at, updated_at)
  ON public.parties TO authenticated;

REVOKE SELECT ON public.consultant_profiles FROM authenticated;
GRANT SELECT (party_id, origin, joined_at, representative_party_id, sponsor_party_id,
              region, wallet, level, goal_cents, cycle, sale_profile, experience,
              audience, availability, block_reason, created_at, updated_at)
  ON public.consultant_profiles TO authenticated;

-- Escrita de campos financeiros exige permissão financeira
CREATE OR REPLACE FUNCTION public.consultant_finance_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE mudou boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    mudou := NEW.pix_key IS NOT NULL OR NEW.pix_key_type IS NOT NULL OR NEW.pix_holder IS NOT NULL
          OR NEW.pix_holder_doc IS NOT NULL OR NEW.bank_info IS NOT NULL
          OR NEW.credit_limit_cents IS NOT NULL OR NEW.financial_status IS NOT NULL
          OR NEW.restricted_notes IS NOT NULL;
  ELSE
    mudou := NEW.pix_key IS DISTINCT FROM OLD.pix_key
          OR NEW.pix_key_type IS DISTINCT FROM OLD.pix_key_type
          OR NEW.pix_holder IS DISTINCT FROM OLD.pix_holder
          OR NEW.pix_holder_doc IS DISTINCT FROM OLD.pix_holder_doc
          OR NEW.bank_info IS DISTINCT FROM OLD.bank_info
          OR NEW.credit_limit_cents IS DISTINCT FROM OLD.credit_limit_cents
          OR NEW.financial_status IS DISTINCT FROM OLD.financial_status
          OR NEW.restricted_notes IS DISTINCT FROM OLD.restricted_notes;
  END IF;
  IF mudou AND NOT public.has_capability(auth.uid(), 'registry.finance.view') THEN
    RAISE EXCEPTION 'Sem permissão para alterar dados financeiros da consultora.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_consultant_finance_guard ON public.consultant_profiles;
CREATE TRIGGER zz_consultant_finance_guard
BEFORE INSERT OR UPDATE ON public.consultant_profiles
FOR EACH ROW EXECUTE FUNCTION public.consultant_finance_guard();

-- Listagem paginada no servidor, com documento mascarado por padrão
CREATE OR REPLACE FUNCTION public.list_parties(
  _search text DEFAULT NULL, _kind text DEFAULT NULL, _role text DEFAULT NULL,
  _status text DEFAULT NULL, _limit integer DEFAULT 20, _offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, kind party_kind, code text, display_name text, legal_name text,
  social_name text, doc text, birth_date date, status party_status,
  is_active boolean, created_at timestamptz, updated_at timestamptz, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ver_doc boolean; termo text; digitos text;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN
    RAISE EXCEPTION 'Sem permissão para consultar cadastros.';
  END IF;
  ver_doc := public.has_capability(auth.uid(), 'registry.doc.view');
  termo := nullif(trim(coalesce(_search,'')), '');
  digitos := nullif(regexp_replace(coalesce(termo,''), '\D', '', 'g'), '');

  RETURN QUERY
  WITH base AS (
    SELECT p.* FROM public.parties p
    WHERE (_kind IS NULL OR _kind = 'todos' OR p.kind::text = _kind)
      AND (_status IS NULL OR _status = 'todos' OR p.status::text = _status)
      AND (_role IS NULL OR _role = 'todos' OR EXISTS (
            SELECT 1 FROM public.party_roles pr
            WHERE pr.party_id = p.id AND pr.role::text = _role))
      AND (termo IS NULL OR p.display_name ILIKE '%'||termo||'%'
           OR p.legal_name ILIKE '%'||termo||'%'
           OR p.social_name ILIKE '%'||termo||'%'
           OR p.code ILIKE '%'||termo||'%'
           OR (digitos IS NOT NULL AND p.doc_digits LIKE '%'||digitos||'%'))
  ), contagem AS (SELECT count(*)::bigint AS n FROM base)
  SELECT b.id, b.kind, b.code, b.display_name, b.legal_name, b.social_name,
         CASE WHEN ver_doc THEN b.doc ELSE b.doc_masked END,
         b.birth_date, b.status, b.is_active, b.created_at, b.updated_at,
         (SELECT n FROM contagem)
  FROM base b
  ORDER BY b.updated_at DESC
  LIMIT greatest(coalesce(_limit,20),1) OFFSET greatest(coalesce(_offset,0),0);
END $$;

-- Ficha completa com camadas de permissão e auditoria de leitura sensível
CREATE OR REPLACE FUNCTION public.get_party_full(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ver_doc boolean; ver_fin boolean; p public.parties; resultado jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN
    RAISE EXCEPTION 'Sem permissão para consultar cadastros.';
  END IF;
  ver_doc := public.has_capability(auth.uid(), 'registry.doc.view');
  ver_fin := public.has_capability(auth.uid(), 'registry.finance.view');

  SELECT * INTO p FROM public.parties WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;

  resultado := jsonb_build_object(
    'party', jsonb_build_object(
      'id', p.id, 'kind', p.kind, 'code', p.code, 'display_name', p.display_name,
      'legal_name', p.legal_name, 'social_name', p.social_name,
      'doc', CASE WHEN ver_doc THEN p.doc ELSE p.doc_masked END,
      'doc_digits', CASE WHEN ver_doc THEN p.doc_digits ELSE NULL END,
      'doc_masked', p.doc_masked,
      'doc_visivel', ver_doc,
      'rg', CASE WHEN ver_doc THEN p.rg ELSE NULL END,
      'rg_issuer', CASE WHEN ver_doc THEN p.rg_issuer ELSE NULL END,
      'birth_date', p.birth_date, 'profession', p.profession,
      'marital_status', p.marital_status, 'notes', p.notes,
      'status', p.status, 'is_active', p.is_active,
      'created_at', p.created_at, 'updated_at', p.updated_at),
    'contatos', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.is_primary DESC)
                          FROM public.contact_points c WHERE c.party_id = _id), '[]'::jsonb),
    'enderecos', coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.party_addresses a WHERE a.party_id = _id), '[]'::jsonb),
    'papeis', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.party_roles r WHERE r.party_id = _id), '[]'::jsonb),
    'vinculos', coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM public.party_links v WHERE v.party_id = _id), '[]'::jsonb),
    'financeiro_visivel', ver_fin,
    'consultora', (
      SELECT CASE WHEN cp.party_id IS NULL THEN NULL ELSE
        CASE WHEN ver_fin THEN to_jsonb(cp)
        ELSE to_jsonb(cp) - 'pix_key' - 'pix_key_type' - 'pix_holder' - 'pix_holder_doc'
             - 'bank_info' - 'credit_limit_cents' - 'financial_status' - 'restricted_notes' END
      END FROM public.consultant_profiles cp WHERE cp.party_id = _id)
  );

  IF ver_doc OR ver_fin THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'leitura_sensivel', 'parties', _id::text,
            jsonb_build_object('documento', ver_doc, 'financeiro', ver_fin));
  END IF;

  RETURN resultado;
END $$;

-- Duplicidades sem expor documento
CREATE OR REPLACE FUNCTION public.find_party_duplicates(
  _doc text DEFAULT NULL, _contact text DEFAULT NULL, _ignore uuid DEFAULT NULL)
RETURNS TABLE(id uuid, code text, display_name text, legal_name text,
              doc_masked text, status party_status, motivo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d text; c text;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN
    RAISE EXCEPTION 'Sem permissão para consultar cadastros.';
  END IF;
  d := nullif(regexp_replace(coalesce(_doc,''), '\D', '', 'g'), '');
  c := nullif(trim(coalesce(_contact,'')), '');
  IF c IS NOT NULL THEN
    c := CASE WHEN position('@' in c) > 0 THEN lower(c) ELSE regexp_replace(c, '\D', '', 'g') END;
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.id, p.code, p.display_name, p.legal_name, p.doc_masked, p.status,
         CASE WHEN d IS NOT NULL AND p.doc_digits = d THEN 'documento' ELSE 'contato' END
  FROM public.parties p
  LEFT JOIN public.contact_points cp ON cp.party_id = p.id
  WHERE (_ignore IS NULL OR p.id <> _ignore)
    AND ((d IS NOT NULL AND p.doc_digits = d) OR (c IS NOT NULL AND cp.value_norm = c))
  LIMIT 20;
END $$;

GRANT EXECUTE ON FUNCTION public.list_parties(text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_party_full(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_party_duplicates(text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.doc_is_valid(text) TO authenticated;

-- ============ R1.3 fonte única contínua ============
CREATE OR REPLACE FUNCTION public.ensure_supplier_party()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pid uuid;
BEGIN
  IF NEW.party_id IS NULL THEN
    INSERT INTO public.parties (kind, display_name, legal_name, doc, status, created_by)
    VALUES ('organizacao', coalesce(NEW.trade_name, NEW.name), NEW.name, NEW.tax_id, 'ativo', auth.uid())
    RETURNING id INTO pid;
    NEW.party_id := pid;
    INSERT INTO public.party_roles (party_id, role, status) VALUES (pid, 'fornecedor', 'ativo')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_suppliers_party ON public.suppliers;
CREATE TRIGGER zz_suppliers_party BEFORE INSERT ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.ensure_supplier_party();

CREATE OR REPLACE FUNCTION public.ensure_entity_party()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pid uuid;
BEGIN
  IF NEW.party_id IS NULL THEN
    INSERT INTO public.parties (kind, display_name, legal_name, doc, status, created_by)
    VALUES ('organizacao', coalesce(NEW.trade_name, NEW.legal_name), NEW.legal_name, NEW.tax_id, 'ativo', auth.uid())
    RETURNING id INTO pid;
    NEW.party_id := pid;
    INSERT INTO public.party_roles (party_id, role, status) VALUES (pid, 'entidade_grupo', 'ativo')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_entities_party ON public.business_entities;
CREATE TRIGGER zz_entities_party BEFORE INSERT ON public.business_entities
FOR EACH ROW EXECUTE FUNCTION public.ensure_entity_party();

CREATE OR REPLACE FUNCTION public.ensure_profile_party()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pid uuid;
BEGIN
  IF NEW.party_id IS NULL THEN
    INSERT INTO public.parties (kind, display_name, status, created_by)
    VALUES ('pessoa', coalesce(NEW.display_name, NEW.full_name, NEW.email), 'ativo', NEW.id)
    RETURNING id INTO pid;
    NEW.party_id := pid;
    INSERT INTO public.party_roles (party_id, role, status) VALUES (pid, 'usuario', 'ativo')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_profiles_party ON public.profiles;
CREATE TRIGGER zz_profiles_party BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_profile_party();

-- ============ R1.4 estoque correto ============
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_quantity_check;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_quantity_check
  CHECK ((kind = 'inventario' AND quantity >= 0) OR (kind = 'ajuste' AND quantity <> 0) OR (kind NOT IN ('inventario','ajuste') AND quantity > 0));

ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_idempotency_key_uidx
  ON public.stock_movements (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.register_stock_movement(
  _kind stock_move_kind, _variant_id uuid, _quantity integer,
  _from_location_id uuid DEFAULT NULL, _to_location_id uuid DEFAULT NULL,
  _reason_code text DEFAULT NULL, _unit_cost_cents integer DEFAULT NULL,
  _reference text DEFAULT NULL, _note text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); saldo integer; mov uuid; atual integer;
        a uuid; b uuid; motivo_ok boolean;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid, 'stock.operate') THEN
    RAISE EXCEPTION 'Sem permissão para movimentar estoque.';
  END IF;
  IF _kind IN ('ajuste','inventario') AND NOT public.has_capability(uid, 'stock.adjust') THEN
    RAISE EXCEPTION 'Sem permissão para ajustar estoque.';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO mov FROM public.stock_movements WHERE idempotency_key = _idempotency_key;
    IF mov IS NOT NULL THEN RETURN mov; END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = _variant_id AND is_active) THEN
    RAISE EXCEPTION 'Peça inexistente ou inativa.';
  END IF;
  IF _from_location_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.locations WHERE id = _from_location_id AND is_active) THEN
    RAISE EXCEPTION 'Local de origem inexistente ou inativo.';
  END IF;
  IF _to_location_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.locations WHERE id = _to_location_id AND is_active) THEN
    RAISE EXCEPTION 'Local de destino inexistente ou inativo.';
  END IF;

  IF _kind IN ('ajuste','inventario','saida') THEN
    IF nullif(trim(coalesce(_reason_code,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Informe o motivo desta operação.';
    END IF;
    SELECT true INTO motivo_ok FROM public.stock_reasons
      WHERE code = _reason_code AND is_active AND kind = _kind LIMIT 1;
    IF motivo_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'Motivo inválido para este tipo de movimentação.';
    END IF;
  END IF;

  IF _quantity IS NULL THEN RAISE EXCEPTION 'Informe a quantidade.'; END IF;
  IF _kind = 'inventario' AND _quantity < 0 THEN
    RAISE EXCEPTION 'A contagem de inventário não pode ser negativa.';
  END IF;
  IF _kind = 'ajuste' AND _quantity = 0 THEN
    RAISE EXCEPTION 'O ajuste precisa ser diferente de zero.';
  END IF;
  IF _kind NOT IN ('inventario','ajuste') AND _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;

  -- trava determinística por local, evitando impasse entre operações simultâneas
  a := least(coalesce(_from_location_id, _to_location_id), coalesce(_to_location_id, _from_location_id));
  b := greatest(coalesce(_from_location_id, _to_location_id), coalesce(_to_location_id, _from_location_id));
  PERFORM pg_advisory_xact_lock(hashtextextended(_variant_id::text || a::text, 0));
  IF b IS DISTINCT FROM a THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_variant_id::text || b::text, 0));
  END IF;

  IF _kind = 'entrada' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local de destino.'; END IF;
    saldo := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
  ELSIF _kind = 'saida' THEN
    IF _from_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local de origem.'; END IF;
    saldo := public.apply_stock_delta(_variant_id, _from_location_id, -_quantity);
  ELSIF _kind = 'transferencia' THEN
    IF _from_location_id IS NULL OR _to_location_id IS NULL THEN
      RAISE EXCEPTION 'Informe origem e destino.';
    END IF;
    IF _from_location_id = _to_location_id THEN
      RAISE EXCEPTION 'Origem e destino devem ser diferentes.';
    END IF;
    PERFORM public.apply_stock_delta(_variant_id, _from_location_id, -_quantity);
    saldo := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
  ELSIF _kind = 'ajuste' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local.'; END IF;
    saldo := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
  ELSIF _kind = 'inventario' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local.'; END IF;
    SELECT COALESCE(quantity,0) INTO atual FROM public.stock_balances
      WHERE variant_id = _variant_id AND location_id = _to_location_id;
    saldo := public.apply_stock_delta(_variant_id, _to_location_id, _quantity - COALESCE(atual,0));
  END IF;

  INSERT INTO public.stock_movements (
    kind, variant_id, from_location_id, to_location_id, quantity,
    unit_cost_cents, reason_code, reference, note, balance_after, created_by, idempotency_key
  ) VALUES (
    _kind, _variant_id, _from_location_id, _to_location_id, _quantity,
    _unit_cost_cents, _reason_code, _reference, _note, saldo, uid, _idempotency_key
  ) RETURNING id INTO mov;

  RETURN mov;
END $$;

GRANT EXECUTE ON FUNCTION public.register_stock_movement(stock_move_kind,uuid,integer,uuid,uuid,text,integer,text,text,text) TO authenticated;

-- motivos mínimos para as operações que agora exigem motivo
INSERT INTO public.stock_reasons (code, label, kind, requires_adjust, is_active) VALUES
  ('venda', 'Venda', 'saida', false, true),
  ('perda', 'Perda', 'saida', true, true),
  ('avaria', 'Avaria', 'saida', true, true),
  ('ajuste_positivo', 'Ajuste positivo', 'ajuste', true, true),
  ('ajuste_negativo', 'Ajuste negativo', 'ajuste', true, true),
  ('contagem', 'Contagem de inventário', 'inventario', true, true)
ON CONFLICT (code) DO NOTHING;

-- ============ R3.1 bloqueadores imediatos da importação ============
CREATE OR REPLACE FUNCTION public.import_products_stock(
  _rows jsonb, _location_id uuid, _mode text DEFAULT 'entrada', _job_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _row jsonb; _nome text; _sku text; _barcode text; _legacy text;
  _categoria text; _colecao text; _cor text; _tamanho text;
  _qty integer; _custo integer; _preco integer;
  _category_id uuid; _collection_id uuid; _product_id uuid; _variant_id uuid;
  _slug text; _created_products integer := 0; _created_variants integer := 0;
  _updated_variants integer := 0; _units integer := 0; _skipped integer := 0;
  _errors jsonb := '[]'::jsonb; _line integer := 0; _key text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(), 'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar planilhas.';
  END IF;
  IF _mode NOT IN ('catalogo','entrada') THEN
    RAISE EXCEPTION 'Modo de importação inválido.';
  END IF;
  IF _mode = 'entrada' THEN
    IF NOT public.has_capability(auth.uid(), 'stock.operate') THEN
      RAISE EXCEPTION 'Sem permissão para lançar estoque.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = _location_id AND is_active) THEN
      RAISE EXCEPTION 'Local de estoque inválido ou inativo.';
    END IF;
  END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'Formato de linhas inválido.';
  END IF;

  FOR _row IN SELECT * FROM jsonb_array_elements(_rows)
  LOOP
    _line := _line + 1;
    BEGIN
      _nome := nullif(trim(coalesce(_row->>'nome','')), '');
      _sku := nullif(trim(coalesce(_row->>'sku','')), '');
      _barcode := nullif(trim(coalesce(_row->>'codigo_barras','')), '');
      _legacy := nullif(trim(coalesce(_row->>'codigo_legado','')), '');
      _categoria := nullif(trim(coalesce(_row->>'categoria','')), '');
      _colecao := nullif(trim(coalesce(_row->>'colecao','')), '');
      _cor := nullif(trim(coalesce(_row->>'cor','')), '');
      _tamanho := nullif(trim(coalesce(_row->>'tamanho','')), '');
      _qty := greatest(coalesce(nullif(_row->>'quantidade','')::integer, 0), 0);
      _custo := nullif(_row->>'custo_cents','')::integer;
      _preco := nullif(_row->>'preco_cents','')::integer;

      IF _nome IS NULL THEN RAISE EXCEPTION 'Nome do produto vazio'; END IF;
      IF _sku IS NULL AND _barcode IS NULL AND _legacy IS NULL THEN
        RAISE EXCEPTION 'Linha sem chave: informe SKU, código de barras ou código legado';
      END IF;

      _category_id := NULL;
      IF _categoria IS NOT NULL THEN
        SELECT id INTO _category_id FROM public.categories WHERE lower(name) = lower(_categoria) LIMIT 1;
        IF _category_id IS NULL THEN
          _slug := lower(regexp_replace(_categoria, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text,1,6);
          INSERT INTO public.categories (name, slug, status, created_by)
          VALUES (_categoria, _slug, 'rascunho', auth.uid()) RETURNING id INTO _category_id;
        END IF;
      END IF;

      _collection_id := NULL;
      IF _colecao IS NOT NULL THEN
        SELECT id INTO _collection_id FROM public.collections WHERE lower(name) = lower(_colecao) LIMIT 1;
        IF _collection_id IS NULL THEN
          _slug := lower(regexp_replace(_colecao, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text,1,6);
          INSERT INTO public.collections (name, slug, status, created_by)
          VALUES (_colecao, _slug, 'rascunho', auth.uid()) RETURNING id INTO _collection_id;
        END IF;
      END IF;

      -- chave explícita: SKU, código legado ou código de barras. Nunca só o nome.
      _variant_id := NULL;
      IF _sku IS NOT NULL THEN
        SELECT id INTO _variant_id FROM public.product_variants WHERE lower(sku) = lower(_sku) LIMIT 1;
      END IF;
      IF _variant_id IS NULL AND _legacy IS NOT NULL THEN
        SELECT id INTO _variant_id FROM public.product_variants WHERE lower(legacy_code) = lower(_legacy) LIMIT 1;
      END IF;
      IF _variant_id IS NULL AND _barcode IS NOT NULL THEN
        SELECT id INTO _variant_id FROM public.product_variants WHERE barcode = _barcode LIMIT 1;
      END IF;

      IF _variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET barcode = coalesce(product_variants.barcode, _barcode),
            legacy_code = coalesce(product_variants.legacy_code, _legacy),
            sku = coalesce(product_variants.sku, _sku),
            price_cents = coalesce(_preco, product_variants.price_cents),
            updated_at = now()
        WHERE id = _variant_id;
        _updated_variants := _updated_variants + 1;
      ELSE
        _slug := lower(regexp_replace(_nome, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text,1,6);
        INSERT INTO public.products (name, slug, status, category_id, collection_id, price_cents, legacy_code, created_by)
        VALUES (_nome, _slug, 'rascunho', _category_id, _collection_id, _preco, _legacy, auth.uid())
        RETURNING id INTO _product_id;
        _created_products := _created_products + 1;

        -- o gatilho já criou a variante padrão: aproveitar em vez de conflitar
        SELECT id INTO _variant_id FROM public.product_variants
          WHERE product_id = _product_id AND is_default LIMIT 1;

        IF _variant_id IS NULL THEN
          INSERT INTO public.product_variants (product_id, label, sku, barcode, legacy_code, color, size, price_cents, is_default)
          VALUES (_product_id, coalesce(nullif(concat_ws(' / ', _cor, _tamanho),''), 'Padrão'),
                  _sku, _barcode, _legacy, _cor, _tamanho, _preco, true)
          RETURNING id INTO _variant_id;
        ELSE
          UPDATE public.product_variants
          SET label = coalesce(nullif(concat_ws(' / ', _cor, _tamanho),''), 'Padrão'),
              sku = _sku, barcode = _barcode, legacy_code = _legacy,
              color = _cor, size = _tamanho, price_cents = _preco, updated_at = now()
          WHERE id = _variant_id;
        END IF;
        _created_variants := _created_variants + 1;
      END IF;

      IF _mode = 'entrada' AND _qty > 0 THEN
        _key := CASE WHEN _job_key IS NULL THEN NULL
                     ELSE _job_key || ':' || _line::text || ':entrada' END;
        PERFORM public.register_stock_movement(
          'entrada', _variant_id, _qty, NULL, _location_id, NULL, _custo,
          coalesce(_job_key,'importacao'), 'Importação em massa via planilha', _key);
        _units := _units + _qty;
      ELSIF _mode = 'catalogo' THEN
        _skipped := _skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _errors := _errors || jsonb_build_object('linha', _line, 'erro', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'produtos_criados', _created_products,
    'variantes_criadas', _created_variants,
    'variantes_atualizadas', _updated_variants,
    'unidades_entradas', _units,
    'linhas_sem_estoque', _skipped,
    'erros', _errors);
END $$;

REVOKE ALL ON FUNCTION public.import_products_stock(jsonb,uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.import_products_stock(jsonb,uuid,text,text) TO authenticated;