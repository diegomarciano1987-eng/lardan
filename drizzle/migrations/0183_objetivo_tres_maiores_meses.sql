CREATE OR REPLACE FUNCTION public.consultora_objetivo_calc(_party uuid, _ref date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE fim date := date_trunc('month', _ref)::date;
        minimo bigint; meses jsonb; n int; soma bigint; media numeric; bruto bigint; objetivo bigint;
BEGIN
  SELECT nullif(proxima_maleta_minimo_cents, 0) INTO minimo FROM pedido_config LIMIT 1;
  WITH por_mes AS (
    SELECT date_trunc('month', a.data)::date m, sum(a.vendido_cents)::bigint vendido, sum(a.comissao_cents)::bigint comissao,
           bool_or(a.estimada) estimada
      FROM public.consultora_acertos_vendas(_party) a
     WHERE a.data < fim
     GROUP BY 1),
  melhores AS (SELECT * FROM por_mes ORDER BY vendido DESC, m DESC LIMIT 3)
  SELECT jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'acerto', true, 'vendido_cents', vendido,
                                      'comissao_cents', comissao, 'estimada', coalesce(estimada, false)) ORDER BY m),
         count(*), coalesce(sum(vendido), 0)
    INTO meses, n, soma
    FROM melhores;
  meses := coalesce(meses, '[]'::jsonb);
  IF n = 0 THEN
    RETURN jsonb_build_object('tipo', 'meta', 'criterio', 'melhores_meses', 'referencia', _ref, 'meses', meses, 'meses_com_acerto', 0,
      'objetivo_cents', minimo, 'minimo_cents', minimo, 'piso', true,
      'comissao_objetivo_cents', CASE WHEN minimo IS NULL THEN NULL ELSE (public.comissao_pelas_faixas(minimo)->>'comissao_cents')::bigint END);
  END IF;
  media := soma::numeric / n;
  bruto := ceil(media * 1.15)::bigint;
  objetivo := (ceil(bruto / 1000.0) * 1000)::bigint;
  objetivo := greatest(objetivo, coalesce(minimo, 0));
  RETURN jsonb_build_object('tipo', 'objetivo', 'criterio', 'melhores_meses', 'referencia', _ref, 'meses', meses, 'meses_com_acerto', n,
    'media_cents', round(media)::bigint, 'objetivo_cents', objetivo, 'minimo_cents', minimo,
    'piso', minimo IS NOT NULL AND objetivo = minimo AND bruto <= minimo,
    'comissao_objetivo_cents', (public.comissao_pelas_faixas(objetivo)->>'comissao_cents')::bigint,
    'percentual_objetivo', (public.comissao_pelas_faixas(objetivo)->>'percentual')::numeric);
END $$;
REVOKE ALL ON FUNCTION public.consultora_objetivo_calc(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_objetivo_calc(uuid, date) TO service_role;

UPDATE public.kit_cycles k
   SET objetivo_memoria = o.m, objetivo_cents = (o.m->>'objetivo_cents')::bigint, objetivo_em = now()
  FROM (SELECT c.id, public.consultora_objetivo_calc(c.consultora_party_id,
                 coalesce((c.objetivo_memoria->>'referencia')::date, (coalesce(c.shipped_at, c.created_at) AT TIME ZONE 'America/Sao_Paulo')::date)) m
          FROM public.kit_cycles c
         WHERE c.consultora_party_id IS NOT NULL
           AND c.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao', 'acerto')
           AND coalesce(c.objetivo_memoria->>'criterio', '') <> 'melhores_meses') o
 WHERE k.id = o.id;