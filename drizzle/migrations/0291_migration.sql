DO $ddl$ DECLARE d text; t text; BEGIN
 SELECT pg_get_functiondef('public.legado_consultora_dados(integer[])'::regprocedure) INTO d;
 d := replace(d, 'FUNCTION public.legado_consultora_dados(', 'FUNCTION public.legado_consultora_dados_rede(');
 d := regexp_replace(d, '\mcolab_v_(legado_[a-z_]+)\M', '\1', 'g');
 EXECUTE d;
 SELECT pg_get_functiondef('public.legado_consultora_historico(uuid)'::regprocedure) INTO d;
 IF position('BEGIN' in d) = 0 THEN RAISE EXCEPTION 'contrato inesperado'; END IF;
 d := regexp_replace(d, 'END IF;\n', E'END IF;\n  -- Montagem (colaboradora com kit.manage) vê o histórico SmallData de toda a rede, só leitura.\n  IF public.colab_restrita() AND public.has_capability(auth.uid(), ''kit.manage'') THEN\n    SELECT array_agg(codcli ORDER BY codcli) INTO cods FROM legado_consultoras WHERE party_id = _party;\n    IF cods IS NULL THEN RETURN jsonb_build_object(''vinculada'', false); END IF;\n    RETURN public.legado_consultora_dados_rede(cods) || jsonb_build_object(''vinculada'', true);\n  END IF;\n');
 EXECUTE d;
END $ddl$;
REVOKE ALL ON FUNCTION public.legado_consultora_dados_rede(integer[]) FROM PUBLIC, anon, authenticated;