CREATE OR REPLACE FUNCTION public.my_capabilities()
 RETURNS TABLE(capability text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH eu AS (
    SELECT p.id,
           EXISTS (SELECT 1 FROM colab_acessos c WHERE c.user_id = p.id) AS colab,
           EXISTS (SELECT 1 FROM colab_acessos c WHERE c.user_id = p.id AND c.ativo) AS colab_ativo,
           EXISTS (SELECT 1 FROM user_financial_access f WHERE f.user_id = p.id AND f.enabled) AS fin,
           public.access_mfa_ok() AS mfa
      FROM profiles p
     WHERE p.id = auth.uid() AND p.is_active
  ),
  concedidas AS (
    SELECT rc.capability FROM eu JOIN user_roles ur ON ur.user_id = eu.id JOIN role_capabilities rc ON rc.role = ur.role
    UNION
    SELECT rc.capability FROM eu JOIN role_capabilities rc ON rc.role = 'master' WHERE eu.fin AND rc.capability LIKE 'finance.%'
    UNION
    SELECT uc.capability FROM eu JOIN user_capabilities uc ON uc.user_id = eu.id JOIN colab_acessos ca ON ca.user_id = uc.user_id AND ca.ativo
     WHERE uc.capability = ANY (public.colab_caps_permitidas())
    UNION
    SELECT uc.capability FROM eu JOIN user_capabilities uc ON uc.user_id = eu.id
     WHERE uc.capability = ANY (public.caps_individuais_permitidas())
  )
  SELECT c.capability
    FROM concedidas c CROSS JOIN eu
   WHERE (c.capability IN (SELECT r.capability FROM role_capabilities r) OR c.capability = ANY (public.caps_individuais_permitidas()))
     AND (NOT eu.colab OR (c.capability NOT LIKE 'stock.%' AND eu.colab_ativo))
     AND (c.capability !~ '^(finance\.|users\.|access\.)' OR eu.mfa)
$function$;