-- 0326 — Auditoria de segurança (16/11/2026): limites contra envio em massa e portas que não deviam estar abertas.
-- Nada lança dinheiro, nada é apagado e nenhuma coluna é removida. Roda duas vezes seguidas sem erro.

-- 1
CREATE TABLE IF NOT EXISTS public.seguranca_limites (
  chave text NOT NULL,
  janela timestamptz NOT NULL,
  contagem integer NOT NULL DEFAULT 0,
  PRIMARY KEY (chave, janela)
);
ALTER TABLE public.seguranca_limites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seguranca_limites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.seguranca_limites TO service_role;
COMMENT ON TABLE public.seguranca_limites IS '0326: contadores de limite (janela fixa) contra envio em massa. Linhas com mais de 2 dias são limpas sozinhas.';

CREATE OR REPLACE FUNCTION public.seguranca_limite(_chave text, _max integer, _janela_seg integer)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_jan timestamptz; v_n integer;
BEGIN
  IF _chave IS NULL OR _chave = '' OR _max IS NULL OR _max < 1 OR _janela_seg IS NULL OR _janela_seg < 1 THEN RETURN true; END IF;
  v_jan := to_timestamp(floor(extract(epoch FROM now()) / _janela_seg) * _janela_seg);
  INSERT INTO seguranca_limites (chave, janela, contagem) VALUES (left(_chave, 200), v_jan, 1)
  ON CONFLICT (chave, janela) DO UPDATE SET contagem = seguranca_limites.contagem + 1
  RETURNING contagem INTO v_n;
  IF random() < 0.01 THEN DELETE FROM seguranca_limites WHERE janela < now() - interval '2 days'; END IF;
  RETURN v_n <= _max;
END $$;
REVOKE ALL ON FUNCTION public.seguranca_limite(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seguranca_limite(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.seguranca_ip()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT nullif(btrim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for', ''), ',', 1)), '')
    FROM (SELECT nullif(current_setting('request.headers', true), '')::json AS h) s
$$;
REVOKE ALL ON FUNCTION public.seguranca_ip() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seguranca_ip() TO service_role;

-- 2
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.submit_candidatura(jsonb,jsonb)'::regprocedure); antes := def;
  IF position('candidatura:cpf:' IN def) = 0 THEN
    def := replace(def, $a$    IF v_recent >= 5 THEN RAISE EXCEPTION 'limite_envios'; END IF;
  END IF;$a$, $b$    IF v_recent >= 5 THEN RAISE EXCEPTION 'limite_envios'; END IF;
  END IF;
  -- 0326: limites que não dependem do IP
  IF NOT public.seguranca_limite('candidatura:cpf:' || v_cpf, 3, 86400) THEN RAISE EXCEPTION 'limite_envios'; END IF;
  IF NOT public.seguranca_limite('candidatura:total', 200, 3600) THEN RAISE EXCEPTION 'limite_envios'; END IF;$b$);
    IF def = antes THEN RAISE EXCEPTION '0326: ponto do limite não encontrado em submit_candidatura; revisar.'; END IF;
    EXECUTE def;
  END IF;
END $do$;
REVOKE ALL ON FUNCTION public.submit_candidatura(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_candidatura(jsonb, jsonb) TO service_role;

-- 3
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.submit_contact_request(text,text,text,text,text,text,text,jsonb,text,boolean)'::regprocedure); antes := def;
  IF position('contato:ip:' IN def) = 0 THEN
    def := replace(def, $a$  IF coalesce(p_privacy_version,'') = '' THEN
    RAISE EXCEPTION 'privacidade_ausente';
  END IF;$a$, $b$  IF coalesce(p_privacy_version,'') = '' THEN
    RAISE EXCEPTION 'privacidade_ausente';
  END IF;
  -- 0326: limites contra envio em massa
  IF length(coalesce(p_message, '')) > 5000 OR length(coalesce(p_subject, '')) > 300 THEN RAISE EXCEPTION 'mensagem_invalida'; END IF;
  IF public.seguranca_ip() IS NOT NULL AND NOT public.seguranca_limite('contato:ip:' || public.seguranca_ip(), 5, 600) THEN
    RAISE EXCEPTION 'limite_envios';
  END IF;
  IF NOT public.seguranca_limite('contato:total', 100, 3600) THEN RAISE EXCEPTION 'limite_envios'; END IF;$b$);
    IF def = antes THEN RAISE EXCEPTION '0326: ponto do limite não encontrado em submit_contact_request; revisar.'; END IF;
    EXECUTE def;
  END IF;
END $do$;
REVOKE INSERT ON public.contact_requests FROM anon, authenticated;

-- 4
DO $do$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'submit_lead' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $do$;

-- 5
DO $do$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN (
              'product_next_internal_code','produto_ref_prefixo','consultora_historico_partes','consultora_rep_pela_praca',
              'kit_preco_da_consultora','stock_available','indicacao_aprovadas','import_row_dup_in_file',
              'asaas_smalldata_data_ref','e_vendedora_interna','fiscal_peca_codigo','fiscal_peca_descricao',
              'qualidade_peca','praca_pela_cidade','pre_baixa_faixa','network_scope_party','rep_publico',
              'pdv_links_listar','kit_data_acerto') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $do$;