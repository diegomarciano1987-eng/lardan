-- ============================================================================
-- 0113 — Metas da montagem pelo histórico de venda da consultora
--
-- Na tela de bipagem (MontagemLeitor) os cartões "Brincos 12/25, Anéis 3/4…"
-- usavam metas fixas, iguais para todas. Agora a tela pede ao banco as metas
-- DESTA consultora: o que ela vendeu no JFLEX misturado com o que a praça vende
-- (montagem_sugestao, 0112), somado por tipo de peça do leitor.
--
-- Garantias:
--   * Só leitura: não reserva, não adiciona peça, não mexe em estoque.
--   * Só equipe de montagem (mesma permissão de montagem_sugestao).
--   * Sem histórico confiável (menos de 10 peças vendidas) a tela continua no
--     padrão de remessa_parametros; o montador pode trocar o modo na tela.
-- ============================================================================

-- Categoria do JFLEX -> tipo de peça do leitor (src/lib/remessa.ts: TipoPeca).
CREATE TABLE IF NOT EXISTS public.legado_categoria_tipo (
  categoria text PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('brinco','anel','colar','pulseira','tornozeleira','outro')),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.legado_categoria_tipo (categoria, tipo) VALUES
  ('BRINCO','brinco'), ('ANEL','anel'), ('COLAR','colar'),
  ('PULSEIRAS','pulseira'), ('PULSEIRA','pulseira'), ('BRACELETE','pulseira'),
  ('TORNOZELEIRA','tornozeleira'),
  ('CONJUNTO','outro'), ('PIERCING','outro'), ('BROCHE','outro'), ('PINGENTE','outro'),
  ('BERLOQUE','outro'), ('ACESSORIOS','outro')
ON CONFLICT (categoria) DO NOTHING;
ALTER TABLE public.legado_categoria_tipo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_categoria_tipo FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.legado_categoria_tipo TO service_role;

