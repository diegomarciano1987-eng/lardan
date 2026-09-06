-- =========================================================
-- LARDAN Cloud — Importação industrial (pipeline persistente)
-- Arquivo -> Job -> Mapeamento -> Validação -> Staging -> Lotes -> Resultado
-- =========================================================

-- ---------- Leitura de números/dinheiro ----------
CREATE OR REPLACE FUNCTION public.parse_decimal_any(_v text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; lastc int; lastp int;
BEGIN
  IF _v IS NULL THEN RETURN NULL; END IF;
  s := trim(_v);
  IF s = '' THEN RETURN NULL; END IF;
  s := regexp_replace(s, '[^0-9,\.\-]', '', 'g');
  IF s IN ('', '-') THEN RETURN NULL; END IF;
  lastc := length(s) - length(regexp_replace(reverse(s), '^([^,]*),.*$', '\1')) ;
  lastc := position(',' in reverse(s));
  lastp := position('.' in reverse(s));
  IF lastc > 0 AND lastp > 0 THEN
    IF lastc < lastp THEN            -- vírgula é o decimal: 1.234,56
      s := replace(replace(s, '.', ''), ',', '.');
    ELSE                             -- ponto é o decimal: 1,234.56
      s := replace(s, ',', '');
    END IF;
  ELSIF lastc > 0 THEN
    IF lastc - 1 <= 2 THEN s := replace(s, ',', '.');   -- 12,90
    ELSE s := replace(s, ',', ''); END IF;              -- 1,234
  END IF;
  BEGIN RETURN s::numeric; EXCEPTION WHEN others THEN RETURN NULL; END;
END $$;

CREATE OR REPLACE FUNCTION public.parse_cents_any(_v text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN public.parse_decimal_any(_v) IS NULL THEN NULL
              ELSE round(public.parse_decimal_any(_v) * 100)::int END
$$;

-- código: preserva zeros à esquerda, remove espaços, nunca vira número
CREATE OR REPLACE FUNCTION public.norm_code(_v text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(coalesce(_v,''), '\s+', '', 'g'), '')
$$;

-- ---------- Modelos de importação ----------
CREATE TABLE public.import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_templates TO authenticated;
GRANT ALL ON public.import_templates TO service_role;
ALTER TABLE public.import_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipe ve modelos" ON public.import_templates FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "importadores gerem modelos" ON public.import_templates FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'imports.run'))
  WITH CHECK (public.has_capability(auth.uid(),'imports.run'));
CREATE TRIGGER import_templates_updated BEFORE UPDATE ON public.import_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Lotes ----------
CREATE TABLE public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL,
  file_name text NOT NULL,
  file_size integer,
  mode text NOT NULL DEFAULT 'catalogo',        -- catalogo | entrada
  status text NOT NULL DEFAULT 'rascunho',      -- rascunho|validando|pronto|processando|pausado|concluido|cancelado|erro
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  dry_run boolean NOT NULL DEFAULT false,
  location_id uuid REFERENCES public.locations(id),
  operation_date date,
  reason_code text,
  reference text,
  responsible_user_id uuid REFERENCES auth.users(id),
  total_rows integer NOT NULL DEFAULT 0,
  processed_rows integer NOT NULL DEFAULT 0,
  ok_rows integer NOT NULL DEFAULT 0,
  warn_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  products_created integer NOT NULL DEFAULT 0,
  products_updated integer NOT NULL DEFAULT 0,
  variants_created integer NOT NULL DEFAULT 0,
  variants_updated integer NOT NULL DEFAULT 0,
  stock_entries integer NOT NULL DEFAULT 0,
  units_in integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_jobs_mode_ck CHECK (mode IN ('catalogo','entrada'))
);
CREATE UNIQUE INDEX import_jobs_key_uidx ON public.import_jobs (job_key);
CREATE INDEX import_jobs_created_idx ON public.import_jobs (created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.import_jobs TO authenticated;
GRANT ALL ON public.import_jobs TO service_role;
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipe ve lotes" ON public.import_jobs FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "importadores criam lotes" ON public.import_jobs FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(auth.uid(),'imports.run'));
CREATE POLICY "importadores editam lotes" ON public.import_jobs FOR UPDATE TO authenticated
  USING (public.has_capability(auth.uid(),'imports.run'))
  WITH CHECK (public.has_capability(auth.uid(),'imports.run'));
CREATE TRIGGER import_jobs_updated BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Linhas em espera ----------
CREATE TABLE public.import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  raw jsonb NOT NULL,
  parsed jsonb,
  status text NOT NULL DEFAULT 'pendente',  -- pendente|valido|aviso|erro|conflito|processado|ignorado
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_id uuid REFERENCES public.products(id),
  variant_id uuid REFERENCES public.product_variants(id),
  movement_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX import_rows_job_line_uidx ON public.import_rows (job_id, line_no);
CREATE INDEX import_rows_job_status_idx ON public.import_rows (job_id, status, line_no);
GRANT SELECT, INSERT, UPDATE ON public.import_rows TO authenticated;
GRANT ALL ON public.import_rows TO service_role;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipe ve linhas" ON public.import_rows FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "importadores gravam linhas" ON public.import_rows FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(auth.uid(),'imports.run'));
CREATE POLICY "importadores atualizam linhas" ON public.import_rows FOR UPDATE TO authenticated
  USING (public.has_capability(auth.uid(),'imports.run'))
  WITH CHECK (public.has_capability(auth.uid(),'imports.run'));

-- ---------- Abertura do lote (idempotente pela chave) ----------
CREATE OR REPLACE FUNCTION public.import_job_open(
  _job_key text, _file_name text, _mode text, _mapping jsonb, _defaults jsonb,
  _location_id uuid DEFAULT NULL, _operation_date date DEFAULT NULL,
  _reason_code text DEFAULT NULL, _reference text DEFAULT NULL,
  _responsible uuid DEFAULT NULL, _dry_run boolean DEFAULT false,
  _file_size integer DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.';
  END IF;
  IF nullif(trim(coalesce(_job_key,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Informe a chave do lote.';
  END IF;
  SELECT id INTO j FROM public.import_jobs WHERE job_key = _job_key;
  IF j IS NOT NULL THEN RETURN j; END IF;

  IF _mode = 'entrada' THEN
    IF _location_id IS NULL OR NOT EXISTS
       (SELECT 1 FROM public.locations WHERE id = _location_id AND is_active) THEN
      RAISE EXCEPTION 'Informe um local de entrada ativo.';
    END IF;
    IF _operation_date IS NULL THEN RAISE EXCEPTION 'Informe a data operacional.'; END IF;
    IF nullif(trim(coalesce(_reference,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Informe o documento ou referência da entrada.';
    END IF;
  END IF;

  INSERT INTO public.import_jobs (
    job_key, file_name, file_size, mode, mapping, defaults, dry_run,
    location_id, operation_date, reason_code, reference, responsible_user_id, status
  ) VALUES (
    _job_key, coalesce(_file_name,'planilha'), _file_size, coalesce(_mode,'catalogo'),
    coalesce(_mapping,'{}'::jsonb), coalesce(_defaults,'{}'::jsonb), coalesce(_dry_run,false),
    _location_id, _operation_date, _reason_code, _reference,
    coalesce(_responsible, auth.uid()), 'validando'
  ) RETURNING id INTO j;
  RETURN j;
END $$;

-- ---------- Gravação das linhas em staging ----------
CREATE OR REPLACE FUNCTION public.import_rows_stage(_job uuid, _rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.import_jobs WHERE id = _job) THEN
    RAISE EXCEPTION 'Lote inexistente.';
  END IF;

  WITH src AS (
    SELECT (e->>'n')::int AS line_no, e->'raw' AS raw FROM jsonb_array_elements(_rows) e
  ), ins AS (
    INSERT INTO public.import_rows (job_id, line_no, raw)
    SELECT _job, line_no, raw FROM src
    ON CONFLICT (job_id, line_no) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO n FROM ins;

  UPDATE public.import_jobs j
     SET total_rows = (SELECT count(*) FROM public.import_rows r WHERE r.job_id = _job)
   WHERE j.id = _job;
  RETURN n;
END $$;

-- ---------- Validação/interpretação em lotes ----------
CREATE OR REPLACE FUNCTION public.import_job_validate(_job uuid, _limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.import_jobs; r record; m jsonb; d jsonb;
        p jsonb; msgs jsonb; st text;
        c_sku text; c_leg text; c_ean text; c_nome text;
        v_sku uuid; v_leg uuid; v_ean uuid; alvos uuid[];
        feitas int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id = _job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  m := j.mapping; d := j.defaults;

  FOR r IN SELECT * FROM public.import_rows
            WHERE job_id = _job AND status = 'pendente'
            ORDER BY line_no LIMIT greatest(coalesce(_limit,500),1)
  LOOP
    msgs := '[]'::jsonb; st := 'valido';
    p := jsonb_build_object(
      'nome',        coalesce(nullif(trim(coalesce(r.raw->>(m->>'nome'),'')),''), d->>'nome'),
      'descricao_curta', nullif(trim(coalesce(r.raw->>(m->>'descricao_curta'),'')),''),
      'descricao',   nullif(trim(coalesce(r.raw->>(m->>'descricao'),'')),''),
      'categoria',   coalesce(nullif(trim(coalesce(r.raw->>(m->>'categoria'),'')),''), d->>'categoria'),
      'subcategoria',nullif(trim(coalesce(r.raw->>(m->>'subcategoria'),'')),''),
      'colecao',     coalesce(nullif(trim(coalesce(r.raw->>(m->>'colecao'),'')),''), d->>'colecao'),
      'fornecedor',  coalesce(nullif(trim(coalesce(r.raw->>(m->>'fornecedor'),'')),''), d->>'fornecedor'),
      'marca',       nullif(trim(coalesce(r.raw->>(m->>'marca'),'')),''),
      'material',    coalesce(nullif(trim(coalesce(r.raw->>(m->>'material'),'')),''), d->>'material'),
      'banho',       coalesce(nullif(trim(coalesce(r.raw->>(m->>'banho'),'')),''), d->>'banho'),
      'cor',         nullif(trim(coalesce(r.raw->>(m->>'cor'),'')),''),
      'tamanho',     nullif(trim(coalesce(r.raw->>(m->>'tamanho'),'')),''),
      'peso',        public.parse_decimal_any(r.raw->>(m->>'peso')),
      'medidas',     nullif(trim(coalesce(r.raw->>(m->>'medidas'),'')),''),
      'sku',         public.norm_code(r.raw->>(m->>'sku')),
      'codigo_legado', public.norm_code(r.raw->>(m->>'codigo_legado')),
      'ean',         public.norm_code(r.raw->>(m->>'ean')),
      'custo_cents', public.parse_cents_any(r.raw->>(m->>'custo')),
      'preco_cents', public.parse_cents_any(coalesce(r.raw->>(m->>'preco'), d->>'preco')),
      'quantidade',  coalesce(public.parse_decimal_any(r.raw->>(m->>'quantidade')),0)::int,
      'destaque',    lower(coalesce(r.raw->>(m->>'destaque'), d->>'destaque','')) IN ('1','sim','true','x','s'),
      'publicar',    lower(coalesce(r.raw->>(m->>'publicar'), d->>'publicar','')) IN ('1','sim','true','x','s'),
      'mostrar_preco', lower(coalesce(r.raw->>(m->>'mostrar_preco'), d->>'mostrar_preco','sim')) IN ('1','sim','true','x','s'),
      'imagem_url',  nullif(trim(coalesce(r.raw->>(m->>'imagem_url'),'')),'')
    );

    c_nome := p->>'nome'; c_sku := p->>'sku'; c_leg := p->>'codigo_legado'; c_ean := p->>'ean';

    IF c_nome IS NULL THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','nome','erro','Nome do produto é obrigatório.');
    END IF;
    IF c_sku IS NULL AND c_leg IS NULL AND c_ean IS NULL THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','identificador',
        'erro','Informe SKU, código legado ou código de barras. Produto não é identificado só pelo nome.');
    END IF;
    IF (p->>'quantidade')::int < 0 THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','quantidade','erro','Quantidade não pode ser negativa.');
    END IF;
    IF j.mode = 'entrada' AND (p->>'quantidade')::int = 0 THEN
      IF st <> 'erro' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','quantidade','aviso','Sem quantidade: a peça será só cadastrada.');
    END IF;

    IF st <> 'erro' THEN
      v_sku := NULL; v_leg := NULL; v_ean := NULL;
      IF c_sku IS NOT NULL THEN
        SELECT pv.id INTO v_sku FROM public.product_variants pv
          WHERE pv.sku IS NOT NULL AND lower(pv.sku) = lower(c_sku) LIMIT 1;
      END IF;
      IF c_leg IS NOT NULL THEN
        SELECT pv.id INTO v_leg FROM public.product_variants pv
          WHERE pv.legacy_code IS NOT NULL AND lower(pv.legacy_code) = lower(c_leg) LIMIT 1;
      END IF;
      IF c_ean IS NOT NULL THEN
        SELECT pv.id INTO v_ean FROM public.product_variants pv
          WHERE pv.barcode IS NOT NULL AND pv.barcode = c_ean LIMIT 1;
      END IF;
      alvos := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[v_sku, v_leg, v_ean]) x WHERE x IS NOT NULL);
      IF array_length(alvos,1) > 1 THEN
        st := 'conflito';
        msgs := msgs || jsonb_build_object('campo','identificador',
          'erro','Os códigos desta linha apontam para peças diferentes. Linha bloqueada para revisão manual.');
      ELSE
        p := p || jsonb_build_object('variant_id', coalesce(v_sku, v_leg, v_ean));
      END IF;
    END IF;

    UPDATE public.import_rows
       SET parsed = p, status = st, messages = msgs
     WHERE id = r.id;
    feitas := feitas + 1;
  END LOOP;

  UPDATE public.import_jobs SET
      ok_rows    = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('valido','processado')),
      warn_rows  = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='aviso'),
      error_rows = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('erro','conflito')),
      status = CASE WHEN EXISTS (SELECT 1 FROM public.import_rows WHERE job_id=_job AND status='pendente')
                    THEN 'validando' ELSE 'pronto' END
    WHERE id = _job;

  RETURN jsonb_build_object('validadas', feitas,
    'restantes', (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='pendente'));
END $$;
