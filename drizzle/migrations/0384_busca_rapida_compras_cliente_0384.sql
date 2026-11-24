-- 0384: busca rápida (funções inlináveis + coluna normalizada) e aba Compras da cliente
CREATE OR REPLACE FUNCTION public.busca_norm(_t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.translate(coalesce(_t,''),
    'áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ',
    'aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY')), '\s+', ' ', 'g'))
$$;
CREATE OR REPLACE FUNCTION public.busca_padroes(_t text) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce((SELECT pg_catalog.array_agg('%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%')
                     FROM pg_catalog.unnest(pg_catalog.string_to_array(public.busca_norm(_t), ' ')) w WHERE w <> ''), '{}'::text[])
$$;
CREATE OR REPLACE FUNCTION public.busca_casa(_alvo text, _termo text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT public.busca_norm(_alvo) LIKE ALL (public.busca_padroes(_termo))
$$;
GRANT EXECUTE ON FUNCTION public.busca_padroes(text) TO authenticated, service_role, anon;

ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS busca_txt text GENERATED ALWAYS AS (
  public.busca_norm(coalesce(display_name,'') || ' ' || coalesce(legal_name,'') || ' ' || coalesce(social_name,'') || ' ' || coalesce(code,''))) STORED;
CREATE INDEX IF NOT EXISTS parties_busca_txt_trgm ON public.parties USING gin (busca_txt gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.list_parties(_search text DEFAULT NULL::text, _kind text DEFAULT NULL::text, _role text DEFAULT NULL::text, _status text DEFAULT NULL::text, _limit integer DEFAULT 20, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, kind party_kind, code text, display_name text, legal_name text, social_name text, doc text, birth_date date, status party_status, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, total bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE termo text; canon text; pad text[]; ids uuid[];
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN
    RAISE EXCEPTION 'Sem permissão para consultar cadastros.' USING errcode = '42501';
  END IF;
  termo := nullif(trim(coalesce(_search,'')), '');
  canon := nullif(upper(regexp_replace(coalesce(termo,''), '[^0-9A-Za-z]', '', 'g')), '');
  IF canon is not null and length(canon) < 3 THEN canon := null; END IF;
  IF termo IS NOT NULL THEN
    pad := public.busca_padroes(termo);
    SELECT array_agg(DISTINCT x) INTO ids FROM (
      SELECT pp.id x FROM public.parties pp WHERE pp.busca_txt LIKE ALL (pad)
      UNION ALL SELECT h.party_id FROM public.party_codigo_historico h WHERE public.busca_norm(h.code_antigo) LIKE ALL (pad)
      UNION ALL SELECT pp.id FROM public.parties pp WHERE canon IS NOT NULL AND pp.doc_canon LIKE '%'||canon||'%'
    ) s;
    ids := coalesce(ids, '{}'::uuid[]);
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT p.* FROM public.colab_v_parties p
    WHERE (termo IS NULL OR p.id = ANY (ids))
      AND (_kind IS NULL OR _kind = 'todos' OR p.kind::text = _kind)
      AND (_status IS NULL OR _status = 'todos' OR p.status::text = _status)
      AND (_role IS NULL OR _role = 'todos' OR EXISTS (
            SELECT 1 FROM public.colab_v_party_roles pr
            WHERE pr.party_id = p.id AND pr.role::text = _role))
  ), contagem AS (SELECT count(*)::bigint AS n FROM base)
  SELECT b.id, b.kind, b.code, b.display_name, b.legal_name, b.social_name,
         b.doc_masked, b.birth_date, b.status, b.is_active, b.created_at, b.updated_at,
         (SELECT n FROM contagem)
  FROM base b
  ORDER BY b.updated_at DESC
  LIMIT greatest(coalesce(_limit,20),1) OFFSET greatest(coalesce(_offset,0),0);
END $function$;

CREATE OR REPLACE FUNCTION public.cliente_cockpit(_party uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') OR NOT public.colab_party_ok(_party) THEN
    RAISE EXCEPTION 'Sem permissão para ver esta cliente.' USING errcode = '42501';
  END IF;
  WITH cli AS (SELECT id FROM public.consultant_clients WHERE party_id = _party),
  ped AS (
    SELECT o.* FROM public.sales_orders o
     WHERE o.client_id IN (SELECT id FROM cli) OR o.pay_party_id = _party OR o.customer_party_id = _party
  ),
  itens AS (
    SELECT i.order_id, jsonb_agg(jsonb_build_object(
             'referencia', (SELECT public.peca_referencia_etiqueta(v.reference_code, pr.reference_code) FROM public.product_variants v LEFT JOIN public.products pr ON pr.id = v.product_id WHERE v.id = i.variant_id),
             'produto', i.product_name, 'variante', i.variant_label,
             'quantidade', i.quantity, 'unitario_cents', i.unit_price_cents) ORDER BY i.created_at) lista,
           sum(i.quantity) pecas
      FROM public.sales_order_items i WHERE i.order_id IN (SELECT id FROM ped) GROUP BY i.order_id
  ),
  tit AS (
    SELECT t.id, t.numero, t.descricao, t.status::text status, t.emissao, t.valor_cents,
           CASE WHEN t.status = 'cancelado' THEN 0 ELSE
             coalesce((SELECT sum(public.fin_installment_saldo(i.id)) FROM public.financial_installments i WHERE i.title_id = t.id), 0) END saldo_cents,
           coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a JOIN public.financial_installments i ON i.id = a.installment_id WHERE i.title_id = t.id), 0) pago_cents
      FROM public.financial_titles t
     WHERE t.direction = 'receivable' AND (t.party_id = _party OR t.pagador_party_id = _party)
  )
  SELECT jsonb_build_object(
    'resumo', jsonb_build_object(
      'pedidos', (SELECT count(*) FROM ped WHERE status <> 'cancelado'),
      'pecas', (SELECT coalesce(sum(it.pecas), 0) FROM ped p JOIN itens it ON it.order_id = p.id WHERE p.status <> 'cancelado'),
      'total_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM ped WHERE status <> 'cancelado'),
      'pago_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM ped WHERE status <> 'cancelado' AND payment_status = 'pago'),
      'ultima_compra', (SELECT max(created_at) FROM ped WHERE status <> 'cancelado'),
      'em_aberto_cents', (SELECT coalesce(sum(saldo_cents), 0) FROM tit)),
    'consultoras', coalesce((SELECT jsonb_agg(jsonb_build_object('party_id', x.consultora_party_id, 'nome', pc.display_name, 'codigo', pc.code, 'pedidos', x.n))
        FROM (SELECT consultora_party_id, count(*) n FROM ped GROUP BY 1) x JOIN public.parties pc ON pc.id = x.consultora_party_id), '[]'::jsonb),
    'pedidos', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'codigo', p.code, 'data', p.created_at, 'status', p.status, 'pagamento', p.payment_status,
        'entrega', p.delivery_status, 'forma', p.pay_method, 'valor_cents', p.subtotal_cents, 'pago_em', p.pay_paid_at,
        'consultora', (SELECT '[Cód. ' || pc.code || '] ' || pc.display_name FROM public.parties pc WHERE pc.id = p.consultora_party_id),
        'itens', coalesce(it.lista, '[]'::jsonb)) ORDER BY p.created_at DESC)
        FROM ped p LEFT JOIN itens it ON it.order_id = p.id), '[]'::jsonb),
    'titulos', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.emissao DESC) FROM tit t), '[]'::jsonb),
    'asaas', coalesce((SELECT jsonb_agg(jsonb_build_object('cobranca', c.external_id, 'status', c.external_status,
        'forma', c.billing_type, 'valor_cents', c.value_cents, 'vencimento', c.due_date, 'pago_em', c.payment_date) ORDER BY c.due_date DESC)
        FROM public.asaas_charges c WHERE c.party_id = _party), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $function$;