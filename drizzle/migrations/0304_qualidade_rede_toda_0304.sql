-- 0304 (Diego, 13/11/2026): a gerente da Qualidade (colaboradora por código com o módulo Trocas e garantias em
-- "alterar" = quality.manage) confere maletas de TODAS as consultoras, de qualquer representante/praça.
-- Antes a trava de carteira (colab_carteira_guard em kit_cycles) recusava "Maleta fora da carteira." ao confirmar
-- a chegada de uma maleta de outro representante (Tatiane 1006, ligada ao Daniel).
-- Separação de conceitos:
--   colab_conta()     = é colaboradora por código (estoque continua fechado, catálogo/estoque geral fechado,
--                       reservas internas de montagem e Inteligência da Rede seguem como antes);
--   colab_restrita()  = colaboradora PRESA à carteira do representante (colab_conta e sem quality.manage).
-- Desligar o acesso (colab_acessos.ativo=false) ou tirar o módulo devolve a trava na hora.

CREATE OR REPLACE FUNCTION public.colab_conta()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM colab_acessos WHERE user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.colab_conta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.colab_conta() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.colab_rede_toda()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM user_capabilities uc
                   JOIN colab_acessos ca ON ca.user_id = uc.user_id AND ca.ativo
                   JOIN profiles pf ON pf.id = uc.user_id AND pf.is_active
                  WHERE uc.user_id = auth.uid() AND uc.capability = 'quality.manage')
$$;
REVOKE ALL ON FUNCTION public.colab_rede_toda() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.colab_rede_toda() TO authenticated, service_role;

-- 1) rotinas onde "colab_restrita" queria dizer "é colaboradora" (estoque, reservas internas, rede): passam a colab_conta,
--    comportamento idêntico ao de hoje para todo mundo.
DO $$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
      'has_capability','catalog_overview','colab_kit_reserva_criar_interna','colab_kit_reserva_liberar_interna',
      'network_scope','network_geo_candidaturas','network_geo_municipio_consultoras','network_geo_municipio_consultoras_v2')
  LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'public.colab_restrita()', 'public.colab_conta()');
    d := replace(d, 'colab_restrita()', 'public.colab_conta()');
    EXECUTE d;
  END LOOP;
END $$;

-- 2) colab_restrita: só a colaboradora presa à carteira
CREATE OR REPLACE FUNCTION public.colab_restrita()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.colab_conta() AND NOT public.colab_rede_toda()
$$;

-- 3) tabelas fora do assunto (estoque/locais, fornecedores, empresas, vínculos) seguem fechadas para toda colaboradora
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suppliers','business_entities','locations','party_links'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS colab_carteira_guard ON public.%I', t);
    EXECUTE format('CREATE POLICY colab_carteira_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.colab_conta())) WITH CHECK ((SELECT NOT public.colab_conta()))', t);
  END LOOP;
END $$;

-- 4) escopo para a tela: continua "colaboradora" (abas de acesso/estoque escondidas), mas sem trava de representante
CREATE OR REPLACE FUNCTION public.colab_meu_escopo()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('colaboradora', public.colab_conta(), 'rede_toda', public.colab_conta() AND public.colab_rede_toda(),
    'representante', public.colab_rep(), 'nome', (SELECT display_name FROM parties WHERE id = public.colab_rep()))
$$;
