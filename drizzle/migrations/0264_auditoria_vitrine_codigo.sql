DO $do$ DECLARE def text; BEGIN
 def := pg_get_functiondef('public.auditoria_integridade()'::regprocedure);
 IF position('SELECT s.id::text AS ref FROM consultant_showcases s' IN def) > 0 THEN
  def := replace(def, 'SELECT s.id::text AS ref FROM consultant_showcases s', 'SELECT s.party_id::text AS ref FROM consultant_showcases s');
  EXECUTE def;
 ELSIF position('SELECT s.party_id::text AS ref FROM consultant_showcases s' IN def) = 0 THEN
  RAISE EXCEPTION 'Auditoria mudou; revisar identificação da vitrine.';
 END IF;
END $do$;