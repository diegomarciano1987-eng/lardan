CREATE TABLE IF NOT EXISTS public.captacao_config (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.captacao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.captacao_config FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.captacao_gate_isentas (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  motivo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.captacao_gate_isentas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.captacao_gate_isentas FROM PUBLIC, anon, authenticated;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.captacao_config WHERE chave = 'gate_representante_desde') THEN
    INSERT INTO public.captacao_gate_isentas (lead_id, motivo)
    SELECT l.id, CASE WHEN l.representante_origem = 'encaminhada' THEN 'encaminhada pela Lardan antes da 0398'
                      ELSE 'aprovada antes da 0398' END
      FROM public.leads l
     WHERE l.representante_party_id IS NOT NULL AND l.outcome <> 'perdida'
       AND (l.status::text = 'aprovado' OR l.outcome = 'ganha' OR l.party_id IS NOT NULL OR l.representante_origem = 'encaminhada')
    ON CONFLICT DO NOTHING;
    INSERT INTO public.captacao_config (chave, valor) VALUES ('gate_representante_desde', to_jsonb(now()));
  END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.captacao_lead_liberado(_lead uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT l.outcome <> 'perdida' AND l.status::text <> 'recusado' AND (
           l.outcome = 'ganha'
        OR EXISTS (SELECT 1 FROM captacao_gate_isentas i WHERE i.lead_id = l.id)
        OR (l.party_id IS NOT NULL AND EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id = l.party_id
                                                AND c.status NOT IN ('cancelada', 'rascunho'))))
    FROM leads l WHERE l.id = _lead
$$;
REVOKE ALL ON FUNCTION public.captacao_lead_liberado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_lead_liberado(uuid) TO service_role;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.rep_maleta_repassar(uuid,uuid,uuid,uuid)'::regprocedure); antes := def;
  IF position('0398' IN def) = 0 THEN
    def := replace(def,
      $a$IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não é sua.'; END IF;$a$,
      $b$IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não é sua.'; END IF;
    -- 0398: teste de perfil + análise da Lardan antes da maleta
    IF NOT coalesce(public.captacao_lead_liberado(le.id), false) THEN
      RAISE EXCEPTION 'Esta candidata ainda não foi aprovada pela Lardan. Ela precisa fazer o teste de perfil e passar na análise antes de receber a maleta.';
    END IF;$b$);
    IF def = antes THEN RAISE EXCEPTION '0398: ponto não encontrado em rep_maleta_repassar'; END IF;
    EXECUTE def;
  END IF;
END $do$;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.rep_abertura_rua_cadastrar(uuid,jsonb,jsonb)'::regprocedure); antes := def;
  IF position('0398' IN def) = 0 THEN
    def := replace(def,
      $a$street_number = v_num, party_id = pid, status = 'aprovado', updated_at = now() WHERE id = v_lead;$a$,
      $b$street_number = v_num, party_id = pid, data_nascimento = coalesce(data_nascimento, v_nasc),
    -- 0398: quem aprova é a Lardan (teste + análise); o cadastro só deixa em análise
    status = CASE WHEN status::text IN ('aprovado', 'recusado') THEN status ELSE 'em_analise'::lead_status END, updated_at = now() WHERE id = v_lead;$b$);
    def := replace(def,
      $a$VALUES (pid, 'candidata', 'aprovado', current_date, uid) ON CONFLICT DO NOTHING;$a$,
      $b$VALUES (pid, 'candidata', 'em_analise', current_date, uid) ON CONFLICT DO NOTHING;$b$);
    def := replace(def,
      $a$'Abertura na rua pelo representante (decisão de campo)'$a$,
      $b$'Cadastro na rua pelo representante; segue para o teste e a análise da Lardan'$b$);
    IF def = antes OR position('em_analise''::lead_status' IN def) = 0 THEN RAISE EXCEPTION '0398: ponto não encontrado em rep_abertura_rua_cadastrar'; END IF;
    EXECUTE def;
  END IF;
END $do$;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.rep_crm_lead_criar(uuid,text,text,text,text,text)'::regprocedure); antes := def;
  IF position('0398' IN def) = 0 THEN
    def := replace(def,
      $a$IF dono IS NOT NULL AND dono <> _rep THEN RAISE EXCEPTION 'Esta candidata já está com outro representante. Fale com a Lardan.'; END IF;$a$,
      $b$IF dono IS NOT NULL AND dono <> _rep THEN RAISE EXCEPTION 'Esta candidata já está com outro representante. Fale com a Lardan.'; END IF;
    -- 0398: candidatura do site é da Lardan; só a Lardan encaminha para um representante
    IF dono IS NULL THEN RAISE EXCEPTION 'Esta pessoa já se candidatou pelo site da Lardan. Quem atende é a Lardan: fale com o Daniel.'; END IF;$b$);
    IF def = antes THEN RAISE EXCEPTION '0398: ponto não encontrado em rep_crm_lead_criar'; END IF;
    EXECUTE def;
  END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.rep_crm_coluna_sistema(_l leads)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _l.party_id IS NOT NULL AND EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id = _l.party_id AND c.status NOT IN ('cancelada', 'rascunho')) THEN 'primeira_maleta'
    WHEN _l.status::text = 'recusado' OR _l.outcome = 'perdida' THEN 'nao_aprovada'
    WHEN _l.status::text = 'aprovado' OR _l.outcome = 'ganha'
      OR (_l.party_id IS NOT NULL AND EXISTS (SELECT 1 FROM captacao_gate_isentas i WHERE i.lead_id = _l.id)) THEN 'aprovada'
    ELSE NULL END
