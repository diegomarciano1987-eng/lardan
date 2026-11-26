-- 0402 — Lara, a assistente de captação no WhatsApp oficial (Diego/Daniel, 26/11/2026).
-- Desligada até o Master ligar. Nenhum envio acontece pela aplicação desta estrutura.

-- A ausência da configuração já significa Lara desligada; o Master cria a linha ao usar lara_ligar.

CREATE TABLE IF NOT EXISTS public.lara_conversas (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  wa_id text NOT NULL CHECK (wa_id ~ '^[0-9]{10,15}$'),
  estado text NOT NULL DEFAULT 'nova' CHECK (estado IN ('nova', 'msg1', 'msg2', 'teste', 'lembrete', 'teste_feito', 'pensando',
                                                        'desistiu', 'expirada', 'aprovada', 'recusada', 'revisao_pedida')),
  humano boolean NOT NULL DEFAULT false,
  humano_motivo text,
  humano_desde timestamptz,
  humano_por uuid,
  opt_out boolean NOT NULL DEFAULT false,
  ultima_entrada_em timestamptz,
  ultima_saida_em timestamptz,
  proxima_acao_em timestamptz,
  nao_lidas integer NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.lara_conversas TO service_role;
CREATE INDEX IF NOT EXISTS lara_conversas_wa ON public.lara_conversas (wa_id);
CREATE INDEX IF NOT EXISTS lara_conversas_acao ON public.lara_conversas (proxima_acao_em) WHERE proxima_acao_em IS NOT NULL;
ALTER TABLE public.lara_conversas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lara_conversas FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.lara_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  wa_id text NOT NULL,
  direcao text NOT NULL CHECK (direcao IN ('entrada', 'saida')),
  tipo text NOT NULL,
  texto text,
  template text,
  autor text NOT NULL CHECK (autor IN ('candidata', 'lara', 'equipe')),
  autor_id uuid,
  wa_message_id text UNIQUE,
  status text NOT NULL DEFAULT 'recebida' CHECK (status IN ('recebida', 'enviada', 'entregue', 'lida', 'falhou')),
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.lara_mensagens TO service_role;
CREATE INDEX IF NOT EXISTS lara_mensagens_lead ON public.lara_mensagens (lead_id, criado_em);
CREATE INDEX IF NOT EXISTS lara_mensagens_wa ON public.lara_mensagens (wa_id, criado_em);
ALTER TABLE public.lara_mensagens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lara_mensagens FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.lara_fila (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  wa_id text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('template', 'texto', 'botoes')),
  conteudo jsonb NOT NULL,
  registro text NOT NULL,
  autor text NOT NULL DEFAULT 'lara' CHECK (autor IN ('lara', 'equipe')),
  autor_id uuid,
  chave text UNIQUE,
  proxima_em timestamptz NOT NULL DEFAULT now(),
  tentativas integer NOT NULL DEFAULT 0,
  enviado_em timestamptz,
  cancelado_em timestamptz,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.lara_fila TO service_role;
CREATE INDEX IF NOT EXISTS lara_fila_pendente ON public.lara_fila (proxima_em) WHERE enviado_em IS NULL AND cancelado_em IS NULL;
ALTER TABLE public.lara_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lara_fila FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.captacao_revisao_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  texto text,
  pedido_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  resolvido_por uuid
);
GRANT ALL ON public.captacao_revisao_pedidos TO service_role;
CREATE INDEX IF NOT EXISTS captacao_revisao_aberta ON public.captacao_revisao_pedidos (lead_id) WHERE resolvido_em IS NULL;
ALTER TABLE public.captacao_revisao_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.captacao_revisao_pedidos FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lara_ativa()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT valor = 'true'::jsonb FROM captacao_config WHERE chave = 'lara_ativa'), false)
$$;
REVOKE ALL ON FUNCTION public.lara_ativa() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_ativa() TO service_role;

