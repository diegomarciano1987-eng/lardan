CREATE OR REPLACE FUNCTION public.familia_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE TABLE IF NOT EXISTS public.familia_categorias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  nome        text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 60),
  tipo        text NOT NULL CHECK (tipo IN ('despesa', 'receita')),
  cor         text NOT NULL DEFAULT '#64748B' CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ordem       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_familia_categorias_nome ON public.familia_categorias (user_id, tipo, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.familia_contas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid(),
  nome         text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 60),
  tipo         text NOT NULL DEFAULT 'conta_corrente'
                 CHECK (tipo IN ('conta_corrente', 'poupanca', 'carteira', 'cartao_credito', 'investimento', 'outro')),
  instituicao  text CHECK (instituicao IS NULL OR char_length(instituicao) <= 60),
  cor          text NOT NULL DEFAULT '#0EA5E9' CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativa        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_familia_contas_nome ON public.familia_contas (user_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.familia_projetos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  nome        text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 60),
  cor         text NOT NULL DEFAULT '#8B5CF6' CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_familia_projetos_nome ON public.familia_projetos (user_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.familia_despesas_fixas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid(),
  nome             text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 120),
  valor            numeric(14,2) NOT NULL CHECK (valor > 0),
  dia_vencimento   smallint NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  mes_inicio       date NOT NULL CHECK (extract(day FROM mes_inicio) = 1),
  recorrencia      text NOT NULL DEFAULT 'mensal' CHECK (recorrencia IN ('mensal', 'anual')),
  parcelado        boolean NOT NULL DEFAULT false,
  parcelas_total   smallint,
  categoria_id     uuid REFERENCES public.familia_categorias(id) ON DELETE SET NULL,
  forma_pagamento  text NOT NULL DEFAULT 'debito'
                   CHECK (forma_pagamento IN ('debito', 'credito', 'pix', 'dinheiro', 'boleto', 'transferencia', 'vale')),
  projeto_id       uuid REFERENCES public.familia_projetos(id) ON DELETE SET NULL,
  conta_id         uuid REFERENCES public.familia_contas(id) ON DELETE SET NULL,
  encerrada_em     date CHECK (encerrada_em IS NULL OR extract(day FROM encerrada_em) = 1),
  observacoes      text CHECK (observacoes IS NULL OR char_length(observacoes) <= 1000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_familia_fixa_parcelas CHECK (
    (parcelado = false AND parcelas_total IS NULL)
    OR (parcelado = true AND parcelas_total IS NOT NULL AND parcelas_total BETWEEN 2 AND 360)
  ),
  CONSTRAINT chk_familia_fixa_encerramento CHECK (encerrada_em IS NULL OR encerrada_em >= mes_inicio)
);
CREATE INDEX IF NOT EXISTS idx_familia_fixas_user ON public.familia_despesas_fixas (user_id);

