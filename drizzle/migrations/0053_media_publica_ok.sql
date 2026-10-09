CREATE OR REPLACE FUNCTION public.media_publica_ok(_media uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM product_media pm JOIN products p ON p.id = pm.product_id
                 WHERE pm.media_id = _media AND p.status = 'publicado')
  OR EXISTS (SELECT 1 FROM categories WHERE hero_media_id = _media AND status = 'publicado')
  OR EXISTS (SELECT 1 FROM collections WHERE hero_media_id = _media AND status = 'publicado')
  OR EXISTS (SELECT 1 FROM product_media pm
             JOIN product_variants v ON v.product_id = pm.product_id
             JOIN kit_balances kb ON kb.variant_id = v.id AND kb.qty_available > 0
             JOIN kit_cycles c ON c.id = kb.cycle_id AND c.status = 'operacao'
             WHERE pm.media_id = _media);
$$;
REVOKE ALL ON FUNCTION public.media_publica_ok(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_publica_ok(uuid) TO service_role;