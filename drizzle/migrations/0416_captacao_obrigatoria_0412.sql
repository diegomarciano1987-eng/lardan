-- 0412 — Captação obrigatória (Diego, 27/11): ninguém é aprovada sem teste DISC + consulta Assertiva + documentos.
--   Site:          formulário → teste DISC na hora → Assertiva automática (com ou sem a Lara) → documentos → aprovação.
--   Representante: cadastro → teste DISC (link obrigatório) → Assertiva automática → documentos → aprovação → maleta.
--   Aprovação: automática quando teste e crédito passam e os documentos chegam; senão, por uma pessoa da Lardan
--   (Daniel) ou pelo próprio representante (só candidata dele e só com o crédito dentro da regra). Recusa nunca é automática.
-- A regra vale no banco (gatilho), para qualquer tela ou caminho. Ficam fora só as isentas da 0398 e quem já tem maleta.
-- Nada lança dinheiro, nada é apagado e nenhuma coluna é removida. Roda duas vezes sem erro.

-- ───────────────────────────────────────────── 1. O que falta para aprovar
CREATE OR REPLACE FUNCTION public.captacao_requisitos(_lead uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'teste', EXISTS (SELECT 1 FROM candidatura_testes t WHERE t.lead_id = l.id AND t.cancelado_em IS NULL AND t.concluido_em IS NOT NULL),
    'credito', EXISTS (SELECT 1 FROM candidatura_credito_consultas c WHERE c.lead_id = l.id AND c.situacao <> 'erro'),
    'documentos', EXISTS (SELECT 1 FROM candidatura_documentos_link d WHERE d.lead_id = l.id AND d.finalizado_em IS NOT NULL),
    'isenta', EXISTS (SELECT 1 FROM captacao_gate_isentas i WHERE i.lead_id = l.id) OR public.crm_lead_maleta(l) IS NOT NULL)
  FROM leads l WHERE l.id = _lead
