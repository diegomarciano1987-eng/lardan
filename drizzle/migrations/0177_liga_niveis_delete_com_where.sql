DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.liga_niveis_salvar(jsonb)'::regprocedure);
  IF position('DELETE FROM liga_niveis WHERE true;' in d) > 0 THEN RETURN; END IF;
  IF position('DELETE FROM liga_niveis;' in d) = 0 THEN RAISE EXCEPTION 'liga_niveis_salvar mudou; revisar antes de aplicar.'; END IF;
  EXECUTE replace(d, 'DELETE FROM liga_niveis;', 'DELETE FROM liga_niveis WHERE true;');
END $patch$;