CREATE OR REPLACE FUNCTION public.maletas_individuais_buscar(_busca text DEFAULT NULL, _situacao text DEFAULT 'abertas')
RETURNS TABLE(cycle_id uuid, remessa_id uuid, remessa_numero integer, maleta text, consultora_party_id uuid, consultora text,
  consultora_codigo text, responsavel text, praca text, data_emissao date, data_acerto date, status text, pecas bigint, valor_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH t AS (SELECT btrim(coalesce(_busca, '')) AS t,
                    nullif(ltrim(regexp_replace(coalesce(_busca, ''), '\D', '', 'g'), '0'), '') AS d,
                    btrim(coalesce(_busca, '')) ~* '^(MAL-?\s*)?\d{1,7}$' AS num)
  SELECT c.id, l.id, l.numero, k.code, c.consultora_party_id, pc.display_name, pc.code,
         coalesce(nullif(btrim(pf.full_name), ''), 'Não informado'), l.praca, l.data_emissao, l.data_acerto,
         c.status::text, c.quantity_total::bigint, c.reference_total_cents::bigint
  FROM public.remessas_lista(NULL) l
  JOIN public.remessas rr ON rr.id = l.id AND rr.direta
  LEFT JOIN public.profiles pf ON pf.id = rr.responsavel_user_id
  JOIN colab_v_kit_cycles c ON c.remessa_id = l.id AND c.status <> 'cancelada'
  JOIN public.kits k ON k.id = c.kit_id
  LEFT JOIN public.parties pc ON pc.id = c.consultora_party_id
  CROSS JOIN t
  WHERE (coalesce(_situacao, 'abertas') = 'todas'
         OR (_situacao = 'abertas' AND c.status::text NOT IN ('encerrada','cancelada'))
         OR (_situacao = 'encerradas' AND c.status::text = 'encerrada'))
    AND (t.t = '' OR length(t.t) < 2
      OR l.numero::text = t.t
      OR upper(k.code) = upper(t.t) OR k.qr_token = t.t
      OR (t.num AND ltrim(regexp_replace(k.code, '\D', '', 'g'), '0') = t.d)
      OR (pc.id IS NOT NULL AND public.consultora_termo_casa(pc.id, pc.display_name, pc.code, pc.doc, t.t))
      OR coalesce(pf.full_name, '') ILIKE '%' || t.t || '%'
      OR l.praca ILIKE '%' || t.t || '%'
      -- tolerante a erro de digitação (a partir de 4 letras): "ketlin" acha "ketllin"
      OR (length(t.t) >= 4 AND t.t !~ '\d' AND (
            public.word_similarity(lower(t.t), lower(coalesce(pc.display_name, ''))) >= 0.6
         OR public.word_similarity(lower(t.t), lower(coalesce(pf.full_name, ''))) >= 0.6)))
  ORDER BY l.data_acerto NULLS LAST, l.numero DESC;
$$;
REVOKE ALL ON FUNCTION public.maletas_individuais_buscar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maletas_individuais_buscar(text, text) TO authenticated, service_role;