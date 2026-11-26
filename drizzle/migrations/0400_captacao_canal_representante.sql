CREATE OR REPLACE FUNCTION public.captacao_canal(_l public.leads)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN _l.representante_origem IN ('link', 'manual')
                OR _l.representante_party_id IS NOT NULL
                OR _l.source_normalized = 'representante'
                OR coalesce(_l.entry_url, '') ILIKE '%rep=lc-%'
              THEN 'representante' ELSE 'site' END
$$;