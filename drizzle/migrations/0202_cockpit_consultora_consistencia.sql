-- 0201 — Cockpit da consultora: números iguais entre as telas (03/11/2026). Só leitura.
CREATE OR REPLACE FUNCTION public.consultora_acertos_vendas(_party uuid)
 RETURNS TABLE(origem text, remessa integer, data date, vendido_cents bigint, comissao_cents bigint, estimada boolean, kits integer, pecas_vendidas integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cods AS (SELECT public.legado_codigos_da_pessoa(_party) c),
  modo AS (SELECT EXISTS (SELECT 1 FROM legado_acertos_consultora WHERE fonte = 'cobranca') cobranca),
  lardan AS (
    SELECT r.numero AS remessa,
           (max(p.fechada_em) AT TIME ZONE 'America/Sao_Paulo')::date AS data,
           sum(coalesce(p.vendido_final_cents, p.total_vendido_cents))::bigint AS vendido,
           sum(public.pre_baixa_comissao_final(p))::bigint AS comissao,
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
      FROM legado_acertos_consultora a, cods, modo
     WHERE a.codcli = ANY (cods.c) AND a.tipo = 'remessa' AND a.data IS NOT NULL
       AND (a.fonte = 'cobranca' OR NOT modo.cobranca)
       AND NOT EXISTS (SELECT 1 FROM lardan l WHERE l.remessa = a.remessa)
     GROUP BY a.remessa
  )
  SELECT 'lardan', l.remessa, l.data, l.vendido, l.comissao, false, l.kits, l.pecas FROM lardan l
  UNION ALL
  SELECT 'antigo', a.remessa, a.data, a.vendido,
         coalesce(a.comissao_real, (public.comissao_pelas_faixas(a.vendido)->>'comissao_cents')::bigint),
         a.comissao_real IS NULL, greatest(a.kits, 1), a.pecas
    FROM antigo a
$function$;

CREATE OR REPLACE FUNCTION public.consultora_notas_e_fechamentos(_party uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cods int[];
BEGIN
  IF NOT (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'registry.finance.view')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o financeiro desta pessoa' USING errcode = '42501';
  END IF;
  cods := coalesce(public.legado_codigos_da_pessoa(_party), '{}');
  RETURN jsonb_build_object(
    'notas', coalesce((SELECT jsonb_agg(n ORDER BY n->>'data' DESC NULLS LAST, n->>'numero' DESC) FROM (
        SELECT jsonb_build_object('origem', 'smalldata', 'id', 'sd:' || ln.nf_id, 'data', ln.emitida_em, 'numero', ln.numero::text, 'serie', ln.serie::text,
          'tipo', CASE ln.tipo WHEN 'R' THEN 'remessa' WHEN 'D' THEN 'devolucao' WHEN 'V' THEN 'venda' WHEN 'P' THEN 'perda' ELSE coalesce(lower(ln.natureza), 'outra') END,
          'natureza', ln.natureza, 'cfop', ln.cfop, 'operacao', ln.operacao, 'situacao', ln.situacao, 'valor_cents', ln.valor_cents, 'pecas', ln.pecas,
          'remessa', ln.remessa, 'maleta', CASE WHEN ln.kit IS NULL THEN NULL ELSE 'Kit ' || ln.kit END, 'chave', ln.chave, 'simulada', false) n
          FROM legado_notas ln WHERE ln.codcli = ANY (cods)
        UNION ALL
        SELECT jsonb_build_object('origem', 'lardan', 'id', fd.id, 'data', coalesce(fd.authorized_at, fd.issued_at, fd.created_at), 'numero', fd.number, 'serie', fd.series,
          'tipo', fd.kind, 'natureza', fd.kind, 'cfop', NULL, 'operacao', NULL,
          'situacao', CASE WHEN (to_jsonb(fd)->>'cancelled_at') IS NOT NULL OR fd.status IN ('cancelado', 'cancelada') THEN 'cancelada' ELSE fd.status END, 'valor_cents', fd.total_cents,
          'pecas', (SELECT sum(fi.quantity) FROM fiscal_document_items fi WHERE fi.document_id = fd.id),
          'remessa', (SELECT r.numero FROM kit_cycles c JOIN remessas r ON r.id = c.remessa_id WHERE c.id = fd.cycle_id),
          'maleta', (SELECT k.code FROM kit_cycles c JOIN kits k ON k.id = c.kit_id WHERE c.id = fd.cycle_id),
          'chave', fd.access_key, 'simulada', coalesce((to_jsonb(fd)->>'simulado')::boolean, false)) n
          FROM fiscal_documents fd
         WHERE fd.recipient_party_id = _party OR fd.debtor_party_id = _party
            OR EXISTS (SELECT 1 FROM kit_cycles c WHERE c.id = fd.cycle_id AND c.consultora_party_id = _party)
      ) s), '[]'::jsonb),
    'fechamentos', coalesce((SELECT jsonb_agg(f ORDER BY coalesce(f->>'fechamento', f->>'enviada') DESC NULLS LAST) FROM (
        SELECT jsonb_build_object('origem', 'smalldata', 'id', 'sd:' || m.remessa || ':' || m.kit, 'remessa', m.remessa, 'maleta', 'Kit ' || m.kit, 'tipo', m.tipo,
          'enviada', m.emissao, 'fechamento', coalesce(m.fechamento, m.fechamento_smalldata),
          'situacao', CASE WHEN m.tipo = 'perdida' THEN 'perdida' WHEN coalesce(m.fechamento, m.fechamento_smalldata) IS NOT NULL THEN 'fechada' ELSE 'aberta' END,
          'pecas_enviadas', m.pecas_enviadas, 'pecas_devolvidas', m.pecas_devolvidas, 'pecas_vendidas', m.pecas_vendidas, 'pecas_defeito', m.pecas_defeito,
          'valor_enviado_cents', m.valor_enviado_cents, 'valor_devolvido_cents', m.valor_devolvido_cents, 'vendido_cents', m.valor_venda_cents,
          'acerto_divergente', m.acerto_divergente, 'sem_cobranca', m.sem_cobranca,
          'cobranca', (SELECT jsonb_build_object('data', min(c.data), 'venda_bruta_cents', sum(c.venda_bruta_cents), 'venda_liquida_cents', sum(c.venda_liquida_cents),
                         'comissao_cents', sum(c.venda_bruta_cents - c.venda_liquida_cents), 'pago_cents', sum(c.total_pago_cents), 'fiado_novo_cents', sum(c.fiado_novo_cents))
                         FROM legado_cobrancas c WHERE c.codcli = m.codcli AND c.remessa = m.remessa AND c.tipo IN (1, 2) HAVING count(*) > 0),
          'notas', jsonb_strip_nulls(jsonb_build_object('remessa', m.nf_remessa, 'devolucao', m.nf_devolucao, 'venda', m.nf_venda, 'perda', m.nf_perda))) f
          FROM legado_maletas m WHERE m.codcli = ANY (cods)
        UNION ALL
        SELECT jsonb_build_object('origem', 'lardan', 'id', kc.id, 'remessa', r.numero, 'maleta', k.code, 'tipo', 'remessa',
          'enviada', (kc.shipped_at AT TIME ZONE 'America/Sao_Paulo')::date,
          'fechamento', (coalesce(pb.encerrada_em, kc.closed_at, pb.fechada_em) AT TIME ZONE 'America/Sao_Paulo')::date,
          'situacao', CASE WHEN pb.id IS NOT NULL THEN public.pre_baixa_situacao(pb) ELSE kc.status::text END,
          'pecas_enviadas', b.aceitas, 'pecas_devolvidas', b.devolvidas, 'pecas_vendidas', b.vendidas, 'pecas_defeito', NULL,
          'valor_enviado_cents', kc.reference_total_cents, 'valor_devolvido_cents', NULL,
          'vendido_cents', coalesce(pb.vendido_final_cents, pb.total_vendido_cents),
          'acerto_divergente', pb.status = 'pendencia', 'sem_cobranca', false,
          'cobranca', CASE WHEN pb.id IS NOT NULL THEN jsonb_build_object('data', (pb.fechada_em AT TIME ZONE 'America/Sao_Paulo')::date,
                        'venda_bruta_cents', coalesce(pb.vendido_final_cents, pb.total_vendido_cents), 'comissao_cents', public.pre_baixa_comissao_final(pb),
                        'venda_liquida_cents', coalesce(pb.valor_final_cents, pb.valor_pagar_cents),
                        'pago_cents', CASE WHEN pb.installment_id IS NULL THEN NULL
                                           ELSE (SELECT coalesce(sum(a.valor_cents), 0) FROM financial_allocations a WHERE a.installment_id = pb.installment_id) END,
                        'origem', pb.origem)
                      END,
          'notas', coalesce((SELECT jsonb_object_agg(fd.kind, fd.number) FROM fiscal_documents fd WHERE fd.cycle_id = kc.id AND fd.number IS NOT NULL), '{}'::jsonb)) f
          FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id LEFT JOIN remessas r ON r.id = kc.remessa_id
          LEFT JOIN kit_pre_baixas pb ON pb.cycle_id = kc.id
          CROSS JOIN LATERAL (SELECT coalesce(sum(qty_accepted), 0) aceitas, coalesce(sum(qty_returned), 0) devolvidas, coalesce(sum(qty_sold), 0) vendidas
                                FROM kit_balances WHERE cycle_id = kc.id) b
         WHERE kc.consultora_party_id = _party AND kc.status NOT IN ('rascunho', 'montagem', 'cancelada')
      ) s), '[]'::jsonb)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.consultora_meu_historico()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE eu uuid := public.my_party_id(); cods int[]; d jsonb;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501';
  END IF;
  cods := nullif(public.legado_codigos_da_pessoa(eu), '{}'::int[]);
  IF cods IS NULL THEN RETURN jsonb_build_object('vinculada', false); END IF;
  d := public.legado_consultora_dados(cods);
  RETURN jsonb_build_object('vinculada', true, 'resumo', d->'resumo', 'categorias', d->'categorias',
    'produtos_top', d->'produtos_top', 'subcategorias_top', d->'subcategorias_top', 'por_ano', d->'por_ano',
    'maletas', (SELECT coalesce(jsonb_agg(m - 'codcli' - 'representante'), '[]'::jsonb) FROM jsonb_array_elements(d->'maletas') m));
END $function$;

CREATE OR REPLACE FUNCTION public.montagem_metas_ciclo(_cycle uuid, _total integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_party uuid; cods int[]; p record; v_total int; v_origem text; sug jsonb; conf text;
  metas_padrao jsonb; metas_hist jsonb; v_modo text; fechadas int;
  pc int; g_dela numeric; g_ref numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.can_manage_kits(auth.uid())
       OR public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque','montagem']::public.app_role[])) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF _total IS NOT NULL AND (_total < 1 OR _total > 1000) THEN RAISE EXCEPTION 'Total de peças entre 1 e 1000.'; END IF;
  SELECT consultora_party_id INTO v_party FROM kit_cycles WHERE id = _cycle;
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

  IF _total IS NOT NULL THEN
    v_total := _total; v_origem := 'informado';
  ELSIF v_party IS NOT NULL THEN
    v_total := (public.maleta_total_sugerido(v_party)->>'total')::int;
    v_origem := CASE WHEN v_total IS NULL THEN NULL ELSE 'historico' END;
  END IF;
  IF v_total IS NULL OR v_total < 1 THEN
    v_total := coalesce(p.pecas_cliente_nova, 35); v_origem := 'parametro';
  END IF;
  v_total := least(v_total, 1000);

  IF v_party IS NULL THEN
    RETURN jsonb_build_object('party_id', NULL, 'vinculada', false, 'modo_sugerido', 'padrao', 'confianca', 'baixa',
      'total_pecas', v_total, 'total_origem', v_origem, 'metas_padrao', metas_padrao, 'metas_historico', NULL,
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

CREATE OR REPLACE FUNCTION public.montagem_sugestao(_party uuid, _total integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cods int[]; pc int; k numeric := 30; v_total numeric; res jsonb; conf text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.can_manage_kits(auth.uid())
       OR public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque','montagem']::public.app_role[])) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF _total IS NULL OR _total < 1 OR _total > 1000 THEN RAISE EXCEPTION 'Total de peças entre 1 e 1000.'; END IF;
  cods := nullif(public.legado_codigos_da_pessoa(_party), '{}'::int[]);
  SELECT cp.codigo INTO pc FROM consultant_profiles c JOIN cob_pracas cp ON cp.id = c.praca_id WHERE c.party_id = _party;
  IF pc IS NULL AND cods IS NOT NULL THEN
    SELECT r.praca INTO pc FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
     WHERE m.codcli = ANY (cods) ORDER BY m.emissao DESC NULLS LAST LIMIT 1;
  END IF;
  WITH fech AS (
    SELECT m.remessa, m.codcli, m.kit, r.praca FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
     WHERE m.fechamento IS NOT NULL AND m.tipo = 'remessa'),
  ref AS (
    SELECT c.categoria, sum(c.pecas_enviadas) env, sum(c.pecas_enviadas - c.pecas_devolvidas) vend
      FROM legado_maleta_categorias c JOIN fech f USING (remessa, codcli, kit)
     WHERE pc IS NULL OR f.praca = pc OR NOT EXISTS (SELECT 1 FROM fech WHERE praca = pc)
     GROUP BY 1),
  minha AS (
    SELECT c.categoria, sum(c.pecas_enviadas) env, sum(c.pecas_enviadas - c.pecas_devolvidas) vend
      FROM legado_maleta_categorias c JOIN fech f USING (remessa, codcli, kit)
     WHERE c.codcli = ANY (coalesce(cods, '{}')) GROUP BY 1),
  junta AS (
    SELECT r.categoria, coalesce(m.env,0) m_env, coalesce(m.vend,0) m_vend, r.env r_env, r.vend r_vend,
           r.vend::numeric / nullif((SELECT sum(vend) FROM ref),0) r_share
      FROM ref r LEFT JOIN minha m USING (categoria)
     WHERE r.vend > 0 OR coalesce(m.vend,0) > 0),
  peso AS (
    SELECT j.*, (j.m_vend + k * coalesce(j.r_share,0)) / ((SELECT sum(m_vend) FROM junta) + k) bruto FROM junta j),
  piso AS (
    SELECT p.*, CASE WHEN coalesce(p.r_share,0) >= 0.01 THEN greatest(p.bruto, 0.02) ELSE p.bruto END ajustado FROM peso p),
  norm AS (SELECT p.*, p.ajustado / (SELECT sum(ajustado) FROM piso) frac FROM piso p),
  base AS (SELECT n.*, floor(n.frac * _total)::int pecas, n.frac * _total - floor(n.frac * _total) resto FROM norm n),
  falta AS (SELECT _total - (SELECT sum(pecas) FROM base) n),
  ordem AS (SELECT b.*, row_number() OVER (ORDER BY b.resto DESC, b.categoria) rk FROM base b)
  SELECT jsonb_agg(jsonb_build_object(
           'categoria', o.categoria,
           'pecas_sugeridas', o.pecas + CASE WHEN o.rk <= (SELECT n FROM falta) THEN 1 ELSE 0 END,
           'participacao_sugerida_pct', round(100 * o.frac, 1),
           'consultora_pecas_vendidas', o.m_vend, 'consultora_pecas_enviadas', o.m_env,
           'consultora_giro_pct', CASE WHEN o.m_env > 0 THEN round(100.0 * o.m_vend / o.m_env, 1) END,
           'consultora_participacao_vendas_pct', CASE WHEN (SELECT sum(m_vend) FROM junta) > 0 THEN round(100.0 * o.m_vend / (SELECT sum(m_vend) FROM junta), 1) END,
           'referencia_giro_pct', CASE WHEN o.r_env > 0 THEN round(100.0 * o.r_vend / o.r_env, 1) END,
           'referencia_participacao_vendas_pct', round(100 * coalesce(o.r_share,0), 1))
         ORDER BY o.frac DESC), (SELECT sum(m_vend) FROM junta)
    INTO res, v_total FROM ordem o;
  conf := CASE WHEN coalesce(v_total,0) >= 30 THEN 'alta' WHEN coalesce(v_total,0) >= 10 THEN 'media' ELSE 'baixa' END;
  RETURN jsonb_build_object('total_pecas', _total, 'confianca', conf, 'pecas_vendidas_historico', coalesce(v_total,0),
    'referencia', CASE WHEN pc IS NULL THEN 'rede' ELSE 'praca' END, 'praca_codigo', pc,
    'praca_nome', (SELECT nome FROM legado_pracas WHERE codigo = pc),
    'como_ler', 'Mistura o que ela vendeu com o que a praça vende; quanto mais histórico, mais pesa o dela. Só sugestão: a montagem continua manual.',
    'categorias', coalesce(res, '[]'::jsonb));
END $function$;