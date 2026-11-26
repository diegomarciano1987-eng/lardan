INSERT INTO public.candidatura_stages (key, name, sort_order, is_initial, is_active, color)
SELECT 'teste', 'Teste', 30, false, true, '#A96B2D'
WHERE NOT EXISTS (SELECT 1 FROM public.candidatura_stages WHERE key = 'teste');
UPDATE public.candidatura_stages SET name = 'Nova candidatura', sort_order = 10, is_active = true WHERE key = 'nova';
UPDATE public.candidatura_stages SET name = 'Conversa (Lara)', sort_order = 20, is_active = true WHERE key = 'conversa';
UPDATE public.candidatura_stages SET name = 'Teste', sort_order = 30, is_active = true WHERE key = 'teste';
UPDATE public.candidatura_stages SET name = 'Análise', sort_order = 40, is_active = true WHERE key = 'avaliacao';
UPDATE public.candidatura_stages SET name = 'Aprovada', sort_order = 50, is_active = true WHERE key = 'aprovada';
UPDATE public.candidatura_stages SET name = 'Documentação', sort_order = 60, is_active = true WHERE key = 'documentacao';
UPDATE public.candidatura_stages SET name = 'Maleta', sort_order = 70, is_active = true WHERE key = 'onboarding';
UPDATE public.candidatura_stages SET name = 'Reprovada', sort_order = 90, is_active = true WHERE key = 'reprovada';
DO $$
DECLARE v_de uuid; v_para uuid; r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('primeiro', 'conversa'), ('perfil', 'teste')) v(de, para) LOOP
    SELECT id INTO v_de FROM public.candidatura_stages WHERE key = r.de;
    SELECT id INTO v_para FROM public.candidatura_stages WHERE key = r.para;
    IF v_de IS NULL OR v_para IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.candidatura_stage_history (lead_id, from_stage_id, to_stage_id, actor_id, note)
    SELECT id, v_de, v_para, NULL, '0395: funil da Captação' FROM public.leads WHERE stage_id = v_de;
    UPDATE public.leads SET stage_id = v_para, stage_entered_at = now(), updated_at = now() WHERE stage_id = v_de;
    UPDATE public.candidatura_stages SET is_active = false, sort_order = 95 WHERE id = v_de;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.lead_rota_representante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.indicacao_representante_do_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN NEW;
END $$;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS como_conheceu text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_como_conheceu_ok') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_como_conheceu_ok
      CHECK (como_conheceu IS NULL OR como_conheceu IN ('indicacao', 'instagram', 'google', 'outro')) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.captacao_canal(_l public.leads)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN _l.representante_origem IN ('link', 'manual') THEN 'representante' ELSE 'site' END
$$;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.crm_filtrar(jsonb)'::regprocedure); antes := def;
  IF position('captacao_canal' IN def) = 0 THEN
    def := replace(def, $a$    AND (coalesce(_f->>'etapa','') = '' OR l.stage_id = (_f->>'etapa')::uuid)$a$,
                        $b$    AND (coalesce(_f->>'canal','') = '' OR public.captacao_canal(l) = _f->>'canal')
    AND (coalesce(_f->>'etapa','') = '' OR l.stage_id = (_f->>'etapa')::uuid)$b$);
    IF def = antes THEN RAISE EXCEPTION '0395: ponto do filtro não encontrado em crm_filtrar'; END IF;
    EXECUTE def;
  END IF;
