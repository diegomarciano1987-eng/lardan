-- 0311 (pacote 0310 do Diego; renumerado) — Inteligência Operacional › Previsibilidade (Diego/Daniel, 13/11/2026). Só leitura: nada é gravado.
-- Responde, para o mês corrente: quanto vamos vender (R$ e peças), quantas consultoras devem parar, quantas devem entrar
-- e como fica a base. Tudo pelo histórico real: SmallData (legado_maletas) + Lardan Cloud (kit_cycles / kit_pre_baixas).
--
-- Como cada número nasce (o painel mostra essa explicação):
--  • Venda pelo acerto (como o SmallData e o financeiro): já acertado no mês + maletas na rua com acerto até o fim do mês
--    × "giro esperado" de cada consultora. O giro esperado é a média dela nos últimos 12 meses puxada para a média da rede
--    na proporção de quanto histórico ela tem (quem tem pouca maleta fica perto da média; quem tem muita, perto da própria).
--    Estreante usa o giro das primeiras maletas da rede. Nem toda maleta acerta no dia previsto: aplica-se a pontualidade
--    medida (quantas maletas com acerto num mês acertaram dentro dele) e a antecipação (quantas do mês seguinte acertaram antes).
--  • Faixa de 80%: incerteza do giro de cada maleta (desvio medido na rede), somada maleta a maleta.
--  • Pelo ritmo: média dos 3 últimos meses fechados × peso do mês (sazonalidade dos anos anteriores). Serve de conferência.
--  • Paradas: de cada consultora que acerta no mês e ainda não tem a próxima maleta, a chance de NÃO pegar outra em 60 dias,
--    medida no histórico por número de maletas (1ª, 2ª–3ª, 4ª+) e pelo giro.
--  • Novas: quem já recebeu a primeira maleta no mês + maletas de abertura montadas × taxa de conversão das aberturas.

