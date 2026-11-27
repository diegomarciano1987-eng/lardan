CREATE OR REPLACE FUNCTION public.painel_carteira_vencida()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT (public.has_capability(auth.uid(), 'finance.view') OR public.cob_pode_ler(auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão para ver a carteira.' USING errcode = '42501';
  END IF;
  WITH v AS (
    SELECT x.party_id, x.saldo_cents, hoje - x.vencimento AS atraso
      FROM public.cob_parcelas_abertas() x WHERE x.saldo_cents > 0
  )
  SELECT jsonb_build_object(
    'data', hoje,
    'vencido_cents', coalesce(sum(saldo_cents) FILTER (WHERE atraso > 0), 0),
    'a_vencer_cents', coalesce(sum(saldo_cents) FILTER (WHERE atraso <= 0), 0),
    'carteira_cents', coalesce(sum(saldo_cents), 0),
    'devedoras', count(DISTINCT party_id),
    'devedoras_vencidas', count(DISTINCT party_id) FILTER (WHERE atraso > 0),
    'faixas', jsonb_build_array(
      jsonb_build_object('faixa', '1-30', 'rotulo', '1 a 30 dias', 'cents', coalesce(sum(saldo_cents) FILTER (WHERE atraso BETWEEN 1 AND 30), 0), 'parcelas', count(*) FILTER (WHERE atraso BETWEEN 1 AND 30)),
      jsonb_build_object('faixa', '31-90', 'rotulo', '31 a 90 dias', 'cents', coalesce(sum(saldo_cents) FILTER (WHERE atraso BETWEEN 31 AND 90), 0), 'parcelas', count(*) FILTER (WHERE atraso BETWEEN 31 AND 90)),
      jsonb_build_object('faixa', '91-180', 'rotulo', '91 a 180 dias', 'cents', coalesce(sum(saldo_cents) FILTER (WHERE atraso BETWEEN 91 AND 180), 0), 'parcelas', count(*) FILTER (WHERE atraso BETWEEN 91 AND 180)),
      jsonb_build_object('faixa', '181+', 'rotulo', 'Mais de 180 dias', 'cents', coalesce(sum(saldo_cents) FILTER (WHERE atraso > 180), 0), 'parcelas', count(*) FILTER (WHERE atraso > 180))
    ))
  INTO r FROM v;
  RETURN r || jsonb_build_object('inadimplencia_pct',
    CASE WHEN (r->>'carteira_cents')::numeric = 0 THEN 0
         ELSE round(100 * (r->>'vencido_cents')::numeric / (r->>'carteira_cents')::numeric, 1) END);
END $$;
REVOKE ALL ON FUNCTION public.painel_carteira_vencida() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.painel_carteira_vencida() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stock_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN NOT public.has_capability(auth.uid(), 'stock.view') THEN '{}'::jsonb ELSE jsonb_build_object(
    'locais', (SELECT count(*) FROM public.locations WHERE is_active),
    'pecas_com_saldo', (SELECT count(*) FROM public.stock_balances WHERE quantity > 0),
    'unidades', (SELECT COALESCE(sum(quantity), 0) FROM public.stock_balances WHERE quantity > 0),
    'unidades_liquidas', (SELECT COALESCE(sum(quantity), 0) FROM public.stock_balances),
    'negativos', (SELECT count(*) FROM public.stock_balances WHERE quantity < 0),
    'faltam_contar', (SELECT COALESCE(-sum(quantity), 0) FROM public.stock_balances WHERE quantity < 0),
    'locais_com_negativo', (SELECT count(DISTINCT location_id) FROM public.stock_balances WHERE quantity < 0),
    'negativos_por_local', (SELECT coalesce(jsonb_agg(x ORDER BY x.saldos DESC), '[]'::jsonb) FROM (
        SELECT l.name AS local, count(*) AS saldos, -sum(b.quantity) AS unidades
          FROM public.stock_balances b JOIN public.locations l ON l.id = b.location_id
         WHERE b.quantity < 0 GROUP BY l.name ORDER BY count(*) DESC LIMIT 5) x),
    'movimentos_7d', (SELECT count(*) FROM public.stock_movements WHERE created_at > now() - interval '7 days')
  ) END
$$;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.network_geo_overview'::regproc); antes := def;
  IF position('com_maleta_90d' IN def) = 0 THEN
    def := replace(def, $a$      count(*) filter (where status in ('bloqueado','inativo','desligado')) inativas,$a$,
      $b$      count(*) filter (where status in ('bloqueado','inativo','desligado')) inativas,
      count(*) filter (where exists (select 1 from public.kit_cycles k where k.consultora_party_id = base.party_id
        and k.status not in ('rascunho','montagem','cancelada')
        and (k.closed_at is null or k.closed_at > now() - interval '90 days'))) com_maleta_90d,$b$);
    IF def = antes THEN RAISE EXCEPTION '0408: ponto não encontrado em network_geo_overview'; END IF;
    EXECUTE def;
  END IF;
END $do$;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.cob_regua_executar()'::regprocedure); antes := def;
  IF position('Substituída pela etapa seguinte da régua' IN def) = 0 THEN
    def := replace(def, $a$  GET DIAGNOSTICS criadas = ROW_COUNT;
  RETURN$a$, $b$  GET DIAGNOSTICS criadas = ROW_COUNT;
  -- 0408: só a etapa mais avançada da régua fica aberta por pessoa
  UPDATE cob_tarefas t SET status='cancelada', motivo_fim='Substituída pela etapa seguinte da régua'
   WHERE t.status='aberta' AND t.origem='regua'
     AND EXISTS (SELECT 1 FROM cob_tarefas n WHERE n.party_id=t.party_id AND n.status='aberta' AND n.origem='regua'
                   AND coalesce(n.regua_dias,0) > coalesce(t.regua_dias,0));
  RETURN$b$);
    IF def = antes THEN RAISE EXCEPTION '0408: ponto não encontrado em cob_regua_executar'; END IF;
    EXECUTE def;
  END IF;
END $do$;

WITH c AS (
  UPDATE public.cob_tarefas t SET status='cancelada', motivo_fim='Substituída pela etapa seguinte da régua'
   WHERE t.status='aberta' AND t.origem='regua'
     AND EXISTS (SELECT 1 FROM public.cob_tarefas n WHERE n.party_id=t.party_id AND n.status='aberta' AND n.origem='regua'
                   AND coalesce(n.regua_dias,0) > coalesce(t.regua_dias,0))
  RETURNING 1)
INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
SELECT NULL, 'cob.regua.etapas_substituidas', 'cob_tarefas', NULL, jsonb_build_object('tarefas', count(*), 'migracao', '0408')
  FROM c HAVING count(*) > 0;

CREATE OR REPLACE FUNCTION public.cob_dia_util(_base date, _n integer)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT d::date FROM generate_series(_base, _base + (greatest(_n, 0) * 2 + 7), interval '1 day') d
   WHERE extract(isodow FROM d) < 6 ORDER BY d OFFSET greatest(_n, 0) LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.cob_dia_util(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_dia_util(date, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cob_prioridade(_vencido_cents bigint, _maior_atraso integer)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(_vencido_cents, 0)::numeric * CASE
    WHEN coalesce(_maior_atraso, 0) <= 30 THEN 1.0
    WHEN _maior_atraso <= 90 THEN 0.6
    WHEN _maior_atraso <= 180 THEN 0.3
    ELSE 0.1 END
$$;
GRANT EXECUTE ON FUNCTION public.cob_prioridade(bigint, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cob_agenda_reorganizar(_por_dia integer DEFAULT 40)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; n integer; ultimo date; pd integer := least(greatest(coalesce(_por_dia, 40), 5), 500);
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança' USING errcode = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cob_agenda_reorganizar', 0));
  WITH alvo AS (
    SELECT t.id, row_number() OVER (ORDER BY public.cob_prioridade(c.vencido_cents, c.maior_atraso) DESC, t.vence_em, t.id) - 1 AS pos
      FROM public.cob_tarefas t
      JOIN public.cob_carteira2() c ON c.party_id = t.party_id
     WHERE t.status = 'aberta' AND t.origem = 'regua' AND t.vence_em < hoje
  ), up AS (
    UPDATE public.cob_tarefas t SET vence_em = public.cob_dia_util(hoje, (a.pos / pd)::integer)
      FROM alvo a WHERE a.id = t.id
    RETURNING t.vence_em
  )
  SELECT count(*), max(vence_em) INTO n, ultimo FROM up;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'cob.agenda.reorganizada', 'cob_tarefas', NULL, jsonb_build_object('tarefas', n, 'por_dia', pd, 'ate', ultimo));
  RETURN jsonb_build_object('reorganizadas', n, 'por_dia', pd, 'ate', ultimo);
END $$;
REVOKE ALL ON FUNCTION public.cob_agenda_reorganizar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_agenda_reorganizar(integer) TO authenticated;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.qualidade_troca_buscar(text,text,integer,integer)'::regprocedure); antes := def;
  IF position('paradas15' IN def) = 0 THEN
    def := replace(def, $a$OR (_status='novidades' AND q.novidade_lardan))$a$,
      $b$OR (_status='novidades' AND q.novidade_lardan)
      OR (_status IN ('paradas15','paradas30') AND q.status IN ('aberta','em_analise','aguardando_envio')
          AND q.aberto_em < now() - make_interval(days => CASE WHEN _status='paradas15' THEN 15 ELSE 30 END)))$b$);
    IF def = antes OR (length(def) - length(replace(def, 'paradas15', ''))) / length('paradas15') < 4 THEN
      RAISE EXCEPTION '0408: pontos não encontrados em qualidade_troca_buscar';
    END IF;
    EXECUTE def;
  END IF;