$$;
REVOKE ALL ON FUNCTION public.captacao_requisitos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_requisitos(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.captacao_requisitos_falta(_r jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce((_r->>'isenta')::boolean, false) THEN '{}'::text[] ELSE array_remove(ARRAY[
    CASE WHEN NOT coalesce((_r->>'teste')::boolean, false) THEN 'o teste DISC' END,
    CASE WHEN NOT coalesce((_r->>'credito')::boolean, false) THEN 'a consulta na Assertiva' END,
    CASE WHEN NOT coalesce((_r->>'documentos')::boolean, false) THEN 'os documentos (4 fotos)' END], NULL) END
$$;
GRANT EXECUTE ON FUNCTION public.captacao_requisitos_falta(jsonb) TO authenticated, service_role;

-- ───────────────────────────────────────────── 2. A trava: aprovar (ou pôr em Aprovada/Maleta) exige os três
CREATE OR REPLACE FUNCTION public.captacao_aprovacao_guarda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_key text; falta text[];
BEGIN
  IF NEW.outcome = 'ganha' AND OLD.outcome IS DISTINCT FROM 'ganha' THEN
    NULL;
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.outcome IS DISTINCT FROM 'ganha' THEN
    SELECT key INTO v_key FROM candidatura_stages WHERE id = NEW.stage_id;
    IF v_key NOT IN ('aprovada', 'onboarding') THEN RETURN NEW; END IF;
  ELSE
    RETURN NEW;
  END IF;
  falta := public.captacao_requisitos_falta(public.captacao_requisitos(NEW.id));
  IF cardinality(falta) > 0 THEN
    RAISE EXCEPTION 'Ainda não dá para aprovar: falta %.', array_to_string(falta, ', ')
      USING errcode = 'P0001', hint = 'A aprovação exige o teste DISC, a consulta na Assertiva e os documentos.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.captacao_aprovacao_guarda() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a_captacao_aprovacao_guarda ON public.leads;
CREATE TRIGGER a_captacao_aprovacao_guarda BEFORE UPDATE OF outcome, stage_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.captacao_aprovacao_guarda();

-- ───────────────────────────────────────────── 3. Aprovar (um caminho só, auditado)
CREATE OR REPLACE FUNCTION public.captacao_aprovar_interno(_lead uuid, _por uuid, _nota text, _auto boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_de uuid; v_para uuid; v_key text;
BEGIN
  SELECT l.stage_id, s.key INTO v_de, v_key FROM leads l LEFT JOIN candidatura_stages s ON s.id = l.stage_id WHERE l.id = _lead FOR UPDATE OF l;
  SELECT id INTO v_para FROM candidatura_stages WHERE key = 'aprovada' AND is_active;
  IF coalesce(v_key, '') IN ('aprovada', 'onboarding') THEN v_para := v_de; END IF;
  UPDATE leads SET outcome = 'ganha', won_at = now(), won_by = _por, won_notes = left(_nota, 500), status = 'aprovado',
         lost_reason_id = NULL, lost_at = NULL, lost_by = NULL,
         stage_id = coalesce(v_para, stage_id),
         stage_entered_at = CASE WHEN v_para IS DISTINCT FROM v_de THEN now() ELSE stage_entered_at END, updated_at = now()
   WHERE id = _lead AND outcome = 'aberta';
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta candidatura não está mais aberta.'; END IF;
  IF v_para IS NOT NULL AND v_para IS DISTINCT FROM v_de THEN
    INSERT INTO candidatura_stage_history (lead_id, from_stage_id, to_stage_id, actor_id, note) VALUES (_lead, v_de, v_para, _por, left(_nota, 300));
  END IF;
  PERFORM public.crm_log(_lead, 'ganho', CASE WHEN _auto THEN 'Aprovada automaticamente (teste, crédito e documentos)' ELSE 'Candidatura aprovada' END,
    _nota, jsonb_build_object('automatica', _auto), NULL);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_por, 'captacao.aprovada', 'leads', _lead::text, jsonb_build_object('automatica', _auto, 'nota', left(_nota, 300)));
END $$;
REVOKE ALL ON FUNCTION public.captacao_aprovar_interno(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_aprovar_interno(uuid, uuid, text, boolean) TO service_role;

-- ───────────────────────────────────────────── 4. Lara: pré-aprovada recebe o link dos documentos (mesmo modelo e mesma chave da aprovação)
CREATE OR REPLACE FUNCTION public.lara_pre_aprovada(_lead uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c lara_conversas; l leads; v_token text;
BEGIN
  SELECT * INTO c FROM lara_conversas WHERE lead_id = _lead;
  IF c.lead_id IS NULL OR c.opt_out OR NOT public.lara_ativa() THEN RETURN; END IF;
  SELECT * INTO l FROM leads WHERE id = _lead;
  SELECT token INTO v_token FROM candidatura_documentos_link WHERE lead_id = _lead AND expira_em > now() AND finalizado_em IS NULL;
  IF v_token IS NULL THEN RETURN; END IF;
  PERFORM public.lara_enfileirar(_lead, c.wa_id, 'template',
    jsonb_build_object('template', 'lara_aprovada_documentos', 'params', jsonb_build_array(public.lara_primeiro_nome(l)), 'url', v_token),
    'Pré-aprovada (modelo): link dos 4 documentos', 'aprovada:' || _lead::text);
END $$;
REVOKE ALL ON FUNCTION public.lara_pre_aprovada(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_pre_aprovada(uuid) TO service_role;

-- ───────────────────────────────────────────── 5. Decisão: teste + crédito ok → pré-aprovada; aprova sozinha quando os documentos chegam
CREATE OR REPLACE FUNCTION public.captacao_decidir(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  l leads; t candidatura_testes; c candidatura_credito_consultas; mot text[] := '{}'; v_cor text; v_alertas text[];
  v_dec text; v_docs boolean; v_from uuid; v_para uuid; v_id uuid; v_nasc date;
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
  v_docs := EXISTS (SELECT 1 FROM candidatura_documentos_link d WHERE d.lead_id = _lead AND d.finalizado_em IS NOT NULL);
  INSERT INTO captacao_decisoes (lead_id, decisao, motivos, semaforo, score, score_minimo, teste_id, credito_id)
  VALUES (_lead, v_dec, mot, v_cor, c.score, c.score_minimo, t.id, c.id) RETURNING id INTO v_id;

  IF v_dec = 'aprovada_automatica' AND v_docs THEN
    PERFORM public.captacao_aprovar_interno(_lead, NULL, 'Aprovada automaticamente na Captação (teste + crédito + documentos)', true);
  ELSE
    v_from := l.stage_id;
    SELECT id INTO v_para FROM candidatura_stages WHERE key = CASE WHEN v_dec = 'aprovada_automatica' THEN 'documentacao' ELSE 'avaliacao' END AND is_active;
    UPDATE leads SET status = 'em_analise', stage_id = coalesce(v_para, stage_id),
           stage_entered_at = CASE WHEN v_para IS NOT NULL AND v_para IS DISTINCT FROM stage_id THEN now() ELSE stage_entered_at END,
           updated_at = now()
     WHERE id = _lead;
    IF v_para IS NOT NULL AND v_para IS DISTINCT FROM v_from THEN
      INSERT INTO candidatura_stage_history (lead_id, from_stage_id, to_stage_id, actor_id, note)
      VALUES (_lead, v_from, v_para, NULL, CASE WHEN v_dec = 'aprovada_automatica' THEN 'Pré-aprovada: aguardando documentos' ELSE 'Análise' END);
    END IF;
    IF v_dec = 'aprovada_automatica' THEN
      PERFORM public.crm_log(_lead, 'analise', 'Pré-aprovada: teste e crédito dentro da regra; aprova sozinha quando os documentos chegarem', NULL,
        jsonb_build_object('decisao', v_id), NULL);
    ELSE
      PERFORM public.crm_log(_lead, 'analise', 'Foi para a análise (Daniel ou o representante dela)', array_to_string(mot, ' · '),
        jsonb_build_object('decisao', v_id), NULL);
    END IF;
    IF NOT v_docs THEN
      PERFORM public.candidatura_documentos_link_garantir(_lead);
      IF v_dec = 'aprovada_automatica' THEN PERFORM public.lara_pre_aprovada(_lead); END IF;
    END IF;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (NULL, 'captacao.decisao', 'leads', _lead::text, jsonb_build_object('decisao', v_dec, 'motivos', mot, 'id', v_id, 'documentos', v_docs));
  RETURN jsonb_build_object('decisao', v_dec, 'motivos', mot, 'id', v_id, 'documentos', v_docs);
END $$;
REVOKE ALL ON FUNCTION public.captacao_decidir(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_decidir(uuid) TO service_role;

-- ───────────────────────────────────────────── 6. Documentos: liberados logo depois do teste (antes só depois da aprovação)
CREATE OR REPLACE FUNCTION public.candidatura_documentos_por_token(_token text)
RETURNS public.candidatura_documentos_link LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.candidatura_documentos_link;
BEGIN
  IF coalesce(_token, '') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'link_invalido'; END IF;
  SELECT k.* INTO v FROM candidatura_documentos_link k JOIN leads l ON l.id = k.lead_id
   WHERE k.token = _token AND l.outcome IN ('aberta', 'ganha') AND l.archived_at IS NULL;
  IF v.lead_id IS NULL THEN RAISE EXCEPTION 'link_invalido'; END IF;
  IF v.expira_em <= now() THEN RAISE EXCEPTION 'link_vencido'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_por_token(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.candidatura_documentos_link_gerar(_lead uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.edit');
  IF NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = _lead AND l.archived_at IS NULL AND (l.outcome = 'ganha'
                 OR (l.outcome = 'aberta' AND EXISTS (SELECT 1 FROM candidatura_testes t WHERE t.lead_id = l.id AND t.cancelado_em IS NULL AND t.concluido_em IS NOT NULL)))) THEN
    RAISE EXCEPTION 'O link dos documentos sai depois que a candidata conclui o teste DISC.';
  END IF;
  RETURN public.candidatura_documentos_link_garantir(_lead);
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_link_gerar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidatura_documentos_link_gerar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.captacao_teste_documentos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM leads WHERE id = NEW.lead_id AND outcome = 'aberta' AND archived_at IS NULL) THEN
    PERFORM public.candidatura_documentos_link_garantir(NEW.lead_id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.captacao_teste_documentos() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_captacao_teste_documentos ON public.candidatura_testes;
CREATE TRIGGER zz_captacao_teste_documentos AFTER UPDATE OF concluido_em ON public.candidatura_testes
  FOR EACH ROW WHEN (NEW.concluido_em IS NOT NULL AND OLD.concluido_em IS NULL) EXECUTE FUNCTION public.captacao_teste_documentos();
DROP TRIGGER IF EXISTS zz_captacao_teste_documentos_ins ON public.candidatura_testes;
CREATE TRIGGER zz_captacao_teste_documentos_ins AFTER INSERT ON public.candidatura_testes
  FOR EACH ROW WHEN (NEW.concluido_em IS NOT NULL) EXECUTE FUNCTION public.captacao_teste_documentos();

-- Para a tela final do teste (servidor): o link dos documentos da candidata deste teste
CREATE OR REPLACE FUNCTION public.candidatura_teste_documentos_token(_teste_token text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT d.token FROM candidatura_testes t
    JOIN leads l ON l.id = t.lead_id AND l.outcome IN ('aberta', 'ganha') AND l.archived_at IS NULL
    JOIN candidatura_documentos_link d ON d.lead_id = t.lead_id AND d.finalizado_em IS NULL AND d.expira_em > now()
   WHERE t.token = _teste_token AND t.concluido_em IS NOT NULL AND t.cancelado_em IS NULL
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.candidatura_teste_documentos_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_teste_documentos_token(text) TO service_role;

CREATE OR REPLACE FUNCTION public.candidatura_documentos_finalizar(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.candidatura_documentos_link := public.candidatura_documentos_por_token(_token); n int; v_dec text; v_aprovou boolean := false;
BEGIN
  SELECT count(DISTINCT tipo) INTO n FROM candidatura_documentos
   WHERE lead_id = v.lead_id AND substituido_em IS NULL AND situacao IN ('enviado', 'conferido');
  IF n < 4 THEN RAISE EXCEPTION 'faltam_documentos'; END IF;
  IF v.finalizado_em IS NOT NULL THEN RETURN jsonb_build_object('ja_enviado', true); END IF;
  UPDATE candidatura_documentos_link SET finalizado_em = now() WHERE lead_id = v.lead_id;
  PERFORM public.crm_log(v.lead_id, 'documentos', 'Documentos enviados pela candidata', NULL, '{}'::jsonb, NULL);
  -- pré-aprovada (teste + crédito dentro da regra): aprova sozinha agora
  SELECT d.decisao INTO v_dec FROM captacao_decisoes d WHERE d.lead_id = v.lead_id ORDER BY d.decidido_em DESC LIMIT 1;
  IF v_dec = 'aprovada_automatica' AND EXISTS (SELECT 1 FROM leads WHERE id = v.lead_id AND outcome = 'aberta')
     AND cardinality(public.captacao_requisitos_falta(public.captacao_requisitos(v.lead_id))) = 0 THEN
    PERFORM public.captacao_aprovar_interno(v.lead_id, NULL, 'Aprovada automaticamente: teste, crédito e documentos ok', true);
    v_aprovou := true;
  END IF;
  RETURN jsonb_build_object('ja_enviado', false, 'aprovada', v_aprovou);
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_finalizar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_documentos_finalizar(text) TO service_role;

-- ───────────────────────────────────────────── 7. Equipe: o que falta aparece na ficha
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.captacao_decisao_ver(uuid)'::regprocedure); antes := def;
  IF position('captacao_requisitos' IN def) = 0 THEN
    def := replace(def, $a$'como_conheceu', (SELECT como_conheceu FROM leads WHERE id = _lead),$a$,
      $b$'requisitos', public.captacao_requisitos(_lead),
      'falta', to_jsonb(public.captacao_requisitos_falta(public.captacao_requisitos(_lead))),
      'como_conheceu', (SELECT como_conheceu FROM leads WHERE id = _lead),$b$);
    IF def = antes THEN RAISE EXCEPTION '0412: ponto não encontrado em captacao_decisao_ver'; END IF;
    EXECUTE def;
  END IF;
END $do$;

-- ───────────────────────────────────────────── 8. Representante: vê tudo da candidata dele e pode aprovar
CREATE OR REPLACE FUNCTION public.rep_candidata_situacao(_rep uuid, _lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l leads; t candidatura_testes; tc candidatura_testes; d captacao_decisoes; c candidatura_credito_consultas;
        v_sit text; v_lib boolean; dl record; req jsonb; falta text[]; v_credito text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  SELECT * INTO l FROM leads WHERE id = _lead;
  IF l.id IS NULL OR l.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não é sua.'; END IF;
  v_lib := coalesce(public.captacao_lead_liberado(_lead), false);
  SELECT * INTO t FROM candidatura_testes WHERE lead_id = _lead AND cancelado_em IS NULL AND concluido_em IS NULL AND expira_em > now()
   ORDER BY criado_em DESC LIMIT 1;
  SELECT * INTO tc FROM candidatura_testes WHERE lead_id = _lead AND cancelado_em IS NULL AND concluido_em IS NOT NULL
   ORDER BY concluido_em DESC LIMIT 1;
  SELECT * INTO d FROM captacao_decisoes WHERE lead_id = _lead ORDER BY decidido_em DESC LIMIT 1;
  SELECT * INTO c FROM candidatura_credito_consultas WHERE lead_id = _lead AND situacao <> 'erro' ORDER BY consultado_em DESC LIMIT 1;
  SELECT token, finalizado_em, expira_em INTO dl FROM candidatura_documentos_link WHERE lead_id = _lead;
  req := public.captacao_requisitos(_lead);
  falta := public.captacao_requisitos_falta(req);
  v_credito := CASE WHEN c.id IS NULL THEN 'sem_consulta' WHEN c.situacao = 'ok' AND c.resultado = 'aprovada_regra' THEN 'dentro' ELSE 'fora' END;
  v_sit := CASE
    WHEN l.outcome = 'perdida' OR l.status::text = 'recusado' THEN 'reprovada'
    WHEN v_lib THEN 'aprovada'
    WHEN tc.id IS NULL THEN CASE WHEN t.id IS NULL THEN 'sem_teste' ELSE 'teste_em_andamento' END
    WHEN d.id IS NULL OR d.decidido_em < tc.concluido_em THEN 'aguardando_decisao'
    WHEN d.decisao = 'aprovada_automatica' THEN 'documentos'
    ELSE 'analise' END;
  RETURN jsonb_build_object(
    'situacao', v_sit, 'liberada', v_lib,
    'isenta', EXISTS (SELECT 1 FROM captacao_gate_isentas i WHERE i.lead_id = _lead),
    'teste_token', CASE WHEN tc.id IS NULL THEN t.token END, 'teste_parte', t.parte, 'teste_concluido_em', tc.concluido_em,
    'documentos_token', CASE WHEN l.outcome IN ('aberta', 'ganha') AND tc.id IS NOT NULL AND dl.token IS NOT NULL AND dl.expira_em > now() AND dl.finalizado_em IS NULL THEN dl.token END,
    'documentos_enviados', dl.finalizado_em IS NOT NULL,
    'requisitos', req, 'falta', to_jsonb(falta),
    -- o que o representante precisa para decidir (sem o relatório completo do bureau)
    'resumo', CASE WHEN tc.id IS NULL THEN NULL ELSE jsonb_build_object(
        'semaforo', coalesce(tc.resultado->>'semaforo_final', tc.resultado->>'semaforo_base'),
        'perfil_disc', tc.resultado->>'disc_principal',
        'ipl', tc.resultado->'ipl',
        'credito', v_credito, 'score', c.score, 'score_minimo', c.score_minimo,
        'motivos', CASE WHEN d.decisao = 'revisao' THEN to_jsonb(d.motivos) ELSE '[]'::jsonb END) END,
    'pode_aprovar', v_sit IN ('analise', 'documentos') AND cardinality(falta) = 0 AND v_credito = 'dentro' AND l.outcome = 'aberta');
END $$;
REVOKE ALL ON FUNCTION public.rep_candidata_situacao(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_candidata_situacao(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rep_candidata_aprovar(_rep uuid, _lead uuid, _nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l leads; c candidatura_credito_consultas; falta text[];
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  SELECT * INTO l FROM leads WHERE id = _lead FOR UPDATE;
  IF l.id IS NULL OR l.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não é sua.'; END IF;
  IF l.outcome <> 'aberta' OR l.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Esta candidatura não está mais aberta.'; END IF;
  falta := public.captacao_requisitos_falta(public.captacao_requisitos(_lead));
  IF cardinality(falta) > 0 THEN RAISE EXCEPTION 'Ainda não dá para aprovar: falta %.', array_to_string(falta, ', '); END IF;
  SELECT * INTO c FROM candidatura_credito_consultas WHERE lead_id = _lead AND situacao <> 'erro' ORDER BY consultado_em DESC LIMIT 1;
  IF c.situacao IS DISTINCT FROM 'ok' OR c.resultado IS DISTINCT FROM 'aprovada_regra' THEN
    RAISE EXCEPTION 'O crédito dela ficou fora da regra: só a Lardan (Daniel) pode aprovar.';
  END IF;
  PERFORM public.captacao_aprovar_interno(_lead, auth.uid(),
    'Aprovada pelo representante' || CASE WHEN nullif(btrim(coalesce(_nota, '')), '') IS NOT NULL THEN ': ' || btrim(_nota) ELSE '' END, false);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'captacao.aprovada_representante', 'leads', _lead::text, jsonb_build_object('representante', _rep, 'nota', left(_nota, 300)));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.rep_candidata_aprovar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_candidata_aprovar(uuid, uuid, text) TO authenticated;

-- ───────────────────────────────────────────── 9. Funil: Documentação vem antes de Aprovada
UPDATE public.candidatura_stages SET sort_order = 45 WHERE key = 'documentacao' AND sort_order <> 45;

-- ───────────────────────────────────────────── 10. Quem fez o teste e nunca passou pela Assertiva entra na fila agora
-- (testes concluídos nos últimos 45 dias, candidatura aberta, sem consulta e fora da fila). Cada uma vira uma consulta paga.
INSERT INTO public.captacao_fila (lead_id)
SELECT DISTINCT t.lead_id FROM public.candidatura_testes t JOIN public.leads l ON l.id = t.lead_id
 WHERE t.concluido_em > now() - interval '45 days' AND t.cancelado_em IS NULL
   AND l.outcome = 'aberta' AND l.archived_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.candidatura_credito_consultas c WHERE c.lead_id = l.id AND c.situacao <> 'erro')
   AND NOT EXISTS (SELECT 1 FROM public.captacao_fila f WHERE f.lead_id = l.id AND f.feito_em IS NULL)
   AND public.crm_lead_maleta(l) IS NULL
ON CONFLICT (lead_id) DO UPDATE SET feito_em = NULL, erro = NULL, tentativas = 0, proxima_em = now();

-- e quem já concluiu o teste e está aberta ganha o link dos documentos
DO $do$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT t.lead_id FROM public.candidatura_testes t JOIN public.leads l ON l.id = t.lead_id
            WHERE t.concluido_em IS NOT NULL AND t.cancelado_em IS NULL AND l.outcome = 'aberta' AND l.archived_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.candidatura_documentos_link d WHERE d.lead_id = l.id) LOOP
    PERFORM public.candidatura_documentos_link_garantir(r.lead_id);
  END LOOP;
END $do$;

-- ───────────────────────────────────────────── 11. Rede: card "Ativas" com a mesma regra do território (ativo + aprovado, 0391)
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.network_geo_overview'::regproc); antes := def;
  IF position($k$count(*) filter (where status = 'ativo') ativas,$k$ IN def) > 0 THEN
    def := replace(def, $a$count(*) filter (where status = 'ativo') ativas,$a$, $b$count(*) filter (where status in ('ativo','aprovado')) ativas,$b$);
    EXECUTE def;
  END IF;
END $do$;
