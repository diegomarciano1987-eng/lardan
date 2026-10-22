CREATE OR REPLACE FUNCTION public.comissao_faixas_leitura() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('min_cents', min_vendido_cents, 'percentual', percentual, 'titulo', titulo) ORDER BY min_vendido_cents), '[]'::jsonb)
  FROM public.consultora_comissao_faixas
  WHERE auth.uid() IS NOT NULL AND (public.legado_pode_ver(auth.uid()) OR public.has_role(auth.uid(),'consultora') OR public.can_manage_leads(auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.comissao_faixas_leitura() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comissao_faixas_leitura() TO authenticated;