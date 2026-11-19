CREATE OR REPLACE FUNCTION public.pecas_referencias(_ids uuid[])
RETURNS TABLE(variant_id uuid, referencia text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT v.id, public.peca_referencia_etiqueta(v.reference_code, p.reference_code)
  FROM public.product_variants v
  JOIN public.products p ON p.id = v.product_id
  WHERE auth.uid() IS NOT NULL
    AND v.id = ANY ((_ids)[1:2000]);
$$;
COMMENT ON FUNCTION public.pecas_referencias(uuid[]) IS '0340: referência de etiqueta (variante, senão produto) por peça, para exibir ao lado do nome em qualquer tela. Só a referência, já pública na vitrine.';
REVOKE ALL ON FUNCTION public.pecas_referencias(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pecas_referencias(uuid[]) TO authenticated, service_role;