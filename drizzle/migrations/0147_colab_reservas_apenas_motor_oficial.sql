DO $ddl$ DECLARE d text; BEGIN
SELECT pg_get_functiondef('public.create_stock_reservation(uuid,uuid,integer,timestamp with time zone,text,text,uuid,text,text)'::regprocedure) INTO d;
EXECUTE replace(d,'FUNCTION public.create_stock_reservation(','FUNCTION public.colab_kit_reserva_criar_interna(');
d:=regexp_replace(d,'IF uid IS NULL OR NOT \(public.has_capability\(uid,''stock.reservation.create''\).*? THEN','IF uid IS NULL OR NOT public.has_capability(uid,''stock.reservation.create'') THEN','s'); EXECUTE d;
SELECT pg_get_functiondef('public.release_stock_reservation(uuid,boolean,text,text)'::regprocedure) INTO d;
EXECUTE replace(d,'FUNCTION public.release_stock_reservation(','FUNCTION public.colab_kit_reserva_liberar_interna(');
d:=regexp_replace(d,'IF uid IS NULL OR NOT \(public.has_capability\(uid,''stock.reservation.cancel''\).*? THEN','IF uid IS NULL OR NOT public.has_capability(uid,''stock.reservation.cancel'') THEN','s'); EXECUTE d;
SELECT pg_get_functiondef('public.kit_conferir(uuid,text)'::regprocedure) INTO d;
IF position('public.create_stock_reservation(' in d)=0 THEN RAISE EXCEPTION 'Contrato de conferencia inesperado'; END IF;
EXECUTE replace(d,'public.create_stock_reservation(','public.colab_kit_reserva_criar_interna(');
SELECT pg_get_functiondef('public.kit_expedir(uuid,jsonb)'::regprocedure) INTO d;
IF position('public.release_stock_reservation(' in d)=0 THEN RAISE EXCEPTION 'Contrato de expedicao inesperado'; END IF;
EXECUTE replace(d,'public.release_stock_reservation(','public.colab_kit_reserva_liberar_interna(');
END $ddl$;
REVOKE ALL ON FUNCTION public.colab_kit_reserva_criar_interna(uuid,uuid,integer,timestamp with time zone,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.colab_kit_reserva_liberar_interna(uuid,boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;