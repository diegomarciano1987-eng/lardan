DO $ddl$ DECLARE d text; n text; BEGIN
FOREACH n IN ARRAY ARRAY['remessa_maletas','remessas_buscar','remessas_lista'] LOOP
SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=n;
IF d IS NULL THEN RAISE EXCEPTION 'Rotina ausente %',n; END IF;
d:=replace(d,'JOIN parties pa','JOIN public.colab_v_parties pa');
IF n='remessa_maletas' THEN d:=replace(d,'WHERE k.remessa_id = _remessa','WHERE (k.consultora_party_id IS NULL OR public.colab_party_ok(k.consultora_party_id)) AND k.remessa_id = _remessa'); END IF;
EXECUTE d;
END LOOP;
SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='network_geo_municipio_consultoras';
IF position('s := public.network_scope();' in d)=0 THEN RAISE EXCEPTION 'Contrato rede inesperado'; END IF;
EXECUTE replace(d,'s := public.network_scope();','s := public.network_scope(); IF public.colab_restrita() AND NOT public.has_capability(auth.uid(),''network.identity.view'') THEN RETURN; END IF;');
END $ddl$;