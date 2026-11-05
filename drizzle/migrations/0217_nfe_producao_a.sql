-- 0216a — configuração de produção + funções de ambiente e código da peça
ALTER TABLE public.fiscal_settings ADD COLUMN IF NOT EXISTS producao_piloto_cycle_id uuid REFERENCES public.kit_cycles(id);
ALTER TABLE public.fiscal_settings ADD COLUMN IF NOT EXISTS producao_todas boolean NOT NULL DEFAULT false;
ALTER TABLE public.fiscal_settings ADD COLUMN IF NOT EXISTS producao_automatico boolean NOT NULL DEFAULT false;
ALTER TABLE public.fiscal_settings ADD COLUMN IF NOT EXISTS serie_producao text NOT NULL DEFAULT '3';
ALTER TABLE public.fiscal_settings ADD COLUMN IF NOT EXISTS email_copia_xml text DEFAULT 'fiscal2@on4.com.br';
ALTER TABLE public.fiscal_focus_envios ADD COLUMN IF NOT EXISTS email_enviado_em timestamptz;
ALTER TABLE public.fiscal_focus_envios ADD COLUMN IF NOT EXISTS email_tentativas int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.fiscal_focus_eh_servidor()
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT coalesce(auth.role(), '') = 'service_role' AND auth.uid() IS NULL
$$;
REVOKE ALL ON FUNCTION public.fiscal_focus_eh_servidor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_eh_servidor() TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_focus_producao_ativa()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT emission_active AND environment = 'producao' AND provider = 'focus' FROM fiscal_settings WHERE id), false)
$$;
REVOKE ALL ON FUNCTION public.fiscal_focus_producao_ativa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_producao_ativa() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fiscal_focus_ambiente(_cycle uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM fiscal_settings WHERE id;
  IF NOT public.fiscal_focus_producao_ativa() THEN RETURN 'homologacao'; END IF;
  IF s.producao_todas OR s.producao_piloto_cycle_id = _cycle THEN RETURN 'producao'; END IF;
  RAISE EXCEPTION 'A emissão real está ligada só para a maleta piloto. Libere todas as maletas em Integrações para emitir esta.';
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_ambiente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_ambiente(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fiscal_peca_codigo(_variant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT left(coalesce(public.peca_referencia_etiqueta(v.reference_code, pr.reference_code),
                       nullif(btrim(v.barcode), ''), nullif(btrim(pr.barcode), ''),
                       nullif(btrim(v.sku), ''), nullif(btrim(pr.internal_code), ''), left(v.id::text, 8)), 60)
    FROM product_variants v JOIN products pr ON pr.id = v.product_id WHERE v.id = _variant
$$;
CREATE OR REPLACE FUNCTION public.fiscal_peca_descricao(_variant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT left(CASE WHEN nullif(btrim(v.label), '') IS NULL OR btrim(v.label) = 'U'
                     OR position(upper(btrim(v.label)) IN upper(pr.name)) > 0 THEN btrim(pr.name)
                   ELSE btrim(pr.name) || ' ' || btrim(v.label) END, 120)
    FROM product_variants v JOIN products pr ON pr.id = v.product_id WHERE v.id = _variant
$$;
REVOKE ALL ON FUNCTION public.fiscal_peca_codigo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fiscal_peca_descricao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_peca_codigo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_peca_descricao(uuid) TO authenticated, service_role;