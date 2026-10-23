CREATE OR REPLACE FUNCTION public.legado_consultora_dados_rep(_codclis integer[], _remessas integer[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH fech AS (
    SELECT m.* FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
     WHERE m.codcli = ANY (_codclis) AND m.remessa = ANY (_remessas) AND m.fechamento IS NOT NULL AND m.tipo = 'remessa'),
  todas AS (SELECT m.* FROM legado_maletas m WHERE m.codcli = ANY (_codclis) AND m.remessa = ANY (_remessas)),
  praca AS (SELECT (SELECT r.praca FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
                     WHERE m.codcli = ANY (_codclis) AND m.remessa = ANY (_remessas) ORDER BY m.emissao DESC NULLS LAST LIMIT 1) AS codigo),
  cat AS (
    SELECT c.categoria, sum(c.pecas_enviadas) env, sum(c.pecas_enviadas - c.pecas_devolvidas) vend,
           sum(c.valor_enviado_cents - c.valor_devolvido_cents) valor
      FROM legado_maleta_categorias c JOIN fech f USING (remessa, codcli, kit) GROUP BY 1),
  cat_praca AS (
    SELECT c.categoria, sum(c.pecas_enviadas) env, sum(c.pecas_enviadas - c.pecas_devolvidas) vend
      FROM legado_maleta_categorias c JOIN legado_maletas m USING (remessa, codcli, kit)
      JOIN legado_remessas r ON r.numero = m.remessa
     WHERE m.fechamento IS NOT NULL AND r.praca = (SELECT codigo FROM praca) GROUP BY 1)
  SELECT jsonb_build_object(
    'codigos', to_jsonb(_codclis),
    'praca', (SELECT jsonb_build_object('codigo', p.codigo, 'nome', lp.nome) FROM praca p LEFT JOIN legado_pracas lp ON lp.codigo = p.codigo),
    'resumo', (SELECT jsonb_build_object(
        'maletas', (SELECT count(*) FROM todas), 'maletas_fechadas', count(*), 'remessas', (SELECT count(DISTINCT remessa) FROM todas),
        'primeira_maleta', (SELECT min(emissao) FROM todas), 'ultima_maleta', (SELECT max(emissao) FROM todas),
        'pecas_enviadas', coalesce(sum(pecas_enviadas),0), 'pecas_vendidas', coalesce(sum(pecas_vendidas),0),
        'giro_pct', CASE WHEN sum(pecas_enviadas) > 0 THEN round(100.0 * sum(pecas_vendidas) / sum(pecas_enviadas), 1) END,
        'valor_vendido_cents', coalesce(sum(valor_venda_cents),0),
        'ticket_medio_maleta_cents', CASE WHEN count(*) > 0 THEN round(sum(valor_venda_cents)::numeric / count(*)) END,
        'pecas_defeito', coalesce(sum(pecas_defeito),0),
        'maletas_perdidas', (SELECT count(*) FROM todas WHERE tipo = 'perdida'))
      FROM fech),
    'categorias', coalesce((SELECT jsonb_agg(jsonb_build_object('categoria', c.categoria, 'pecas_enviadas', c.env, 'pecas_vendidas', c.vend,
        'giro_pct', CASE WHEN c.env > 0 THEN round(100.0 * c.vend / c.env, 1) END,
        'giro_praca_pct', CASE WHEN cp.env > 0 THEN round(100.0 * cp.vend / cp.env, 1) END,
        'participacao_vendas_pct', CASE WHEN (SELECT sum(vend) FROM cat) > 0 THEN round(100.0 * c.vend / (SELECT sum(vend) FROM cat), 1) END,
        'valor_vendido_cents', c.valor) ORDER BY c.vend DESC, c.env DESC)
      FROM cat c LEFT JOIN cat_praca cp USING (categoria)), '[]'::jsonb),
    'produtos_top', coalesce((SELECT jsonb_agg(x ORDER BY x.quantidade DESC, x.valor_cents DESC) FROM (
        SELECT v.produto, p.nome, p.referencia, p.categoria, p.subcategoria, p.product_id, sum(v.quantidade) quantidade,
               sum(v.quantidade * v.valor_unitario_cents) valor_cents, max(m.emissao) ultima_venda
          FROM legado_maleta_vendidos v JOIN legado_maletas m USING (remessa, codcli, kit)
          LEFT JOIN legado_produtos p ON p.codigo = v.produto
         WHERE v.codcli = ANY (_codclis) AND v.remessa = ANY (_remessas) GROUP BY 1,2,3,4,5,6 ORDER BY 7 DESC, 8 DESC LIMIT 20) x), '[]'::jsonb),
    'subcategorias_top', coalesce((SELECT jsonb_agg(x ORDER BY x.quantidade DESC) FROM (
        SELECT coalesce(p.categoria,'?') categoria, coalesce(p.subcategoria,'') subcategoria, sum(v.quantidade) quantidade
          FROM legado_maleta_vendidos v LEFT JOIN legado_produtos p ON p.codigo = v.produto
         WHERE v.codcli = ANY (_codclis) AND v.remessa = ANY (_remessas) GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10) x), '[]'::jsonb),
    'por_ano', coalesce((SELECT jsonb_agg(x ORDER BY x.ano) FROM (
        SELECT extract(year FROM emissao)::int ano, count(*) maletas, sum(pecas_vendidas) pecas_vendidas, sum(valor_venda_cents) valor_vendido_cents
          FROM fech GROUP BY 1) x), '[]'::jsonb),
    'maletas', coalesce((SELECT jsonb_agg(x ORDER BY x.emissao DESC NULLS LAST, x.remessa DESC) FROM (
        SELECT m.remessa, m.kit, m.codcli, m.tipo, m.emissao, m.fechamento, r.status status_remessa, lp.nome praca, lr.nome representante,
               m.pecas_enviadas, m.pecas_devolvidas, m.pecas_defeito, m.valor_enviado_cents,
               CASE WHEN m.fechamento IS NOT NULL THEN m.pecas_vendidas END pecas_vendidas,
               CASE WHEN m.fechamento IS NOT NULL THEN m.valor_venda_cents END valor_vendido_cents,
               CASE WHEN m.pecas_enviadas > 0 AND m.fechamento IS NOT NULL THEN round(100.0 * m.pecas_vendidas / m.pecas_enviadas, 1) END giro_pct,
               m.nf_remessa, m.nf_devolucao, m.nf_venda, m.nf_perda
          FROM todas m LEFT JOIN legado_remessas r ON r.numero = m.remessa
          LEFT JOIN legado_pracas lp ON lp.codigo = r.praca LEFT JOIN legado_representantes lr ON lr.codigo = r.representante
         ORDER BY m.emissao DESC NULLS LAST LIMIT 300) x), '[]'::jsonb))
$function$;
REVOKE ALL ON FUNCTION public.legado_consultora_dados_rep(integer[], integer[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.legado_consultora_historico(_party uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cods int[]; v_rep uuid; v_nome text; v_rep_nome text; v_reps int[]; v_rems int[];
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para ver o histórico.' USING errcode = '42501'; END IF;
  SELECT array_agg(codcli ORDER BY codcli) INTO cods FROM legado_consultoras WHERE party_id = _party;
  IF cods IS NULL THEN RETURN jsonb_build_object('vinculada', false); END IF;
  -- Com representante no vínculo, a ficha mostra só as remessas SmallData daquele representante.
  SELECT representative_party_id INTO v_rep FROM consultant_profiles WHERE party_id = _party;
  IF v_rep IS NULL THEN
    RETURN public.legado_consultora_dados(cods) || jsonb_build_object('vinculada', true);
  END IF;
  SELECT display_name, upper(trim(display_name)) INTO v_rep_nome, v_nome FROM parties WHERE id = v_rep;
  SELECT array_agg(codigo) INTO v_reps FROM legado_representantes WHERE party_id = v_rep OR upper(trim(nome)) = v_nome;
  SELECT coalesce(array_agg(DISTINCT m.remessa), '{}') INTO v_rems
    FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
   WHERE m.codcli = ANY (cods) AND r.representante = ANY (coalesce(v_reps, '{}'));
  RETURN public.legado_consultora_dados_rep(cods, v_rems) || jsonb_build_object('vinculada', true,
    'filtro_representante', jsonb_build_object('party_id', v_rep, 'nome', v_rep_nome, 'codigos', to_jsonb(coalesce(v_reps, '{}')),
      'remessas', cardinality(v_rems),
      'remessas_total', (SELECT count(DISTINCT remessa) FROM legado_maletas WHERE codcli = ANY (cods))));
END $function$;