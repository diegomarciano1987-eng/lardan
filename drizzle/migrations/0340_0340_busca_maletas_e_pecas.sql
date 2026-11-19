CREATE OR REPLACE FUNCTION public.pecas_buscar(_termo text, _limite integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  t text := btrim(regexp_replace(coalesce(_termo, ''), '[%_,()]', ' ', 'g'));
  n text;
  lim int := least(greatest(coalesce(_limite, 30), 1), 60);
  res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para buscar peças.' USING errcode = '42501'; END IF;
  n := public.cidade_norm(t);
  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'ordem' ORDER BY x.ordem, x.produto, x.label), '[]'::jsonb) INTO res
  FROM (
    SELECT v.id, v.product_id, p.name AS produto, v.label, v.sku, v.barcode,
      coalesce(nullif(v.reference_code, ''), p.reference_code) AS referencia,
      v.size AS tamanho,
      CASE
        WHEN length(t) >= 2 AND (coalesce(v.barcode, '') = t
          OR upper(coalesce(nullif(v.reference_code, ''), p.reference_code, '')) = upper(t)
          OR upper(coalesce(v.sku, '')) = upper(t)) THEN 0
        WHEN length(t) >= 2 AND (upper(coalesce(nullif(v.reference_code, ''), p.reference_code, '')) LIKE upper(t) || '%'
          OR coalesce(v.barcode, '') LIKE t || '%') THEN 1
        ELSE 2
      END AS ordem
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.is_active
      AND NOT ('demo-video' = ANY (coalesce(p.tags, '{}'::text[])))
      AND (
        length(t) < 2
        OR upper(coalesce(v.reference_code, '')) LIKE '%' || upper(t) || '%'
        OR upper(coalesce(p.reference_code, '')) LIKE '%' || upper(t) || '%'
        OR coalesce(v.barcode, '') LIKE t || '%'
        OR upper(coalesce(v.sku, '')) LIKE '%' || upper(t) || '%'
        OR upper(coalesce(p.internal_code, '')) LIKE '%' || upper(t) || '%'
        OR NOT EXISTS (
          SELECT 1 FROM unnest(string_to_array(n, ' ')) w
          WHERE w <> '' AND public.cidade_norm(p.name || ' ' || coalesce(v.label, '') || ' ' || coalesce(nullif(v.reference_code, ''), p.reference_code, '')) NOT LIKE '%' || w || '%')
      )
    ORDER BY 9, p.name, v.label
    LIMIT lim
  ) x;
  RETURN res;
END
$function$;

REVOKE ALL ON FUNCTION public.pecas_buscar(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pecas_buscar(text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.maletas_buscar(_termo text, _limite integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t text := btrim(coalesce(_termo, ''));
  d text := regexp_replace(coalesce(_termo, ''), '\D', '', 'g');
  num boolean := btrim(coalesce(_termo, '')) ~* '^(MAL-?\s*)?\d{1,7}$';
  lim int := least(greatest(coalesce(_limite, 20), 1), 50);
  res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(), 'kit.view') THEN
    RAISE EXCEPTION 'Acesso não liberado.' USING errcode = '42501';
  END IF;
  IF length(t) < 2 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'ordem' ORDER BY x.ordem, x.criado_em DESC), '[]'::jsonb) INTO res
  FROM (
    SELECT c.id AS cycle_id, k.code AS maleta, c.cycle_no AS ciclo, c.status::text AS status,
      c.consultora_party_id, pc.display_name AS consultora, pc.code AS consultora_codigo,
      r.id AS remessa_id, r.numero AS remessa, pr.nome AS praca, rep.display_name AS representante,
      r.data_acerto, c.abertura_numero, c.quantity_total AS pecas, c.created_at AS criado_em,
      CASE
        WHEN upper(k.code) = upper(t) OR k.qr_token = t THEN 0
        WHEN num AND nullif(regexp_replace(k.code, '\D', '', 'g'), '')::bigint = d::bigint THEN 0
        WHEN pc.code IS NOT NULL AND upper(pc.code) = upper(t) THEN 1
        ELSE 2
      END AS ordem
    FROM public.kit_cycles c
    JOIN public.kits k ON k.id = c.kit_id
    LEFT JOIN public.parties pc ON pc.id = c.consultora_party_id
    LEFT JOIN public.remessas r ON r.id = c.remessa_id
    LEFT JOIN public.cob_pracas pr ON pr.id = r.praca_id
    LEFT JOIN public.parties rep ON rep.id = coalesce(c.representante_party_id, r.representante_party_id)
    WHERE c.status <> 'cancelada'
      AND (
        upper(k.code) = upper(t) OR k.qr_token = t
        OR (num AND nullif(regexp_replace(k.code, '\D', '', 'g'), '')::bigint = d::bigint)
        OR (pc.id IS NOT NULL AND public.consultora_termo_casa(pc.id, pc.display_name, pc.code, pc.doc, t))
      )
      AND public.kit_cycle_in_scope(c.id)
    ORDER BY 16, c.created_at DESC
    LIMIT lim
  ) x;
  RETURN res;
END
$function$;

REVOKE ALL ON FUNCTION public.maletas_buscar(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maletas_buscar(text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remessas_buscar(_busca text DEFAULT NULL::text, _status text DEFAULT NULL::text, _praca uuid DEFAULT NULL::uuid, _representante uuid DEFAULT NULL::uuid, _de date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _campo_data text DEFAULT 'emissao'::text)
 RETURNS TABLE(id uuid, numero integer, praca_id uuid, praca text, representante text, data_emissao date, data_acerto date, status text, maletas bigint, maletas_conferidas bigint, consultoras_praca bigint, pecas bigint, valor_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.* FROM public.remessas_lista(_status) l
  JOIN colab_v_remessas r ON r.id = l.id
  WHERE (_praca IS NULL OR r.praca_id = _praca)
    AND (_representante IS NULL OR r.representante_party_id = _representante)
    AND (_de IS NULL OR (CASE WHEN _campo_data = 'acerto' THEN r.data_acerto ELSE r.data_emissao END) >= _de)
    AND (_ate IS NULL OR (CASE WHEN _campo_data = 'acerto' THEN r.data_acerto ELSE r.data_emissao END) <= _ate)
    AND (_busca IS NULL OR btrim(_busca) = ''
      OR l.numero::text LIKE btrim(_busca) || '%'
      OR l.praca ILIKE '%' || btrim(_busca) || '%'
      OR coalesce(l.representante,'') ILIKE '%' || btrim(_busca) || '%'
      OR EXISTS (SELECT 1 FROM colab_v_kit_cycles k JOIN public.parties px ON px.id = k.consultora_party_id
                 WHERE k.remessa_id = r.id
                   AND public.consultora_termo_casa(px.id, px.display_name, px.code, px.doc, _busca))
      OR EXISTS (SELECT 1 FROM public.kit_cycles kc JOIN public.kits kk ON kk.id = kc.kit_id
                 WHERE kc.remessa_id = r.id AND kc.status <> 'cancelada'
                   AND (upper(kk.code) = upper(btrim(_busca)) OR kk.qr_token = btrim(_busca)
                     OR (btrim(_busca) ~* '^MAL-?\s*\d{1,7}$'
                         AND nullif(regexp_replace(kk.code, '\D', '', 'g'), '')::bigint = regexp_replace(_busca, '\D', '', 'g')::bigint))))
  ORDER BY l.numero DESC;
$function$;