CREATE OR REPLACE FUNCTION public.lara_tel_chave(_tel text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN length(d) >= 10 THEN left(d, 2) || right(d, 8) END
    FROM (SELECT CASE WHEN length(x) >= 12 AND left(x, 2) = '55' THEN substr(x, 3) ELSE x END d
             FROM (SELECT regexp_replace(coalesce(_tel, ''), '\D', '', 'g') x) a) b
$$;
CREATE INDEX IF NOT EXISTS leads_lara_tel ON public.leads (public.lara_tel_chave(whatsapp_norm));

CREATE OR REPLACE FUNCTION public.lara_wa(_tel text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN length(d) IN (10, 11) THEN '55' || d WHEN length(d) IN (12, 13) AND left(d, 2) = '55' THEN d END
    FROM (SELECT regexp_replace(coalesce(_tel, ''), '\D', '', 'g') d) a
$$;

CREATE OR REPLACE FUNCTION public.lara_primeiro_nome(_l leads)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT initcap(lower(coalesce(nullif(btrim(_l.first_name), ''), split_part(btrim(_l.full_name), ' ', 1))))
$$;

CREATE OR REPLACE FUNCTION public.lara_enfileirar(_lead uuid, _wa text, _tipo text, _conteudo jsonb, _registro text,
  _chave text DEFAULT NULL, _autor text DEFAULT 'lara', _autor_id uuid DEFAULT NULL, _quando timestamptz DEFAULT now())
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO lara_fila (lead_id, wa_id, tipo, conteudo, registro, chave, autor, autor_id, proxima_em)
  VALUES (_lead, _wa, _tipo, _conteudo, left(_registro, 4000), _chave, _autor, _autor_id, coalesce(_quando, now()))
  ON CONFLICT (chave) DO NOTHING RETURNING id INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.lara_enfileirar(uuid, text, text, jsonb, text, text, text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_enfileirar(uuid, text, text, jsonb, text, text, text, uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_iniciar(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l leads; v_wa text; v_nome text; v_sonho text;
BEGIN
  IF NOT public.lara_ativa() THEN RETURN jsonb_build_object('iniciada', false, 'motivo', 'lara_desligada'); END IF;
  SELECT * INTO l FROM leads WHERE id = _lead;
  IF l.id IS NULL THEN RETURN jsonb_build_object('iniciada', false, 'motivo', 'sem_candidatura'); END IF;
  IF public.captacao_canal(l) <> 'site' OR l.outcome <> 'aberta' OR l.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('iniciada', false, 'motivo', 'fora_do_site_ou_encerrada');
  END IF;
  IF EXISTS (SELECT 1 FROM lara_conversas WHERE lead_id = _lead) THEN RETURN jsonb_build_object('iniciada', false, 'motivo', 'ja_existe'); END IF;
  v_wa := public.lara_wa(l.whatsapp_norm);
  IF v_wa IS NULL THEN RETURN jsonb_build_object('iniciada', false, 'motivo', 'whatsapp_invalido'); END IF;
  IF EXISTS (SELECT 1 FROM lara_conversas c JOIN leads o ON o.id = c.lead_id
              WHERE public.lara_tel_chave(c.wa_id) = public.lara_tel_chave(v_wa) AND o.outcome = 'aberta' AND c.lead_id <> _lead) THEN
    RETURN jsonb_build_object('iniciada', false, 'motivo', 'numero_com_conversa');
  END IF;
  v_nome := public.lara_primeiro_nome(l);
  v_sonho := left(coalesce(nullif(btrim(l.dream), ''), 'crescer com a Lardan'), 120);
  INSERT INTO lara_conversas (lead_id, wa_id, estado) VALUES (_lead, v_wa, 'msg1');
  PERFORM public.lara_enfileirar(_lead, v_wa, 'template',
    jsonb_build_object('template', 'lara_candidatura_recebida', 'params', jsonb_build_array(v_nome, v_sonho)),
    'Mensagem 1 (modelo): candidatura recebida, como conheceu e interesse no consignado', 'msg1:' || _lead::text);
  IF EXISTS (SELECT 1 FROM leads x JOIN candidatura_stages s ON s.id = x.stage_id WHERE x.id = _lead AND s.key = 'nova') THEN
    PERFORM public.captacao_mover_etapa(_lead, 'conversa', 'Lara iniciou a conversa no WhatsApp');
  END IF;
  PERFORM public.crm_log(_lead, 'whatsapp', 'Lara iniciou a conversa no WhatsApp', NULL, '{}'::jsonb, NULL);
  RETURN jsonb_build_object('iniciada', true);
END $$;
REVOKE ALL ON FUNCTION public.lara_iniciar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_iniciar(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_iniciar_protocolo(_protocolo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM leads WHERE protocol = _protocolo;
  IF v IS NULL THEN RETURN jsonb_build_object('iniciada', false, 'motivo', 'sem_candidatura'); END IF;
  RETURN public.lara_iniciar(v);
END $$;
REVOKE ALL ON FUNCTION public.lara_iniciar_protocolo(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_iniciar_protocolo(text) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_fila_pegar(_n integer DEFAULT 20)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE lara_fila f SET cancelado_em = now(), erro = 'pediu para não receber mensagens'
   WHERE f.enviado_em IS NULL AND f.cancelado_em IS NULL
     AND EXISTS (SELECT 1 FROM lara_conversas c WHERE c.lead_id = f.lead_id AND c.opt_out);
  RETURN QUERY
  WITH pegos AS (
    SELECT id FROM lara_fila
     WHERE enviado_em IS NULL AND cancelado_em IS NULL AND proxima_em <= now()
     ORDER BY proxima_em, criado_em
     LIMIT greatest(1, least(coalesce(_n, 20), 100))
      FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE lara_fila f SET tentativas = f.tentativas + 1, proxima_em = now() + make_interval(mins => 2 * (f.tentativas + 1))
      FROM pegos WHERE f.id = pegos.id
    RETURNING f.*
  )
  SELECT jsonb_build_object('id', u.id, 'lead_id', u.lead_id, 'wa_id', u.wa_id, 'tipo', u.tipo, 'conteudo', u.conteudo,
                            'registro', u.registro, 'autor', u.autor, 'tentativas', u.tentativas)
    FROM upd u;
END $$;
REVOKE ALL ON FUNCTION public.lara_fila_pegar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_fila_pegar(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_fila_concluir(_id uuid, _wamid text, _erro text DEFAULT NULL, _definitivo boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE f lara_fila;
BEGIN
  SELECT * INTO f FROM lara_fila WHERE id = _id FOR UPDATE;
  IF f.id IS NULL OR f.enviado_em IS NOT NULL THEN RETURN; END IF;
  IF _erro IS NULL THEN
    UPDATE lara_fila SET enviado_em = now(), erro = NULL WHERE id = _id;
    INSERT INTO lara_mensagens (lead_id, wa_id, direcao, tipo, texto, template, autor, autor_id, wa_message_id, status)
    VALUES (f.lead_id, f.wa_id, 'saida', f.tipo, f.registro, f.conteudo->>'template', f.autor, f.autor_id, nullif(_wamid, ''), 'enviada')
    ON CONFLICT (wa_message_id) DO NOTHING;
    UPDATE lara_conversas SET ultima_saida_em = now(), atualizado_em = now() WHERE lead_id = f.lead_id;
  ELSIF _definitivo OR f.tentativas >= 6 THEN
    UPDATE lara_fila SET cancelado_em = now(), erro = left(_erro, 500) WHERE id = _id;
    INSERT INTO lara_mensagens (lead_id, wa_id, direcao, tipo, texto, template, autor, autor_id, status, erro)
    VALUES (f.lead_id, f.wa_id, 'saida', f.tipo, f.registro, f.conteudo->>'template', f.autor, f.autor_id, 'falhou', left(_erro, 500));
    IF f.lead_id IS NOT NULL THEN
      PERFORM public.crm_log(f.lead_id, 'whatsapp', 'Mensagem da Lara não foi entregue', left(_erro, 300), '{}'::jsonb, NULL);
    END IF;
  ELSE
    UPDATE lara_fila SET erro = left(_erro, 500) WHERE id = _id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.lara_fila_concluir(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_fila_concluir(uuid, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_entrada(_wa_id text, _wamid text, _tipo text, _texto text, _em timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c lara_conversas; l leads; v_chave text := public.lara_tel_chave(_wa_id); v_id uuid; v_teste boolean;
BEGIN
  IF coalesce(_wa_id, '') !~ '^[0-9]{10,15}$' THEN RAISE EXCEPTION 'wa_id_invalido'; END IF;
  IF EXISTS (SELECT 1 FROM lara_mensagens WHERE wa_message_id = _wamid) THEN RETURN jsonb_build_object('duplicada', true); END IF;
  SELECT * INTO c FROM lara_conversas WHERE public.lara_tel_chave(wa_id) = v_chave ORDER BY atualizado_em DESC LIMIT 1;
  IF c.lead_id IS NOT NULL THEN SELECT * INTO l FROM leads WHERE id = c.lead_id; END IF;
  INSERT INTO lara_mensagens (lead_id, wa_id, direcao, tipo, texto, autor, wa_message_id, status, criado_em)
   VALUES (c.lead_id, _wa_id, 'entrada', left(coalesce(_tipo, 'texto'), 30), left(_texto, 4000), 'candidata', _wamid, 'recebida', coalesce(_em, now()))
  RETURNING id INTO v_id;
  IF c.lead_id IS NULL THEN
    RETURN jsonb_build_object('duplicada', false, 'mensagem_id', v_id, 'lead_id', NULL);
  END IF;
  UPDATE lara_conversas SET ultima_entrada_em = coalesce(_em, now()), nao_lidas = nao_lidas + 1, wa_id = _wa_id, atualizado_em = now()
   WHERE lead_id = c.lead_id;
  SELECT EXISTS (SELECT 1 FROM candidatura_testes t WHERE t.lead_id = c.lead_id AND t.concluido_em IS NOT NULL AND t.cancelado_em IS NULL) INTO v_teste;
  RETURN jsonb_build_object('duplicada', false, 'mensagem_id', v_id, 'lead_id', c.lead_id, 'estado', c.estado, 'humano', c.humano,
    'opt_out', c.opt_out, 'nome', public.lara_primeiro_nome(l), 'cidade', l.city, 'uf', l.uf, 'teste_concluido', v_teste,
    'como_conheceu', l.como_conheceu, 'outcome', l.outcome);
END $$;
REVOKE ALL ON FUNCTION public.lara_entrada(text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_entrada(text, text, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_status(_wamid text, _status text, _erro text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE lara_mensagens SET
    status = CASE
      WHEN _status = 'failed' THEN 'falhou'
      WHEN _status = 'read' THEN 'lida'
      WHEN _status = 'delivered' AND status NOT IN ('lida') THEN 'entregue'
      ELSE status END,
    erro = CASE WHEN _status = 'failed' THEN left(_erro, 500) ELSE erro END
   WHERE wa_message_id = _wamid AND direcao = 'saida';
END $$;
REVOKE ALL ON FUNCTION public.lara_status(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_status(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_transicao(_lead uuid, _estado text DEFAULT NULL, _proxima_em timestamptz DEFAULT NULL,
  _limpar_proxima boolean DEFAULT false, _humano_motivo text DEFAULT NULL, _como_conheceu text DEFAULT NULL, _opt_out boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c lara_conversas;
BEGIN
  SELECT * INTO c FROM lara_conversas WHERE lead_id = _lead FOR UPDATE;
  IF c.lead_id IS NULL THEN RAISE EXCEPTION 'sem_conversa'; END IF;
  UPDATE lara_conversas SET
    estado = coalesce(_estado, estado),
    proxima_acao_em = CASE WHEN _limpar_proxima THEN NULL ELSE coalesce(_proxima_em, proxima_acao_em) END,
    humano = humano OR _humano_motivo IS NOT NULL,
    humano_motivo = CASE WHEN _humano_motivo IS NOT NULL AND NOT humano THEN left(_humano_motivo, 300) ELSE humano_motivo END,
    humano_desde = CASE WHEN _humano_motivo IS NOT NULL AND NOT humano THEN now() ELSE humano_desde END,
    opt_out = opt_out OR coalesce(_opt_out, false),
    atualizado_em = now()
   WHERE lead_id = _lead;
  IF _como_conheceu IN ('indicacao', 'instagram', 'google', 'outro') THEN
    UPDATE leads SET como_conheceu = _como_conheceu WHERE id = _lead AND como_conheceu IS NULL;
  END IF;
  IF _estado = 'teste' THEN
    IF EXISTS (SELECT 1 FROM leads x JOIN candidatura_stages s ON s.id = x.stage_id WHERE x.id = _lead AND s.key IN ('nova', 'conversa')) THEN
      PERFORM public.captacao_mover_etapa(_lead, 'teste', 'Lara mandou o link do teste');
    END IF;
  END IF;
  IF _humano_motivo IS NOT NULL AND NOT c.humano THEN
    PERFORM public.crm_log(_lead, 'whatsapp', 'Lara passou a conversa para uma pessoa', _humano_motivo, '{}'::jsonb, NULL);
  END IF;
  IF coalesce(_opt_out, false) AND NOT c.opt_out THEN
    PERFORM public.crm_log(_lead, 'whatsapp', 'Pediu para não receber mais mensagens no WhatsApp', NULL, '{}'::jsonb, NULL);
  END IF;
  IF _estado IS NOT NULL AND _estado IS DISTINCT FROM c.estado AND _estado IN ('desistiu', 'pensando', 'teste', 'expirada') THEN
    PERFORM public.crm_log(_lead, 'whatsapp',
      CASE _estado WHEN 'desistiu' THEN 'Disse no WhatsApp que não tem interesse agora'
                   WHEN 'pensando' THEN 'Disse no WhatsApp que vai pensar'
                   WHEN 'teste' THEN 'Lara mandou o link do teste'
                   ELSE 'Candidatura expirou sem o teste (sem novo aviso)' END, NULL, '{}'::jsonb, NULL);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.lara_transicao(uuid, text, timestamptz, boolean, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_transicao(uuid, text, timestamptz, boolean, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_teste_token(_lead uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t candidatura_testes; v_dias int;
BEGIN
  SELECT * INTO v_t FROM candidatura_testes WHERE lead_id = _lead AND concluido_em IS NULL AND cancelado_em IS NULL ORDER BY criado_em DESC LIMIT 1 FOR UPDATE;
  IF v_t.id IS NOT NULL AND v_t.expira_em > now() + interval '1 day' THEN RETURN v_t.token; END IF;
  IF v_t.id IS NOT NULL THEN UPDATE candidatura_testes SET cancelado_em = now(), atualizado_em = now() WHERE id = v_t.id; END IF;
  SELECT coalesce((params->>'validade_dias')::int, 15) INTO v_dias FROM candidatura_teste_config ORDER BY criado_em DESC LIMIT 1;
  INSERT INTO candidatura_testes (lead_id, token, origem, expira_em, respostas)
  VALUES (_lead, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'site',
          now() + make_interval(days => coalesce(v_dias, 15)), coalesce(v_t.respostas, '{}'::jsonb))
  RETURNING * INTO v_t;
  RETURN v_t.token;
END $$;
REVOKE ALL ON FUNCTION public.lara_teste_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_teste_token(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_revisao_pedir(_lead uuid, _texto text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM captacao_revisao_pedidos WHERE lead_id = _lead AND resolvido_em IS NULL) THEN
    INSERT INTO captacao_revisao_pedidos (lead_id, texto) VALUES (_lead, left(_texto, 1000));
    PERFORM public.crm_log(_lead, 'analise', 'Candidata pediu revisão da recusa', left(_texto, 300), '{}'::jsonb, NULL);
  END IF;
  PERFORM public.lara_transicao(_lead, 'revisao_pedida', NULL, true, 'Pediu revisão da recusa');
END $$;
REVOKE ALL ON FUNCTION public.lara_revisao_pedir(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_revisao_pedir(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.lara_prazos()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n_lembrete int := 0; n_expira int := 0; v_token text;
BEGIN
  FOR r IN SELECT c.*, l.outcome, public.lara_primeiro_nome(l) nome FROM lara_conversas c JOIN leads l ON l.id = c.lead_id
            WHERE c.proxima_acao_em <= now() AND c.estado IN ('teste', 'lembrete') AND NOT c.opt_out
            ORDER BY c.proxima_acao_em LIMIT 200 FOR UPDATE OF c SKIP LOCKED LOOP
    IF EXISTS (SELECT 1 FROM candidatura_testes t WHERE t.lead_id = r.lead_id AND t.concluido_em IS NOT NULL AND t.cancelado_em IS NULL) THEN
      UPDATE lara_conversas SET estado = 'teste_feito', proxima_acao_em = NULL, atualizado_em = now() WHERE lead_id = r.lead_id;
    ELSIF r.outcome <> 'aberta' THEN
      UPDATE lara_conversas SET proxima_acao_em = NULL, atualizado_em = now() WHERE lead_id = r.lead_id;
    ELSIF r.estado = 'teste' THEN
      v_token := public.lara_teste_token(r.lead_id);
      PERFORM public.lara_enfileirar(r.lead_id, r.wa_id, 'template',
        jsonb_build_object('template', 'lara_lembrete_teste', 'params', jsonb_build_array(r.nome), 'url', v_token),
        'Lembrete (modelo): o teste ainda não ficou pronto', 'lembrete:' || r.lead_id::text);
      UPDATE lara_conversas SET estado = 'lembrete', proxima_acao_em = now() + interval '3 days', atualizado_em = now() WHERE lead_id = r.lead_id;
      n_lembrete := n_lembrete + 1;
    ELSE
      PERFORM public.lara_transicao(r.lead_id, 'expirada', NULL, true);
      n_expira := n_expira + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('lembretes', n_lembrete, 'expiradas', n_expira);
END $$;
REVOKE ALL ON FUNCTION public.lara_prazos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lara_prazos() TO service_role;

CREATE OR REPLACE FUNCTION public.lara_teste_concluido_gatilho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE lara_conversas SET estado = 'teste_feito', proxima_acao_em = NULL, atualizado_em = now()
   WHERE lead_id = NEW.lead_id AND estado IN ('nova', 'msg1', 'msg2', 'teste', 'lembrete', 'pensando', 'expirada');
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.lara_teste_concluido_gatilho() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_lara_teste_concluido ON public.candidatura_testes;
CREATE TRIGGER zz_lara_teste_concluido AFTER UPDATE OF concluido_em ON public.candidatura_testes
  FOR EACH ROW WHEN (NEW.concluido_em IS NOT NULL AND OLD.concluido_em IS NULL) EXECUTE FUNCTION public.lara_teste_concluido_gatilho();

CREATE OR REPLACE FUNCTION public.lara_resultado_gatilho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c lara_conversas; v_token text; v_nome text := public.lara_primeiro_nome(NEW);
BEGIN
  SELECT * INTO c FROM lara_conversas WHERE lead_id = NEW.id;
  IF c.lead_id IS NULL OR c.opt_out OR NOT public.lara_ativa() THEN RETURN NULL; END IF;
  IF NEW.outcome = 'ganha' THEN
    SELECT token INTO v_token FROM candidatura_documentos_link WHERE lead_id = NEW.id AND expira_em > now() AND finalizado_em IS NULL;
    IF v_token IS NOT NULL THEN
      PERFORM public.lara_enfileirar(NEW.id, c.wa_id, 'template',
        jsonb_build_object('template', 'lara_aprovada_documentos', 'params', jsonb_build_array(v_nome), 'url', v_token),
        'Aprovação (modelo): parabéns e link dos 4 documentos', 'aprovada:' || NEW.id::text);
    END IF;
    UPDATE lara_conversas SET estado = 'aprovada', proxima_acao_em = NULL, atualizado_em = now() WHERE lead_id = NEW.id;
  ELSIF NEW.outcome = 'perdida' THEN
    PERFORM public.lara_enfileirar(NEW.id, c.wa_id, 'template',
      jsonb_build_object('template', 'lara_resultado_candidatura', 'params', jsonb_build_array(v_nome)),
      'Resultado (modelo): não seguimos agora; pode pedir revisão', 'recusa:' || NEW.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    UPDATE lara_conversas SET estado = 'recusada', proxima_acao_em = NULL, atualizado_em = now() WHERE lead_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.lara_resultado_gatilho() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zzz_lara_resultado ON public.leads;
CREATE TRIGGER zzz_lara_resultado AFTER UPDATE OF outcome ON public.leads
  FOR EACH ROW WHEN (NEW.outcome IN ('ganha', 'perdida') AND OLD.outcome IS DISTINCT FROM NEW.outcome)
  EXECUTE FUNCTION public.lara_resultado_gatilho();

CREATE OR REPLACE FUNCTION public.lara_conversas_lista(_filtro text DEFAULT 'todas', _busca text DEFAULT NULL, _limite integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_busca text := nullif(btrim(coalesce(_busca, '')), '');
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN jsonb_build_object(
    'ativa', public.lara_ativa(),
    'contagem', jsonb_build_object(
      'pessoa', (SELECT count(*) FROM lara_conversas WHERE humano AND NOT opt_out),
      'revisao', (SELECT count(DISTINCT lead_id) FROM captacao_revisao_pedidos WHERE resolvido_em IS NULL),
      'nao_lidas', (SELECT count(*) FROM lara_conversas WHERE nao_lidas > 0)),
    'itens', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'ordem') DESC) FROM (
      SELECT jsonb_build_object(
        'lead_id', c.lead_id, 'nome', l.full_name, 'cidade', l.city, 'uf', l.uf, 'estado', c.estado, 'humano', c.humano,
        'humano_motivo', c.humano_motivo, 'opt_out', c.opt_out, 'nao_lidas', c.nao_lidas,
        'revisao', EXISTS (SELECT 1 FROM captacao_revisao_pedidos r WHERE r.lead_id = c.lead_id AND r.resolvido_em IS NULL),
        'ultima', (SELECT jsonb_build_object('texto', left(m.texto, 140), 'em', m.criado_em, 'direcao', m.direcao, 'autor', m.autor, 'status', m.status)
                     FROM lara_mensagens m WHERE m.lead_id = c.lead_id ORDER BY m.criado_em DESC LIMIT 1),
        'janela_aberta', c.ultima_entrada_em > now() - interval '23 hours 50 minutes',
        'ordem', greatest(c.ultima_entrada_em, c.ultima_saida_em, c.criado_em)) x
        FROM lara_conversas c JOIN leads l ON l.id = c.lead_id
       WHERE (coalesce(_filtro, 'todas') = 'todas'
               OR (_filtro = 'pessoa' AND c.humano AND NOT c.opt_out)
              OR (_filtro = 'nao_lidas' AND c.nao_lidas > 0)
              OR (_filtro = 'revisao' AND EXISTS (SELECT 1 FROM captacao_revisao_pedidos r WHERE r.lead_id = c.lead_id AND r.resolvido_em IS NULL)))
         AND (v_busca IS NULL OR l.full_name ILIKE '%' || v_busca || '%' OR c.wa_id LIKE '%' || regexp_replace(v_busca, '\D', '', 'g') || '%' AND regexp_replace(v_busca, '\D', '', 'g') <> '')
       ORDER BY greatest(c.ultima_entrada_em, c.ultima_saida_em, c.criado_em) DESC
       LIMIT greatest(1, least(coalesce(_limite, 100), 300))) s), '[]'::jsonb),
    'sem_candidatura', (SELECT count(DISTINCT wa_id) FROM lara_mensagens WHERE lead_id IS NULL AND direcao = 'entrada' AND criado_em > now() - interval '30 days'));
END $$;
REVOKE ALL ON FUNCTION public.lara_conversas_lista(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lara_conversas_lista(text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.lara_conversa_ver(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c lara_conversas; l leads;
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  SELECT * INTO c FROM lara_conversas WHERE lead_id = _lead;
  IF c.lead_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO l FROM leads WHERE id = _lead;
  UPDATE lara_conversas SET nao_lidas = 0 WHERE lead_id = _lead AND nao_lidas > 0;
  RETURN jsonb_build_object(
    'lead_id', c.lead_id, 'nome', l.full_name, 'protocolo', l.protocol, 'cidade', l.city, 'uf', l.uf, 'wa_id', c.wa_id,
    'estado', c.estado, 'humano', c.humano, 'humano_motivo', c.humano_motivo, 'humano_desde', c.humano_desde, 'opt_out', c.opt_out,
    'como_conheceu', l.como_conheceu, 'outcome', l.outcome,
    'janela_aberta', c.ultima_entrada_em > now() - interval '23 hours 50 minutes',
    'janela_ate', c.ultima_entrada_em + interval '24 hours',
    'revisao', (SELECT jsonb_build_object('id', r.id, 'pedido_em', r.pedido_em, 'texto', r.texto) FROM captacao_revisao_pedidos r
                 WHERE r.lead_id = _lead AND r.resolvido_em IS NULL ORDER BY r.pedido_em DESC LIMIT 1),
    'na_fila', (SELECT count(*) FROM lara_fila WHERE lead_id = _lead AND enviado_em IS NULL AND cancelado_em IS NULL),
    'mensagens', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'direcao', m.direcao, 'autor', m.autor, 'tipo', m.tipo, 'texto', m.texto,
                                  'template', m.template, 'status', m.status, 'erro', m.erro, 'em', m.criado_em) ORDER BY m.criado_em)
                            FROM (SELECT * FROM lara_mensagens WHERE lead_id = _lead ORDER BY criado_em DESC LIMIT 300) m), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.lara_conversa_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lara_conversa_ver(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.lara_assumir(_lead uuid, _assumir boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.edit');
  UPDATE lara_conversas SET humano = _assumir,
         humano_motivo = CASE WHEN _assumir THEN coalesce(humano_motivo, 'Assumida pela equipe') ELSE NULL END,
         humano_desde = CASE WHEN _assumir THEN coalesce(humano_desde, now()) ELSE NULL END,
         humano_por = CASE WHEN _assumir THEN auth.uid() ELSE NULL END, atualizado_em = now()
   WHERE lead_id = _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta candidata não tem conversa com a Lara.'; END IF;
  PERFORM public.crm_log(_lead, 'whatsapp', CASE WHEN _assumir THEN 'Equipe assumiu a conversa do WhatsApp' ELSE 'Conversa devolvida para a Lara' END, NULL, '{}'::jsonb, NULL);
END $$;
REVOKE ALL ON FUNCTION public.lara_assumir(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lara_assumir(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.lara_responder(_lead uuid, _texto text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c lara_conversas; v_txt text := btrim(coalesce(_texto, '')); v uuid;
BEGIN
  PERFORM public.crm_require('candidaturas.edit');
  IF length(v_txt) < 1 OR length(v_txt) > 3000 THEN RAISE EXCEPTION 'Escreva a mensagem (até 3.000 caracteres).'; END IF;
  SELECT * INTO c FROM lara_conversas WHERE lead_id = _lead FOR UPDATE;
  IF c.lead_id IS NULL THEN RAISE EXCEPTION 'Esta candidata não tem conversa com a Lara.'; END IF;
  IF c.opt_out THEN RAISE EXCEPTION 'Ela pediu para não receber mensagens.'; END IF;
  IF c.ultima_entrada_em IS NULL OR c.ultima_entrada_em <= now() - interval '23 hours 50 minutes' THEN
    RAISE EXCEPTION 'Passaram 24 horas desde a última mensagem dela: a Meta só deixa responder quando ela escrever de novo.';
  END IF;
  IF NOT public.seguranca_limite('lara:resp:' || auth.uid()::text, 120, 3600) THEN RAISE EXCEPTION 'Muitas mensagens seguidas. Espere alguns minutos.'; END IF;
  v := public.lara_enfileirar(_lead, c.wa_id, 'texto', jsonb_build_object('texto', v_txt), v_txt, NULL, 'equipe', auth.uid());
  UPDATE lara_conversas SET humano = true, humano_motivo = coalesce(humano_motivo, 'Equipe respondeu'), humano_desde = coalesce(humano_desde, now()),
         humano_por = coalesce(humano_por, auth.uid()), nao_lidas = 0, atualizado_em = now() WHERE lead_id = _lead;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.lara_responder(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lara_responder(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.captacao_revisao_resolver(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_lead uuid;
BEGIN
  PERFORM public.crm_require('candidaturas.edit');
  UPDATE captacao_revisao_pedidos SET resolvido_em = now(), resolvido_por = auth.uid() WHERE id = _id AND resolvido_em IS NULL RETURNING lead_id INTO v_lead;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado ou já resolvido.'; END IF;
  PERFORM public.crm_log(v_lead, 'analise', 'Pedido de revisão resolvido', NULL, '{}'::jsonb, NULL);
END $$;
REVOKE ALL ON FUNCTION public.captacao_revisao_resolver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.captacao_revisao_resolver(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.lara_ligar(_ativa boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master'::app_role) THEN RAISE EXCEPTION 'Só o Master liga ou desliga a Lara.' USING errcode = '42501'; END IF;
  INSERT INTO captacao_config (chave, valor, atualizado_em) VALUES ('lara_ativa', to_jsonb(coalesce(_ativa, false)), now())
  ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = now();
  IF NOT coalesce(_ativa, false) THEN
    UPDATE lara_fila SET cancelado_em = now(), erro = 'Lara desligada' WHERE autor = 'lara' AND enviado_em IS NULL AND cancelado_em IS NULL;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), CASE WHEN _ativa THEN 'lara.ligada' ELSE 'lara.desligada' END, 'captacao_config', 'lara_ativa', '{}'::jsonb);
  RETURN coalesce(_ativa, false);
END $$;
REVOKE ALL ON FUNCTION public.lara_ligar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lara_ligar(boolean) TO authenticated;
