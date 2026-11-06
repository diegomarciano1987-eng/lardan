-- 0245 — App do representante mais simples, contrato/promissória na abertura, convite só com senha
-- e acessos das consultoras para o Daniel (05/11/2026).

-- ───────────── 1. rep_crm com party_id e CPF da candidatura ─────────────
CREATE OR REPLACE FUNCTION public.rep_crm(_rep uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; primeira uuid;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  PERFORM public.rep_crm_etapas_garantir(_rep);
  SELECT id INTO primeira FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema IS NULL ORDER BY ordem LIMIT 1;
  SELECT jsonb_build_object(
    'codigo', (SELECT lower(code) FROM parties WHERE id = _rep),
    'etapas', (SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'sistema', sistema) ORDER BY ordem) FROM rep_crm_etapas WHERE rep_party_id = _rep),
    'cards', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'lead_id', l.id, 'protocolo', l.protocol, 'nome', l.full_name, 'whatsapp', l.whatsapp, 'cidade', l.city || '/' || l.uf,
        'status_lardan', l.status::text, 'origem', l.representante_origem, 'criado', l.created_at, 'nota', c.nota,
        'travado', s.col IS NOT NULL, 'sistema', s.col,
        'party_id', l.party_id, 'tem_cpf', coalesce(length(l.cpf_digits), 0) = 11,
        'movido_em', c.updated_at,
        'etapa_id', CASE WHEN s.col IS NOT NULL THEN (SELECT id FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema = s.col)
                         WHEN ce.sistema IS NULL AND ce.id IS NOT NULL THEN ce.id ELSE primeira END)
        ORDER BY l.created_at DESC)
      FROM leads l LEFT JOIN rep_crm_cards c ON c.lead_id = l.id LEFT JOIN rep_crm_etapas ce ON ce.id = c.etapa_id
      CROSS JOIN LATERAL (SELECT public.rep_crm_coluna_sistema(l) AS col) s
      WHERE l.representante_party_id = _rep AND l.status::text NOT IN ('arquivado')), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.rep_crm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_crm(uuid) TO authenticated, service_role;

-- ───────────── 2. permissão de assinatura pela candidatura ─────────────
CREATE OR REPLACE FUNCTION public.assinatura_pode(_party uuid, _rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro']::public.app_role[])
    OR public.can_manage_kits(auth.uid())
    OR (_rep IS NOT NULL AND public.rep_portal_pode(_rep)
        AND (EXISTS (SELECT 1 FROM consultant_profiles cp WHERE cp.party_id = _party AND cp.representative_party_id = _rep)
             OR EXISTS (SELECT 1 FROM leads l WHERE l.party_id = _party AND l.representante_party_id = _rep))))
