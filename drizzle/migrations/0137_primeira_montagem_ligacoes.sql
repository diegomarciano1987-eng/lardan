-- 0136 — auditoria "do cadastro à primeira montagem": ligações que faltavam e login por código endurecido.
-- Não apaga nada, não remove coluna e pode rodar duas vezes.
--
-- 1. Login por código: tentativa reservada de forma atômica (5 erradas travam 15 min, mesmo em paralelo),
--    código nunca abre conta com papel de equipe, e a tela sabe se a pessoa é colaboradora.
-- 2. Carteira pelo SmallData: representante (e praça vazia) da consultora antiga vêm do cadastro dela no
--    SmallData — prévia, aplicação só pelo Master, nunca sobrescreve, desfazer por lote.
--    Representante sem CPF liga ao cadastro pelo Master (legado_representante_vincular).
-- 3. Bipagem: o tipo da peça (brinco, anel, colar, pulseira, tornozeleira) vem da categoria do produto,
--    pelo mesmo de-para das metas do histórico (legado_categoria_tipo). Bracelete conta como pulseira.
-- 4. Maleta aceita reativa a consultora inativa (bloqueada/desligada nunca); maleta nova não abre para
--    consultora bloqueada ou desligada.

-- ───────────────────────── 1. login por código ─────────────────────────

CREATE OR REPLACE FUNCTION public.colab_login_reservar(_codigo text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  -- Cada tentativa conta ANTES de conferir a senha; o sucesso zera (colab_login_ok).
  -- A linha fica travada no UPDATE: tentativas simultâneas entram em fila e a 6ª já vê o bloqueio.
  UPDATE colab_acessos ca SET
    falhas = CASE WHEN ca.bloqueado_ate IS NOT NULL THEN 1 ELSE ca.falhas + 1 END,
    bloqueado_ate = CASE WHEN (CASE WHEN ca.bloqueado_ate IS NOT NULL THEN 1 ELSE ca.falhas + 1 END) >= 5
                         THEN now() + interval '15 minutes' END,
    updated_at = now()
  WHERE ca.codigo = btrim(coalesce(_codigo, ''))
    AND ca.ativo
    AND (ca.bloqueado_ate IS NULL OR ca.bloqueado_ate <= now())
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = ca.user_id AND p.is_active)
    AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = ca.user_id
                     AND ur.role::text NOT IN ('consultora', 'representante'))
  RETURNING ca.user_id INTO v;
  RETURN v;   -- NULL: código inexistente, suspenso, travado ou de conta da equipe (a tela responde igual)
END $$;
REVOKE ALL ON FUNCTION public.colab_login_reservar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_login_reservar(text) TO service_role;

