-- Peças da maleta ainda sem aceite (com o representante, a caminho ou recebida sem conferência) aparecem
-- na vitrine para divulgar (em_breve); só viram compráveis com saldo aceito (qty_available) em recebida/operacao.
CREATE OR REPLACE FUNCTION public.showcase_items_for(_party uuid, _design jsonb)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY ord, x->>'produto'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'cycle_id', coalesce(min(b.cycle_id::text) FILTER (WHERE vendavel), min(b.cycle_id::text))::uuid,
      'variant_id', v.id, 'produto', pr.name, 'slug', pr.slug, 'variante', v.label,
      'tamanho', v.size, 'cor', v.color, 'categoria', cat.name,
      'referencia', public.peca_referencia_etiqueta(v.reference_code, pr.reference_code),
      'disponivel', coalesce(sum(livre) FILTER (WHERE vendavel), 0)::int,
      'em_breve', NOT bool_or(vendavel),
      'preco_cents', public.kit_preco_da_consultora(_party, v.id),
      'media_id', coalesce(
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id
             AND pm.media_id::text = _design#>>ARRAY['organizacao','fotos',v.id::text]),
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1)),
      'midias', (SELECT coalesce(jsonb_agg(pm.media_id ORDER BY pm.position), '[]') FROM public.product_media pm WHERE pm.product_id = pr.id),
      'ilustracao', (SELECT '/api/public/vitrine-ilus/' || si.party_id || '/' || si.variant_id
          FROM public.showcase_illustrations si
         WHERE si.party_id = _party AND si.variant_id = v.id
           AND NOT EXISTS (SELECT 1 FROM public.product_media pm2 WHERE pm2.product_id = pr.id))
    ) AS x,
    coalesce((SELECT o FROM jsonb_array_elements_text(coalesce(_design#>'{organizacao,ordem}','[]')) WITH ORDINALITY q(e,o) WHERE e = v.id::text), 100000) AS ord
    FROM (
      SELECT b.*, (c.status IN ('recebida','operacao') AND b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id) > 0) AS vendavel,
             b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id) AS livre,
             (c.status IN ('expedida','transito','recebida') AND b.qty_accepted = 0 AND b.qty_allocated > 0
              AND NOT EXISTS (SELECT 1 FROM public.kit_acceptances a WHERE a.cycle_id = c.id)) AS divulgacao
        FROM public.kit_balances b JOIN public.kit_cycles c ON c.id = b.cycle_id
       WHERE c.consultora_party_id = _party AND c.status IN ('expedida','transito','recebida','operacao') AND b.is_published
    ) b
    JOIN public.product_variants v ON v.id = b.variant_id
    JOIN public.products pr ON pr.id = v.product_id
    LEFT JOIN public.categories cat ON cat.id = pr.category_id
    WHERE (b.vendavel OR b.divulgacao) AND v.is_active
      AND pr.status <> 'arquivado'
      AND coalesce(public.kit_preco_da_consultora(_party, v.id), 0) > 0
    GROUP BY v.id, pr.id, cat.name
  ) s
$function$;

CREATE OR REPLACE FUNCTION public.media_publica_ok(_media uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM product_media pm JOIN products p ON p.id = pm.product_id
                 WHERE pm.media_id = _media AND p.status = 'publicado')
  OR EXISTS (SELECT 1 FROM categories WHERE hero_media_id = _media AND status = 'publicado')
  OR EXISTS (SELECT 1 FROM collections WHERE hero_media_id = _media AND status = 'publicado')
  OR EXISTS (SELECT 1 FROM product_media pm
             JOIN product_variants v ON v.product_id = pm.product_id
             JOIN kit_balances kb ON kb.variant_id = v.id
             JOIN kit_cycles c ON c.id = kb.cycle_id AND c.consultora_party_id IS NOT NULL
             WHERE pm.media_id = _media
               AND ((c.status = 'operacao' AND kb.qty_available > 0)
                 OR (c.status IN ('expedida','transito','recebida') AND kb.qty_allocated > 0)));
$function$;