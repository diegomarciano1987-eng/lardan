ALTER TABLE public.pedido_config ADD COLUMN proxima_maleta_texto text NOT NULL DEFAULT '', ADD COLUMN proxima_maleta_minimo_cents bigint;
COMMENT ON COLUMN public.pedido_config.proxima_maleta_minimo_cents IS 'Valor informativo configurado pelo Master; não bloqueia maletas nem altera comissões.';
DO $$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.pedido_config_salvar(jsonb)'::regprocedure);
 IF position('''rodape_texto'',''prazo_correio_dias''' in def)=0 THEN RAISE EXCEPTION 'A configuração mudou; revisar antes.'; END IF;
 def:=replace(def,'''rodape_texto'',''prazo_correio_dias''','''rodape_texto'',''prazo_correio_dias'',''proxima_maleta_texto'',''proxima_maleta_minimo_cents''');
 def:=replace(def,'  SELECT to_jsonb(c) INTO antes FROM pedido_config c;','  IF _dados ? ''proxima_maleta_minimo_cents'' AND _dados->>''proxima_maleta_minimo_cents'' IS NOT NULL AND ((_dados->>''proxima_maleta_minimo_cents'')::bigint <= 0 OR (_dados->>''proxima_maleta_minimo_cents'')::bigint > 100000000) THEN RAISE EXCEPTION ''Informe um valor mínimo de vendas positivo.''; END IF; SELECT to_jsonb(c) INTO antes FROM pedido_config c;');
 def:=replace(def,'    atualizado_por = auth.uid(), atualizado_em = now();','    proxima_maleta_texto = coalesce(_dados->>''proxima_maleta_texto'', c.proxima_maleta_texto), proxima_maleta_minimo_cents = CASE WHEN _dados ? ''proxima_maleta_minimo_cents'' THEN (_dados->>''proxima_maleta_minimo_cents'')::bigint ELSE c.proxima_maleta_minimo_cents END, atualizado_por = auth.uid(), atualizado_em = now();');
 EXECUTE def;
END $$;
CREATE OR REPLACE FUNCTION public.consultora_aviso_proxima_maleta() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
 RETURN (SELECT jsonb_build_object('texto',c.proxima_maleta_texto,'minimo_cents',c.proxima_maleta_minimo_cents) FROM pedido_config c);
END $$;
REVOKE ALL ON FUNCTION public.consultora_aviso_proxima_maleta() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consultora_aviso_proxima_maleta() TO authenticated,service_role;