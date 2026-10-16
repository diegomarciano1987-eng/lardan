
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.party_unificar(uuid,uuid,text,boolean)'::regprocedure);
  d := replace(d, $x$    IF jsonb_array_length(ids) > 0 THEN
      BEGIN$x$, $x$    IF jsonb_array_length(ids) > 0 AND fk.t IN ('cob_fiado_linhas','asaas_import_stage') THEN
      -- lastro original imutável: fica como foi importado; o título já passa para a canônica
      mov := mov || jsonb_build_object('preservado:'||fk.t||'.'||fk.col, ids);
    ELSIF jsonb_array_length(ids) > 0 THEN
      BEGIN$x$);
  EXECUTE d;
END $$;