$$;
REVOKE ALL ON FUNCTION public.assinatura_pode(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_pode(uuid, uuid) TO authenticated;

-- ───────────── 3. CPF que falta para o contrato ─────────────
CREATE OR REPLACE FUNCTION public.rep_consultora_cpf_definir(_rep uuid, _party uuid, _cpf text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p record; d text; fonte text := 'digitado';
BEGIN
  IF NOT public.assinatura_pode(_party, _rep) THEN RAISE EXCEPTION 'Sem permissão para esta consultora.' USING errcode = '42501'; END IF;
  SELECT * INTO p FROM parties WHERE id = _party FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultora não encontrada.'; END IF;
  IF length(coalesce(p.doc_digits, '')) = 11 THEN RETURN jsonb_build_object('ok', true, 'ja_tinha', true); END IF;
  d := regexp_replace(coalesce(_cpf, ''), '\D', '', 'g');
  IF d = '' THEN
    SELECT l.cpf_digits INTO d FROM leads l WHERE l.party_id = _party AND length(coalesce(l.cpf_digits, '')) = 11 ORDER BY l.created_at DESC LIMIT 1;
    fonte := 'candidatura';
  END IF;
  IF length(coalesce(d, '')) <> 11 OR NOT public.doc_is_valid(public.doc_canon(d)) THEN
    RAISE EXCEPTION 'CPF inválido. Confira os 11 números.';
  END IF;
  IF EXISTS (SELECT 1 FROM parties x WHERE x.doc_digits = d AND x.id <> _party) THEN
    RAISE EXCEPTION 'Este CPF já está em outro cadastro. Fale com a Lardan para unir os cadastros.';
  END IF;
  UPDATE parties SET doc = d WHERE id = _party;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'rep.consultora.cpf', 'parties', _party::text, jsonb_build_object('rep', _rep, 'fonte', fonte));
  RETURN jsonb_build_object('ok', true, 'ja_tinha', false, 'fonte', fonte);
END $$;
REVOKE ALL ON FUNCTION public.rep_consultora_cpf_definir(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_consultora_cpf_definir(uuid, uuid, text) TO authenticated;

-- ───────────── 4. convite: e-mail e conta (só servidor) ─────────────
CREATE OR REPLACE FUNCTION public.access_invite_conta(_token_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $fn$
DECLARE i public.access_invites; u record;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' AND auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Só o servidor.' USING errcode = '42501';
  END IF;
  SELECT * INTO i FROM public.access_invites WHERE token_hash = _token_hash;
  IF i.id IS NULL THEN RETURN jsonb_build_object('situacao', 'invalido'); END IF;
  IF i.status = 'aceito' THEN RETURN jsonb_build_object('situacao', 'utilizado'); END IF;
  IF i.status = 'revogado' THEN RETURN jsonb_build_object('situacao', 'revogado'); END IF;
  IF i.expires_at < now() THEN RETURN jsonb_build_object('situacao', 'expirado'); END IF;
  IF i.tentativas >= 10 THEN RETURN jsonb_build_object('situacao', 'bloqueado'); END IF;
  SELECT au.id, au.last_sign_in_at, au.email_confirmed_at INTO u FROM auth.users au WHERE lower(au.email) = lower(i.email) LIMIT 1;
  RETURN jsonb_build_object('situacao', 'valido', 'email', lower(i.email), 'party_id', i.party_id,
    'user_id', u.id, 'ja_entrou', u.last_sign_in_at IS NOT NULL,
    'papeis_conta', coalesce((SELECT array_agg(ur.role::text) FROM user_roles ur WHERE ur.user_id = u.id), '{}'));
END $fn$;
REVOKE ALL ON FUNCTION public.access_invite_conta(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.access_invite_conta(text) TO service_role;

-- ───────────── 5. acessos das consultoras (Daniel / Master) ─────────────
CREATE OR REPLACE FUNCTION public.consultoras_acessos(_busca text DEFAULT NULL, _offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE t text := nullif(btrim(coalesce(_busca, '')), ''); res jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['master','diretoria']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só o Daniel (diretoria) ou o Master.' USING errcode = '42501';
  END IF;
  WITH base AS (
    SELECT p.id, p.code AS codigo, coalesce(p.display_name, p.legal_name) AS nome, p.status::text AS situacao,
           pr.id AS user_id, au.email, au.last_sign_in_at AS ultimo_acesso, au.created_at AS conta_criada,
           (SELECT ai.status FROM access_invites ai WHERE ai.party_id = p.id ORDER BY ai.created_at DESC LIMIT 1) AS convite,
           (SELECT ai.email FROM access_invites ai WHERE ai.party_id = p.id ORDER BY ai.created_at DESC LIMIT 1) AS email_convite,
           (SELECT count(*) FROM user_roles ur WHERE ur.user_id = pr.id AND ur.role::text NOT IN ('consultora')) AS outros_papeis
      FROM parties p
      JOIN party_roles r ON r.party_id = p.id AND r.role = 'consultora'
      LEFT JOIN profiles pr ON pr.party_id = p.id
      LEFT JOIN auth.users au ON au.id = pr.id
     WHERE t IS NULL OR coalesce(p.display_name, p.legal_name, '') ILIKE '%' || t || '%' OR p.code = t
        OR coalesce(au.email, '') ILIKE '%' || t || '%'
        OR (t ~ '^\d{3,}$' AND coalesce(p.doc_digits, '') LIKE '%' || t || '%')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'com_login', (SELECT count(*) FROM base WHERE user_id IS NOT NULL),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ultimo_acesso DESC NULLS LAST, x.nome) FROM (
        SELECT id, codigo, nome, situacao, user_id, coalesce(email, email_convite) AS email, ultimo_acesso, conta_criada, convite,
               (user_id IS NOT NULL AND outros_papeis = 0) AS pode_definir_senha
          FROM base ORDER BY ultimo_acesso DESC NULLS LAST, nome LIMIT 50 OFFSET greatest(_offset, 0)) x), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.consultoras_acessos(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultoras_acessos(text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.consultora_acesso_pode_definir(_ator uuid, _party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE uid uuid; outros int;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' AND auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Só o servidor.' USING errcode = '42501';
  END IF;
  IF _ator IS NULL OR NOT public.has_any_role(_ator, ARRAY['master','diretoria']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só o Daniel (diretoria) ou o Master define senha de consultora.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM party_roles WHERE party_id = _party AND role = 'consultora') THEN
    RAISE EXCEPTION 'Este cadastro não é de consultora.';
  END IF;
  SELECT id INTO uid FROM profiles WHERE party_id = _party LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'Esta consultora ainda não tem login. Mande o convite.'; END IF;
  SELECT count(*) INTO outros FROM user_roles WHERE user_id = uid AND role::text NOT IN ('consultora');
  IF outros > 0 THEN RAISE EXCEPTION 'Este login também é da equipe Lardan: a senha só é trocada pela própria pessoa.'; END IF;
  RETURN jsonb_build_object('user_id', uid);
END $$;
REVOKE ALL ON FUNCTION public.consultora_acesso_pode_definir(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_acesso_pode_definir(uuid, uuid) TO service_role;