$$;

CREATE TABLE IF NOT EXISTS public.candidatura_documentos_link (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CHECK (token ~ '^[a-f0-9]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  finalizado_em timestamptz,
  criado_por uuid
);
ALTER TABLE public.candidatura_documentos_link ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candidatura_documentos_link FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.candidatura_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('documento', 'comprovante', 'selfie', 'fachada')),
  arquivo_path text NOT NULL,
  mime text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  enviado_em timestamptz NOT NULL DEFAULT now(),
  situacao text NOT NULL DEFAULT 'enviado' CHECK (situacao IN ('enviado', 'conferido', 'refazer')),
  motivo text,
  conferido_por uuid,
  conferido_em timestamptz,
  substituido_em timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS candidatura_documentos_atual ON public.candidatura_documentos (lead_id, tipo) WHERE substituido_em IS NULL;
ALTER TABLE public.candidatura_documentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candidatura_documentos FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_candidata_situacao(_rep uuid, _lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l leads; t candidatura_testes; tc candidatura_testes; d captacao_decisoes; v_sit text; v_lib boolean; dl record;
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
  SELECT token, finalizado_em, expira_em INTO dl FROM candidatura_documentos_link WHERE lead_id = _lead;
  v_sit := CASE
    WHEN l.outcome = 'perdida' OR l.status::text = 'recusado' THEN 'reprovada'
    WHEN v_lib THEN 'aprovada'
    WHEN tc.id IS NULL THEN CASE WHEN t.id IS NULL THEN 'sem_teste' ELSE 'teste_em_andamento' END
    WHEN d.id IS NOT NULL AND d.decisao = 'revisao' AND d.decidido_em >= tc.concluido_em THEN 'analise'
    ELSE 'aguardando_decisao' END;
  RETURN jsonb_build_object(
    'situacao', v_sit, 'liberada', v_lib,
    'isenta', EXISTS (SELECT 1 FROM captacao_gate_isentas i WHERE i.lead_id = _lead),
    'teste_token', CASE WHEN tc.id IS NULL THEN t.token END, 'teste_parte', t.parte, 'teste_concluido_em', tc.concluido_em,
    'documentos_token', CASE WHEN v_lib AND dl.token IS NOT NULL AND dl.expira_em > now() THEN dl.token END,
    'documentos_enviados', dl.finalizado_em IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.rep_candidata_situacao(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_candidata_situacao(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.captacao_mover_etapa(_lead uuid, _key text, _nota text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_de uuid; v_para uuid;
BEGIN
  SELECT stage_id INTO v_de FROM leads WHERE id = _lead FOR UPDATE;
  SELECT id INTO v_para FROM candidatura_stages WHERE key = _key AND is_active;
  IF v_para IS NULL OR v_para = v_de THEN RETURN; END IF;
  UPDATE leads SET stage_id = v_para, stage_entered_at = now(), updated_at = now() WHERE id = _lead;
  INSERT INTO candidatura_stage_history (lead_id, from_stage_id, to_stage_id, actor_id, note) VALUES (_lead, v_de, v_para, auth.uid(), _nota);
END $$;
REVOKE ALL ON FUNCTION public.captacao_mover_etapa(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.candidatura_documentos_link_garantir(_lead uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.candidatura_documentos_link; novo text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  SELECT * INTO v FROM candidatura_documentos_link WHERE lead_id = _lead FOR UPDATE;
  IF v.lead_id IS NULL THEN
    INSERT INTO candidatura_documentos_link (lead_id, token, expira_em, criado_por) VALUES (_lead, novo, now() + interval '30 days', auth.uid())
    ON CONFLICT (lead_id) DO NOTHING;
    PERFORM public.crm_log(_lead, 'documentos', 'Link dos documentos criado', NULL, '{}'::jsonb, NULL);
    RETURN (SELECT token FROM candidatura_documentos_link WHERE lead_id = _lead);
  END IF;
  IF v.expira_em <= now() + interval '3 days' AND v.finalizado_em IS NULL THEN
    UPDATE candidatura_documentos_link SET token = novo, expira_em = now() + interval '30 days' WHERE lead_id = _lead;
    PERFORM public.crm_log(_lead, 'documentos', 'Link dos documentos renovado', NULL, '{}'::jsonb, NULL);
    RETURN novo;
  END IF;
  RETURN v.token;
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_link_garantir(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_documentos_link_garantir(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.captacao_aprovada_documentos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.candidatura_documentos_link_garantir(NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.captacao_aprovada_documentos() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_captacao_aprovada_documentos ON public.leads;
CREATE TRIGGER zz_captacao_aprovada_documentos AFTER UPDATE OF outcome ON public.leads
  FOR EACH ROW WHEN (NEW.outcome = 'ganha' AND OLD.outcome IS DISTINCT FROM 'ganha')
  EXECUTE FUNCTION public.captacao_aprovada_documentos();

CREATE OR REPLACE FUNCTION public.candidatura_documentos_por_token(_token text)
RETURNS public.candidatura_documentos_link LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.candidatura_documentos_link;
BEGIN
  IF coalesce(_token, '') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'link_invalido'; END IF;
  SELECT k.* INTO v FROM candidatura_documentos_link k JOIN leads l ON l.id = k.lead_id
   WHERE k.token = _token AND l.outcome = 'ganha' AND l.archived_at IS NULL;
  IF v.lead_id IS NULL THEN RAISE EXCEPTION 'link_invalido'; END IF;
  IF v.expira_em <= now() THEN RAISE EXCEPTION 'link_vencido'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_por_token(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.candidatura_documentos_abrir(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.candidatura_documentos_link := public.candidatura_documentos_por_token(_token);
BEGIN
  RETURN jsonb_build_object(
    'primeiro_nome', (SELECT coalesce(nullif(btrim(first_name), ''), split_part(btrim(full_name), ' ', 1)) FROM leads WHERE id = v.lead_id),
    'finalizado_em', v.finalizado_em,
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', d.tipo, 'situacao', d.situacao, 'motivo', CASE WHEN d.situacao = 'refazer' THEN d.motivo END,
                                                           'enviado_em', d.enviado_em) ORDER BY d.tipo)
                         FROM candidatura_documentos d WHERE d.lead_id = v.lead_id AND d.substituido_em IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_abrir(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_documentos_abrir(text) TO service_role;

CREATE OR REPLACE FUNCTION public.candidatura_documento_caminho(_token text, _tipo text, _ext text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.candidatura_documentos_link := public.candidatura_documentos_por_token(_token);
BEGIN
  IF _tipo NOT IN ('documento', 'comprovante', 'selfie', 'fachada') THEN RAISE EXCEPTION 'tipo_invalido'; END IF;
  IF _ext NOT IN ('jpg', 'png', 'webp', 'heic', 'pdf') OR (_ext = 'pdf' AND _tipo <> 'comprovante') THEN RAISE EXCEPTION 'formato_invalido'; END IF;
  IF EXISTS (SELECT 1 FROM candidatura_documentos WHERE lead_id = v.lead_id AND tipo = _tipo AND substituido_em IS NULL AND situacao = 'conferido') THEN
    RAISE EXCEPTION 'ja_conferido';
  END IF;
  RETURN v.lead_id::text || '/' || _tipo || '/' || replace(gen_random_uuid()::text, '-', '') || '.' || _ext;
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documento_caminho(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_documento_caminho(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.candidatura_documento_registrar(_token text, _tipo text, _path text, _mime text, _bytes integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.candidatura_documentos_link := public.candidatura_documentos_por_token(_token); v_id uuid;
BEGIN
  IF _tipo NOT IN ('documento', 'comprovante', 'selfie', 'fachada') THEN RAISE EXCEPTION 'tipo_invalido'; END IF;
  IF coalesce(_path, '') !~ ('^' || v.lead_id::text || '/' || _tipo || '/[a-f0-9]{32}\.(jpg|png|webp|heic|pdf)$') THEN RAISE EXCEPTION 'arquivo_invalido'; END IF;
  IF EXISTS (SELECT 1 FROM candidatura_documentos WHERE lead_id = v.lead_id AND tipo = _tipo AND substituido_em IS NULL AND situacao = 'conferido') THEN
    RAISE EXCEPTION 'ja_conferido';
  END IF;
  IF EXISTS (SELECT 1 FROM candidatura_documentos WHERE arquivo_path = _path) THEN RAISE EXCEPTION 'arquivo_repetido'; END IF;
  UPDATE candidatura_documentos SET substituido_em = now() WHERE lead_id = v.lead_id AND tipo = _tipo AND substituido_em IS NULL;
  INSERT INTO candidatura_documentos (lead_id, tipo, arquivo_path, mime, bytes) VALUES (v.lead_id, _tipo, _path, left(_mime, 60), _bytes)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documento_registrar(text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_documento_registrar(text, text, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.candidatura_documentos_finalizar(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.candidatura_documentos_link := public.candidatura_documentos_por_token(_token); n int;
BEGIN
  SELECT count(DISTINCT tipo) INTO n FROM candidatura_documentos
   WHERE lead_id = v.lead_id AND substituido_em IS NULL AND situacao IN ('enviado', 'conferido');
  IF n < 4 THEN RAISE EXCEPTION 'faltam_documentos'; END IF;
  IF v.finalizado_em IS NOT NULL THEN RETURN jsonb_build_object('ja_enviado', true); END IF;
  UPDATE candidatura_documentos_link SET finalizado_em = now() WHERE lead_id = v.lead_id;
  IF EXISTS (SELECT 1 FROM leads l JOIN candidatura_stages s ON s.id = l.stage_id WHERE l.id = v.lead_id AND s.key IN ('aprovada', 'avaliacao', 'teste', 'conversa', 'nova')) THEN
    PERFORM public.captacao_mover_etapa(v.lead_id, 'documentacao', 'Documentos enviados pela candidata');
  END IF;
  PERFORM public.crm_log(v.lead_id, 'documentos', 'Documentos enviados pela candidata', NULL, '{}'::jsonb, NULL);
  RETURN jsonb_build_object('ja_enviado', false);
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_finalizar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_documentos_finalizar(text) TO service_role;

CREATE OR REPLACE FUNCTION public.candidatura_documentos_ver(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN jsonb_build_object(
    'aprovada', (SELECT outcome = 'ganha' FROM leads WHERE id = _lead),
    'link', (SELECT jsonb_build_object('token', token, 'expira_em', expira_em, 'finalizado_em', finalizado_em, 'vencido', expira_em <= now())
               FROM candidatura_documentos_link WHERE lead_id = _lead),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'situacao', d.situacao, 'motivo', d.motivo, 'mime', d.mime,
                                                           'enviado_em', d.enviado_em, 'conferido_em', d.conferido_em, 'path', d.arquivo_path) ORDER BY d.tipo)
                         FROM candidatura_documentos d WHERE d.lead_id = _lead AND d.substituido_em IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidatura_documentos_ver(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.candidatura_documentos_link_gerar(_lead uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.edit');
  IF NOT EXISTS (SELECT 1 FROM leads WHERE id = _lead AND outcome = 'ganha') THEN RAISE EXCEPTION 'Só candidata aprovada recebe o link dos documentos.'; END IF;
  RETURN public.candidatura_documentos_link_garantir(_lead);
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_link_gerar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidatura_documentos_link_gerar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.candidatura_documento_conferir(_doc uuid, _ok boolean, _motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d candidatura_documentos; v_mot text := nullif(btrim(coalesce(_motivo, '')), '');
BEGIN
  PERFORM public.crm_require('candidaturas.edit');
  SELECT * INTO d FROM candidatura_documentos WHERE id = _doc FOR UPDATE;
  IF d.id IS NULL OR d.substituido_em IS NOT NULL THEN RAISE EXCEPTION 'Documento não encontrado (ou já foi trocado por outro).'; END IF;
  IF NOT _ok AND (v_mot IS NULL OR length(v_mot) < 5) THEN RAISE EXCEPTION 'Escreva o que ela precisa refazer.'; END IF;
  UPDATE candidatura_documentos SET situacao = CASE WHEN _ok THEN 'conferido' ELSE 'refazer' END, motivo = CASE WHEN _ok THEN NULL ELSE left(v_mot, 300) END,
         conferido_por = auth.uid(), conferido_em = now() WHERE id = _doc;
  IF NOT _ok THEN
    UPDATE candidatura_documentos_link SET finalizado_em = NULL, expira_em = greatest(expira_em, now() + interval '15 days') WHERE lead_id = d.lead_id;
  END IF;
  PERFORM public.crm_log(d.lead_id, 'documentos', CASE WHEN _ok THEN 'Documento conferido' ELSE 'Documento pedido de novo' END,
    CASE WHEN _ok THEN NULL ELSE v_mot END, jsonb_build_object('tipo', d.tipo, 'documento', d.id), NULL);
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documento_conferir(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidatura_documento_conferir(uuid, boolean, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.captacao_envios (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  modo text NOT NULL CHECK (modo IN ('correios', 'representante')),
  representante_party_id uuid REFERENCES public.parties(id),
  nota text,
  definido_por uuid,
  definido_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((modo = 'representante') = (representante_party_id IS NOT NULL))
);
ALTER TABLE public.captacao_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.captacao_envios FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.captacao_aprovadas(_canal text DEFAULT 'site')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'aprovada_em' DESC) FROM (
    SELECT jsonb_build_object(
      'id', l.id, 'nome', l.full_name, 'cidade', l.city, 'uf', l.uf, 'whatsapp', l.whatsapp, 'protocolo', l.protocol,
      'canal', public.captacao_canal(l), 'aprovada_em', coalesce(l.won_at, l.updated_at),
      'automatica', l.won_by IS NULL AND EXISTS (SELECT 1 FROM captacao_decisoes d WHERE d.lead_id = l.id AND d.decisao = 'aprovada_automatica'),
      'representante', (SELECT jsonb_build_object('id', p.id, 'nome', p.display_name) FROM parties p WHERE p.id = l.representante_party_id),
      'representante_origem', l.representante_origem,
      'docs', jsonb_build_object(
        'token', (SELECT CASE WHEN k.expira_em > now() THEN k.token END FROM candidatura_documentos_link k WHERE k.lead_id = l.id),
        'finalizado_em', (SELECT k.finalizado_em FROM candidatura_documentos_link k WHERE k.lead_id = l.id),
        'enviados', (SELECT count(*) FROM candidatura_documentos d WHERE d.lead_id = l.id AND d.substituido_em IS NULL AND d.situacao <> 'refazer'),
        'conferidos', (SELECT count(*) FROM candidatura_documentos d WHERE d.lead_id = l.id AND d.substituido_em IS NULL AND d.situacao = 'conferido'),
        'refazer', (SELECT count(*) FROM candidatura_documentos d WHERE d.lead_id = l.id AND d.substituido_em IS NULL AND d.situacao = 'refazer')),
      'envio', (SELECT jsonb_build_object('modo', e.modo, 'nota', e.nota, 'em', e.definido_em,
                                          'representante', (SELECT display_name FROM parties WHERE id = e.representante_party_id))
                  FROM captacao_envios e WHERE e.lead_id = l.id)) x
      FROM leads l
     WHERE l.outcome = 'ganha' AND l.archived_at IS NULL
       AND public.captacao_canal(l) = coalesce(nullif(_canal, ''), 'site')
       AND public.crm_lead_maleta(l) IS NULL
     ORDER BY coalesce(l.won_at, l.updated_at) DESC
     LIMIT 300) s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.captacao_aprovadas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.captacao_aprovadas(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.captacao_envio_definir(_lead uuid, _modo text, _rep uuid DEFAULT NULL, _nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l leads; v_nome text; v_nota text := nullif(btrim(coalesce(_nota, '')), '');
BEGIN
  PERFORM public.crm_require('candidaturas.assign');
  SELECT * INTO l FROM leads WHERE id = _lead FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Candidatura não encontrada.'; END IF;
  IF l.outcome <> 'ganha' THEN RAISE EXCEPTION 'Só candidata aprovada.'; END IF;
  IF public.captacao_canal(l) <> 'site' THEN RAISE EXCEPTION 'Candidata de representante volta para ele: não precisa escolher.'; END IF;
  IF public.crm_lead_maleta(l) IS NOT NULL THEN RAISE EXCEPTION 'Ela já tem maleta.'; END IF;
  IF _modo NOT IN ('correios', 'representante') THEN RAISE EXCEPTION 'Escolha Correios ou representante.'; END IF;
  IF _modo = 'representante' THEN
    IF _rep IS NULL THEN RAISE EXCEPTION 'Escolha o representante.'; END IF;
    SELECT p.display_name INTO v_nome FROM parties p
     WHERE p.id = _rep AND p.status NOT IN ('bloqueado', 'desligado', 'inativo')
       AND EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id = p.id AND r.role = 'representante');
    IF v_nome IS NULL THEN RAISE EXCEPTION 'Pessoa escolhida não é representante ativo.'; END IF;
    UPDATE leads SET representante_party_id = _rep, representante_origem = 'encaminhada', updated_at = now() WHERE id = _lead;
  ELSE
    _rep := NULL;
    UPDATE leads SET representante_party_id = NULL, representante_origem = NULL, updated_at = now()
     WHERE id = _lead AND representante_origem = 'encaminhada';
  END IF;
  INSERT INTO captacao_envios (lead_id, modo, representante_party_id, nota, definido_por, definido_em)
  VALUES (_lead, _modo, _rep, left(v_nota, 300), auth.uid(), now())
  ON CONFLICT (lead_id) DO UPDATE SET modo = excluded.modo, representante_party_id = excluded.representante_party_id,
    nota = excluded.nota, definido_por = excluded.definido_por, definido_em = excluded.definido_em;
  PERFORM public.crm_log(_lead, 'envio',
    CASE WHEN _modo = 'correios' THEN 'Maleta: a Lardan monta e envia pelos Correios' ELSE 'Maleta: encaminhada para o representante ' || v_nome END,
    v_nota, jsonb_build_object('modo', _modo, 'representante', _rep), NULL);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'captacao.envio_definido', 'leads', _lead::text, jsonb_build_object('modo', _modo, 'representante', _rep));
  RETURN jsonb_build_object('modo', _modo, 'representante', v_nome);
END $$;
REVOKE ALL ON FUNCTION public.captacao_envio_definir(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.captacao_envio_definir(uuid, text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.captacao_representantes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.assign');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.display_name,
      'whatsapp', (SELECT regexp_replace(cp.value, '\D', '', 'g') FROM contact_points cp WHERE cp.party_id = p.id AND cp.kind = 'whatsapp'
                    ORDER BY cp.is_primary DESC LIMIT 1)) ORDER BY p.display_name)
    FROM parties p WHERE p.status NOT IN ('bloqueado', 'desligado', 'inativo') AND p.is_active
     AND EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id = p.id AND r.role = 'representante')), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.captacao_representantes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.captacao_representantes() TO authenticated;