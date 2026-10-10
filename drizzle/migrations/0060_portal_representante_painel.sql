CREATE OR REPLACE FUNCTION public.rep_portal_ranking(_rep uuid, _de date, _ate date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  WITH ciclos AS (
    SELECT k.id, k.consultora_party_id FROM public.kit_cycles k
    JOIN public.consultant_profiles c ON c.party_id=k.consultora_party_id AND c.representative_party_id=_rep
    WHERE k.status IN ('acerto','encerrada')
      AND (coalesce(k.closed_at,k.settlement_started_at) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _de AND _ate
  ), preco AS (
    SELECT DISTINCT ON (m.cycle_id, mi.variant_id) m.cycle_id, mi.variant_id, mi.unit_reference_cents
    FROM public.kit_movement_items mi JOIN public.kit_movements m ON m.id=mi.movement_id
    WHERE m.cycle_id IN (SELECT id FROM ciclos) AND mi.unit_reference_cents IS NOT NULL
    ORDER BY m.cycle_id, mi.variant_id, m.created_at DESC
  ), por AS (
    SELECT ci.consultora_party_id pid, sum(b.qty_sold)::bigint pecas, sum(b.qty_sold*coalesce(p.unit_reference_cents,0))::bigint valor, count(DISTINCT ci.id) maletas
    FROM ciclos ci JOIN public.kit_balances b ON b.cycle_id=ci.id
    LEFT JOIN preco p ON p.cycle_id=ci.id AND p.variant_id=b.variant_id
    GROUP BY 1
  ), x AS (SELECT por.*, pa.display_name nome, pa.code FROM por JOIN public.parties pa ON pa.id=por.pid)
  SELECT jsonb_build_object(
    'consultoras', (SELECT count(*) FROM x),
    'valor_cents', (SELECT coalesce(sum(valor),0) FROM x),
    'pecas', (SELECT coalesce(sum(pecas),0) FROM x),
    'top_valor', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT nome,code,valor,pecas,maletas FROM x ORDER BY valor DESC, nome LIMIT 10) t),'[]'),
    'pior_valor', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT nome,code,valor,pecas,maletas FROM x ORDER BY valor ASC, nome LIMIT 10) t),'[]'),
    'top_pecas', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT nome,code,valor,pecas,maletas FROM x ORDER BY pecas DESC, nome LIMIT 10) t),'[]'),
    'pior_pecas', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT nome,code,valor,pecas,maletas FROM x ORDER BY pecas ASC, nome LIMIT 10) t),'[]')
  ) INTO r;
  RETURN r;
END $fn$;

CREATE OR REPLACE FUNCTION public.rep_portal_mapa(_rep uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  WITH e AS (
    SELECT DISTINCT ON (p.id) p.id, p.status, a.city, a.uf, a.latitude, a.longitude
    FROM public.consultant_profiles c JOIN public.parties p ON p.id=c.party_id
    JOIN public.party_addresses a ON a.party_id=p.id
    WHERE c.representative_party_id=_rep AND a.latitude IS NOT NULL AND a.longitude IS NOT NULL
    ORDER BY p.id, a.is_primary DESC NULLS LAST
  )
  SELECT jsonb_build_object(
    'sem_local', (SELECT count(*) FROM public.consultant_profiles WHERE representative_party_id=_rep) - (SELECT count(*) FROM e),
    'cidades', coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.total DESC) FROM (
      SELECT city||'/'||uf chave, city, uf, avg(latitude)::float lat, avg(longitude)::float lng, count(*) total,
             count(*) FILTER (WHERE status='ativo') ativas
      FROM e GROUP BY city, uf) g),'[]'::jsonb)
  ) INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_portal_ranking(uuid,date,date), public.rep_portal_mapa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_portal_ranking(uuid,date,date), public.rep_portal_mapa(uuid) TO authenticated;