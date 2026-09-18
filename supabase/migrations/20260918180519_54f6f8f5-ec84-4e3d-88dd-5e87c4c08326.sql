-- 1) Códigos de barras reais da operação podem ter menos de 4 caracteres
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_barcode_ck;
ALTER TABLE public.products ADD CONSTRAINT products_barcode_ck
  CHECK (barcode IS NULL OR barcode ~ '^[0-9A-Za-z._-]{1,60}$');

-- 2) Área de recebimento da planilha
CREATE TABLE IF NOT EXISTS public.product_import_stage (
  lote text NOT NULL,
  linha integer NOT NULL,
  barcode text,
  referencia text,
  nome text,
  custo_cents integer,
  venda_cents integer,
  ncm text,
  product_id uuid,
  variant_id uuid,
  status text NOT NULL DEFAULT 'pendente',
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lote, linha)
);
GRANT ALL ON public.product_import_stage TO service_role;
ALTER TABLE public.product_import_stage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import stage service only" ON public.product_import_stage
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS product_import_stage_status_idx
  ON public.product_import_stage (lote, status);

-- 3) Endereço de página a partir do nome
CREATE OR REPLACE FUNCTION public.product_import_slug(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  select nullif(
    trim(both '-' from regexp_replace(
      lower(translate(coalesce(_t,''),
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
      '[^a-z0-9]+', '-', 'g')), '');
$$;

-- 4) Rotina de importação
CREATE OR REPLACE FUNCTION public.product_import_apply(_lote text, _limite integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _g record; _r record;
  _pid uuid; _vid uuid;
  _slug text; _base text; _n integer;
  _label text; _pos integer;
  _criados integer := 0; _variantes integer := 0; _erros integer := 0;
  _ref text; _refkey text;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Importação restrita ao processo interno.' USING ERRCODE = '42501';
  END IF;

  FOR _g IN
    SELECT coalesce(nullif(upper(btrim(s.referencia)), ''), 'BARRAS:' || s.barcode) AS chave
      FROM public.product_import_stage s
     WHERE s.lote = _lote AND s.status = 'pendente'
     GROUP BY 1
     ORDER BY min(s.linha)
     LIMIT _limite
  LOOP
    BEGIN
      _pid := NULL; _pos := 0;

      SELECT * INTO _r FROM public.product_import_stage s
       WHERE s.lote = _lote
         AND coalesce(nullif(upper(btrim(s.referencia)), ''), 'BARRAS:' || s.barcode) = _g.chave
       ORDER BY s.linha LIMIT 1;

      _ref := nullif(btrim(coalesce(_r.referencia, '')), '');
      _refkey := upper(coalesce(_ref, ''));

      IF _ref IS NOT NULL THEN
        SELECT p.id INTO _pid FROM public.products p
         WHERE upper(p.reference_code) = _refkey LIMIT 1;
      END IF;
      IF _pid IS NULL THEN
        SELECT v.product_id INTO _pid FROM public.product_variants v
         WHERE v.barcode = _r.barcode LIMIT 1;
      END IF;

      IF _pid IS NULL THEN
        _base := coalesce(public.product_import_slug(_r.nome), 'peca');
        IF _ref IS NOT NULL THEN
          _slug := left(_base, 60) || '-' || public.product_import_slug(_ref);
        ELSE
          _slug := left(_base, 60) || '-' || _r.barcode;
        END IF;
        _n := 1;
        WHILE EXISTS (SELECT 1 FROM public.products p WHERE p.slug = _slug) LOOP
          _n := _n + 1;
          _slug := left(_base, 55) || '-' || _n::text || '-' || coalesce(public.product_import_slug(_ref), _r.barcode);
        END LOOP;

        INSERT INTO public.products (
          slug, name, status, reference_code, ncm, price_cents,
          cost_price_cents, markup_percent, price_is_public, position
        ) VALUES (
          _slug, _r.nome, 'rascunho', _ref, _r.ncm, _r.venda_cents,
          nullif(_r.custo_cents, 0),
          CASE WHEN coalesce(_r.custo_cents, 0) > 0 AND coalesce(_r.venda_cents, 0) > 0
               THEN round(((_r.venda_cents - _r.custo_cents)::numeric / _r.custo_cents) * 100, 2) END,
          false, 0
        ) RETURNING id INTO _pid;

        DELETE FROM public.product_variants WHERE product_id = _pid AND label = 'Padrão';
        _criados := _criados + 1;
      ELSE
        SELECT coalesce(max(v.position), -1) + 1 INTO _pos
          FROM public.product_variants v WHERE v.product_id = _pid;
      END IF;

      FOR _r IN
        SELECT * FROM public.product_import_stage s
         WHERE s.lote = _lote AND s.status = 'pendente'
           AND coalesce(nullif(upper(btrim(s.referencia)), ''), 'BARRAS:' || s.barcode) = _g.chave
         ORDER BY s.linha
      LOOP
        IF EXISTS (SELECT 1 FROM public.product_variants v WHERE v.barcode = _r.barcode) THEN
          SELECT v.id INTO _vid FROM public.product_variants v WHERE v.barcode = _r.barcode;
        ELSE
          _label := left(coalesce(nullif(btrim(_r.nome), ''), 'Peça'), 90);
          IF EXISTS (SELECT 1 FROM public.product_variants v
                      WHERE v.product_id = _pid AND v.label = _label) THEN
            _label := _label || ' · ' || _r.barcode;
          END IF;

          INSERT INTO public.product_variants (
            product_id, label, barcode, price_cents, position, is_default, is_active
          ) VALUES (
            _pid, _label, _r.barcode, _r.venda_cents, _pos,
            NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = _pid AND v.is_default),
            true
          ) RETURNING id INTO _vid;
          _pos := _pos + 1;
          _variantes := _variantes + 1;

          IF coalesce(_r.custo_cents, 0) > 0 THEN
            INSERT INTO public.variant_costs (variant_id, cost_cents, note)
            VALUES (_vid, _r.custo_cents, 'Importação da planilha de produtos ' || _lote);
          END IF;
        END IF;

        UPDATE public.product_import_stage
           SET status = 'ok', product_id = _pid, variant_id = _vid, erro = NULL, updated_at = now()
         WHERE lote = _lote AND linha = _r.linha;
      END LOOP;

    EXCEPTION WHEN OTHERS THEN
      _erros := _erros + 1;
      UPDATE public.product_import_stage
         SET status = 'erro', erro = SQLERRM, updated_at = now()
       WHERE lote = _lote AND status = 'pendente'
         AND coalesce(nullif(upper(btrim(referencia)), ''), 'BARRAS:' || barcode) = _g.chave;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'produtos_criados', _criados,
    'variantes_criadas', _variantes,
    'grupos_com_erro', _erros,
    'pendentes', (SELECT count(*) FROM public.product_import_stage WHERE lote = _lote AND status = 'pendente')
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.product_import_apply(text, integer) FROM PUBLIC, anon, authenticated;

-- 5) Valor nas ruas: soma do preço de venda de todas as peças cadastradas
CREATE OR REPLACE FUNCTION public.catalog_street_value()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select jsonb_build_object(
    'total_cents', coalesce(sum(coalesce(v.price_cents, p.price_cents, 0)), 0),
    'pecas', count(*),
    'custo_cents', coalesce(sum(coalesce(p.cost_price_cents, 0)), 0)
  )
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.is_active and p.status <> 'arquivado';
$$;
REVOKE EXECUTE ON FUNCTION public.catalog_street_value() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_street_value() TO authenticated;