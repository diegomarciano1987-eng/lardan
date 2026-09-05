CREATE OR REPLACE FUNCTION public.import_products_stock(_rows jsonb, _location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row jsonb;
  _nome text;
  _sku text;
  _barcode text;
  _categoria text;
  _colecao text;
  _cor text;
  _tamanho text;
  _qty integer;
  _custo integer;
  _preco integer;
  _category_id uuid;
  _collection_id uuid;
  _product_id uuid;
  _variant_id uuid;
  _balance integer;
  _slug text;
  _created_products integer := 0;
  _created_variants integer := 0;
  _updated_variants integer := 0;
  _units integer := 0;
  _errors jsonb := '[]'::jsonb;
  _line integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(), 'stock.operate') THEN
    RAISE EXCEPTION 'Sem permissão para importar produtos no estoque.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = _location_id AND is_active) THEN
    RAISE EXCEPTION 'Local de estoque inválido ou inativo.';
  END IF;

  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'Formato de linhas inválido.';
  END IF;

  FOR _row IN SELECT * FROM jsonb_array_elements(_rows)
  LOOP
    _line := _line + 1;
    BEGIN
      _nome := nullif(trim(coalesce(_row->>'nome', '')), '');
      _sku := nullif(trim(coalesce(_row->>'sku', '')), '');
      _barcode := nullif(trim(coalesce(_row->>'codigo_barras', '')), '');
      _categoria := nullif(trim(coalesce(_row->>'categoria', '')), '');
      _colecao := nullif(trim(coalesce(_row->>'colecao', '')), '');
      _cor := nullif(trim(coalesce(_row->>'cor', '')), '');
      _tamanho := nullif(trim(coalesce(_row->>'tamanho', '')), '');
      _qty := greatest(coalesce(nullif(_row->>'quantidade', '')::integer, 0), 0);
      _custo := nullif(_row->>'custo_cents', '')::integer;
      _preco := nullif(_row->>'preco_cents', '')::integer;

      IF _nome IS NULL THEN
        RAISE EXCEPTION 'Nome do produto vazio';
      END IF;

      -- Categoria: encontra pelo nome ou cria
      _category_id := NULL;
      IF _categoria IS NOT NULL THEN
        SELECT id INTO _category_id FROM public.categories WHERE lower(name) = lower(_categoria) LIMIT 1;
        IF _category_id IS NULL THEN
          _slug := lower(regexp_replace(_categoria, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 6);
          INSERT INTO public.categories (name, slug, status, created_by)
          VALUES (_categoria, _slug, 'rascunho', auth.uid())
          RETURNING id INTO _category_id;
        END IF;
      END IF;

      -- Coleção: encontra pelo nome ou cria
      _collection_id := NULL;
      IF _colecao IS NOT NULL THEN
        SELECT id INTO _collection_id FROM public.collections WHERE lower(name) = lower(_colecao) LIMIT 1;
        IF _collection_id IS NULL THEN
          _slug := lower(regexp_replace(_colecao, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 6);
          INSERT INTO public.collections (name, slug, status, created_by)
          VALUES (_colecao, _slug, 'rascunho', auth.uid())
          RETURNING id INTO _collection_id;
        END IF;
      END IF;

      -- Variação existente: por SKU, senão por código de barras
      _variant_id := NULL;
      IF _sku IS NOT NULL THEN
        SELECT id INTO _variant_id FROM public.product_variants WHERE lower(sku) = lower(_sku) LIMIT 1;
      END IF;
      IF _variant_id IS NULL AND _barcode IS NOT NULL THEN
        SELECT id INTO _variant_id FROM public.product_variants WHERE barcode = _barcode LIMIT 1;
      END IF;

      IF _variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET barcode = coalesce(product_variants.barcode, _barcode),
            price_cents = coalesce(_preco, product_variants.price_cents),
            updated_at = now()
        WHERE id = _variant_id;
        _updated_variants := _updated_variants + 1;
      ELSE
        -- Produto: encontra pelo nome ou cria
        SELECT id INTO _product_id FROM public.products WHERE lower(name) = lower(_nome) LIMIT 1;
        IF _product_id IS NULL THEN
          _slug := lower(regexp_replace(_nome, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 6);
          INSERT INTO public.products (name, slug, status, category_id, collection_id, price_cents, created_by)
          VALUES (_nome, _slug, 'rascunho', _category_id, _collection_id, _preco, auth.uid())
          RETURNING id INTO _product_id;
          _created_products := _created_products + 1;
        ELSE
          UPDATE public.products
          SET category_id = coalesce(products.category_id, _category_id),
              collection_id = coalesce(products.collection_id, _collection_id),
              price_cents = coalesce(_preco, products.price_cents),
              updated_at = now()
          WHERE id = _product_id;
        END IF;

        INSERT INTO public.product_variants (product_id, label, sku, barcode, color, size, price_cents, is_default)
        VALUES (
          _product_id,
          coalesce(nullif(concat_ws(' / ', _cor, _tamanho), ''), 'Padrão'),
          _sku, _barcode, _cor, _tamanho, _preco, true
        )
        RETURNING id INTO _variant_id;
        _created_variants := _created_variants + 1;
      END IF;

      -- Entrada de estoque com razão permanente
      IF _qty > 0 THEN
        _balance := public.apply_stock_delta(_variant_id, _location_id, _qty);
        INSERT INTO public.stock_movements
          (kind, variant_id, quantity, to_location_id, reason_code, unit_cost_cents, reference, note, balance_after, created_by)
        VALUES
          ('entrada', _variant_id, _qty, _location_id, 'compra', _custo, 'importacao', 'Importação em massa via planilha', _balance, auth.uid());
        _units := _units + _qty;
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
    'erros', _errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_products_stock(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_products_stock(jsonb, uuid) TO authenticated, service_role;