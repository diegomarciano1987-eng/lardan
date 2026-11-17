ALTER TABLE public.kit_cycles ADD COLUMN IF NOT EXISTS montagem_total_pecas integer
  CHECK (montagem_total_pecas IS NULL OR montagem_total_pecas BETWEEN 1 AND 1000);
ALTER TABLE public.kit_cycles ADD COLUMN IF NOT EXISTS montagem_metas_modo text
  CHECK (montagem_metas_modo IS NULL OR montagem_metas_modo IN ('historico','padrao'));
COMMENT ON COLUMN public.kit_cycles.montagem_total_pecas IS 'Quantidade de peças escolhida na montagem (null = usar a sugestão). Só sugestão: não reserva nem move estoque.';

CREATE OR REPLACE FUNCTION public.maleta_total_sugerido(_party uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ult AS (
    SELECT enviadas, quando, origem FROM (
      SELECT lm.pecas_enviadas::numeric AS enviadas, coalesce(lm.emissao, lm.fechamento)::timestamptz AS quando, 'smalldata'::text AS origem
        FROM legado_maletas lm JOIN legado_consultoras lc ON lc.codcli = lm.codcli
       WHERE lc.party_id = _party AND lm.tipo = 'remessa' AND lm.pecas_enviadas >= 10
      UNION ALL
      SELECT coalesce(nullif((SELECT sum(kb.qty_allocated) FROM kit_balances kb WHERE kb.cycle_id = c.id), 0), c.quantity_total, 0)::numeric,
             coalesce(c.shipped_at, c.created_at), 'lardan'
        FROM kit_cycles c
       WHERE c.consultora_party_id = _party
         AND c.status IN ('conferida','expedida','transito','recebida','operacao','acerto','encerrada')
    ) x WHERE enviadas >= 10 ORDER BY quando DESC NULLS LAST LIMIT 3)
  SELECT jsonb_build_object(
    'maletas', (SELECT count(*) FROM ult),
    'media', (SELECT round(avg(enviadas),1) FROM ult),
    'base', (SELECT coalesce(jsonb_agg(jsonb_build_object('pecas', enviadas::int, 'quando', quando, 'origem', origem) ORDER BY quando DESC), '[]'::jsonb) FROM ult),
    'regra', 'média das peças enviadas nas últimas 3 maletas, arredondada para o múltiplo de 5 mais próximo',
    'total', (SELECT CASE WHEN count(*) = 0 OR avg(enviadas) <= 0 THEN NULL
                          ELSE least(greatest((round(avg(enviadas) / 5) * 5)::int, 5), 1000) END FROM ult))
  WHERE (public.kit_ve_rede()
         OR public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque','montagem']::public.app_role[]))
    AND public.colab_party_ok(_party);
$function$;

CREATE OR REPLACE FUNCTION public.montagem_total_definir(_cycle uuid, _total integer, _modo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.can_manage_kits(auth.uid())
       OR public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque','montagem']::public.app_role[])) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF _total IS NOT NULL AND (_total < 1 OR _total > 1000) THEN RAISE EXCEPTION 'Total de peças entre 1 e 1000.'; END IF;
  IF _modo IS NOT NULL AND _modo NOT IN ('historico','padrao') THEN RAISE EXCEPTION 'Modo inválido.'; END IF;
  SELECT id, status, consultora_party_id INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.consultora_party_id IS NOT NULL AND NOT public.colab_party_ok(c.consultora_party_id) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF c.status NOT IN ('rascunho','montagem') THEN RAISE EXCEPTION 'A maleta já saiu da montagem.'; END IF;
  UPDATE kit_cycles SET montagem_total_pecas = _total, montagem_metas_modo = coalesce(_modo, montagem_metas_modo), updated_at = now()
   WHERE id = _cycle;
  RETURN jsonb_build_object('ok', true, 'total', _total, 'modo', coalesce(_modo, (SELECT montagem_metas_modo FROM kit_cycles WHERE id = _cycle)));
END $function$;
REVOKE ALL ON FUNCTION public.montagem_total_definir(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.montagem_total_definir(uuid, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.montagem_metas_ciclo(_cycle uuid, _total integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_party uuid; cods int[]; p record; v_total int; v_origem text; sug jsonb; conf text;
  metas_padrao jsonb; metas_hist jsonb; v_modo text; fechadas int;
  v_escolhido int; v_modo_salvo text; v_sugjson jsonb; v_sugerido int; v_sug_origem text;
  pc int; g_dela numeric; g_ref numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.can_manage_kits(auth.uid())
       OR public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque','montagem']::public.app_role[])) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF _total IS NOT NULL AND (_total < 1 OR _total > 1000) THEN RAISE EXCEPTION 'Total de peças entre 1 e 1000.'; END IF;
  SELECT consultora_party_id, montagem_total_pecas, montagem_metas_modo INTO v_party, v_escolhido, v_modo_salvo FROM kit_cycles WHERE id = _cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;

  SELECT * INTO p FROM remessa_parametros LIMIT 1;
  metas_padrao := jsonb_build_object(
    'colar', coalesce(p.meta_colares, 3), 'pulseira', coalesce(p.meta_pulseiras, 3),
    'anel', coalesce(p.meta_aneis, 4), 'tornozeleira', coalesce(p.meta_tornozeleiras, 0),
    'brinco', greatest(coalesce(p.pecas_cliente_nova, 35)
      - coalesce(p.meta_colares, 3) - coalesce(p.meta_pulseiras, 3) - coalesce(p.meta_aneis, 4) - coalesce(p.meta_tornozeleiras, 0), 0),
    'outro', 0);

  IF v_party IS NOT NULL THEN
    cods := nullif(public.legado_codigos_da_pessoa(v_party), '{}'::int[]);
  END IF;
  SELECT count(*) INTO fechadas FROM legado_maletas
   WHERE codcli = ANY (coalesce(cods, '{}')) AND tipo = 'remessa' AND fechamento IS NOT NULL;

  IF v_party IS NOT NULL THEN v_sugjson := public.maleta_total_sugerido(v_party); END IF;
  v_sugerido := (v_sugjson->>'total')::int;
  IF v_sugerido IS NULL OR v_sugerido < 1 THEN
    v_sugerido := coalesce(p.pecas_cliente_nova, 35); v_sug_origem := 'parametro';
  ELSE v_sug_origem := 'historico'; END IF;
  IF _total IS NOT NULL THEN
    v_total := _total; v_origem := 'informado';
  ELSIF v_escolhido IS NOT NULL THEN
    v_total := v_escolhido; v_origem := 'informado';
  ELSE
    v_total := v_sugerido; v_origem := v_sug_origem;
  END IF;
  v_total := least(v_total, 1000);

  IF v_party IS NULL THEN
    RETURN jsonb_build_object('party_id', NULL, 'vinculada', false, 'modo_sugerido', 'padrao', 'confianca', 'baixa',
      'total_pecas', v_total, 'total_origem', v_origem, 'total_sugerido', v_sugerido, 'sugestao_base', '[]'::jsonb,
      'modo_escolhido', v_modo_salvo, 'metas_padrao', metas_padrao, 'metas_historico', NULL,
      'categorias', '[]'::jsonb, 'destaques', '[]'::jsonb, 'ultimas_maletas', '[]'::jsonb, 'variantes_campeas', '[]'::jsonb,
      'como_ler', 'Maleta sem consultora: metas do padrão de remessa.');
  END IF;

  sug := public.montagem_sugestao(v_party, v_total);
  conf := sug->>'confianca';
  pc := (sug->>'praca_codigo')::int;

  SELECT CASE WHEN sum(c.pecas_enviadas) > 0 THEN 100.0 * sum(c.pecas_enviadas - c.pecas_devolvidas) / sum(c.pecas_enviadas) END
    INTO g_dela
    FROM legado_maleta_categorias c JOIN legado_maletas m USING (remessa, codcli, kit)
    JOIN legado_remessas r ON r.numero = m.remessa
   WHERE c.codcli = ANY (coalesce(cods, '{}')) AND m.fechamento IS NOT NULL AND m.tipo = 'remessa';
  SELECT CASE WHEN sum(c.pecas_enviadas) > 0 THEN 100.0 * sum(c.pecas_enviadas - c.pecas_devolvidas) / sum(c.pecas_enviadas) END
    INTO g_ref
    FROM legado_maleta_categorias c JOIN legado_maletas m USING (remessa, codcli, kit)
    JOIN legado_remessas r ON r.numero = m.remessa
   WHERE m.fechamento IS NOT NULL AND m.tipo = 'remessa'
     AND (sug->>'referencia' = 'rede' OR r.praca = pc);

  SELECT jsonb_build_object(
           'brinco', coalesce(sum(n) FILTER (WHERE tipo = 'brinco'), 0),
           'anel', coalesce(sum(n) FILTER (WHERE tipo = 'anel'), 0),
           'colar', coalesce(sum(n) FILTER (WHERE tipo = 'colar'), 0),
           'pulseira', coalesce(sum(n) FILTER (WHERE tipo = 'pulseira'), 0),
           'tornozeleira', coalesce(sum(n) FILTER (WHERE tipo = 'tornozeleira'), 0),
           'outro', coalesce(sum(n) FILTER (WHERE tipo = 'outro'), 0))
    INTO metas_hist
    FROM (SELECT coalesce(t.tipo, 'outro') tipo, (c->>'pecas_sugeridas')::int n
            FROM jsonb_array_elements(sug->'categorias') c
            LEFT JOIN legado_categoria_tipo t ON t.categoria = c->>'categoria') x;

  v_modo := CASE WHEN cods IS NOT NULL AND conf IN ('alta','media') THEN 'historico' ELSE 'padrao' END;

  RETURN jsonb_build_object(
    'party_id', v_party,
    'vinculada', cods IS NOT NULL,
    'modo_sugerido', v_modo,
    'confianca', conf,
    'pecas_vendidas_historico', sug->'pecas_vendidas_historico',
    'maletas_fechadas', fechadas,
    'referencia', sug->'referencia',
    'praca_nome', sug->'praca_nome',
    'total_pecas', v_total,
    'total_origem', v_origem,
    'total_sugerido', v_sugerido,
    'sugestao_base', coalesce(v_sugjson->'base', '[]'::jsonb),
    'modo_escolhido', v_modo_salvo,
    'metas_padrao', metas_padrao,
    'metas_historico', metas_hist,
    'categorias', (SELECT coalesce(jsonb_agg(c || jsonb_build_object('tipo', coalesce(t.tipo, 'outro'))), '[]'::jsonb)
                     FROM jsonb_array_elements(sug->'categorias') c
                     LEFT JOIN legado_categoria_tipo t ON t.categoria = c->>'categoria'),
    'giro_geral_pct', round(g_dela, 1),
    'referencia_giro_geral_pct', round(g_ref, 1),
    'destaques', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'categoria', x.categoria, 'tipo', x.tipo, 'sinal', CASE WHEN x.indice >= 1.25 THEN 'forte' ELSE 'fraco' END,
                     'indice', round(x.indice, 2), 'giro_pct', x.giro, 'referencia_giro_pct', x.ref) ORDER BY x.indice DESC), '[]'::jsonb)
                    FROM (SELECT c->>'categoria' categoria, coalesce(t.tipo, 'outro') tipo,
                                 (c->>'consultora_giro_pct')::numeric giro, (c->>'referencia_giro_pct')::numeric ref,
                                 ((c->>'consultora_giro_pct')::numeric / g_dela) / ((c->>'referencia_giro_pct')::numeric / g_ref) indice
                            FROM jsonb_array_elements(sug->'categorias') c
                            LEFT JOIN legado_categoria_tipo t ON t.categoria = c->>'categoria'
                           WHERE (c->>'consultora_pecas_enviadas')::int >= 20 AND g_dela > 0 AND g_ref > 0
                             AND (c->>'referencia_giro_pct')::numeric > 0) x
                   WHERE x.indice >= 1.25 OR x.indice <= 0.75),
    'ultimas_maletas', (SELECT coalesce(jsonb_agg(jsonb_build_object('remessa', remessa, 'fechamento', fechamento, 'maletas', maletas,
                          'pecas_enviadas', env, 'pecas_vendidas', vend,
                          'giro_pct', CASE WHEN env > 0 THEN round(100.0 * vend / env, 1) END,
                          'valor_vendido_cents', valor) ORDER BY fechamento DESC, remessa DESC), '[]'::jsonb)
                         FROM (SELECT remessa, max(fechamento) fechamento, count(*) maletas, sum(pecas_enviadas) env,
                                      sum(pecas_vendidas) vend, sum(valor_venda_cents) valor
                                 FROM legado_maletas
                                WHERE codcli = ANY (coalesce(cods, '{}')) AND tipo = 'remessa' AND fechamento IS NOT NULL
                                GROUP BY remessa ORDER BY max(fechamento) DESC, remessa DESC LIMIT 3) u),
    'variantes_campeas', (SELECT coalesce(jsonb_agg(DISTINCT v.id), '[]'::jsonb) FROM (
                            SELECT lp.product_id, lp.variant_id FROM legado_maleta_vendidos mv
                              JOIN legado_produtos lp ON lp.codigo = mv.produto
                             WHERE mv.codcli = ANY (coalesce(cods, '{}')) AND (lp.product_id IS NOT NULL OR lp.variant_id IS NOT NULL)
                             GROUP BY lp.codigo, lp.product_id, lp.variant_id ORDER BY sum(mv.quantidade) DESC LIMIT 10) top
                            JOIN product_variants v ON v.id = top.variant_id OR (top.variant_id IS NULL AND v.product_id = top.product_id)),
    'como_ler', sug->'como_ler');
END $function$;