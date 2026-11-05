DO $$
DECLARE v_cep text := x2786300000x27;
BEGIN
  IF v_cep ~ x27^[0-9]{8}$x27 THEN
    RAISE NOTICE x27okx27;
  END IF;
END $$;
