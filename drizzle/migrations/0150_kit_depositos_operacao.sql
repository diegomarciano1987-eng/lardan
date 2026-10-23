CREATE OR REPLACE FUNCTION public.kit_depositos_operacao()
RETURNS TABLE(id uuid, code text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.code::text, l.name::text FROM public.locations l
  WHERE l.kind = 'deposito' AND l.is_active AND NOT coalesce(l.is_blocked, false)
    AND l.code NOT ILIKE 'HOMOLOG%' AND l.name NOT ILIKE 'HOMOLOG%'
    AND (public.has_capability(auth.uid(), 'kit.view') OR public.has_capability(auth.uid(), 'kit.manage')
         OR public.has_capability(auth.uid(), 'stock.view'))
  ORDER BY (l.code = 'DEP-01') DESC, l.code
$$;
COMMENT ON FUNCTION public.kit_depositos_operacao() IS 'Depósitos de origem/retorno para montagem e acertos (inclui colaboradora; somente id/código/nome; sem HOMOLOG).';
REVOKE ALL ON FUNCTION public.kit_depositos_operacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_depositos_operacao() TO authenticated;