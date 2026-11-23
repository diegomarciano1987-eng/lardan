-- 0371: Jurídico somente leitura na Cobrança (Dr. Danilo, 23/11/2026).
-- Leitura da Cobrança passa por cob_pode_ler (equipe de cobrança + jurídico); toda escrita continua em cob_pode.
CREATE OR REPLACE FUNCTION public.cob_pode_ler(_u uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_any_role(_u, array['master','diretoria','cobranca','financeiro','juridico']::app_role[]) $function$;
REVOKE ALL ON FUNCTION public.cob_pode_ler(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cob_pode_ler(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cob_pode_ler(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.cob_pode_ler(uuid) IS 'Leitura da Cobrança (inclui jurídico somente leitura). Escrita usa cob_pode.';

INSERT INTO public.role_capabilities(role, capability) VALUES ('juridico','collection.view') ON CONFLICT DO NOTHING;

-- Rotinas só de leitura da Cobrança: trocam cob_pode por cob_pode_ler (as de escrita ficam como estão).
DO $$
DECLARE
  f record; def text; novo text;
  leitura text[] := array[
    'asaas_cliente_espelho_situacao','cob_acordo_cobrancas','cob_acordos_atrasados_lista','cob_acordos_situacao',
    'cob_cadastro_ler','cob_carteira','cob_carteira2','cob_contatos_avisos','cob_devedor','cob_historica_buscar',
    'cob_historica_lista','cob_judicial_assinaturas','cob_judicial_contato','cob_kpis','cob_kpis_periodo',
    'cob_lembretes','cob_maletas_perdidas','cob_termos_confissao','consultora_cockpit_financeiro',
    'consultora_financeiro_smalldata','consultora_historico_vendas_equipe','consultora_notas_e_fechamentos'];
BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = ANY(leitura) LOOP
    IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = f.oid AND prosrc ~* '\m(insert|update|delete)\M') THEN
      RAISE EXCEPTION 'Rotina % escreve dados; não pode ir para leitura.', f.proname;
    END IF;
    def := pg_get_functiondef(f.oid);
    novo := regexp_replace(def, '\mcob_pode\(', 'cob_pode_ler(', 'g');
    IF novo <> def THEN EXECUTE novo; END IF;
  END LOOP;

  -- Alvarás judiciais: leitura também para quem lê a Cobrança.
  SELECT p.oid INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cob_judicial_alvaras' LIMIT 1;
  IF FOUND THEN
    def := pg_get_functiondef(f.oid);
    IF def !~ 'cob_pode_ler' THEN
      novo := replace(def, 'public.has_capability(auth.uid(),''finance.receivable.view'')',
                      '(public.has_capability(auth.uid(),''finance.receivable.view'') OR public.cob_pode_ler(auth.uid()))');
      IF novo <> def THEN EXECUTE novo; END IF;
    END IF;
  END IF;
END $$;

-- Políticas de LEITURA das tabelas da Cobrança: cob_pode -> cob_pode_ler. Políticas de escrita não existem (tudo por RPC).
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT tablename, policyname, qual FROM pg_policies
              WHERE schemaname = 'public' AND cmd = 'SELECT' AND qual ~ '\mcob_pode\(' LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', pol.policyname, pol.tablename,
                   regexp_replace(pol.qual, '\mcob_pode\(', 'cob_pode_ler(', 'g'));
  END LOOP;
END $$;