CREATE OR REPLACE FUNCTION public.colab_login_ok(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE colab_acessos SET falhas = 0, bloqueado_ate = NULL, updated_at = now() WHERE user_id = _user;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_user, 'colab.login.codigo', 'colab_acessos', _user::text, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.colab_login_ok(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_login_ok(uuid) TO service_role;

-- A porta da Operação por módulos é só de quem tem acesso de colaboradora ativo
-- (consultora e representante também têm permissões, e não são da operação).
CREATE OR REPLACE FUNCTION public.meu_acesso_colab() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM colab_acessos WHERE user_id = auth.uid() AND ativo)
$$;
REVOKE ALL ON FUNCTION public.meu_acesso_colab() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_acesso_colab() TO authenticated, service_role;

-- Código só para colaboradora sem papel de equipe (quem é da equipe entra com e-mail e MFA quando exigido).
CREATE OR REPLACE FUNCTION public.colab_acesso_registrar(_user_id uuid,_party_id uuid,_codigo text,_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE antes jsonb; papeis text;
BEGIN
 PERFORM public.colab_exigir_master(_actor);
 IF NOT EXISTS(SELECT 1 FROM party_roles WHERE party_id=_party_id AND role='colaborador' AND ended_at IS NULL) THEN
  RAISE EXCEPTION 'Marque esta pessoa como colaboradora antes de criar o acesso.';
 END IF;
 SELECT string_agg(DISTINCT role::text, ', ') INTO papeis FROM user_roles
  WHERE user_id=_user_id AND role::text NOT IN ('consultora','representante');
 IF papeis IS NOT NULL THEN
  RAISE EXCEPTION 'Esta pessoa já tem papel de equipe (%): o login por código é só para colaboradora sem papel. Ela entra com o e-mail.', papeis;
 END IF;
 IF EXISTS(SELECT 1 FROM colab_acessos WHERE codigo=_codigo AND user_id<>_user_id) THEN
  RAISE EXCEPTION 'Este código já é de outra colaboradora.';
 END IF;
 SELECT to_jsonb(c) INTO antes FROM colab_acessos c WHERE user_id=_user_id;
 INSERT INTO colab_acessos(user_id,party_id,codigo,criado_por) VALUES(_user_id,_party_id,_codigo,_actor)
 ON CONFLICT(user_id) DO UPDATE SET codigo=excluded.codigo, ativo=true, falhas=0, bloqueado_ate=NULL, updated_at=now();
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
 VALUES(_actor,'colab.acesso.salvar','colab_acessos',_user_id::text,jsonb_build_object('antes',antes,'codigo',_codigo,'party_id',_party_id));
END $$;
REVOKE ALL ON FUNCTION public.colab_acesso_registrar(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_acesso_registrar(uuid,uuid,text,uuid) TO service_role;

-- ───────────────────────── 2. carteira pelo SmallData ─────────────────────────

CREATE OR REPLACE FUNCTION public.legado_representante_vincular(_codigo integer, _party uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE antes uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'Só o Master liga o representante do histórico ao cadastro.' USING errcode = '42501';
  END IF;
  SELECT party_id INTO antes FROM legado_representantes WHERE codigo = _codigo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Representante % não está no histórico do SmallData.', _codigo; END IF;
  IF _party IS NOT NULL AND NOT EXISTS (SELECT 1 FROM party_roles WHERE party_id = _party AND role = 'representante' AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'Este cadastro não tem o papel de representante.';
  END IF;
  UPDATE legado_representantes SET party_id = _party, vinculo = CASE WHEN _party IS NULL THEN NULL ELSE 'manual' END,
         atualizado_em = now()
   WHERE codigo = _codigo;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'legado.representante_vinculado', 'legado_representantes', _codigo::text,
          jsonb_build_object('antes', antes, 'depois', _party));
  RETURN jsonb_build_object('codigo', _codigo, 'party_id', _party);
END $$;
REVOKE ALL ON FUNCTION public.legado_representante_vincular(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_representante_vincular(integer, uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.consultoras_vinculo_log (
  id bigserial PRIMARY KEY,
  lote text NOT NULL,
  party_id uuid NOT NULL REFERENCES public.parties(id),
  campo text NOT NULL CHECK (campo IN ('representante', 'praca', 'perfil')),
  antes uuid,
  depois uuid,
  ator uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz
);
ALTER TABLE public.consultoras_vinculo_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consultoras_vinculo_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.consultoras_vinculo_log TO service_role;

CREATE OR REPLACE FUNCTION public.consultoras_vinculo_smalldata(_aplicar boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_lote text; n_rep int; n_praca int; n_perfil int; r jsonb;
BEGIN
  IF NOT (uid IS NULL AND coalesce(auth.role(), '') = 'service_role') THEN
    IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN
      RAISE EXCEPTION 'Só o Master liga a carteira pelo histórico.' USING errcode = '42501';
    END IF;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _cvs (party_id uuid PRIMARY KEY, sem_perfil boolean, rep_novo uuid, praca_nova uuid,
                                        reps int, pracas int) ON COMMIT DROP;
  TRUNCATE _cvs;
  INSERT INTO _cvs
  SELECT lc.party_id,
         cp.party_id IS NULL,
         CASE WHEN cp.representative_party_id IS NULL AND count(DISTINCT lr.party_id) = 1 THEN min(lr.party_id::text)::uuid END,
         CASE WHEN cp.praca_id IS NULL AND count(DISTINCT lp.praca_id) = 1 THEN min(lp.praca_id::text)::uuid END,
         count(DISTINCT lr.party_id)::int, count(DISTINCT lp.praca_id)::int
    FROM legado_consultoras lc
    JOIN party_roles pr ON pr.party_id = lc.party_id AND pr.role = 'consultora' AND pr.ended_at IS NULL
    LEFT JOIN consultant_profiles cp ON cp.party_id = lc.party_id
    LEFT JOIN legado_representantes lr ON lr.codigo = lc.representante AND lr.party_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM party_roles x WHERE x.party_id = lr.party_id AND x.role = 'representante' AND x.ended_at IS NULL)
    LEFT JOIN legado_pracas lp ON lp.codigo = lc.praca AND lp.praca_id IS NOT NULL
   WHERE lc.party_id IS NOT NULL AND NOT coalesce(lc.interna, false)
   GROUP BY lc.party_id, cp.party_id, cp.representative_party_id, cp.praca_id;

  SELECT count(*) FILTER (WHERE rep_novo IS NOT NULL), count(*) FILTER (WHERE praca_nova IS NOT NULL),
         count(*) FILTER (WHERE sem_perfil AND (rep_novo IS NOT NULL OR praca_nova IS NOT NULL))
    INTO n_rep, n_praca, n_perfil FROM _cvs;

  r := jsonb_build_object(
    'representante', n_rep, 'praca', n_praca, 'perfil_novo', n_perfil,
    'mais_de_um_representante', (SELECT count(*) FROM _cvs WHERE reps > 1),
    'reps_sem_cadastro', coalesce((
      SELECT jsonb_agg(jsonb_build_object('codigo', x.codigo, 'nome', x.nome, 'consultoras', x.n) ORDER BY x.n DESC)
        FROM (SELECT lr.codigo, lr.nome, count(*) n FROM legado_consultoras lc
                JOIN legado_representantes lr ON lr.codigo = lc.representante
                JOIN consultant_profiles cp ON cp.party_id = lc.party_id AND cp.representative_party_id IS NULL
               WHERE lc.party_id IS NOT NULL AND lr.party_id IS NULL GROUP BY 1, 2) x), '[]'::jsonb),
    'por_representante', coalesce((
      SELECT jsonb_agg(jsonb_build_object('representante', p.display_name, 'consultoras', x.n) ORDER BY x.n DESC)
        FROM (SELECT rep_novo, count(*) n FROM _cvs WHERE rep_novo IS NOT NULL GROUP BY 1) x
        JOIN parties p ON p.id = x.rep_novo), '[]'::jsonb));

  IF NOT coalesce(_aplicar, false) THEN
    RETURN r || jsonb_build_object('aplicado', false);
  END IF;

  v_lote := 'cvs-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 4);
  INSERT INTO consultoras_vinculo_log (lote, party_id, campo, antes, depois, ator)
  SELECT v_lote, party_id, 'perfil', NULL, NULL, uid FROM _cvs WHERE sem_perfil AND (rep_novo IS NOT NULL OR praca_nova IS NOT NULL);
  INSERT INTO consultant_profiles (party_id)
  SELECT party_id FROM _cvs WHERE sem_perfil AND (rep_novo IS NOT NULL OR praca_nova IS NOT NULL)
  ON CONFLICT (party_id) DO NOTHING;

  INSERT INTO consultoras_vinculo_log (lote, party_id, campo, antes, depois, ator)
  SELECT v_lote, c.party_id, 'representante', NULL, c.rep_novo, uid FROM _cvs c
    JOIN consultant_profiles cp ON cp.party_id = c.party_id AND cp.representative_party_id IS NULL
   WHERE c.rep_novo IS NOT NULL;
  UPDATE consultant_profiles cp SET representative_party_id = c.rep_novo
    FROM _cvs c WHERE c.party_id = cp.party_id AND c.rep_novo IS NOT NULL AND cp.representative_party_id IS NULL;

  INSERT INTO consultoras_vinculo_log (lote, party_id, campo, antes, depois, ator)
  SELECT v_lote, c.party_id, 'praca', NULL, c.praca_nova, uid FROM _cvs c
    JOIN consultant_profiles cp ON cp.party_id = c.party_id AND cp.praca_id IS NULL
   WHERE c.praca_nova IS NOT NULL;
  UPDATE consultant_profiles cp SET praca_id = c.praca_nova
    FROM _cvs c WHERE c.party_id = cp.party_id AND c.praca_nova IS NOT NULL AND cp.praca_id IS NULL;

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'consultoras.vinculo_smalldata', 'consultant_profiles', v_lote, r);
  RETURN r || jsonb_build_object('aplicado', true, 'lote', v_lote);
END $$;
REVOKE ALL ON FUNCTION public.consultoras_vinculo_smalldata(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultoras_vinculo_smalldata(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultoras_vinculo_smalldata_desfazer(_lote text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); n_rep int; n_praca int;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN
    RAISE EXCEPTION 'Só o Master desfaz o lote.' USING errcode = '42501';
  END IF;
  -- só volta onde o valor ainda é o que o lote gravou (ninguém mexeu depois)
  WITH d AS (
    UPDATE consultant_profiles cp SET representative_party_id = NULL
      FROM consultoras_vinculo_log l
     WHERE l.lote = _lote AND l.campo = 'representante' AND l.desfeito_em IS NULL
       AND cp.party_id = l.party_id AND cp.representative_party_id = l.depois
    RETURNING cp.party_id)
  SELECT count(*) INTO n_rep FROM d;
  WITH d AS (
    UPDATE consultant_profiles cp SET praca_id = NULL
      FROM consultoras_vinculo_log l
     WHERE l.lote = _lote AND l.campo = 'praca' AND l.desfeito_em IS NULL
       AND cp.party_id = l.party_id AND cp.praca_id = l.depois
    RETURNING cp.party_id)
  SELECT count(*) INTO n_praca FROM d;
  UPDATE consultoras_vinculo_log SET desfeito_em = now() WHERE lote = _lote AND desfeito_em IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'consultoras.vinculo_smalldata_desfeito', 'consultant_profiles', _lote,
          jsonb_build_object('representante', n_rep, 'praca', n_praca));
  RETURN jsonb_build_object('lote', _lote, 'representante', n_rep, 'praca', n_praca);
END $$;
REVOKE ALL ON FUNCTION public.consultoras_vinculo_smalldata_desfazer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultoras_vinculo_smalldata_desfazer(text) TO authenticated, service_role;

-- ───────────────────────── 3. tipo da peça na bipagem ─────────────────────────

CREATE OR REPLACE FUNCTION public.variantes_tipo_peca(_variants uuid[]) RETURNS TABLE (variant_id uuid, tipo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.kit_scope_all() THEN
    RAISE EXCEPTION 'Sem permissão para montar maletas.' USING errcode = '42501';
  END IF;
  IF coalesce(array_length(_variants, 1), 0) > 3000 THEN RAISE EXCEPTION 'Peças demais numa consulta.'; END IF;
  RETURN QUERY
  WITH n AS (
    SELECT pv.id, upper(btrim(translate(coalesce(c.name, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                                         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))) nome
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE pv.id = ANY (_variants)),
  k AS (
    SELECT n.id, CASE
      WHEN nome IN ('BRINCO', 'BRINCOS') THEN 'BRINCO'
      WHEN nome IN ('COLAR', 'COLARES', 'GARGANTILHA', 'GARGANTILHAS') THEN 'COLAR'
      WHEN nome IN ('ANEL', 'ANEIS') THEN 'ANEL'
      WHEN nome IN ('PULSEIRA', 'PULSEIRAS') THEN 'PULSEIRA'
      WHEN nome IN ('TORNOZELEIRA', 'TORNOZELEIRAS') THEN 'TORNOZELEIRA'
      WHEN nome IN ('BRACELETE', 'BRACELETES') THEN 'BRACELETE'
      WHEN nome IN ('PINGENTE', 'PINGENTES') THEN 'PINGENTE'
      WHEN nome IN ('CONJUNTO', 'CONJUNTOS') THEN 'CONJUNTO'
      WHEN nome IN ('PIERCING', 'PIERCINGS') THEN 'PIERCING'
      WHEN nome IN ('BERLOQUE', 'BERLOQUES') THEN 'BERLOQUE'
      WHEN nome IN ('BROCHE', 'BROCHES') THEN 'BROCHE'
      ELSE nullif(nome, '') END chave
      FROM n)
  SELECT k.id,
         coalesce(t.tipo, CASE k.chave WHEN 'BRINCO' THEN 'brinco' WHEN 'COLAR' THEN 'colar' WHEN 'ANEL' THEN 'anel'
                                      WHEN 'PULSEIRA' THEN 'pulseira' WHEN 'TORNOZELEIRA' THEN 'tornozeleira' END)
    FROM k LEFT JOIN legado_categoria_tipo t ON t.categoria = k.chave;
END $$;
REVOKE ALL ON FUNCTION public.variantes_tipo_peca(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.variantes_tipo_peca(uuid[]) TO authenticated, service_role;

-- ───────────────────────── 4. situação da consultora na maleta ─────────────────────────

CREATE OR REPLACE FUNCTION public.kit_consultora_reativar_no_aceite() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.consultora_party_id IS NOT NULL AND NEW.status::text = 'operacao' AND OLD.status::text IS DISTINCT FROM 'operacao' THEN
    -- inativa por tempo sem maleta volta a ativa; bloqueada/desligada só pelo financeiro (fica registrado)
    IF public.rep_reativar_interno(NEW.consultora_party_id, auth.uid(), 'maleta aceita (ciclo ' || NEW.id || ')') THEN
      UPDATE party_roles SET status = 'ativo', updated_at = now()
       WHERE party_id = NEW.consultora_party_id AND role = 'consultora' AND status = 'inativo' AND ended_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kit_consultora_reativar_no_aceite() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_kit_consultora_reativar ON public.kit_cycles;
CREATE TRIGGER zz_kit_consultora_reativar AFTER UPDATE OF status ON public.kit_cycles
  FOR EACH ROW EXECUTE FUNCTION public.kit_consultora_reativar_no_aceite();

CREATE OR REPLACE FUNCTION public.kit_consultora_liberada() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st text; nome text;
BEGIN
  IF NEW.consultora_party_id IS NULL THEN RETURN NEW; END IF;
  SELECT status::text, display_name INTO st, nome FROM parties WHERE id = NEW.consultora_party_id;
  IF st IN ('bloqueado', 'desligado') THEN
    RAISE EXCEPTION 'A consultora % está %: libere o cadastro antes de montar uma maleta para ela.', nome, st;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kit_consultora_liberada() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cob_consultora_liberada_kit ON public.kit_cycles;
CREATE TRIGGER cob_consultora_liberada_kit BEFORE INSERT ON public.kit_cycles
  FOR EACH ROW EXECUTE FUNCTION public.kit_consultora_liberada();

-- ───────────────────────── 5. desempenho: maleta perdida ao ganhar cadastro (corrige a 0130/0131) ─────────────────────────
-- legado_consultoras_cadastrar grava uma consultora por vez; o gatilho por comando da 0131 reprocessava TODAS as
-- perdidas a cada uma (≈0,4 s × 4 mil cadastros ≈ 26 min). Agora só olha as consultoras que mudaram de cadastro.
CREATE OR REPLACE FUNCTION public.maletas_perdidas_apos_cadastro() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  CREATE TEMP TABLE IF NOT EXISTS _mpc (codcli int PRIMARY KEY, party_id uuid) ON COMMIT DROP;
  TRUNCATE _mpc;
  INSERT INTO _mpc SELECT n.codcli, n.party_id FROM novos n JOIN antigos o ON o.codcli = n.codcli
   WHERE n.party_id IS NOT NULL AND n.party_id IS DISTINCT FROM o.party_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- perdida dela ainda não registrada: processamento completo (raro: a importação já registra todas)
  IF EXISTS (SELECT 1 FROM legado_maletas m JOIN _mpc c ON c.codcli = m.codcli
               LEFT JOIN legado_maleta_status s ON s.remessa = m.remessa AND s.codcli = m.codcli
              WHERE (m.tipo = 'perdida' OR s.status = 11)
                AND NOT EXISTS (SELECT 1 FROM maletas_perdidas mp WHERE mp.origem = 'smalldata' AND mp.remessa = m.remessa AND mp.codcli = m.codcli)) THEN
    PERFORM public.maletas_perdidas_smalldata_processar(true);
    RETURN NULL;
  END IF;
  UPDATE maletas_perdidas mp SET party_id = c.party_id,
         ja_tinha_fiado = EXISTS (SELECT 1 FROM cob_fiado_linhas f WHERE f.party_id = c.party_id AND f.lote <> 'maleta_perdida'),
         atualizado_em = now()
    FROM _mpc c WHERE mp.origem = 'smalldata' AND mp.codcli = c.codcli AND mp.party_id IS NULL;
  FOR r IN SELECT mp.id FROM maletas_perdidas mp JOIN _mpc c ON c.codcli = mp.codcli
            WHERE mp.origem = 'smalldata' AND mp.title_id IS NULL AND mp.party_id IS NOT NULL AND mp.valor_cents > 0 LOOP
    PERFORM public.maleta_perdida_fiado(r.id);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.maletas_perdidas_apos_cadastro() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS maletas_perdidas_cadastro ON public.legado_consultoras;
CREATE TRIGGER maletas_perdidas_cadastro AFTER UPDATE ON public.legado_consultoras
  REFERENCING OLD TABLE AS antigos NEW TABLE AS novos
  FOR EACH STATEMENT EXECUTE FUNCTION public.maletas_perdidas_apos_cadastro();