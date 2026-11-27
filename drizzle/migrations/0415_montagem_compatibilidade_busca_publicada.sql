DO $$ DECLARE d text; n text; BEGIN
 d:=pg_get_functiondef('public.praca_consultoras_busca(uuid,text)'::regprocedure);
 n:=replace(d,'WHERE cp.praca_id = _praca','WHERE (cp.praca_id = _praca OR public.colab_rede_toda())');
 IF n=d THEN RAISE EXCEPTION 'Ponto de atualização da busca não encontrado'; END IF;
 EXECUTE n;
 d:=pg_get_functiondef('public.remessa_abrir_maleta(uuid,uuid)'::regprocedure);
 n:=replace(d,$a$  IF NOT EXISTS (SELECT 1 FROM consultant_profiles WHERE party_id = _consultora AND praca_id = r.praca_id) THEN$a$,
 $b$  IF public.colab_rede_toda() AND public.colab_rem_ok(r.id) AND public.colab_party_ok(_consultora)
     AND EXISTS (SELECT 1 FROM consultant_profiles WHERE party_id=_consultora AND praca_id IS DISTINCT FROM r.praca_id) THEN
    PERFORM public.remessa_vincular_consultora(_remessa,_consultora);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM consultant_profiles WHERE party_id = _consultora AND praca_id = r.praca_id) THEN$b$);
 IF n=d THEN RAISE EXCEPTION 'Ponto de atualização da abertura não encontrado'; END IF;
 EXECUTE n;
END $$;