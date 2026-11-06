CREATE OR REPLACE FUNCTION public.fiscal_focus_pode_maleta()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND (public.fiscal_focus_pode('emitir') OR public.can_manage_kits(auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.fiscal_focus_pode_maleta() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_pode_maleta() TO authenticated, service_role;
COMMENT ON FUNCTION public.fiscal_focus_pode_maleta() IS 'Quem emite a NF-e da maleta (remessa/acerto) pela tela: Master ou equipe com kit.manage. Configuração fiscal continua só Master.';