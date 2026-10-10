CREATE OR REPLACE FUNCTION public.rep_portal_mapa(_rep uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  WITH e AS (
    SELECT DISTINCT ON (p.id) p.id, p.display_name, p.status, a.city, a.uf, a.latitude, a.longitude
    FROM public.consultant_profiles c JOIN public.parties p ON p.id=c.party_id
    JOIN public.party_addresses a ON a.party_id=p.id
    WHERE c.representative_party_id=_rep AND a.latitude IS NOT NULL AND a.longitude IS NOT NULL
    ORDER BY p.id, a.is_primary DESC NULLS LAST
  )
  SELECT jsonb_build_object(
    'sem_local', (SELECT count(*) FROM public.consultant_profiles WHERE representative_party_id=_rep) - (SELECT count(*) FROM e),
    'cidades', coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.total DESC) FROM (
      SELECT city||'/'||uf chave, city, uf, avg(latitude)::float lat, avg(longitude)::float lng, count(*) total,
              count(*) FILTER (WHERE status='ativo') ativas,
              coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.nome) FROM (
                SELECT e2.id, e2.display_name nome FROM e e2
                WHERE e2.city=e.city AND e2.uf=e.uf ORDER BY e2.display_name LIMIT 60
              ) n),'[]'::jsonb) pessoas
      FROM e GROUP BY city, uf) g),'[]'::jsonb)
  ) INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_portal_mapa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_portal_mapa(uuid) TO authenticated;