END $do$;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.candidatura_teste_concluido(uuid)'::regprocedure); antes := def;
  IF position('captacao_fila' IN def) = 0 THEN
    def := replace(def, $a$s.key IN ('nova','primeiro','conversa','perfil')$a$, $b$s.key IN ('nova','primeiro','conversa','perfil','teste')$b$);
    def := replace(def, $a$WHERE key = 'documentacao' AND is_active;$a$, $b$WHERE key = 'avaliacao' AND is_active;$b$);
    def := replace(def, $a$    VALUES (v_t.lead_id, v_from, v_doc, NULL, 'Teste de candidatura concluído');
  END IF;$a$, $b$    VALUES (v_t.lead_id, v_from, v_doc, NULL, 'Teste de candidatura concluído');
  END IF;
  -- 0395: consulta de crédito e decisão automática (servidor, rotina de 1 minuto)
  INSERT INTO public.captacao_fila (lead_id) VALUES (v_t.lead_id)
  ON CONFLICT (lead_id) DO UPDATE SET feito_em = NULL, erro = NULL, tentativas = 0, proxima_em = now(), criado_em = now();$b$);
    IF def = antes OR position('captacao_fila' IN def) = 0 OR position($k$key = 'avaliacao'$k$ IN def) = 0 THEN
      RAISE EXCEPTION '0395: pontos não encontrados em candidatura_teste_concluido';
    END IF;
    EXECUTE def;
  END IF;
END $do$;

CREATE TABLE IF NOT EXISTS public.captacao_fila (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  proxima_em timestamptz NOT NULL DEFAULT now(),
  tentativas integer NOT NULL DEFAULT 0,
  feito_em timestamptz,
  erro text
);
CREATE INDEX IF NOT EXISTS captacao_fila_pendentes_ix ON public.captacao_fila (proxima_em) WHERE feito_em IS NULL;
ALTER TABLE public.captacao_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.captacao_fila FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.captacao_fila TO service_role;

CREATE TABLE IF NOT EXISTS public.captacao_decisoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  decidido_em timestamptz NOT NULL DEFAULT now(),
  decisao text NOT NULL CHECK (decisao IN ('aprovada_automatica', 'revisao')),
  motivos text[] NOT NULL DEFAULT '{}',
  semaforo text,
  score integer,
  score_minimo integer,
  teste_id uuid,
  credito_id uuid
);
CREATE INDEX IF NOT EXISTS captacao_decisoes_lead_ix ON public.captacao_decisoes (lead_id, decidido_em DESC);
ALTER TABLE public.captacao_decisoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.captacao_decisoes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.captacao_decisoes TO service_role;

CREATE OR REPLACE FUNCTION public.captacao_fila_pegar(_n integer DEFAULT 10)
RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN QUERY
  UPDATE captacao_fila f SET tentativas = f.tentativas + 1,
         proxima_em = now() + make_interval(mins => least(60, 2 * (f.tentativas + 1)))
   WHERE f.lead_id IN (SELECT lead_id FROM captacao_fila WHERE feito_em IS NULL AND proxima_em <= now() AND tentativas < 8
                         ORDER BY proxima_em LIMIT least(greatest(coalesce(_n, 10), 1), 50) FOR UPDATE SKIP LOCKED)
  RETURNING f.lead_id;
