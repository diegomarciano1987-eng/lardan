ALTER TABLE public.pedido_config ADD COLUMN IF NOT EXISTS envio_garantia_texto text NOT NULL DEFAULT '';
DO $$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.pedido_config_salvar(jsonb)'::regprocedure);
 IF position('envio_garantia_texto' in def)>0 THEN RETURN; END IF;
 IF position('''proxima_maleta_texto'',''proxima_maleta_minimo_cents''' in def)=0 OR position('proxima_maleta_texto = coalesce(' in def)=0 THEN RAISE EXCEPTION 'A configuração mudou; revisar antes.'; END IF;
 def:=replace(def,'''proxima_maleta_texto'',''proxima_maleta_minimo_cents''','''proxima_maleta_texto'',''proxima_maleta_minimo_cents'',''envio_garantia_texto''');
 def:=replace(def,'proxima_maleta_texto = coalesce(','envio_garantia_texto = coalesce(_dados->>''envio_garantia_texto'', c.envio_garantia_texto), proxima_maleta_texto = coalesce(');
 EXECUTE def;
END $$;