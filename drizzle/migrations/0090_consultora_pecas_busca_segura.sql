CREATE OR REPLACE FUNCTION public.consultora_pecas_buscar(_busca text DEFAULT '', _categoria text DEFAULT '', _banho text DEFAULT '') RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.produto,x.variante),'[]'::jsonb) FROM (
 SELECT b.cycle_id,b.variant_id,pr.name produto,v.label variante,b.qty_available disponivel,public.kit_reference_price(b.variant_id) preco_cents,
 (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id=pr.id ORDER BY pm.position LIMIT 1) media_id,k.code maleta,cat.name categoria,coalesce(pt.name,pr.plating) banho,pr.collection_id,v.barcode,v.sku,pr.internal_code,pr.material,pr.warranty_text
 FROM public.kit_balances b JOIN public.kit_cycles c ON c.id=b.cycle_id JOIN public.kits k ON k.id=c.kit_id JOIN public.product_variants v ON v.id=b.variant_id JOIN public.products pr ON pr.id=v.product_id LEFT JOIN public.categories cat ON cat.id=pr.category_id LEFT JOIN public.plating_types pt ON pt.id=v.plating_type_id
 WHERE auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'consultora') AND c.consultora_party_id=public.my_party_id() AND c.status IN ('recebida','operacao') AND b.qty_available>0
 AND (coalesce(_categoria,'')='' OR cat.name=_categoria) AND (coalesce(_banho,'')='' OR coalesce(pt.name,pr.plating)=_banho)
 AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(trim(coalesce(_busca,''))), E'\\s+') term WHERE term<>'' AND lower(concat_ws(' ',pr.name,v.label,v.barcode,v.sku,pr.internal_code,pr.reference_code,cat.name,pt.name,pr.plating)) NOT LIKE '%'||term||'%') LIMIT 300
) x;
$$;
REVOKE ALL ON FUNCTION public.consultora_pecas_buscar(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consultora_pecas_buscar(text,text,text) TO authenticated,service_role;
COMMENT ON FUNCTION public.consultora_pecas_buscar(text,text,text) IS 'Owned available kit pieces only; partial server search, category, plating and exact label lookup; does not alter prices or stock.';