-- Master ajusta o de-para (auditado). Categoria sem linha conta como "outro".
CREATE OR REPLACE FUNCTION public.legado_categoria_tipo_definir(_categoria text, _tipo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE cat text := upper(btrim(coalesce(_categoria, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['master']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só o Master ajusta o de-para de categorias.' USING errcode = '42501';
  END IF;
  IF cat = '' THEN RAISE EXCEPTION 'Informe a categoria.'; END IF;
  IF _tipo NOT IN ('brinco','anel','colar','pulseira','tornozeleira','outro') THEN RAISE EXCEPTION 'Tipo de peça inválido.'; END IF;
  INSERT INTO legado_categoria_tipo (categoria, tipo) VALUES (cat, _tipo)
  ON CONFLICT (categoria) DO UPDATE SET tipo = excluded.tipo, atualizado_em = now();
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'legado.categoria_tipo', 'legado_categoria_tipo', cat, jsonb_build_object('tipo', _tipo));
END $fn$;
REVOKE ALL ON FUNCTION public.legado_categoria_tipo_definir(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_categoria_tipo_definir(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.legado_categoria_tipo_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('categoria', c.categoria, 'tipo', coalesce(t.tipo, 'outro'),
                                                       'mapeada', t.tipo IS NOT NULL) ORDER BY c.categoria)
    FROM (SELECT DISTINCT categoria FROM legado_maleta_categorias
          UNION SELECT categoria FROM legado_categoria_tipo) c
    LEFT JOIN legado_categoria_tipo t USING (categoria)), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_categoria_tipo_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_categoria_tipo_lista() TO authenticated;

-- Metas da maleta aberta na bipagem.
--   _total: força o total de peças; NULL = mediana das 5 últimas maletas fechadas
--   dela no JFLEX com 10+ peças, ou pecas_cliente_nova quando não há histórico.
CREATE OR REPLACE FUNCTION public.montagem_metas_ciclo(_cycle uuid, _total int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
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
    SELECT array_agg(codcli) INTO cods FROM legado_consultoras WHERE party_id = v_party;
  END IF;
  SELECT count(*) INTO fechadas FROM legado_maletas
   WHERE codcli = ANY (coalesce(cods, '{}')) AND tipo = 'remessa' AND fechamento IS NOT NULL;

  IF _total IS NOT NULL THEN
    v_total := _total; v_origem := 'informado';
  ELSIF fechadas > 0 THEN
    -- mediana das 5 últimas maletas cheias (10+ peças): kit de complemento não puxa a média
    SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY pecas_enviadas) INTO v_total FROM (
      SELECT pecas_enviadas FROM legado_maletas
       WHERE codcli = ANY (cods) AND tipo = 'remessa' AND fechamento IS NOT NULL AND pecas_enviadas >= 10
       ORDER BY fechamento DESC, emissao DESC LIMIT 5) u;
    v_origem := 'historico';
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

  -- giro geral dela e da referência (mesmo recorte de montagem_sugestao: maletas fechadas)
  SELECT CASE WHEN sum(c.pecas_enviadas) > 0 THEN 100.0 * sum(c.pecas_enviadas - c.pecas_devolvidas) / sum(c.pecas_enviadas) END
    INTO g_dela
    FROM legado_maleta_categorias c JOIN legado_maletas m USING (remessa, codcli, kit)
    JOIN legado_remessas r ON r.numero = m.remessa
   WHERE c.codcli = ANY (coalesce(cods, '{}')) AND r.status = 'fechada' AND m.fechamento IS NOT NULL AND m.tipo = 'remessa';
  SELECT CASE WHEN sum(c.pecas_enviadas) > 0 THEN 100.0 * sum(c.pecas_enviadas - c.pecas_devolvidas) / sum(c.pecas_enviadas) END
    INTO g_ref
    FROM legado_maleta_categorias c JOIN legado_maletas m USING (remessa, codcli, kit)
    JOIN legado_remessas r ON r.numero = m.remessa
   WHERE r.status = 'fechada' AND m.fechamento IS NOT NULL AND m.tipo = 'remessa'
     AND (sug->>'referencia' = 'rede' OR r.praca = pc);

  -- soma por tipo de peça do leitor (categoria sem de-para conta como "outro")
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
    -- onde o mix dela foge da praça: índice = (giro da categoria / giro geral dela) ÷ (o mesmo na referência).
    -- forte >= 1,25; fraco <= 0,75; só com 20+ peças da categoria recebidas.
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
    -- últimas 3 remessas dela (soma das maletas de cada remessa: kit de complemento entra junto)
    'ultimas_maletas', (SELECT coalesce(jsonb_agg(jsonb_build_object('remessa', remessa, 'fechamento', fechamento, 'maletas', maletas,
                          'pecas_enviadas', env, 'pecas_vendidas', vend,
                          'giro_pct', CASE WHEN env > 0 THEN round(100.0 * vend / env, 1) END,
                          'valor_vendido_cents', valor) ORDER BY fechamento DESC, remessa DESC), '[]'::jsonb)
                         FROM (SELECT remessa, max(fechamento) fechamento, count(*) maletas, sum(pecas_enviadas) env,
                                      sum(pecas_vendidas) vend, sum(valor_vendido_cents) valor
                                 FROM legado_maletas
                                WHERE codcli = ANY (coalesce(cods, '{}')) AND tipo = 'remessa' AND fechamento IS NOT NULL
                                GROUP BY remessa ORDER BY max(fechamento) DESC, remessa DESC LIMIT 3) u),
    -- variantes dos 10 produtos que ela mais vendeu (para a tela marcar "campeã dela" ao bipar)
    'variantes_campeas', (SELECT coalesce(jsonb_agg(DISTINCT v.id), '[]'::jsonb) FROM (
                            SELECT lp.product_id, lp.variant_id FROM legado_maleta_vendidos mv
                              JOIN legado_produtos lp ON lp.codigo = mv.produto
                             WHERE mv.codcli = ANY (coalesce(cods, '{}')) AND (lp.product_id IS NOT NULL OR lp.variant_id IS NOT NULL)
                             GROUP BY lp.codigo, lp.product_id, lp.variant_id ORDER BY sum(mv.quantidade) DESC LIMIT 10) top
                            JOIN product_variants v ON v.id = top.variant_id OR (top.variant_id IS NULL AND v.product_id = top.product_id)),
    'como_ler', sug->'como_ler');
END $fn$;
REVOKE ALL ON FUNCTION public.montagem_metas_ciclo(uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.montagem_metas_ciclo(uuid,int) TO authenticated;