CREATE TABLE IF NOT EXISTS public.familia_fixas_ocorrencias (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid(),
  fixa_id          uuid NOT NULL REFERENCES public.familia_despesas_fixas(id) ON DELETE CASCADE,
  competencia      date NOT NULL CHECK (extract(day FROM competencia) = 1),
  status           text NOT NULL CHECK (status IN ('paga', 'pulada')),
  valor_pago       numeric(14,2) CHECK (valor_pago IS NULL OR valor_pago >= 0),
  data_pagamento   date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_familia_ocorrencia UNIQUE (fixa_id, competencia),
  CONSTRAINT chk_familia_ocorrencia_paga CHECK (
    (status = 'paga' AND valor_pago IS NOT NULL AND data_pagamento IS NOT NULL)
    OR (status = 'pulada' AND valor_pago IS NULL AND data_pagamento IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_familia_ocorrencias_user_comp ON public.familia_fixas_ocorrencias (user_id, competencia);

CREATE TABLE IF NOT EXISTS public.familia_despesas_variaveis (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL DEFAULT auth.uid(),
  descricao          text NOT NULL CHECK (char_length(btrim(descricao)) BETWEEN 1 AND 200),
  valor              numeric(14,2) NOT NULL CHECK (valor > 0),
  data               date NOT NULL,
  recorrente         boolean NOT NULL DEFAULT false,
  grupo_id           uuid,
  ocorrencia_numero  smallint,
  ocorrencias_total  smallint,
  categoria_id       uuid REFERENCES public.familia_categorias(id) ON DELETE SET NULL,
  forma_pagamento    text NOT NULL DEFAULT 'debito'
                     CHECK (forma_pagamento IN ('debito', 'credito', 'pix', 'dinheiro', 'boleto', 'transferencia', 'vale')),
  projeto_id         uuid REFERENCES public.familia_projetos(id) ON DELETE SET NULL,
  conta_id           uuid REFERENCES public.familia_contas(id) ON DELETE SET NULL,
  data_pagamento     date,
  observacoes        text CHECK (observacoes IS NULL OR char_length(observacoes) <= 1000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_familia_var_grupo CHECK (
    (recorrente = false AND grupo_id IS NULL AND ocorrencia_numero IS NULL AND ocorrencias_total IS NULL)
    OR (recorrente = true AND grupo_id IS NOT NULL
        AND ocorrencias_total IS NOT NULL AND ocorrencia_numero IS NOT NULL
        AND ocorrencias_total BETWEEN 2 AND 120
        AND ocorrencia_numero BETWEEN 1 AND ocorrencias_total)
  )
);
CREATE INDEX IF NOT EXISTS idx_familia_var_user_data ON public.familia_despesas_variaveis (user_id, data);
CREATE INDEX IF NOT EXISTS idx_familia_var_grupo ON public.familia_despesas_variaveis (grupo_id) WHERE grupo_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.familia_receitas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL DEFAULT auth.uid(),
  fonte              text NOT NULL CHECK (char_length(btrim(fonte)) BETWEEN 1 AND 120),
  valor              numeric(14,2) NOT NULL CHECK (valor > 0),
  data               date NOT NULL,
  recorrente         boolean NOT NULL DEFAULT false,
  grupo_id           uuid,
  ocorrencia_numero  smallint,
  ocorrencias_total  smallint,
  categoria_id       uuid REFERENCES public.familia_categorias(id) ON DELETE SET NULL,
  forma_pagamento    text NOT NULL DEFAULT 'debito'
                     CHECK (forma_pagamento IN ('debito', 'credito', 'pix', 'dinheiro', 'boleto', 'transferencia', 'vale')),
  observacoes        text CHECK (observacoes IS NULL OR char_length(observacoes) <= 1000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_familia_rec_grupo CHECK (
    (recorrente = false AND grupo_id IS NULL AND ocorrencia_numero IS NULL AND ocorrencias_total IS NULL)
    OR (recorrente = true AND grupo_id IS NOT NULL
        AND ocorrencias_total IS NOT NULL AND ocorrencia_numero IS NOT NULL
        AND ocorrencias_total BETWEEN 2 AND 120
        AND ocorrencia_numero BETWEEN 1 AND ocorrencias_total)
  )
);
CREATE INDEX IF NOT EXISTS idx_familia_rec_user_data ON public.familia_receitas (user_id, data);
CREATE INDEX IF NOT EXISTS idx_familia_rec_grupo ON public.familia_receitas (grupo_id) WHERE grupo_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.familia_valida_vinculos()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_tipo_cat text;
  v_rec jsonb := to_jsonb(NEW);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Não é permitido trocar o dono do registro' USING ERRCODE = '42501';
  END IF;
  v_tipo_cat := CASE TG_TABLE_NAME WHEN 'familia_receitas' THEN 'receita' ELSE 'despesa' END;
  IF v_rec ? 'categoria_id' AND (v_rec->>'categoria_id') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.familia_categorias c
                     WHERE c.id = (v_rec->>'categoria_id')::uuid AND c.user_id = NEW.user_id AND c.tipo = v_tipo_cat) THEN
    RAISE EXCEPTION 'Categoria inválida' USING ERRCODE = '23503';
  END IF;
  IF v_rec ? 'conta_id' AND (v_rec->>'conta_id') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.familia_contas c
                     WHERE c.id = (v_rec->>'conta_id')::uuid AND c.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Conta inválida' USING ERRCODE = '23503';
  END IF;
  IF v_rec ? 'projeto_id' AND (v_rec->>'projeto_id') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.familia_projetos p
                     WHERE p.id = (v_rec->>'projeto_id')::uuid AND p.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Projeto inválido' USING ERRCODE = '23503';
  END IF;
  IF v_rec ? 'fixa_id' AND (v_rec->>'fixa_id') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.familia_despesas_fixas f
                     WHERE f.id = (v_rec->>'fixa_id')::uuid AND f.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Despesa fixa inválida' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END; $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['familia_categorias', 'familia_contas', 'familia_projetos',
                           'familia_despesas_fixas', 'familia_fixas_ocorrencias',
                           'familia_despesas_variaveis', 'familia_receitas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS "Dono lê %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Dono cria %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Dono altera %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Dono exclui %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Dono lê %s" ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())', t, t);
    EXECUTE format('CREATE POLICY "Dono cria %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())', t, t);
    EXECUTE format('CREATE POLICY "Dono altera %s" ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t, t);
    EXECUTE format('CREATE POLICY "Dono exclui %s" ON public.%I FOR DELETE TO authenticated USING (user_id = auth.uid())', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_upd ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_upd BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.familia_set_updated_at()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['familia_despesas_fixas', 'familia_fixas_ocorrencias',
                           'familia_despesas_variaveis', 'familia_receitas',
                           'familia_categorias', 'familia_contas', 'familia_projetos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_vinculos ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_vinculos BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.familia_valida_vinculos()', t, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.familia_categoria_tipo_fixo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.tipo IS DISTINCT FROM OLD.tipo AND (
       EXISTS (SELECT 1 FROM public.familia_despesas_fixas WHERE categoria_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.familia_despesas_variaveis WHERE categoria_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.familia_receitas WHERE categoria_id = OLD.id)) THEN
    RAISE EXCEPTION 'Categoria em uso não pode mudar de tipo' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_familia_categoria_tipo ON public.familia_categorias;
CREATE TRIGGER trg_familia_categoria_tipo BEFORE UPDATE OF tipo ON public.familia_categorias
  FOR EACH ROW EXECUTE FUNCTION public.familia_categoria_tipo_fixo();

CREATE OR REPLACE FUNCTION public.familia_garantir_categorias_padrao()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_qtd integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.familia_categorias WHERE user_id = v_uid) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.familia_categorias (user_id, nome, tipo, cor, ordem)
  SELECT v_uid, x.nome, x.tipo, x.cor, x.ordem
  FROM (VALUES
    ('Moradia',          'despesa', '#0EA5E9', 1),
    ('Contas da casa',   'despesa', '#6366F1', 2),
    ('Mercado',          'despesa', '#22C55E', 3),
    ('Alimentação fora', 'despesa', '#F97316', 4),
    ('Transporte',       'despesa', '#F59E0B', 5),
    ('Saúde',            'despesa', '#EF4444', 6),
    ('Educação',         'despesa', '#8B5CF6', 7),
    ('Lazer',            'despesa', '#EC4899', 8),
    ('Assinaturas',      'despesa', '#14B8A6', 9),
    ('Vestuário',        'despesa', '#A855F7', 10),
    ('Pets',             'despesa', '#84CC16', 11),
    ('Impostos e taxas', 'despesa', '#64748B', 12),
    ('Outros',           'despesa', '#94A3B8', 99),
    ('Ganhos LARDAN',    'receita', '#B45309', 0),
    ('Salário',          'receita', '#22C55E', 1),
    ('Freelance',        'receita', '#0EA5E9', 2),
    ('Investimentos',    'receita', '#F59E0B', 3),
    ('Aluguel recebido', 'receita', '#8B5CF6', 4),
    ('Outros',           'receita', '#94A3B8', 99)
  ) AS x(nome, tipo, cor, ordem)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END; $$;
REVOKE ALL ON FUNCTION public.familia_garantir_categorias_padrao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.familia_garantir_categorias_padrao() TO authenticated;

CREATE OR REPLACE FUNCTION public.familia_reajustar_fixa(_id uuid, _novo_valor numeric, _a_partir date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  f public.familia_despesas_fixas%ROWTYPE;
  v_mes date := date_trunc('month', _a_partir)::date;
  v_inicio_nova date;
  v_novo_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF _novo_valor IS NULL OR _novo_valor <= 0 THEN RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023'; END IF;
  SELECT * INTO f FROM public.familia_despesas_fixas WHERE id = _id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Despesa fixa não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF f.parcelado THEN RAISE EXCEPTION 'Reajuste não se aplica a despesa parcelada' USING ERRCODE = '22023'; END IF;
  IF f.recorrencia = 'anual' THEN
    v_inicio_nova := make_date(extract(year FROM v_mes)::int, extract(month FROM f.mes_inicio)::int, 1);
    IF v_inicio_nova < v_mes THEN v_inicio_nova := (v_inicio_nova + interval '1 year')::date; END IF;
  ELSE
    v_inicio_nova := v_mes;
  END IF;
  IF v_inicio_nova <= f.mes_inicio THEN
    UPDATE public.familia_despesas_fixas SET valor = _novo_valor WHERE id = f.id;
    RETURN f.id;
  END IF;
  IF f.encerrada_em IS NOT NULL AND v_inicio_nova > f.encerrada_em THEN
    RAISE EXCEPTION 'A despesa já está encerrada antes desse mês' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.familia_despesas_fixas
    (user_id, nome, valor, dia_vencimento, mes_inicio, recorrencia, parcelado, parcelas_total,
     categoria_id, forma_pagamento, projeto_id, conta_id, encerrada_em, observacoes)
  VALUES
    (f.user_id, f.nome, _novo_valor, f.dia_vencimento, v_inicio_nova, f.recorrencia, false, NULL,
     f.categoria_id, f.forma_pagamento, f.projeto_id, f.conta_id, f.encerrada_em, f.observacoes)
  RETURNING id INTO v_novo_id;
  UPDATE public.familia_fixas_ocorrencias SET fixa_id = v_novo_id
   WHERE fixa_id = f.id AND competencia >= v_inicio_nova;
  UPDATE public.familia_despesas_fixas SET encerrada_em = (v_inicio_nova - interval '1 month')::date
   WHERE id = f.id;
  RETURN v_novo_id;
END; $$;
REVOKE ALL ON FUNCTION public.familia_reajustar_fixa(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.familia_reajustar_fixa(uuid, numeric, date) TO authenticated;