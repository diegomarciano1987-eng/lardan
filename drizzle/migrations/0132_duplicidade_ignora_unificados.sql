CREATE OR REPLACE FUNCTION public.find_party_duplicates(_doc text DEFAULT NULL::text, _contact text DEFAULT NULL::text, _ignore uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, code text, display_name text, legal_name text, doc_masked text, status party_status, motivo text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d text; c text;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN
    RAISE EXCEPTION 'Sem permissão para consultar cadastros.';
  END IF;
  d := nullif(regexp_replace(coalesce(_doc,''), '\D', '', 'g'), '');
  c := nullif(trim(coalesce(_contact,'')), '');
  IF c IS NOT NULL THEN
    c := CASE WHEN position('@' in c) > 0 THEN lower(c) ELSE regexp_replace(c, '\D', '', 'g') END;
  END IF;
  RETURN QUERY
  SELECT DISTINCT p.id, p.code, p.display_name, p.legal_name, p.doc_masked, p.status,
         CASE WHEN d IS NOT NULL AND p.doc_digits = d THEN 'documento' ELSE 'contato' END
  FROM public.parties p
  LEFT JOIN public.contact_points cp ON cp.party_id = p.id
  WHERE (_ignore IS NULL OR p.id <> _ignore)
    AND NOT EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id = p.id)
    AND ((d IS NOT NULL AND p.doc_digits = d) OR (c IS NOT NULL AND cp.value_norm = c))
  LIMIT 20;
END $function$;

CREATE OR REPLACE FUNCTION public.registry_duplicates(_limit integer DEFAULT 50)
 RETURNS TABLE(motivo text, chave text, quantidade bigint, ids uuid[])
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT 'documento',
         CASE WHEN public.has_capability(auth.uid(),'registry.doc.view')
              THEN p.doc_digits ELSE public.mask_doc(p.doc_digits) END,
         count(*), array_agg(p.id ORDER BY p.created_at)
  FROM public.parties p
  WHERE public.has_capability(auth.uid(), 'registry.view') AND p.doc_digits IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id = p.id)
  GROUP BY p.doc_digits HAVING count(*) > 1
  UNION ALL
  SELECT 'contato', c.value_norm, count(DISTINCT c.party_id), array_agg(DISTINCT c.party_id)
  FROM public.contact_points c
  WHERE public.has_capability(auth.uid(), 'registry.view') AND c.value_norm IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id = c.party_id)
  GROUP BY c.value_norm HAVING count(DISTINCT c.party_id) > 1
  LIMIT least(greatest(COALESCE(_limit, 50), 1), 200);
$function$;