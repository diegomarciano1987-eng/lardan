
CREATE OR REPLACE FUNCTION public.kit_entrada_consultoras(_busca text DEFAULT NULL::text, _limit integer DEFAULT 40)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  de constant text := 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ';
  pa constant text := 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC';
  termo text := nullif(btrim(coalesce(_busca,'')), '');
  palavras text[]; canon text; r jsonb;
BEGIN
  PERFORM public.kit_entrada_exigir();
  palavras := CASE WHEN termo IS NULL THEN '{}'::text[]
              ELSE regexp_split_to_array(lower(translate(termo, de, pa)), '\s+') END;
  canon := nullif(upper(regexp_replace(coalesce(termo,''), '[^0-9A-Za-z]', '', 'g')), '');
  IF canon IS NOT NULL AND length(canon) < 3 THEN canon := NULL; END IF;
  WITH base AS (
    SELECT p.id, p.display_name, p.code, p.doc_masked, pr.status::text AS situacao
    FROM public.parties p
    JOIN public.party_roles pr ON pr.party_id = p.id AND pr.role = 'consultora'
    WHERE termo IS NULL
       OR NOT EXISTS (
            SELECT 1 FROM unnest(palavras) w
            WHERE lower(translate(concat_ws(' ', p.display_name, p.legal_name, p.social_name, p.code), de, pa))
                  NOT LIKE '%'||w||'%')
       OR (canon IS NOT NULL AND p.doc_canon LIKE '%'||canon||'%')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY (b.situacao = 'ativo') DESC, b.display_name)
      FROM (SELECT * FROM base ORDER BY (situacao = 'ativo') DESC, display_name
            LIMIT least(greatest(coalesce(_limit,40),1), 300)) b), '[]'::jsonb))
  INTO r;
  RETURN r;
END $function$;
