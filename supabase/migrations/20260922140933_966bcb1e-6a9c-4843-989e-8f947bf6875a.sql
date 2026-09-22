
CREATE OR REPLACE FUNCTION public.crm_representantes()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'nome'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'nome', coalesce(p.display_name, p.legal_name, p.code),
      'whatsapp', regexp_replace(c.value, '\D', '', 'g')
    ) AS x
    FROM public.parties p
    JOIN public.party_roles r ON r.party_id = p.id AND r.role = 'representante'
    JOIN LATERAL (
      SELECT cp.value FROM public.contact_points cp
       WHERE cp.party_id = p.id AND cp.kind IN ('whatsapp','telefone')
       ORDER BY (cp.kind = 'whatsapp') DESC, cp.is_primary DESC
       LIMIT 1
    ) c ON true
    WHERE p.is_active
      AND length(regexp_replace(c.value, '\D', '', 'g')) >= 10
      AND public.has_capability(auth.uid(), 'candidaturas.view')
  ) s;
$$;

REVOKE EXECUTE ON FUNCTION public.crm_representantes() FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_representantes() TO authenticated;
