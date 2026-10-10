CREATE OR REPLACE FUNCTION public.rep_portal_pode(_rep uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    (_rep = public.my_party_id() AND public.has_role(auth.uid(),'representante'))
    OR public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro','cobranca']::public.app_role[]))
$fn$;

CREATE OR REPLACE FUNCTION public.rep_portal_abertos(_rep uuid)
RETURNS TABLE(installment_id uuid, party_id uuid, vencimento date, saldo_cents bigint, numero text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT i.id, t.party_id, i.vencimento,
         i.valor_cents - coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a WHERE a.installment_id=i.id),0),
         t.numero
  FROM public.consultant_profiles c
  JOIN public.financial_titles t ON t.party_id=c.party_id AND t.direction='receivable' AND t.status='ativo'
  JOIN public.financial_installments i ON i.title_id=t.id
  WHERE c.representative_party_id=_rep
    AND i.valor_cents - coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a WHERE a.installment_id=i.id),0) > 0
$fn$;
REVOKE ALL ON FUNCTION public.rep_portal_abertos(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_portal_resumo(_rep uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  WITH ab AS (SELECT * FROM public.rep_portal_abertos(_rep))
  SELECT jsonb_build_object(
    'nome', (SELECT display_name FROM public.parties WHERE id=_rep),
    'consultoras', (SELECT count(*) FROM public.consultant_profiles WHERE representative_party_id=_rep),
    'ativas', (SELECT count(*) FROM public.consultant_profiles c JOIN public.parties p ON p.id=c.party_id WHERE c.representative_party_id=_rep AND p.status='ativo'),
    'devedoras', (SELECT count(DISTINCT party_id) FROM ab),
    'aberto_cents', (SELECT coalesce(sum(saldo_cents),0) FROM ab),
    'vencido_cents', (SELECT coalesce(sum(saldo_cents),0) FROM ab WHERE vencimento < hoje),
    'hoje_cents', (SELECT coalesce(sum(saldo_cents),0) FROM ab WHERE vencimento = hoje),
    'parcelas', (SELECT count(*) FROM ab),
    'maletas_campo', (SELECT count(*) FROM public.kit_cycles WHERE representante_party_id=_rep AND status IN ('expedida','transito','recebida','operacao','acerto'))
  ) INTO r;
  RETURN r;
END $fn$;

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
      AND (termo IS NULL OR public.unaccent_lower(p.display_name) LIKE '%'||public.unaccent_lower(termo)||'%' OR p.code ILIKE '%'||termo||'%')
      AND (_filtro='todas' OR (_filtro='ativas' AND p.status='ativo') OR (_filtro='inativas' AND p.status<>'ativo') OR (_filtro='devedoras' AND ab.aberto>0))
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM base),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM base ORDER BY vencido_cents DESC, aberto_cents DESC, display_name LIMIT 50 OFFSET (greatest(_pagina,1)-1)*50) x),'[]'::jsonb)) INTO r;
  RETURN r;
END $fn$;

CREATE OR REPLACE FUNCTION public.rep_portal_cobrancas(_rep uuid, _filtro text DEFAULT 'vencidas', _pagina int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  WITH base AS (
    SELECT ab.installment_id, ab.numero, ab.vencimento, ab.saldo_cents, p.id party_id, p.display_name, p.code
    FROM public.rep_portal_abertos(_rep) ab JOIN public.parties p ON p.id=ab.party_id
    WHERE (_filtro='todas' OR (_filtro='vencidas' AND ab.vencimento<hoje) OR (_filtro='hoje' AND ab.vencimento=hoje) OR (_filtro='a_vencer' AND ab.vencimento>hoje)))
  SELECT jsonb_build_object('total',(SELECT count(*) FROM base),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM base ORDER BY vencimento, display_name LIMIT 50 OFFSET (greatest(_pagina,1)-1)*50) x),'[]'::jsonb)) INTO r;
  RETURN r;
END $fn$;

REVOKE ALL ON FUNCTION public.rep_portal_resumo(uuid), public.rep_portal_consultoras(uuid,text,text,int), public.rep_portal_cobrancas(uuid,text,int), public.rep_portal_pode(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_portal_resumo(uuid), public.rep_portal_consultoras(uuid,text,text,int), public.rep_portal_cobrancas(uuid,text,int), public.rep_portal_pode(uuid) TO authenticated;