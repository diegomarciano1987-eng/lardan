DO $$
DECLARE v_cep text := '86300000';
BEGIN
  IF v_cep ~ '^[0-9]{8}$' THEN
    RAISE NOTICE 'ok';
  END IF;
END $$;
