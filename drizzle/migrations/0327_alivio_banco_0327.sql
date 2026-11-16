-- 0327 — Alívio do banco (Diego, 16/11/2026). Só leitura mais rápida: nenhuma regra, valor ou acesso muda.
-- Cada troca se confere sozinha dentro desta mudança: se qualquer resultado divergir do anterior, tudo é desfeito.

-- 1) my_capabilities: antes chamava has_capability uma vez para cada uma das 285 linhas de permissão.
--    Agora calcula o mesmo conjunto de uma vez. has_capability continua igual (é ela que as regras de acesso usam).
CREATE TEMP TABLE _caps_antes (uid uuid, aal text, caps text[]);

DO $antes$
DECLARE u record; a text; v_claims text := current_setting('request.jwt.claims', true); v_test text := current_setting('lardan.test_uid', true);
BEGIN
  FOR u IN SELECT p.id, EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role <> 'consultora') AS equipe FROM public.profiles p LOOP
    FOREACH a IN ARRAY CASE WHEN u.equipe THEN ARRAY['aal1','aal2'] ELSE ARRAY['aal1'] END LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated', 'aal', a)::text, true);
      PERFORM set_config('lardan.test_uid', u.id::text, true);
      INSERT INTO _caps_antes
        SELECT u.id, a, coalesce(array_agg(DISTINCT rc.capability ORDER BY rc.capability), '{}')
          FROM public.role_capabilities rc WHERE public.has_capability(u.id, rc.capability);
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('lardan.test_uid', coalesce(v_test, ''), true);
END $antes$;

CREATE OR REPLACE FUNCTION public.my_capabilities()
 RETURNS TABLE(capability text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Mesmo resultado de: role_capabilities filtrada por has_capability(auth.uid(), capability) — conjunto calculado de uma vez (0327).
  WITH eu AS (
    SELECT p.id,
           EXISTS (SELECT 1 FROM colab_acessos c WHERE c.user_id = p.id) AS colab,
           EXISTS (SELECT 1 FROM colab_acessos c WHERE c.user_id = p.id AND c.ativo) AS colab_ativo,
           EXISTS (SELECT 1 FROM user_financial_access f WHERE f.user_id = p.id AND f.enabled) AS fin,
           public.access_mfa_ok() AS mfa
      FROM profiles p
     WHERE p.id = auth.uid() AND p.is_active
  ),
  concedidas AS (
    SELECT rc.capability FROM eu JOIN user_roles ur ON ur.user_id = eu.id JOIN role_capabilities rc ON rc.role = ur.role
    UNION
    SELECT rc.capability FROM eu JOIN role_capabilities rc ON rc.role = 'master' WHERE eu.fin AND rc.capability LIKE 'finance.%'
    UNION
    SELECT uc.capability FROM eu JOIN user_capabilities uc ON uc.user_id = eu.id JOIN colab_acessos ca ON ca.user_id = uc.user_id AND ca.ativo
     WHERE uc.capability = ANY (public.colab_caps_permitidas())
  )
  SELECT c.capability
    FROM concedidas c CROSS JOIN eu
   WHERE c.capability IN (SELECT r.capability FROM role_capabilities r)
     AND (NOT eu.colab OR (c.capability NOT LIKE 'stock.%' AND eu.colab_ativo))
     AND (c.capability !~ '^(finance\.|users\.|access\.)' OR eu.mfa)
$function$;

DO $depois$
DECLARE r record; novo text[]; n int := 0; v_claims text := current_setting('request.jwt.claims', true); v_test text := current_setting('lardan.test_uid', true);
BEGIN
  FOR r IN SELECT * FROM _caps_antes LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.uid, 'role', 'authenticated', 'aal', r.aal)::text, true);
    PERFORM set_config('lardan.test_uid', r.uid::text, true);
    SELECT coalesce(array_agg(x.capability ORDER BY x.capability), '{}') INTO novo FROM public.my_capabilities() x;
    IF novo IS DISTINCT FROM r.caps THEN
      RAISE EXCEPTION '0327: my_capabilities divergiu para % (%): antes %, agora %', r.uid, r.aal, r.caps, novo;
    END IF;
    n := n + 1;
  END LOOP;
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('lardan.test_uid', coalesce(v_test, ''), true);
  RAISE NOTICE '0327: my_capabilities idêntico em % combinações de usuário', n;
END $depois$;

-- 2) Saldo das parcelas: uma única fórmula (a visão abaixo). fin_installment_saldo lê dela para uma parcela;
--    a Cobrança lê todas de uma vez, sem chamar a rotina milhares de vezes.
CREATE TEMP TABLE _saldo_antes AS SELECT i.id, public.fin_installment_saldo(i.id) AS s FROM public.financial_installments i;
CREATE TEMP TABLE _cob_antes AS SELECT * FROM public.cob_parcelas_abertas();

CREATE OR REPLACE VIEW public.fin_installment_saldos WITH (security_invoker = true) AS
  SELECT i.id AS installment_id,
         (i.valor_cents
          + coalesce((SELECT sum(CASE WHEN j.kind IN ('juros','multa') THEN j.valor_cents
                                      WHEN j.kind IN ('desconto','abatimento') THEN -j.valor_cents
                                      ELSE 0 END)
                        FROM public.financial_adjustments j WHERE j.installment_id = i.id), 0)
          - coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a
                       WHERE a.installment_id = i.id), 0))::bigint AS saldo_cents
    FROM public.financial_installments i;
COMMENT ON VIEW public.fin_installment_saldos IS 'Fórmula única do saldo da parcela (valor + juros/multa − desconto/abatimento − alocações). Só rotinas internas leem.';
REVOKE ALL ON public.fin_installment_saldos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fin_installment_saldos TO service_role;

