ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS data_nascimento date;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_data_nascimento_ok') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_data_nascimento_ok
      CHECK (data_nascimento IS NULL OR (data_nascimento > DATE '1900-01-01' AND data_nascimento <= current_date)) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.candidatura_credito_regras (
  id serial PRIMARY KEY,
  idade_min integer NOT NULL CHECK (idade_min >= 18),
  idade_max integer NOT NULL CHECK (idade_max >= idade_min),
  score_min integer NOT NULL CHECK (score_min BETWEEN 0 AND 1000),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
ALTER TABLE public.candidatura_credito_regras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candidatura_credito_regras FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.candidatura_credito_regras TO service_role;
INSERT INTO public.candidatura_credito_regras (idade_min, idade_max, score_min)
SELECT * FROM (VALUES (18, 31, 690), (32, 40, 520), (41, 130, 350)) v(a, b, c)
WHERE NOT EXISTS (SELECT 1 FROM public.candidatura_credito_regras);

CREATE TABLE IF NOT EXISTS public.candidatura_credito_consultas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  consultado_em timestamptz NOT NULL DEFAULT now(),
  consultado_por uuid,
  origem text NOT NULL CHECK (origem IN ('manual', 'automatica')),
  situacao text NOT NULL CHECK (situacao IN ('ok', 'cpf_nao_encontrado', 'sem_score', 'erro')),
  score integer,
  classe text,
  faixa text,
  protestos_qtd integer,
  protestos_valor numeric(14,2),
  debitos_qtd integer,
  debitos_valor numeric(14,2),
  renda_presumida numeric(14,2),
  idade integer,
  score_minimo integer,
  resultado text NOT NULL CHECK (resultado IN ('aprovada_regra', 'revisar')),
  motivo text NOT NULL,
  protocolo text,
  http integer,
  resposta jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS candidatura_credito_consultas_lead_ix ON public.candidatura_credito_consultas (lead_id, consultado_em DESC);
ALTER TABLE public.candidatura_credito_consultas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candidatura_credito_consultas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.candidatura_credito_consultas TO service_role;

CREATE OR REPLACE FUNCTION public.candidatura_idade(_nasc date, _em date DEFAULT current_date)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN _nasc IS NULL THEN NULL ELSE extract(year FROM age(_em, _nasc))::int END $$;

CREATE OR REPLACE FUNCTION public.candidatura_credito_preparar(_lead uuid, _forcar boolean, _usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l leads; u candidatura_credito_consultas;
BEGIN
  IF _usuario IS NOT NULL AND NOT public.has_capability(_usuario, 'candidaturas.edit') THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'Sem permissão para consultar crédito.');
  END IF;
  SELECT * INTO l FROM leads WHERE id = _lead;
  IF l.id IS NULL THEN RETURN jsonb_build_object('pode', false, 'motivo', 'Candidatura não encontrada.'); END IF;
  IF coalesce(l.cpf_digits, '') !~ '^[0-9]{11}$' THEN RETURN jsonb_build_object('pode', false, 'motivo', 'Candidatura sem CPF válido.'); END IF;
  SELECT * INTO u FROM candidatura_credito_consultas
   WHERE lead_id = _lead AND situacao <> 'erro' AND consultado_em >= now() - interval '30 days'
   ORDER BY consultado_em DESC LIMIT 1;
  IF u.id IS NOT NULL AND NOT coalesce(_forcar, false) THEN
    RETURN jsonb_build_object('pode', false, 'reaproveitar', true, 'consulta', u.id,
      'motivo', 'Já existe consulta dos últimos 30 dias; para consultar de novo, peça uma nova consulta.');
  END IF;
  IF NOT public.seguranca_limite('credito:assertiva:dia', 400, 86400) THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'Limite de 400 consultas de crédito por dia atingido.');
  END IF;
  RETURN jsonb_build_object('pode', true, 'cpf', l.cpf_digits);