END $do$;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.qualidade_troca_resumo()'::regprocedure); antes := def;
  IF position('paradas15' IN def) = 0 THEN
    def := replace(def, $a$'abertas_mais_30d',count(*)$a$,
      $b$'paradas15',count(*) FILTER (WHERE status IN ('aberta','em_analise','aguardando_envio') AND aberto_em < now()-interval '15 days'),
    'paradas30',count(*) FILTER (WHERE status IN ('aberta','em_analise','aguardando_envio') AND aberto_em < now()-interval '30 days'),
    'abertas_mais_30d',count(*)$b$);
    IF def = antes THEN RAISE EXCEPTION '0408: ponto não encontrado em qualidade_troca_resumo'; END IF;
    EXECUTE def;
  END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.qualidade_troca_praca_padrao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.praca_nome IS NULL THEN
    SELECT pc.codigo, pc.nome INTO NEW.praca_codigo, NEW.praca_nome
      FROM public.consultant_profiles cp JOIN public.cob_pracas pc ON pc.id = cp.praca_id
     WHERE cp.party_id = NEW.consultora_party_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_praca_padrao() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS qualidade_troca_praca_padrao ON public.qualidade_trocas;
CREATE TRIGGER qualidade_troca_praca_padrao BEFORE INSERT ON public.qualidade_trocas
  FOR EACH ROW EXECUTE FUNCTION public.qualidade_troca_praca_padrao();

