CREATE OR REPLACE FUNCTION public.rep_portal_consultoras(_rep uuid, _busca text DEFAULT NULL, _filtro text DEFAULT 'todas', _pagina int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb; termo text := nullif(btrim(coalesce(_busca,'')),'');
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  WITH ab AS (SELECT party_id, sum(saldo_cents) aberto, sum(saldo_cents) FILTER (WHERE vencimento<hoje) vencido FROM public.rep_portal_abertos(_rep) GROUP BY 1),
  base AS (
    SELECT p.id, p.code, p.display_name, p.status::text status, p.doc_masked,
      (SELECT a.city||'/'||a.uf FROM public.party_addresses a WHERE a.party_id=p.id ORDER BY a.is_primary DESC NULLS LAST LIMIT 1) cidade,
      (SELECT cp.value FROM public.contact_points cp WHERE cp.party_id=p.id AND cp.kind='whatsapp' LIMIT 1) whatsapp,
      coalesce(ab.aberto,0) aberto_cents, coalesce(ab.vencido,0) vencido_cents
    FROM public.consultant_profiles c JOIN public.parties p ON p.id=c.party_id LEFT JOIN ab ON ab.party_id=p.id
    WHERE c.representative_party_id=_rep
      AND (termo IS NULL OR public.fin_unaccent_lower(p.display_name) LIKE '%'||public.fin_unaccent_lower(termo)||'%' OR p.code ILIKE '%'||termo||'%')
      AND (_filtro='todas' OR (_filtro='ativas' AND p.status='ativo') OR (_filtro='inativas' AND p.status<>'ativo') OR (_filtro='devedoras' AND ab.aberto>0))
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM base),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM base ORDER BY vencido_cents DESC, aberto_cents DESC, display_name LIMIT 50 OFFSET (greatest(_pagina,1)-1)*50) x),'[]'::jsonb)) INTO r;
  RETURN r;
END $fn$;