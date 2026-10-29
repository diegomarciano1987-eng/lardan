-- Pacote 0180 do Diego (aplicado como 0181 porque 0180 já existia). Conteúdo idêntico ao enviado.
CREATE OR REPLACE FUNCTION public.comissao_pelas_faixas(_vendido_cents bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'comissao_cents', coalesce(round(greatest(_vendido_cents, 0) * f.percentual / 100), 0)::bigint,
    'percentual', coalesce(f.percentual, 0))
  FROM (SELECT 1) x
  LEFT JOIN LATERAL (SELECT percentual FROM consultora_comissao_faixas
                      WHERE min_vendido_cents <= greatest(_vendido_cents, 0)
                      ORDER BY min_vendido_cents DESC LIMIT 1) f ON true
$$;
REVOKE ALL ON FUNCTION public.comissao_pelas_faixas(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comissao_pelas_faixas(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.consultora_acertos_vendas(_party uuid)
RETURNS TABLE(origem text, remessa int, data date, vendido_cents bigint, comissao_cents bigint, estimada boolean,
              kits int, pecas_vendidas int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cods AS (SELECT public.legado_codigos_da_pessoa(_party) c),
  lardan AS (
    SELECT r.numero AS remessa,
           (max(p.fechada_em) AT TIME ZONE 'America/Sao_Paulo')::date AS data,
           sum(coalesce(p.vendido_final_cents, p.total_vendido_cents))::bigint AS vendido,
           sum(p.comissao_cents)::bigint AS comissao,
           count(*)::int AS kits,
           (SELECT coalesce(sum(i.qtd_vendida), 0)::int FROM kit_pre_baixa_itens i
             WHERE i.pre_baixa_id = ANY (array_agg(p.id))) AS pecas
      FROM kit_pre_baixas p
      LEFT JOIN remessas r ON r.id = p.remessa_id
     WHERE p.consultora_party_id = _party AND p.status IN ('fechada', 'encerrada', 'pendencia') AND p.fechada_em IS NOT NULL
     GROUP BY coalesce(p.remessa_id, p.cycle_id), r.numero
  ),
  antigo AS (
    SELECT a.remessa, max(a.data) AS data, sum(a.valor_cents)::bigint AS vendido,
           (SELECT sum(c.venda_bruta_cents - c.venda_liquida_cents)::bigint FROM legado_cobrancas c, cods
             WHERE c.codcli = ANY (cods.c) AND c.remessa = a.remessa AND c.tipo IN (1, 2)) AS comissao_real,
           (SELECT count(*)::int FROM legado_maletas m, cods
             WHERE m.codcli = ANY (cods.c) AND m.remessa = a.remessa AND m.tipo = 'remessa') AS kits,
           (SELECT coalesce(sum(m.pecas_vendidas), 0)::int FROM legado_maletas m, cods
             WHERE m.codcli = ANY (cods.c) AND m.remessa = a.remessa AND m.tipo = 'remessa') AS pecas
      FROM legado_acertos_consultora a, cods
     WHERE a.codcli = ANY (cods.c) AND a.tipo = 'remessa' AND a.data IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM lardan l WHERE l.remessa = a.remessa)
     GROUP BY a.remessa
  )
  SELECT 'lardan', l.remessa, l.data, l.vendido, l.comissao, false, l.kits, l.pecas FROM lardan l
  UNION ALL
  SELECT 'antigo', a.remessa, a.data, a.vendido,
         coalesce(a.comissao_real, (public.comissao_pelas_faixas(a.vendido)->>'comissao_cents')::bigint),
         a.comissao_real IS NULL, greatest(a.kits, 1), a.pecas
    FROM antigo a
$$;
REVOKE ALL ON FUNCTION public.consultora_acertos_vendas(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_acertos_vendas(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consultora_objetivo_calc(_party uuid, _ref date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ini date := (date_trunc('month', _ref) - interval '3 months')::date;
        fim date := date_trunc('month', _ref)::date;
        minimo bigint; meses jsonb; n int; soma bigint; media numeric; bruto bigint; objetivo bigint;
BEGIN
  SELECT nullif(proxima_maleta_minimo_cents, 0) INTO minimo FROM pedido_config LIMIT 1;
  SELECT jsonb_agg(jsonb_build_object(
           'mes', to_char(m, 'YYYY-MM'),
           'acerto', x.n > 0,
           'vendido_cents', CASE WHEN x.n > 0 THEN x.vendido END,
           'comissao_cents', CASE WHEN x.n > 0 THEN x.comissao END,
           'estimada', coalesce(x.estimada, false)) ORDER BY m),
         count(*) FILTER (WHERE x.n > 0), coalesce(sum(x.vendido) FILTER (WHERE x.n > 0), 0)
    INTO meses, n, soma
    FROM generate_series(ini, fim - 1, interval '1 month') m
    CROSS JOIN LATERAL (SELECT count(*)::int n, coalesce(sum(a.vendido_cents), 0)::bigint vendido,
                               coalesce(sum(a.comissao_cents), 0)::bigint comissao, bool_or(a.estimada) estimada
                          FROM public.consultora_acertos_vendas(_party) a
                         WHERE a.data >= m::date AND a.data < (m + interval '1 month')::date) x;
  IF n = 0 THEN
    RETURN jsonb_build_object('tipo', 'meta', 'referencia', _ref, 'meses', meses, 'meses_com_acerto', 0,
      'objetivo_cents', minimo, 'minimo_cents', minimo, 'piso', true,
      'comissao_objetivo_cents', CASE WHEN minimo IS NULL THEN NULL ELSE (public.comissao_pelas_faixas(minimo)->>'comissao_cents')::bigint END);
  END IF;
  media := soma::numeric / n;
  bruto := ceil(media * 1.15)::bigint;
  objetivo := (ceil(bruto / 1000.0) * 1000)::bigint;
  objetivo := greatest(objetivo, coalesce(minimo, 0));
  RETURN jsonb_build_object('tipo', 'objetivo', 'referencia', _ref, 'meses', meses, 'meses_com_acerto', n,
    'media_cents', round(media)::bigint, 'objetivo_cents', objetivo, 'minimo_cents', minimo,
    'piso', minimo IS NOT NULL AND objetivo = minimo AND bruto <= minimo,
    'comissao_objetivo_cents', (public.comissao_pelas_faixas(objetivo)->>'comissao_cents')::bigint,
    'percentual_objetivo', (public.comissao_pelas_faixas(objetivo)->>'percentual')::numeric);
END $$;
REVOKE ALL ON FUNCTION public.consultora_objetivo_calc(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_objetivo_calc(uuid, date) TO service_role;

ALTER TABLE public.kit_cycles ADD COLUMN IF NOT EXISTS objetivo_cents bigint;
ALTER TABLE public.kit_cycles ADD COLUMN IF NOT EXISTS objetivo_memoria jsonb;
ALTER TABLE public.kit_cycles ADD COLUMN IF NOT EXISTS objetivo_em timestamptz;
COMMENT ON COLUMN public.kit_cycles.objetivo_memoria IS
  '0180: objetivo de venda da consultora fixado nesta maleta (meses usados, média, piso, comissão ao cumprir). Gravado na conferência ou na saída; não muda até o acerto.';

CREATE OR REPLACE FUNCTION public.kit_cycle_objetivo_gravar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb;
BEGIN
  IF NEW.objetivo_memoria IS NULL AND NEW.consultora_party_id IS NOT NULL
     AND NEW.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    o := public.consultora_objetivo_calc(NEW.consultora_party_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
    NEW.objetivo_memoria := o;
    NEW.objetivo_cents := (o->>'objetivo_cents')::bigint;
    NEW.objetivo_em := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kit_cycle_objetivo_gravar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS kit_cycles_objetivo ON public.kit_cycles;
CREATE TRIGGER kit_cycles_objetivo BEFORE UPDATE OF status ON public.kit_cycles
  FOR EACH ROW EXECUTE FUNCTION public.kit_cycle_objetivo_gravar();

UPDATE public.kit_cycles k
   SET objetivo_memoria = o.m, objetivo_cents = (o.m->>'objetivo_cents')::bigint, objetivo_em = now()
  FROM (SELECT c.id, public.consultora_objetivo_calc(c.consultora_party_id,
                 (coalesce(c.shipped_at, c.created_at) AT TIME ZONE 'America/Sao_Paulo')::date) m
          FROM public.kit_cycles c
         WHERE c.objetivo_memoria IS NULL AND c.consultora_party_id IS NOT NULL
           AND c.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao', 'acerto')) o
 WHERE k.id = o.id;

CREATE OR REPLACE FUNCTION public.kit_cycle_objetivo(_cycle uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(c.objetivo_memoria,
                  public.consultora_objetivo_calc(c.consultora_party_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date))
    FROM kit_cycles c WHERE c.id = _cycle AND c.consultora_party_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.kit_cycle_objetivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kit_cycle_objetivo(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.historico_vendas_de(_party uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (SELECT * FROM public.consultora_acertos_vendas(_party)),
  m AS (SELECT to_char(date_trunc('month', a.data), 'YYYY-MM') mes, sum(a.vendido_cents)::bigint vendido,
               sum(a.comissao_cents)::bigint comissao, bool_or(a.estimada) estimada, count(*)::int acertos,
               jsonb_agg(jsonb_build_object('origem', a.origem, 'remessa', a.remessa, 'data', a.data, 'vendido_cents', a.vendido_cents,
                 'comissao_cents', a.comissao_cents, 'estimada', a.estimada, 'kits', a.kits, 'pecas_vendidas', a.pecas_vendidas)
                 ORDER BY a.data DESC, a.remessa DESC) maletas
          FROM a GROUP BY 1),
  atual AS (SELECT c.id FROM kit_cycles c
             WHERE c.consultora_party_id = _party AND c.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao', 'acerto')
             ORDER BY c.created_at DESC LIMIT 1)
  SELECT jsonb_build_object(
    'resumo', jsonb_build_object(
      'vendido_cents', coalesce((SELECT sum(vendido_cents) FROM a), 0),
      'comissao_cents', coalesce((SELECT sum(comissao_cents) FROM a), 0),
      'acertos', (SELECT count(*) FROM a),
      'primeiro_acerto', (SELECT min(data) FROM a),
      'melhor_mes', (SELECT jsonb_build_object('mes', mes, 'vendido_cents', vendido) FROM m ORDER BY vendido DESC, mes DESC LIMIT 1)),
    'meses', coalesce((SELECT jsonb_agg(jsonb_build_object('mes', mes, 'vendido_cents', vendido, 'comissao_cents', comissao,
                         'estimada', estimada, 'acertos', acertos, 'maletas', maletas) ORDER BY mes DESC) FROM m), '[]'::jsonb),
    'objetivo', coalesce((SELECT public.kit_cycle_objetivo(id) FROM atual),
                         public.consultora_objetivo_calc(_party, (now() AT TIME ZONE 'America/Sao_Paulo')::date)),
    'objetivo_da_maleta', EXISTS (SELECT 1 FROM atual))
$$;
REVOKE ALL ON FUNCTION public.historico_vendas_de(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.historico_vendas_de(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consultora_historico_vendas() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id();
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501';
  END IF;
  RETURN public.historico_vendas_de(eu);
END $$;
REVOKE ALL ON FUNCTION public.consultora_historico_vendas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_historico_vendas() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_historico_vendas_equipe(_party uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'registry.finance.view')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o financeiro desta pessoa' USING errcode = '42501';
  END IF;
  RETURN public.historico_vendas_de(_party);
END $$;
REVOKE ALL ON FUNCTION public.consultora_historico_vendas_equipe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_historico_vendas_equipe(uuid) TO authenticated, service_role;

DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.kit_pedido_dados(uuid)'::regprocedure);
  IF position('''objetivo'', public.kit_cycle_objetivo(' in d) > 0 THEN RETURN; END IF;
  IF position('''montado_por'', montador,' in d) = 0 THEN RAISE EXCEPTION 'kit_pedido_dados mudou; revisar antes de aplicar.'; END IF;
  EXECUTE replace(d, '''montado_por'', montador,', '''montado_por'', montador, ''objetivo'', public.kit_cycle_objetivo(_cycle),');
END $patch$;