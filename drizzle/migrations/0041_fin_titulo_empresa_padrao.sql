CREATE OR REPLACE FUNCTION public.fin_title_empresa_padrao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE unica uuid;
BEGIN
  IF NEW.business_entity_id IS NULL THEN
    SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] END INTO unica FROM business_entities;
    NEW.business_entity_id := unica;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS financial_titles_empresa_padrao ON public.financial_titles;
CREATE TRIGGER financial_titles_empresa_padrao BEFORE INSERT ON public.financial_titles
FOR EACH ROW EXECUTE FUNCTION public.fin_title_empresa_padrao();