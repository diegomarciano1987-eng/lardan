CREATE OR REPLACE FUNCTION public.registry_duplicate_candidates(_nome text DEFAULT NULL,_doc text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $function$
DECLARE v_nome text := lower(regexp_replace(btrim(coalesce(_nome,'')),'\s+',' ','g')); v_doc text := nullif(regexp_replace(coalesce(_doc,''),'\D','','g'),'');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'registry.view') THEN RAISE EXCEPTION 'Sem permissão para consultar cadastros'; END IF;
  IF length(v_nome)>240 OR length(coalesce(v_doc,''))>14 THEN RAISE EXCEPTION 'Busca inválida'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT p.id,p.code,p.display_name,p.doc_masked,p.status,CASE WHEN v_doc IS NOT NULL AND p.doc_digits=v_doc THEN 'documento' ELSE 'nome' END motivo
    FROM public.parties p WHERE (length(v_nome)>=3 AND lower(regexp_replace(btrim(p.display_name),'\s+',' ','g'))=v_nome) OR (length(v_doc)>=11 AND p.doc_digits=v_doc)
    ORDER BY p.code LIMIT 20
  ) x),'[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.registry_duplicate_candidates(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.registry_duplicate_candidates(text,text) TO authenticated;