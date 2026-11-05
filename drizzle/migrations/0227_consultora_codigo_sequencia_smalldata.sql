-- Consultora nova recebe o próximo número da sequência do sistema antigo (SmallData), nunca LC-.
CREATE SEQUENCE IF NOT EXISTS public.consultora_codigo_seq START 9120;
SELECT setval('public.consultora_codigo_seq', greatest(9119,
  coalesce((SELECT max(code::bigint) FROM public.parties WHERE code ~ '^\d{1,9}$'), 0),
  coalesce((SELECT max(codigo::bigint) FROM public.party_codigos_legados WHERE codigo ~ '^\d{1,9}$'), 0),
  coalesce((SELECT max(codcli::bigint) FROM public.legado_consultoras WHERE codcli::text ~ '^\d{1,9}$'), 0)));
REVOKE ALL ON SEQUENCE public.consultora_codigo_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consultora_codigo_proximo()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE n text;
BEGIN
  LOOP
    n := nextval('consultora_codigo_seq')::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM parties WHERE code = n)
          AND NOT EXISTS (SELECT 1 FROM party_codigos_legados WHERE codigo = n)
          AND NOT EXISTS (SELECT 1 FROM legado_consultoras WHERE codcli::text = n)
          AND NOT EXISTS (SELECT 1 FROM party_codigo_historico WHERE code_antigo = n OR code_novo = n);
  END LOOP;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.consultora_codigo_proximo() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consultora_codigo_sequencia_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE antigo text; novo text;
BEGIN
  IF NEW.role::text <> 'consultora' THEN RETURN NEW; END IF;
  SELECT code INTO antigo FROM parties WHERE id = NEW.party_id FOR UPDATE;
  IF antigo IS NULL OR antigo NOT LIKE 'LC-%' THEN RETURN NEW; END IF;
  -- só quem é apenas consultora/candidata/cliente (representante, fornecedor, equipe mantêm o código)
  IF EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id = NEW.party_id
              AND r.role::text NOT IN ('consultora', 'candidata', 'cliente', 'revendedora')) THEN RETURN NEW; END IF;
  novo := public.consultora_codigo_proximo();
  UPDATE parties SET code = novo WHERE id = NEW.party_id;
  INSERT INTO party_codigo_historico (party_id, code_antigo, code_novo, motivo, autor)
  VALUES (NEW.party_id, antigo, novo, 'consultora nova segue a sequência do SmallData', auth.uid());
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.consultora_codigo_sequencia_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_consultora_codigo_sequencia ON public.party_roles;
CREATE TRIGGER zz_consultora_codigo_sequencia AFTER INSERT ON public.party_roles
FOR EACH ROW EXECUTE FUNCTION public.consultora_codigo_sequencia_trg();