CREATE OR REPLACE FUNCTION public.fin_installment_saldo(_installment uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.saldo_cents FROM public.fin_installment_saldos s WHERE s.installment_id = _installment
$function$;

CREATE OR REPLACE FUNCTION public.cob_parcelas_abertas()
 RETURNS TABLE(installment_id uuid, title_id uuid, party_id uuid, numero text, vencimento date, saldo_cents bigint, valor_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.id, t.id, coalesce(t.pagador_party_id,t.party_id), t.numero, i.vencimento, s.saldo_cents, i.valor_cents
  from financial_installments i join financial_titles t on t.id=i.title_id
  join fin_installment_saldos s on s.installment_id = i.id
  where t.direction='receivable' and t.status not in ('cancelado','rascunho')
    and i.settlement_status in ('nao_liquidado','parcial') and coalesce(t.pagador_party_id,t.party_id) is not null $function$;

DO $saldo$
DECLARE n_div int; n_tot int;
BEGIN
  SELECT count(*) FILTER (WHERE a.s IS DISTINCT FROM public.fin_installment_saldo(a.id)), count(*) INTO n_div, n_tot FROM _saldo_antes a;
  IF n_div > 0 THEN RAISE EXCEPTION '0327: saldo divergiu em % de % parcelas', n_div, n_tot; END IF;
  IF EXISTS (SELECT * FROM _cob_antes EXCEPT ALL SELECT * FROM public.cob_parcelas_abertas())
     OR EXISTS (SELECT * FROM public.cob_parcelas_abertas() EXCEPT ALL SELECT * FROM _cob_antes) THEN
    RAISE EXCEPTION '0327: parcelas em aberto da Cobrança divergiram';
  END IF;
  RAISE NOTICE '0327: saldo idêntico em % parcelas', n_tot;
END $saldo$;

-- Trava curta: se alguma tabela estiver ocupada, desiste em 3 s (nada é aplicado) em vez de enfileirar as telas.
SET LOCAL lock_timeout = '3s';

-- 3) Índices da lista e da busca de peças (ordem por data de criação e busca por partes nas colunas da tela)
CREATE INDEX IF NOT EXISTS products_created_desc_idx ON public.products (created_at DESC);
CREATE INDEX IF NOT EXISTS products_busca_name_trgm_idx ON public.products USING gin (name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_busca_slug_trgm_idx ON public.products USING gin (slug public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_busca_legacy_trgm_idx ON public.products USING gin (legacy_code public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_busca_ref_trgm_idx ON public.products USING gin (reference_code public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_busca_material_trgm_idx ON public.products USING gin (material public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_busca_desc_trgm_idx ON public.products USING gin (short_description public.gin_trgm_ops);

-- 4) Regras de acesso: a checagem de papel/permissão do usuário passa a rodar uma vez por consulta
--    (e não uma vez por linha). A expressão continua a mesma — só ganha o "( SELECT ... )" em volta.
DO $pol$
DECLARE
  r record; q2 text; c2 text; cmd text; n int := 0; v_sp text := current_setting('search_path');
  fns constant text := 'has_role|has_capability|has_any_role|cob_pode|can_manage_leads|can_manage_content|is_staff|can_manage_kits|can_view_costs|can_view_kits|pdv_gestao|access_pode_ver_convites';
  padrao text;
  tira text;
  nova record;
BEGIN
  PERFORM set_config('search_path', 'public', true);
  padrao := '(?<!SELECT )\m(' || fns || ')\((auth\.uid\(\)(?:, (?:''[^'']*''::[a-z_]+|ARRAY\[[^]]*\]))?)\)';
  tira := '\( SELECT ((?:' || fns || ')\(auth\.uid\(\)[^)]*\)) AS [a-z_]+\)';
  FOR r IN SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname = 'public' LOOP
    q2 := CASE WHEN r.qual IS NULL THEN NULL ELSE regexp_replace(r.qual, padrao, '( SELECT \1(\2))', 'g') END;
    c2 := CASE WHEN r.with_check IS NULL THEN NULL ELSE regexp_replace(r.with_check, padrao, '( SELECT \1(\2))', 'g') END;
    IF q2 IS DISTINCT FROM r.qual OR c2 IS DISTINCT FROM r.with_check THEN
      cmd := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
      IF q2 IS NOT NULL THEN cmd := cmd || ' USING (' || q2 || ')'; END IF;
      IF c2 IS NOT NULL THEN cmd := cmd || ' WITH CHECK (' || c2 || ')'; END IF;
      EXECUTE cmd;
      SELECT p.qual, p.with_check INTO nova FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = r.tablename AND p.policyname = r.policyname;
      IF regexp_replace(coalesce(nova.qual, ''), tira, '\1', 'g') IS DISTINCT FROM regexp_replace(coalesce(r.qual, ''), tira, '\1', 'g')
         OR regexp_replace(coalesce(nova.with_check, ''), tira, '\1', 'g') IS DISTINCT FROM regexp_replace(coalesce(r.with_check, ''), tira, '\1', 'g') THEN
        RAISE EXCEPTION '0327: regra % em % mudou além do ( SELECT ... ): antes [%] agora [%]', r.policyname, r.tablename, r.qual, nova.qual;
      END IF;
      n := n + 1;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND (coalesce(qual, '') ~ padrao OR coalesce(with_check, '') ~ padrao)) THEN
    RAISE EXCEPTION '0327: ainda há regra com checagem por linha';
  END IF;
  PERFORM set_config('search_path', v_sp, true);
  RAISE NOTICE '0327: % regras de acesso passaram a checar uma vez por consulta', n;
END $pol$;