DO $$
DECLARE fone text;
BEGIN
  SELECT regexp_replace(value, '[^0-9]', '', 'g') INTO fone FROM contact_points WHERE kind IN ('whatsapp', 'telefone') ORDER BY is_primary DESC, created_at LIMIT 1;
END $$;