UPDATE public.qualidade_trocas q SET praca_codigo = pc.codigo, praca_nome = pc.nome
  FROM public.consultant_profiles cp JOIN public.cob_pracas pc ON pc.id = cp.praca_id
 WHERE cp.party_id = q.consultora_party_id AND q.praca_nome IS NULL
   AND q.status IN ('aberta','em_analise','aguardando_envio');

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.showcase_counts()'::regprocedure); antes := def;
  IF position('sem_descricao' IN def) = 0 THEN
    def := replace(def, $a$'sem_imagem', (SELECT count(*) FROM base WHERE NOT tem_imagem),$a$,
      $b$'sem_descricao', (SELECT count(*) FROM base WHERE btrim(coalesce(description,'')) = ''),
    'sem_imagem', (SELECT count(*) FROM base WHERE NOT tem_imagem),$b$);
    IF def = antes THEN RAISE EXCEPTION '0408: ponto não encontrado em showcase_counts'; END IF;
    EXECUTE def;
  END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.registry_incompletos(_falta text DEFAULT NULL, _limite integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE res jsonb; total integer;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  WITH base AS (
    SELECT p.id, p.code, p.kind, coalesce(nullif(btrim(p.display_name), ''), p.legal_name) AS nome, p.updated_at,
           (p.display_name IS NULL OR btrim(p.display_name) = '') AS sem_nome,
           (p.doc_digits IS NULL) AS sem_documento,
           NOT EXISTS (SELECT 1 FROM public.colab_v_contact_points c WHERE c.party_id = p.id) AS sem_contato,
           (SELECT string_agg(DISTINCT r.role::text, ', ') FROM public.colab_v_party_roles r WHERE r.party_id = p.id) AS papeis
      FROM public.colab_v_parties p
  ), f AS (
    SELECT * FROM base WHERE (sem_nome OR sem_documento OR sem_contato)
      AND (coalesce(_falta, '') = ''
           OR (_falta = 'nome' AND sem_nome) OR (_falta = 'documento' AND sem_documento) OR (_falta = 'contato' AND sem_contato))
  )
  SELECT (SELECT count(*) FROM f),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'codigo', code, 'tipo', kind, 'nome', nome, 'papeis', papeis,
                    'faltando', array_remove(ARRAY[CASE WHEN sem_nome THEN 'nome' END, CASE WHEN sem_documento THEN 'documento' END,
                                                  CASE WHEN sem_contato THEN 'contato' END], NULL)) ORDER BY x.updated_at DESC)
                   FROM (SELECT * FROM f ORDER BY updated_at DESC
                          LIMIT least(greatest(coalesce(_limite, 50), 1), 200) OFFSET greatest(coalesce(_offset, 0), 0)) x), '[]'::jsonb)
    INTO total, res;
  RETURN jsonb_build_object('total', total, 'itens', res);
END $$;
REVOKE ALL ON FUNCTION public.registry_incompletos(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registry_incompletos(text, integer, integer) TO authenticated;