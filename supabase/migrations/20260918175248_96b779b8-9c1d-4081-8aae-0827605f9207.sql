GRANT SELECT (barcode, reference_code, ncm) ON public.products TO authenticated;
GRANT SELECT (reference_code, ncm) ON public.product_variants TO authenticated;