CREATE OR REPLACE FUNCTION public.previsibilidade_painel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  tz constant text := 'America/Sao_Paulo';
  hoje date := (now() AT TIME ZONE tz)::date;
  ini date := date_trunc('month', (now() AT TIME ZONE tz))::date;
  fim date := (date_trunc('month', (now() AT TIME ZONE tz)) + interval '1 month - 1 day')::date;
  prox_fim date := (date_trunc('month', (now() AT TIME ZONE tz)) + interval '2 month - 1 day')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.has_capability(auth.uid(), 'finance.view'), false) OR coalesce(public.kit_scope_all(), false)) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;

  RETURN (
  WITH
  -- ── todas as maletas (SmallData + Cloud), uma linha por maleta ─────────────────────────────────────────────────────────
  leg AS (
    SELECT coalesce(lc.party_id::text, 'L' || m.codcli) AS k, m.emissao AS em, m.fechamento AS fe,
           coalesce(m.valor_enviado_cents, 0)::numeric AS env, coalesce(m.valor_venda_cents, 0)::numeric AS vend,
           coalesce(m.pecas_enviadas, 0)::numeric AS pe, coalesce(m.pecas_vendidas, 0)::numeric AS pv,
           CASE WHEN m.fechamento IS NULL THEN coalesce(public.legado_maleta_vencimento_efetivo(m.remessa, m.codcli), m.emissao + 45) END AS prev,
           CASE WHEN m.fechamento IS NULL THEN public.legado_maleta_na_rua(m.remessa, m.codcli)
                     AND NOT EXISTS (SELECT 1 FROM maletas_perdidas mp WHERE mp.origem = 'smalldata' AND mp.remessa = m.remessa AND mp.codcli = m.codcli)
                     AND m.emissao >= hoje - 150 END AS na_rua,
           'smalldata'::text AS origem
      FROM legado_maletas m
      LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
     WHERE m.tipo = 'remessa' AND m.pecas_enviadas > 0 AND NOT coalesce(lc.interna, false)
       AND NOT EXISTS (SELECT 1 FROM legado_transferencia_maletas t
                        WHERE t.legado_remessa = m.remessa AND t.codcli = m.codcli AND t.kit = m.kit
                          AND t.cycle_id IS NOT NULL AND t.situacao <> 'desfeita')),
  pb AS (
    SELECT DISTINCT ON (p.cycle_id) p.cycle_id, p.id, (p.fechada_em AT TIME ZONE tz)::date AS fe,
           coalesce(p.vendido_final_cents, p.total_vendido_cents, 0)::numeric AS vend,
           (SELECT coalesce(sum(i.qtd_vendida), 0) FROM kit_pre_baixa_itens i WHERE i.pre_baixa_id = p.id)::numeric AS pv
      FROM kit_pre_baixas p
     WHERE p.status IN ('fechada', 'encerrada', 'pendencia') AND p.fechada_em IS NOT NULL
     ORDER BY p.cycle_id, p.fechada_em DESC),
  nuv AS (
    SELECT c.consultora_party_id::text AS k, coalesce((c.shipped_at AT TIME ZONE tz)::date, (c.created_at AT TIME ZONE tz)::date) AS em,
           pb.fe, coalesce(c.reference_total_cents, 0)::numeric AS env, coalesce(pb.vend, 0) AS vend,
           coalesce(c.quantity_total, 0)::numeric AS pe, coalesce(pb.pv, 0) AS pv,
           CASE WHEN pb.fe IS NULL THEN coalesce((c.due_at AT TIME ZONE tz)::date, r.data_acerto, coalesce((c.shipped_at AT TIME ZONE tz)::date, hoje) + 45) END AS prev,
           (pb.fe IS NULL AND c.status IN ('expedida', 'transito', 'recebida', 'operacao', 'acerto')
             AND NOT EXISTS (SELECT 1 FROM maletas_perdidas mp WHERE mp.cycle_id = c.id)) AS na_rua,
           'lardan'::text AS origem
      FROM kit_cycles c
      LEFT JOIN remessas r ON r.id = c.remessa_id
      LEFT JOIN pb ON pb.cycle_id = c.id
     WHERE c.consultora_party_id IS NOT NULL AND c.status <> 'cancelada'),
  todas AS (SELECT * FROM leg UNION ALL SELECT * FROM nuv),
  -- maletas fechadas, com a ordem da maleta na vida da consultora e a data da próxima maleta dela
  ordem AS (
    SELECT t.*, row_number() OVER (PARTITION BY t.k ORDER BY t.em, t.fe NULLS LAST) AS n,
           lead(t.em) OVER (PARTITION BY t.k ORDER BY t.em, t.fe NULLS LAST) AS prox_em,
           min(t.em) OVER (PARTITION BY t.k) AS primeira
      FROM todas t),
  fech AS (SELECT * FROM ordem WHERE fe IS NOT NULL AND env > 0),
  -- ── médias da rede ────────────────────────────────────────────────────────────────────────────────────────────────
  rede AS (
    SELECT coalesce(sum(vend) / nullif(sum(env), 0), 0) AS g, coalesce(sum(pv) / nullif(sum(pe), 0), 0) AS gp,
           coalesce(avg(env), 0) AS env_med, coalesce(avg(pe), 0) AS pe_med,
           coalesce(stddev_samp(least(vend / nullif(env, 0), 1)), 0) AS sd, count(*) AS n
      FROM fech WHERE fe >= ini - interval '6 months' AND fe < ini),
  -- variação do giro da rede de um mês para outro (o que faz o mês inteiro sair acima ou abaixo da média)
  giro_mensal AS (
    SELECT coalesce(stddev_samp(gm) / nullif(avg(gm), 0), 0.15) AS cv FROM (
      SELECT sum(vend) / nullif(sum(env), 0) AS gm FROM fech
       WHERE fe >= ini - interval '12 months' AND fe < ini GROUP BY date_trunc('month', fe)) x),
  estreia AS (
    SELECT coalesce(sum(vend) / nullif(sum(env), 0), (SELECT g FROM rede)) AS g,
           coalesce(sum(pv) / nullif(sum(pe), 0), (SELECT gp FROM rede)) AS gp
      FROM fech WHERE n = 1 AND fe >= ini - interval '12 months' AND fe < ini),
  pessoa AS (
    SELECT k, sum(env) AS e, sum(vend) AS v, sum(pe) AS pe, sum(pv) AS pv, count(*) AS maletas
      FROM fech WHERE fe >= hoje - 365 GROUP BY k),
  -- pontualidade: das maletas com acerto previsto num mês, quantas acertaram dentro dele; antecipação: do mês seguinte
  prazo AS (
    SELECT t.prev0, t.fe FROM (
      SELECT coalesce(public.legado_maleta_vencimento_efetivo(m.remessa, m.codcli), m.emissao + 45) AS prev0, m.fechamento AS fe
        FROM legado_maletas m WHERE m.tipo = 'remessa' AND m.pecas_enviadas > 0
         AND m.emissao >= ini - interval '9 months'
      UNION ALL
      SELECT coalesce((c.due_at AT TIME ZONE tz)::date, r.data_acerto), pb.fe
        FROM kit_cycles c LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN pb ON pb.cycle_id = c.id
       WHERE c.consultora_party_id IS NOT NULL AND c.status NOT IN ('cancelada', 'rascunho', 'montagem', 'conferida')) t
     WHERE t.prev0 >= ini - interval '6 months' AND t.prev0 < ini),
  pont AS (
    SELECT coalesce(avg(CASE WHEN fe IS NOT NULL AND fe <= (date_trunc('month', prev0) + interval '1 month - 1 day')::date THEN 1.0 ELSE 0 END), 0.85) AS p,
           coalesce(avg(CASE WHEN fe IS NOT NULL AND fe < date_trunc('month', prev0)::date THEN 1.0 ELSE 0 END), 0.05) AS antecipa,
           count(*) AS n
      FROM prazo),
  -- ── pipeline do mês: maletas na rua com acerto até o fim do mês (e as do mês seguinte, pela antecipação) ────────────
  rua AS (
    SELECT o.k, o.env, o.pe, o.prev, o.origem, o.n,
           CASE WHEN ps.k IS NULL THEN (SELECT g FROM estreia)
                ELSE (ps.v + 2 * rd.env_med * rd.g) / nullif(ps.e + 2 * rd.env_med, 0) END AS giro,
           CASE WHEN ps.k IS NULL THEN (SELECT gp FROM estreia)
                ELSE (ps.pv + 2 * rd.pe_med * rd.gp) / nullif(ps.pe + 2 * rd.pe_med, 0) END AS giro_p,
           CASE WHEN o.prev <= fim THEN (SELECT p FROM pont) WHEN o.prev <= prox_fim THEN (SELECT antecipa FROM pont) ELSE 0 END AS peso
      FROM ordem o CROSS JOIN rede rd LEFT JOIN pessoa ps ON ps.k = o.k
     WHERE o.fe IS NULL AND o.na_rua),
  mes AS (
    SELECT coalesce(sum(vend), 0) AS vend, coalesce(sum(pv), 0) AS pv, count(*) AS maletas, count(DISTINCT k) AS consultoras
      FROM fech WHERE fe BETWEEN ini AND hoje),
  pipe AS (
    SELECT coalesce(sum(env * giro * peso), 0) AS vend, coalesce(sum(pe * giro_p * peso), 0) AS pv,
           sqrt(coalesce(sum(power(env * (SELECT sd FROM rede), 2) * peso), 0)
                + power(coalesce(sum(env * giro * peso), 0) * (SELECT cv FROM giro_mensal), 2)) AS sd_v,
           sqrt(coalesce(sum(power(pe * (SELECT sd FROM rede), 2) * peso), 0)
                + power(coalesce(sum(pe * giro_p * peso), 0) * (SELECT cv FROM giro_mensal), 2)) AS sd_p,
           count(*) FILTER (WHERE prev <= fim) AS maletas_mes, count(*) FILTER (WHERE prev < ini) AS atrasadas,
           count(*) FILTER (WHERE prev > fim AND prev <= prox_fim) AS maletas_prox,
           coalesce(sum(env) FILTER (WHERE prev <= fim), 0) AS env_mes,
           count(*) FILTER (WHERE prev <= fim AND origem = 'smalldata') AS do_smalldata,
           count(*) FILTER (WHERE prev <= fim AND origem = 'lardan') AS do_lardan
      FROM rua),
  -- ── série mensal (pelo mês do acerto) e ritmo com sazonalidade ────────────────────────────────────────────────────
  serie AS (
    SELECT date_trunc('month', fe)::date AS m, sum(vend) AS vend, sum(pv) AS pv, count(*) AS maletas, count(DISTINCT k) AS consultoras
      FROM fech WHERE fe >= ini - interval '36 months' AND fe < ini GROUP BY 1),
  sazon AS (
    SELECT extract(month FROM m)::int AS mm, avg(vend) / nullif((SELECT avg(vend) FROM serie), 0) AS idx
      FROM serie GROUP BY 1),
  ritmo AS (
    SELECT avg(s.vend) AS vend, avg(s.pv) AS pv, avg(coalesce(z.idx, 1)) AS idx_base
      FROM serie s LEFT JOIN sazon z ON z.mm = extract(month FROM s.m)::int
     WHERE s.m >= ini - interval '3 months'),
  idx_mes AS (SELECT coalesce((SELECT idx FROM sazon WHERE mm = extract(month FROM ini)::int), 1) AS idx),
  -- ── novas ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  primeiras AS (SELECT k, min(em) AS primeira FROM ordem GROUP BY k),
  novas_mes AS (SELECT date_trunc('month', primeira)::date AS m, count(*) AS n FROM primeiras
                 WHERE primeira >= ini - interval '12 months' GROUP BY 1),
  aberturas AS (
    SELECT count(*) FILTER (WHERE c.consultora_party_id IS NULL AND c.status NOT IN ('cancelada', 'encerrada')) AS pendentes,
           count(*) FILTER (WHERE c.created_at < now() - interval '30 days') AS antigas,
           count(*) FILTER (WHERE c.created_at < now() - interval '30 days' AND c.consultora_party_id IS NOT NULL) AS antigas_viraram
      FROM kit_cycles c WHERE c.abertura_numero IS NOT NULL),
  conv AS (
    SELECT CASE WHEN a.antigas >= 10 THEN a.antigas_viraram::numeric / a.antigas
                ELSE 0.6 END AS taxa, a.antigas >= 10 AS medida
      FROM aberturas a),
  -- ── paradas: chance de não pegar outra maleta em 60 dias ──────────────────────────────────────────────────────────
  hist_ret AS (
    SELECT CASE WHEN n = 1 THEN '1ª maleta' WHEN n <= 3 THEN '2ª–3ª' ELSE '4ª ou mais' END AS faixa_n,
           CASE WHEN vend <= 0 THEN 'zerada' WHEN vend / env < 0.05 THEN 'fraca' WHEN vend / env < 0.12 THEN 'média' ELSE 'forte' END AS faixa_g,
           (prox_em IS NOT NULL AND prox_em <= fe + 60) AS voltou
      FROM fech WHERE fe >= hoje - 455 AND fe < hoje - 75),
  ret AS (SELECT faixa_n, faixa_g, avg(CASE WHEN voltou THEN 1.0 ELSE 0 END) AS volta, count(*) AS n FROM hist_ret GROUP BY 1, 2),
  ret_n AS (SELECT faixa_n, avg(CASE WHEN voltou THEN 1.0 ELSE 0 END) AS volta FROM hist_ret GROUP BY 1),
  acertam AS (
    -- quem acerta no mês e ainda não tem maleta seguinte (na rua com acerto depois, em montagem ou conferida)
    SELECT r.k, max(r.n) AS n, avg(r.giro) AS giro
      FROM rua r
     WHERE r.prev <= fim
       AND NOT EXISTS (SELECT 1 FROM rua r2 WHERE r2.k = r.k AND r2.prev > fim)
       AND NOT EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id::text = r.k AND c.status IN ('rascunho', 'montagem', 'conferida'))
     GROUP BY r.k),
  risco AS (
    SELECT a.k, a.n, a.giro,
           1 - coalesce(
             (SELECT rt.volta FROM ret rt WHERE rt.n >= 30
                AND rt.faixa_n = CASE WHEN a.n = 1 THEN '1ª maleta' WHEN a.n <= 3 THEN '2ª–3ª' ELSE '4ª ou mais' END
                AND rt.faixa_g = CASE WHEN a.giro <= 0.005 THEN 'zerada' WHEN a.giro < 0.05 THEN 'fraca' WHEN a.giro < 0.12 THEN 'média' ELSE 'forte' END),
             (SELECT rn.volta FROM ret_n rn WHERE rn.faixa_n = CASE WHEN a.n = 1 THEN '1ª maleta' WHEN a.n <= 3 THEN '2ª–3ª' ELSE '4ª ou mais' END),
             0.8) AS p_parar,
           coalesce(ps.v, 0) AS vendido_12m
      FROM acertam a LEFT JOIN pessoa ps ON ps.k = a.k),
  base AS (
    SELECT count(DISTINCT k) AS ativas FROM ordem
     WHERE (fe IS NULL AND na_rua) OR fe >= hoje - 60)
  SELECT jsonb_build_object(
    'mes', ini, 'hoje', hoje, 'fim', fim, 'dias_mes', extract(day FROM fim)::int, 'dia', extract(day FROM hoje)::int,
    'dados', jsonb_build_object(
      'smalldata_ate', (SELECT max(atualizado_em) FROM legado_maletas),
      'smalldata_ultima_remessa', (SELECT max(emissao) FROM legado_remessas),
      'maletas_historico', (SELECT count(*) FROM fech),
      'maletas_6m', (SELECT n FROM rede)),
    'venda', jsonb_build_object(
      'realizado_cents', (SELECT round(vend) FROM mes),
      'pipeline_cents', (SELECT round(vend) FROM pipe),
      'previsto_cents', (SELECT round(mes.vend + pipe.vend) FROM mes, pipe),
      'faixa_min_cents', (SELECT round(greatest(mes.vend, mes.vend + pipe.vend - 1.28 * pipe.sd_v)) FROM mes, pipe),
      'faixa_max_cents', (SELECT round(mes.vend + pipe.vend + 1.28 * pipe.sd_v) FROM mes, pipe),
      'ritmo_cents', (SELECT round(coalesce(ritmo.vend * idx_mes.idx / nullif(ritmo.idx_base, 0), ritmo.vend)) FROM ritmo, idx_mes),
      'mesmo_mes_ano_passado_cents', (SELECT round(vend) FROM serie WHERE m = (ini - interval '12 months')::date),
      'maletas_acertadas', (SELECT maletas FROM mes),
      'maletas_previstas', (SELECT maletas_mes FROM pipe),
      'maletas_atrasadas', (SELECT atrasadas FROM pipe),
      'maletas_mes_seguinte', (SELECT maletas_prox FROM pipe),
      'maletas_smalldata', (SELECT do_smalldata FROM pipe),
      'maletas_lardan', (SELECT do_lardan FROM pipe),
      'enviado_na_rua_cents', (SELECT round(env_mes) FROM pipe),
      'giro_rede_pct', (SELECT round(g * 100, 1) FROM rede),
      'giro_estreia_pct', (SELECT round(g * 100, 1) FROM estreia),
      'pontualidade_pct', (SELECT round(p * 100) FROM pont),
      'antecipacao_pct', (SELECT round(antecipa * 100) FROM pont),
      'indice_mes', (SELECT round(idx, 2) FROM idx_mes),
      'variacao_mensal_pct', (SELECT round(cv * 100) FROM giro_mensal)),
    'pecas', jsonb_build_object(
      'realizado', (SELECT round(pv) FROM mes),
      'pipeline', (SELECT round(pv) FROM pipe),
      'previsto', (SELECT round(mes.pv + pipe.pv) FROM mes, pipe),
      'faixa_min', (SELECT round(greatest(mes.pv, mes.pv + pipe.pv - 1.28 * pipe.sd_p)) FROM mes, pipe),
      'faixa_max', (SELECT round(mes.pv + pipe.pv + 1.28 * pipe.sd_p) FROM mes, pipe),
      'ritmo', (SELECT round(coalesce(ritmo.pv * idx_mes.idx / nullif(ritmo.idx_base, 0), ritmo.pv)) FROM ritmo, idx_mes),
      'giro_rede_pct', (SELECT round(gp * 100, 1) FROM rede)),
    'paradas', jsonb_build_object(
      'acertam_sem_proxima', (SELECT count(*) FROM risco),
      'previstas', (SELECT round(coalesce(sum(p_parar), 0)) FROM risco),
      'taxas', (SELECT coalesce(jsonb_agg(jsonb_build_object('faixa', faixa_n, 'giro', faixa_g, 'volta_pct', round(volta * 100), 'maletas', n)
                  ORDER BY faixa_n, array_position(ARRAY['zerada','fraca','média','forte'], faixa_g)), '[]'::jsonb) FROM ret),
      'risco', (SELECT coalesce(jsonb_agg(z.x ORDER BY z.prioridade DESC), '[]'::jsonb) FROM (
                  SELECT jsonb_build_object(
                           'nome', coalesce(p.display_name, lc.nome, 'Código ' || substr(r.k, 2)),
                           'codigo', coalesce(p.code, CASE WHEN r.k LIKE 'L%' THEN substr(r.k, 2) END),
                           'party_id', CASE WHEN r.k NOT LIKE 'L%' THEN r.k END,
                           'praca', pr.nome, 'representante', rp.display_name,
                           'maletas', r.n, 'giro_pct', round(r.giro * 100, 1), 'chance_parar_pct', round(r.p_parar * 100),
                           'vendido_12m_cents', round(r.vendido_12m)) AS x,
                         r.p_parar * (r.vendido_12m + 1) AS prioridade
                    FROM risco r
                    LEFT JOIN parties p ON r.k NOT LIKE 'L%' AND p.id = r.k::uuid
                    LEFT JOIN legado_consultoras lc ON r.k LIKE 'L%' AND lc.codcli = substr(r.k, 2)::int
                    LEFT JOIN consultant_profiles cp ON cp.party_id = p.id
                    LEFT JOIN cob_pracas pr ON pr.id = cp.praca_id
                    LEFT JOIN parties rp ON rp.id = cp.representative_party_id
                   WHERE r.p_parar >= 0.25
                   ORDER BY r.p_parar * (r.vendido_12m + 1) DESC LIMIT 25) z)),
    'novas', jsonb_build_object(
      'ate_agora', (SELECT count(*) FROM primeiras WHERE primeira BETWEEN ini AND hoje),
      'aberturas_pendentes', (SELECT pendentes FROM aberturas),
      'conversao_pct', (SELECT round(taxa * 100) FROM conv),
      'conversao_medida', (SELECT medida FROM conv),
      'previstas', (SELECT count(*) FROM primeiras WHERE primeira BETWEEN ini AND hoje)
                   + (SELECT round(a.pendentes * c.taxa) FROM aberturas a, conv c),
      'media_3m', (SELECT round(avg(n)) FROM novas_mes WHERE m >= ini - interval '3 months' AND m < ini)),
    'base', jsonb_build_object(
      'ativas_hoje', (SELECT ativas FROM base),
      'fim_do_mes', (SELECT ativas FROM base)
                    + (SELECT round(a.pendentes * c.taxa) FROM aberturas a, conv c)
                    - (SELECT round(coalesce(sum(p_parar), 0)) FROM risco)),
    'serie', (SELECT coalesce(jsonb_agg(jsonb_build_object('mes', s.m, 'vendido_cents', round(s.vend), 'pecas', round(s.pv),
                       'maletas', s.maletas, 'consultoras', s.consultoras, 'novas', coalesce(nm.n, 0)) ORDER BY s.m), '[]'::jsonb)
                FROM serie s LEFT JOIN novas_mes nm ON nm.m = s.m WHERE s.m >= ini - interval '12 months')
  ));
END $fn$;
REVOKE ALL ON FUNCTION public.previsibilidade_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.previsibilidade_painel() TO authenticated, service_role;