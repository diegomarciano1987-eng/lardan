DO $$
DECLARE fone text;
BEGIN
  SELECT regexp_replace(value, x27[^0-9]x27, x27x27, x27gx27) INTO fone FROM contact_points WHERE kind IN (x27whatsappx27, x27telefonex27) ORDER BY is_primary DESC, created_at LIMIT 1;
END $$;