END $$;
REVOKE ALL ON FUNCTION public.captacao_fila_pegar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_fila_pegar(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.captacao_fila_concluir(_lead uuid, _erro text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE captacao_fila SET feito_em = CASE WHEN _erro IS NULL THEN now() END, erro = left(_erro, 500) WHERE lead_id = _lead
$$;
REVOKE ALL ON FUNCTION public.captacao_fila_concluir(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_fila_concluir(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.captacao_decidir(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  l leads; t candidatura_testes; c candidatura_credito_consultas; mot text[] := '{}'; v_cor text; v_alertas text[];
  v_dec text; v_from uuid; v_para uuid; v_id uuid; v_nasc date;
BEGIN
  SELECT * INTO l FROM leads WHERE id = _lead FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Candidatura não encontrada.'; END IF;
  IF l.outcome <> 'aberta' OR l.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('decisao', 'ignorada', 'motivo', 'candidatura já encerrada');
  END IF;
  IF public.crm_lead_maleta(l) IS NOT NULL THEN
    RETURN jsonb_build_object('decisao', 'ignorada', 'motivo', 'candidata já tem maleta');
  END IF;
  SELECT * INTO t FROM candidatura_testes WHERE lead_id = _lead AND cancelado_em IS NULL AND concluido_em IS NOT NULL
   ORDER BY concluido_em DESC LIMIT 1;
  IF t.id IS NULL THEN RETURN jsonb_build_object('decisao', 'aguardando', 'motivo', 'teste não concluído'); END IF;
  SELECT * INTO c FROM candidatura_credito_consultas WHERE lead_id = _lead AND consultado_em >= now() - interval '30 days'
   ORDER BY consultado_em DESC LIMIT 1;
  IF c.id IS NULL THEN RETURN jsonb_build_object('decisao', 'aguardando', 'motivo', 'sem consulta de crédito'); END IF;

  v_cor := coalesce(t.resultado->>'semaforo_final', t.resultado->>'semaforo_base');
  v_alertas := coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(t.resultado->'alertas', '[]'::jsonb))), '{}');
  v_nasc := coalesce(l.data_nascimento, (SELECT birth_date FROM parties WHERE id = l.party_id));

  IF coalesce(v_cor, '') <> 'verde' THEN mot := array_append(mot, ('Semáforo do teste ' || coalesce(v_cor, 'sem cor'))::text); END IF;
  IF c.resultado <> 'aprovada_regra' THEN mot := array_append(mot, ('Crédito: ' || c.motivo)::text); END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_alertas) a WHERE a LIKE 'critico_%') THEN mot := array_append(mot, 'Sinal crítico no teste (dinheiro e combinados)'::text); END IF;
  IF 'disc_rapido' = ANY (v_alertas) THEN mot := array_append(mot, 'Respostas rápidas demais no perfil'::text); END IF;
  IF 'cpf_declarado_nao' = ANY (v_alertas) AND (coalesce(c.protestos_qtd, 0) > 0 OR coalesce(c.debitos_qtd, 0) > 0) THEN
    mot := array_append(mot, 'Disse que não tem restrição, mas a consulta mostrou protesto ou débito'::text);
  END IF;
  IF coalesce(l.cpf_digits, '') !~ '^[0-9]{11}$' OR v_nasc IS NULL OR coalesce(l.whatsapp_norm, '') = ''
     OR coalesce(btrim(l.city), '') = '' OR (public.captacao_canal(l) = 'site' AND (coalesce(btrim(l.dream), '') = '' OR coalesce(l.email, '') = '')) THEN
    mot := array_append(mot, 'Dados incompletos na candidatura'::text);
  END IF;

  v_dec := CASE WHEN cardinality(mot) = 0 THEN 'aprovada_automatica' ELSE 'revisao' END;
  INSERT INTO captacao_decisoes (lead_id, decisao, motivos, semaforo, score, score_minimo, teste_id, credito_id)
  VALUES (_lead, v_dec, mot, v_cor, c.score, c.score_minimo, t.id, c.id) RETURNING id INTO v_id;

  v_from := l.stage_id;
  SELECT id INTO v_para FROM candidatura_stages WHERE key = CASE WHEN v_dec = 'aprovada_automatica' THEN 'aprovada' ELSE 'avaliacao' END AND is_active;
  IF v_dec = 'aprovada_automatica' THEN
    UPDATE leads SET outcome = 'ganha', won_at = now(), won_by = NULL, won_notes = 'Aprovada automaticamente na Captação (teste + crédito)',
           status = 'aprovado', stage_id = coalesce(v_para, stage_id),
           stage_entered_at = CASE WHEN v_para IS NOT NULL AND v_para IS DISTINCT FROM stage_id THEN now() ELSE stage_entered_at END,
           updated_at = now()
     WHERE id = _lead;
    PERFORM public.crm_log(_lead, 'ganho', 'Aprovada automaticamente (teste verde e crédito dentro da regra)', NULL,
      jsonb_build_object('decisao', v_id), NULL);
  ELSE
    UPDATE leads SET status = 'em_analise', stage_id = coalesce(v_para, stage_id),
           stage_entered_at = CASE WHEN v_para IS NOT NULL AND v_para IS DISTINCT FROM stage_id THEN now() ELSE stage_entered_at END,
           updated_at = now()
     WHERE id = _lead;
    PERFORM public.crm_log(_lead, 'analise', 'Foi para a análise do Daniel', array_to_string(mot, ' · '),
      jsonb_build_object('decisao', v_id), NULL);
  END IF;
  IF v_para IS NOT NULL AND v_para IS DISTINCT FROM v_from THEN
    INSERT INTO candidatura_stage_history (lead_id, from_stage_id, to_stage_id, actor_id, note)
    VALUES (_lead, v_from, v_para, NULL, CASE WHEN v_dec = 'aprovada_automatica' THEN 'Aprovada automaticamente' ELSE 'Análise do Daniel' END);
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (NULL, 'captacao.decisao', 'leads', _lead::text, jsonb_build_object('decisao', v_dec, 'motivos', mot, 'id', v_id));
  RETURN jsonb_build_object('decisao', v_dec, 'motivos', mot, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.captacao_decidir(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_decidir(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.captacao_decisao_ver(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN (SELECT jsonb_build_object(
      'canal', (SELECT public.captacao_canal(l) FROM leads l WHERE l.id = _lead),
      'como_conheceu', (SELECT como_conheceu FROM leads WHERE id = _lead),
      'na_fila', EXISTS (SELECT 1 FROM captacao_fila f WHERE f.lead_id = _lead AND f.feito_em IS NULL),
      'erro_fila', (SELECT erro FROM captacao_fila f WHERE f.lead_id = _lead AND f.feito_em IS NULL),
      'ultima', (SELECT jsonb_build_object('em', d.decidido_em, 'decisao', d.decisao, 'motivos', to_jsonb(d.motivos),
                                           'semaforo', d.semaforo, 'score', d.score, 'score_minimo', d.score_minimo)
                   FROM captacao_decisoes d WHERE d.lead_id = _lead ORDER BY d.decidido_em DESC LIMIT 1)));
END $$;
REVOKE ALL ON FUNCTION public.captacao_decisao_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.captacao_decisao_ver(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.captacao_revisar(_lead uuid, _motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO captacao_decisoes (lead_id, decisao, motivos) VALUES (_lead, 'revisao', ARRAY[left(coalesce(_motivo, 'Sem motivo'), 300)]);
  UPDATE leads SET status = 'em_analise', updated_at = now() WHERE id = _lead AND outcome = 'aberta';
  PERFORM public.crm_log(_lead, 'analise', 'Foi para a análise do Daniel', _motivo, '{}'::jsonb, NULL);
END $$;
REVOKE ALL ON FUNCTION public.captacao_revisar(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_revisar(uuid, text) TO service_role;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.crm_mark_won(uuid,text)'::regprocedure); antes := def;
  IF position('0395' IN def) = 0 THEN
    def := replace(def, $a$  PERFORM public.crm_log(_lead, 'ganho', 'Candidatura marcada como aprovada', _nota,$a$, $b$  -- 0395: vai para a etapa Aprovada quando ainda estava antes dela no funil
  WITH de AS (SELECT l.stage_id FROM public.leads l JOIN public.candidatura_stages s ON s.id = l.stage_id
               WHERE l.id = _lead AND s.key IN ('nova','primeiro','conversa','teste','perfil','avaliacao')),
       para AS (SELECT id FROM public.candidatura_stages WHERE key = 'aprovada' AND is_active),
       mov AS (UPDATE public.leads SET stage_id = (SELECT id FROM para), stage_entered_at = now()
                WHERE id = _lead AND EXISTS (SELECT 1 FROM de) AND EXISTS (SELECT 1 FROM para) RETURNING id)
  INSERT INTO public.candidatura_stage_history (lead_id, from_stage_id, to_stage_id, actor_id, note)
  SELECT _lead, (SELECT stage_id FROM de), (SELECT id FROM para), auth.uid(), 'Aprovada pela equipe' FROM mov;
  PERFORM public.crm_log(_lead, 'ganho', 'Candidatura marcada como aprovada', _nota,$b$);
    IF def = antes THEN RAISE EXCEPTION '0395: ponto não encontrado em crm_mark_won'; END IF;
    EXECUTE def;
  END IF;
END $do$;