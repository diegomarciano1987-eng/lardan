CREATE OR REPLACE FUNCTION public.pracas_resumo()
 RETURNS TABLE(id uuid, codigo integer, nome text, ativo boolean, consultoras bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p.id, p.codigo, p.nome, p.ativo,
         (SELECT count(*) FROM colab_v_consultant_profiles cp JOIN parties pa ON pa.id = cp.party_id
          WHERE cp.praca_id = p.id AND pa.status NOT IN ('desligado','bloqueado')) AS consultoras
  FROM colab_v_cob_pracas p
  WHERE public.is_staff(auth.uid()) OR (public.colab_conta() AND (public.can_view_kits(auth.uid()) OR public.has_capability(auth.uid(),'registry.view')))
  ORDER BY p.nome;
$function$;

CREATE OR REPLACE FUNCTION public.kit_ve_rede()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND (coalesce(public.kit_scope_all(), false)
          OR (public.colab_conta() AND (coalesce(public.can_view_kits(auth.uid()), false)
                                          OR coalesce(public.can_manage_kits(auth.uid()), false))));
$function$;