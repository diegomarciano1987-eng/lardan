DO $$ DECLARE d text; alvo text:='  SELECT * INTO s FROM cob_simulacoes WHERE id=it.acordo_simulacao_id FOR UPDATE;'; BEGIN
 d:=pg_get_functiondef('public.cob_acordo_baixa(uuid,uuid)'::regprocedure);
 IF position(alvo in d)=0 THEN RAISE EXCEPTION 'Rotina de acordo mudou'; END IF;
 d:=replace(d,alvo, '  PERFORM 1 FROM cob_judicial_acordos WHERE id=(SELECT judicial_acordo_id FROM cob_simulacoes WHERE id=it.acordo_simulacao_id) FOR UPDATE;'||E'\n'||alvo);
 EXECUTE d;
END $$;