END $$;
REVOKE ALL ON FUNCTION public.candidatura_credito_preparar(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_credito_preparar(uuid, boolean, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.candidatura_credito_registrar(_lead uuid, _http integer, _resposta jsonb, _origem text, _usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  l leads; r jsonb := coalesce(_resposta, '{}'::jsonb) -> 'resposta';
  v_sit text; v_score int; v_idade int; v_min int; v_res text; v_mot text; v_id uuid;
  v_prot_qtd int; v_prot_val numeric; v_deb_qtd int; v_deb_val numeric;
BEGIN
  SELECT * INTO l FROM leads WHERE id = _lead;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Candidatura não encontrada.'; END IF;
  v_score := CASE WHEN jsonb_typeof(r #> '{score,pontos}') = 'number' THEN (r #>> '{score,pontos}')::int END;
  v_sit := CASE
    WHEN _http = 202 THEN 'cpf_nao_encontrado'
    WHEN _http <> 200 OR r IS NULL THEN 'erro'
    WHEN v_score IS NULL THEN 'sem_score'
    ELSE 'ok' END;
  v_prot_qtd := CASE WHEN jsonb_typeof(r #> '{protestosPublicos,qtdProtestos}') = 'number' THEN (r #>> '{protestosPublicos,qtdProtestos}')::int
                     WHEN jsonb_typeof(r #> '{protestosPublicos,list}') = 'array' THEN jsonb_array_length(r #> '{protestosPublicos,list}') END;
  v_prot_val := CASE WHEN jsonb_typeof(r #> '{protestosPublicos,valorTotal}') = 'number' THEN (r #>> '{protestosPublicos,valorTotal}')::numeric END;
  v_deb_qtd := CASE WHEN jsonb_typeof(r #> '{registrosDebitos,qtdDebitos}') = 'number' THEN (r #>> '{registrosDebitos,qtdDebitos}')::int
                    WHEN jsonb_typeof(r #> '{registrosDebitos,list}') = 'array' THEN jsonb_array_length(r #> '{registrosDebitos,list}') END;
  v_deb_val := CASE WHEN jsonb_typeof(r #> '{registrosDebitos,valorTotal}') = 'number' THEN (r #>> '{registrosDebitos,valorTotal}')::numeric END;
  v_idade := public.candidatura_idade(l.data_nascimento);
  SELECT score_min INTO v_min FROM candidatura_credito_regras WHERE v_idade BETWEEN idade_min AND idade_max ORDER BY idade_min LIMIT 1;

  IF v_sit = 'erro' THEN v_res := 'revisar'; v_mot := 'A consulta falhou (HTTP ' || coalesce(_http::text, '—') || '). Tente de novo mais tarde.';
  ELSIF v_sit = 'cpf_nao_encontrado' THEN v_res := 'revisar'; v_mot := 'A Assertiva não encontrou este CPF: confirme o número com a candidata.';
  ELSIF v_sit = 'sem_score' THEN v_res := 'revisar'; v_mot := 'A Assertiva não calculou score para este CPF.';
  ELSIF l.data_nascimento IS NULL THEN v_res := 'revisar'; v_mot := 'Score ' || v_score || ', mas falta a data de nascimento para aplicar a regra por idade.';
  ELSIF v_idade < 18 THEN v_res := 'revisar'; v_mot := 'Candidata com ' || v_idade || ' anos: menor de idade.';
  ELSIF v_min IS NULL THEN v_res := 'revisar'; v_mot := 'Não há regra cadastrada para ' || v_idade || ' anos.';
  ELSIF v_score >= v_min THEN v_res := 'aprovada_regra'; v_mot := 'Score ' || v_score || ' ≥ ' || v_min || ' (mínimo para ' || v_idade || ' anos).';
  ELSE v_res := 'revisar'; v_mot := 'Score ' || v_score || ' abaixo de ' || v_min || ' (mínimo para ' || v_idade || ' anos).';
  END IF;

  INSERT INTO candidatura_credito_consultas (lead_id, consultado_por, origem, situacao, score, classe, faixa, protestos_qtd, protestos_valor,
                                             debitos_qtd, debitos_valor, renda_presumida, idade, score_minimo, resultado, motivo, protocolo, http, resposta)
  VALUES (_lead, _usuario, CASE WHEN _origem = 'automatica' THEN 'automatica' ELSE 'manual' END, v_sit, v_score,
          r #>> '{score,classe}', r #>> '{score,faixa,titulo}', v_prot_qtd, v_prot_val, v_deb_qtd, v_deb_val,
          CASE WHEN jsonb_typeof(r #> '{rendaPresumida,valor}') = 'number' THEN (r #>> '{rendaPresumida,valor}')::numeric END,
          v_idade, v_min, v_res, v_mot, _resposta #>> '{cabecalho,protocolo}', _http, coalesce(_resposta, '{}'::jsonb))
  RETURNING id INTO v_id;

  PERFORM public.crm_log(_lead, 'credito', 'Consulta de crédito (Assertiva): ' ||
    CASE v_res WHEN 'aprovada_regra' THEN 'dentro da regra' ELSE 'revisar' END, v_mot, '{}'::jsonb, _usuario);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_usuario, 'candidatura.credito_consulta', 'leads', _lead::text,
          jsonb_build_object('consulta', v_id, 'situacao', v_sit, 'resultado', v_res, 'origem', _origem));
  RETURN jsonb_build_object('id', v_id, 'situacao', v_sit, 'resultado', v_res, 'motivo', v_mot, 'score', v_score, 'idade', v_idade, 'score_minimo', v_min);
END $$;
REVOKE ALL ON FUNCTION public.candidatura_credito_registrar(uuid, integer, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_credito_registrar(uuid, integer, jsonb, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.candidatura_credito_ver(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN jsonb_build_object(
    'data_nascimento', (SELECT data_nascimento FROM leads WHERE id = _lead),
    'idade', (SELECT public.candidatura_idade(data_nascimento) FROM leads WHERE id = _lead),
    'regras', coalesce((SELECT jsonb_agg(jsonb_build_object('de', idade_min, 'ate', idade_max, 'score_min', score_min) ORDER BY idade_min)
                          FROM candidatura_credito_regras), '[]'::jsonb),
    'consultas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'em', c.consultado_em, 'origem', c.origem, 'por', p.display_name, 'situacao', c.situacao, 'score', c.score,
        'classe', c.classe, 'faixa', c.faixa, 'protestos_qtd', c.protestos_qtd, 'protestos_valor', c.protestos_valor,
        'debitos_qtd', c.debitos_qtd, 'debitos_valor', c.debitos_valor, 'renda_presumida', c.renda_presumida,
        'idade', c.idade, 'score_minimo', c.score_minimo, 'resultado', c.resultado, 'motivo', c.motivo, 'protocolo', c.protocolo)
        ORDER BY c.consultado_em DESC)
      FROM (SELECT * FROM candidatura_credito_consultas WHERE lead_id = _lead ORDER BY consultado_em DESC LIMIT 10) c
      LEFT JOIN profiles p ON p.id = c.consultado_por), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.candidatura_credito_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidatura_credito_ver(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.candidatura_nascimento_definir(_lead uuid, _data date, _usuario uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _usuario IS NOT NULL AND NOT public.has_capability(_usuario, 'candidaturas.edit') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF _data IS NULL OR _data <= DATE '1900-01-01' OR _data > current_date THEN RAISE EXCEPTION 'Data de nascimento inválida.'; END IF;
  UPDATE leads SET data_nascimento = _data WHERE id = _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidatura não encontrada.'; END IF;
  IF _usuario IS NOT NULL THEN
    PERFORM public.crm_log(_lead, 'dados', 'Data de nascimento informada pela equipe', NULL, '{}'::jsonb, _usuario);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.candidatura_nascimento_definir(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_nascimento_definir(uuid, date, uuid) TO service_role;