-- 0130 — Maleta perdida, pular acerto e maleta da remessa com o representante.
--
-- 1. MALETA PERDIDA (histórico do SmallData e maletas do Lardan)
--    • Baixa: a maleta sai de "aberta" e não gera nota fiscal.
--    • Fiado: a consultora fica devendo o varejo das peças que não voltaram. Vira um título a
--      receber (fora da DRE, conta FIADO-PERDA, como o fiado histórico) e uma linha de fiado no
--      cockpit dela. Um fiado por maleta: rodar de novo não duplica.
--    • SmallData: perdida = tipo "remessa perdida" ou situação 11. O processamento roda sozinho
--      a cada importação; consultora sem cadastro fica pendente e entra quando for ligada.
--    • Lardan: kit_maleta_perdida baixa o estoque da maleta (saída "perda"), encerra o ciclo e
--      gera o fiado.
--    • Cobrança ganha a lista cob_maletas_perdidas (aba nova).
-- 2. PULAR ACERTO: muda o vencimento da maleta para o próximo acerto da mesma praça (ou para a
--    data informada), com motivo e registro. Vale para maleta do Lardan e do SmallData.
-- 3. MALETA COM O REPRESENTANTE: a remessa pode abrir maleta sem consultora, que sai para o
--    representante. Depois, no portal dele, o representante passa a maleta para uma consultora
--    ou candidata da carteira dele (a candidata vira consultora) e a maleta segue o fluxo normal
--    (entrega, aceite e termo assinado).
-- Nada é apagado; nenhuma coluna removida.

-- =========================================================== 1. PERDIDAS ===
CREATE TABLE IF NOT EXISTS public.maletas_perdidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem text NOT NULL CHECK (origem IN ('smalldata', 'lardan')),
  remessa int,
  codcli int,
  cycle_id uuid UNIQUE REFERENCES public.kit_cycles(id),
  party_id uuid REFERENCES public.parties(id),
  data_perda date NOT NULL,
  pecas int NOT NULL DEFAULT 0,
  valor_cents bigint NOT NULL DEFAULT 0,
  title_id uuid REFERENCES public.financial_titles(id),
  situacao text NOT NULL CHECK (situacao IN ('fiado_gerado', 'sem_cadastro', 'sem_valor')),
  ja_tinha_fiado boolean NOT NULL DEFAULT false,
  motivo text,
  autor uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS maletas_perdidas_smalldata_key ON public.maletas_perdidas (remessa, codcli) WHERE origem = 'smalldata';
CREATE INDEX IF NOT EXISTS maletas_perdidas_party_idx ON public.maletas_perdidas (party_id);
ALTER TABLE public.maletas_perdidas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maletas_perdidas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.maletas_perdidas TO service_role;

CREATE SEQUENCE IF NOT EXISTS public.maletas_perdidas_linha_seq;

-- Fiado de uma perdida (idempotente: um título por maleta)
CREATE OR REPLACE FUNCTION public.maleta_perdida_fiado(_perdida uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE mp maletas_perdidas; v_ent uuid; v_conta uuid; v_title uuid; v_ref text; v_desc text; v_praca uuid; v_rep uuid;
BEGIN
  SELECT * INTO mp FROM maletas_perdidas WHERE id = _perdida FOR UPDATE;
  IF mp.id IS NULL THEN RAISE EXCEPTION 'Maleta perdida não encontrada.'; END IF;
  IF mp.title_id IS NOT NULL THEN RETURN mp.title_id; END IF;
  IF mp.party_id IS NULL THEN
    UPDATE maletas_perdidas SET situacao = 'sem_cadastro', atualizado_em = now() WHERE id = mp.id;
    RETURN NULL;
  END IF;
  IF coalesce(mp.valor_cents, 0) <= 0 THEN
    UPDATE maletas_perdidas SET situacao = 'sem_valor', atualizado_em = now() WHERE id = mp.id;
    RETURN NULL;
  END IF;

  v_ent := coalesce((SELECT business_entity_id FROM chart_of_accounts WHERE codigo = 'FIADO-HIST' LIMIT 1),
                    (SELECT business_entity_id FROM consultora_cobranca_config WHERE id LIMIT 1),
                    (SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] END FROM business_entities));
  INSERT INTO chart_of_accounts (business_entity_id, codigo, nome, natureza)
  SELECT v_ent, 'FIADO-PERDA', 'Fiado de maleta perdida (a receber da consultora)', 'ativo'
   WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE codigo = 'FIADO-PERDA');
  SELECT id INTO v_conta FROM chart_of_accounts WHERE codigo = 'FIADO-PERDA' LIMIT 1;

  v_ref := CASE WHEN mp.origem = 'lardan' THEN 'lardan:' || mp.cycle_id ELSE 'smalldata:' || mp.remessa || ':' || mp.codcli END;
  v_desc := 'Maleta perdida — ' || CASE WHEN mp.origem = 'lardan' THEN 'remessa ' || coalesce((SELECT r.numero::text FROM kit_cycles c JOIN remessas r ON r.id = c.remessa_id WHERE c.id = mp.cycle_id), 'Lardan')
                                         ELSE 'remessa ' || mp.remessa || ' (SmallData)' END;

  SELECT id INTO v_title FROM financial_titles WHERE sistema_origem = 'maleta_perdida' AND id_externo = v_ref;
  IF v_title IS NULL THEN
    INSERT INTO financial_titles (direction, business_entity_id, party_id, pagador_party_id, descricao, emissao, competencia, valor_cents,
                                  chart_account_id, origem, sistema_origem, id_externo, observacao, status)
    VALUES ('receivable', v_ent, mp.party_id, mp.party_id, v_desc, current_date, current_date, mp.valor_cents,
            v_conta, 'maleta_perdida', 'maleta_perdida', v_ref,
            'Varejo das peças que não voltaram (' || mp.pecas || ' peças). Perda em ' || to_char(mp.data_perda, 'DD/MM/YYYY') || '. Sem nota fiscal.',
            'ativo')
    RETURNING id INTO v_title;
    INSERT INTO financial_installments (title_id, numero, total_parcelas, vencimento, valor_cents) VALUES (v_title, 1, 1, mp.data_perda, mp.valor_cents);
    INSERT INTO financial_title_events (title_id, evento, payload)
    VALUES (v_title, 'criado', jsonb_build_object('valor_cents', mp.valor_cents, 'origem', 'maleta_perdida', 'maleta', v_ref));
  END IF;

  SELECT praca_id, representative_party_id INTO v_praca, v_rep FROM consultant_profiles WHERE party_id = mp.party_id;
  IF NOT EXISTS (SELECT 1 FROM cob_fiado_linhas WHERE title_id = v_title) THEN
    INSERT INTO cob_fiado_linhas (lote, linha, payload, party_id, title_id, representante_party_id, praca_id, data_cobranca, vencimento, parcela, valor_cents, situacao, motivo)
    VALUES ('maleta_perdida', nextval('maletas_perdidas_linha_seq')::int,
            jsonb_build_object('origem', mp.origem, 'remessa', mp.remessa, 'codcli', mp.codcli, 'cycle_id', mp.cycle_id, 'pecas', mp.pecas),
            mp.party_id, v_title, v_rep, v_praca, mp.data_perda, mp.data_perda, 1, mp.valor_cents, 'importada', 'Maleta perdida');
  END IF;
  UPDATE maletas_perdidas SET title_id = v_title, situacao = 'fiado_gerado', atualizado_em = now() WHERE id = mp.id;
  RETURN v_title;
END $fn$;
REVOKE ALL ON FUNCTION public.maleta_perdida_fiado(uuid) FROM PUBLIC, anon, authenticated;

-- SmallData: registra as perdidas e gera os fiados (prévia por padrão)
CREATE OR REPLACE FUNCTION public.maletas_perdidas_smalldata_processar(_aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := auth.uid(); r record; novos int := 0; fiados int := 0;
BEGIN
  IF uid IS NOT NULL AND NOT (public.cob_pode(uid) OR public.has_capability(uid, 'kit.manage')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _mp (remessa int, codcli int, party_id uuid, data_perda date, pecas int, valor_cents bigint, ja_tinha_fiado boolean,
                                       PRIMARY KEY (remessa, codcli)) ON COMMIT DROP;
  TRUNCATE _mp;
  INSERT INTO _mp
  SELECT m.remessa, m.codcli,
         coalesce((SELECT lc.party_id FROM legado_consultoras lc WHERE lc.codcli = m.codcli),
                  (SELECT l.party_id FROM party_codigos_legados l WHERE l.sistema = 'cliente' AND l.codigo = m.codcli::text LIMIT 1)),
         coalesce(max(s.data), max(lr.vencimento), max(m.emissao), current_date),
         sum(greatest(coalesce(m.pecas_enviadas, 0) - coalesce(m.pecas_devolvidas, 0), 0))::int,
         sum(greatest(coalesce(m.valor_enviado_cents, 0) - coalesce(m.valor_devolvido_cents, 0), 0))::bigint,
         false
    FROM legado_maletas m
    LEFT JOIN legado_remessas lr ON lr.numero = m.remessa
    LEFT JOIN legado_maleta_status s ON s.remessa = m.remessa AND s.codcli = m.codcli
   WHERE m.tipo = 'perdida' OR s.status = 11
   GROUP BY m.remessa, m.codcli;
  UPDATE _mp SET ja_tinha_fiado = EXISTS (SELECT 1 FROM cob_fiado_linhas f WHERE f.party_id = _mp.party_id AND f.lote <> 'maleta_perdida')
   WHERE party_id IS NOT NULL;

  IF _aplicar THEN
    INSERT INTO maletas_perdidas (origem, remessa, codcli, party_id, data_perda, pecas, valor_cents, situacao, ja_tinha_fiado, motivo, autor)
    SELECT 'smalldata', remessa, codcli, party_id, data_perda, pecas, valor_cents,
           CASE WHEN party_id IS NULL THEN 'sem_cadastro' WHEN valor_cents <= 0 THEN 'sem_valor' ELSE 'sem_cadastro' END,
           ja_tinha_fiado, 'Remessa perdida no SmallData', uid
      FROM _mp
    ON CONFLICT (remessa, codcli) WHERE origem = 'smalldata' DO UPDATE
       SET party_id = coalesce(maletas_perdidas.party_id, excluded.party_id),
           pecas = CASE WHEN maletas_perdidas.title_id IS NULL THEN excluded.pecas ELSE maletas_perdidas.pecas END,
           valor_cents = CASE WHEN maletas_perdidas.title_id IS NULL THEN excluded.valor_cents ELSE maletas_perdidas.valor_cents END,
           ja_tinha_fiado = excluded.ja_tinha_fiado, atualizado_em = now();
    GET DIAGNOSTICS novos = ROW_COUNT;
    FOR r IN SELECT id FROM maletas_perdidas WHERE origem = 'smalldata' AND title_id IS NULL AND party_id IS NOT NULL AND valor_cents > 0 LOOP
      IF public.maleta_perdida_fiado(r.id) IS NOT NULL THEN fiados := fiados + 1; END IF;
    END LOOP;
    UPDATE maletas_perdidas SET situacao = 'sem_cadastro', atualizado_em = now() WHERE origem = 'smalldata' AND title_id IS NULL AND party_id IS NULL AND situacao <> 'sem_cadastro';
    UPDATE maletas_perdidas SET situacao = 'sem_valor', atualizado_em = now() WHERE origem = 'smalldata' AND title_id IS NULL AND party_id IS NOT NULL AND valor_cents <= 0 AND situacao <> 'sem_valor';
    IF fiados > 0 OR uid IS NOT NULL THEN
      INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
      VALUES (uid, 'cobranca.maletas_perdidas_processar', 'maletas_perdidas', 'smalldata', jsonb_build_object('registradas', novos, 'fiados_gerados', fiados));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'aplicado', _aplicar,
    'perdidas', (SELECT count(*) FROM _mp),
    'consultoras', (SELECT count(DISTINCT codcli) FROM _mp),
    'valor_cents', (SELECT coalesce(sum(valor_cents), 0) FROM _mp),
    'com_cadastro', (SELECT count(*) FROM _mp WHERE party_id IS NOT NULL),
    'sem_cadastro', (SELECT count(*) FROM _mp WHERE party_id IS NULL),
    'sem_valor', (SELECT count(*) FROM _mp WHERE valor_cents <= 0),
    'ja_tinham_fiado', (SELECT count(*) FROM _mp WHERE ja_tinha_fiado),
    'fiados_ja_gerados', (SELECT count(*) FROM maletas_perdidas WHERE origem = 'smalldata' AND title_id IS NOT NULL),
    'fiados_gerados_agora', fiados);
END $fn$;
REVOKE ALL ON FUNCTION public.maletas_perdidas_smalldata_processar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maletas_perdidas_smalldata_processar(boolean) TO authenticated, service_role;

-- Roda sozinho a cada importação do histórico (situação, maletas) e quando a consultora ganha cadastro
CREATE OR REPLACE FUNCTION public.maletas_perdidas_apos_importar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM public.maletas_perdidas_smalldata_processar(true);
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.maletas_perdidas_apos_importar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS maletas_perdidas_status ON public.legado_maleta_status;
CREATE TRIGGER maletas_perdidas_status AFTER INSERT OR UPDATE ON public.legado_maleta_status
  FOR EACH STATEMENT EXECUTE FUNCTION public.maletas_perdidas_apos_importar();
DROP TRIGGER IF EXISTS maletas_perdidas_maletas ON public.legado_maletas;
CREATE TRIGGER maletas_perdidas_maletas AFTER INSERT ON public.legado_maletas
  FOR EACH STATEMENT EXECUTE FUNCTION public.maletas_perdidas_apos_importar();
DROP TRIGGER IF EXISTS maletas_perdidas_cadastro ON public.legado_consultoras;
CREATE TRIGGER maletas_perdidas_cadastro AFTER UPDATE OF party_id ON public.legado_consultoras
  FOR EACH STATEMENT EXECUTE FUNCTION public.maletas_perdidas_apos_importar();

-- Lardan: dar baixa na maleta como perdida
CREATE OR REPLACE FUNCTION public.kit_maleta_perdida(_cycle uuid, _motivo text, _data date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := auth.uid(); c kit_cycles; loc uuid; it record; pecas int := 0; valor bigint := 0; mp uuid; tit uuid; k text;
BEGIN
  IF uid IS NULL OR NOT (public.has_capability(uid, 'kit.manage') OR public.cob_pode(uid)) THEN
    RAISE EXCEPTION 'Sem permissão para dar baixa em maleta.' USING errcode = '42501';
  END IF;
  IF coalesce(btrim(_motivo), '') = '' THEN RAISE EXCEPTION 'Informe o motivo da perda.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM maletas_perdidas WHERE cycle_id = c.id) THEN
    RETURN (SELECT jsonb_build_object('perdida_id', id, 'title_id', title_id, 'repetida', true) FROM maletas_perdidas WHERE cycle_id = c.id);
  END IF;
  IF c.status NOT IN ('recebida', 'operacao', 'acerto') OR c.consultora_party_id IS NULL THEN
    RAISE EXCEPTION 'Só maleta com a consultora pode ser dada como perdida.';
  END IF;
  IF EXISTS (SELECT 1 FROM kit_balances b WHERE b.cycle_id = c.id AND b.qty_return_transit > 0) THEN
    RAISE EXCEPTION 'Há retorno em trânsito nesta maleta: confirme o retorno antes.';
  END IF;
  SELECT code INTO k FROM kits WHERE id = c.kit_id;
  loc := public.kit_location_ensure(c.kit_id);

  -- tudo o que ainda está na maleta sai do estoque como perda; a maleta guarda a quantidade perdida
  PERFORM set_config('lardan.kit_stock', 'on', true);   -- movimento interno da maleta (como no retorno)
  FOR it IN SELECT b.variant_id, greatest(b.qty_available + b.qty_reserved, 0) q FROM kit_balances b WHERE b.cycle_id = c.id LOOP
    CONTINUE WHEN it.q <= 0;
    IF coalesce((SELECT quantity FROM stock_balances WHERE variant_id = it.variant_id AND location_id = loc), 0) >= it.q THEN
      PERFORM public.register_stock_movement('saida'::stock_move_kind, it.variant_id, it.q, loc, NULL, 'perda', NULL,
        'maleta:' || c.id::text, 'Maleta perdida — ' || btrim(_motivo), 'maleta-perdida:' || c.id::text || ':' || it.variant_id::text, NULL);
    END IF;
    UPDATE kit_balances SET qty_lost = qty_lost + it.q, qty_reserved = 0, updated_at = now() WHERE cycle_id = c.id AND variant_id = it.variant_id;
    pecas := pecas + it.q;
    valor := valor + it.q::bigint * public.kit_reference_price(it.variant_id);
  END LOOP;
  PERFORM set_config('lardan.kit_stock', '', true);

  UPDATE kit_cycles SET status = 'encerrada', closed_at = now(), updated_by = uid,
         notes = concat_ws(E'\n', notes, 'Maleta perdida em ' || to_char(coalesce(_data, current_date), 'DD/MM/YYYY') || ': ' || btrim(_motivo))
   WHERE id = c.id;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (c.id, 'maleta.perdida', c.status, 'encerrada', uid,
          jsonb_build_object('motivo', btrim(_motivo), 'pecas', pecas, 'valor_cents', valor, 'nota_fiscal', false));

  INSERT INTO maletas_perdidas (origem, cycle_id, party_id, data_perda, pecas, valor_cents, situacao, motivo, autor,
                                ja_tinha_fiado)
  VALUES ('lardan', c.id, c.consultora_party_id, coalesce(_data, current_date), pecas, valor, 'sem_valor', btrim(_motivo), uid,
          EXISTS (SELECT 1 FROM cob_fiado_linhas f WHERE f.party_id = c.consultora_party_id))
  RETURNING id INTO mp;
  tit := public.maleta_perdida_fiado(mp);

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.perdida', 'kit_cycles', c.id::text, jsonb_build_object('maleta', k, 'pecas', pecas, 'valor_cents', valor, 'titulo', tit));
  RETURN jsonb_build_object('perdida_id', mp, 'title_id', tit, 'pecas', pecas, 'valor_cents', valor);
END $fn$;
REVOKE ALL ON FUNCTION public.kit_maleta_perdida(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_maleta_perdida(uuid, text, date) TO authenticated;

-- Aba da Cobrança: maletas perdidas
CREATE OR REPLACE FUNCTION public.cob_maletas_perdidas(_busca text DEFAULT NULL, _situacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE t text := nullif(btrim(coalesce(_busca, '')), '');
BEGIN
  IF NOT (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'kit.manage')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN (
    WITH l AS (
      SELECT mp.*, p.display_name nome, p.code codigo, cp.praca_id, pr.nome praca, rp.display_name representante,
             coalesce(mp.remessa, (SELECT r.numero FROM kit_cycles kc JOIN remessas r ON r.id = kc.remessa_id WHERE kc.id = mp.cycle_id)) remessa_num,
             (SELECT coalesce(sum(public.fin_installment_saldo(i.id)), 0) FROM financial_installments i WHERE i.title_id = mp.title_id) saldo_cents,
             (SELECT ft.numero FROM financial_titles ft WHERE ft.id = mp.title_id) titulo_numero,
             (SELECT lc.nome FROM legado_consultoras lc WHERE lc.codcli = mp.codcli) nome_smalldata
        FROM maletas_perdidas mp
        LEFT JOIN parties p ON p.id = mp.party_id
        LEFT JOIN consultant_profiles cp ON cp.party_id = mp.party_id
        LEFT JOIN cob_pracas pr ON pr.id = cp.praca_id
        LEFT JOIN parties rp ON rp.id = cp.representative_party_id)
    SELECT jsonb_build_object(
      'resumo', jsonb_build_object(
        'maletas', (SELECT count(*) FROM l), 'consultoras', (SELECT count(DISTINCT coalesce(party_id::text, 'c' || codcli)) FROM l),
        'valor_cents', (SELECT coalesce(sum(valor_cents), 0) FROM l),
        'em_aberto_cents', (SELECT coalesce(sum(saldo_cents), 0) FROM l),
        'sem_cadastro', (SELECT count(*) FROM l WHERE situacao = 'sem_cadastro'),
        'ja_tinham_fiado', (SELECT count(*) FROM l WHERE ja_tinha_fiado)),
      'lista', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'origem', origem, 'remessa', remessa_num, 'codcli', codcli, 'cycle_id', cycle_id, 'party_id', party_id,
          'consultora', coalesce(nome, nome_smalldata, 'Consultora ' || codcli), 'codigo', coalesce(codigo, codcli::text),
          'praca', praca, 'representante', representante, 'data_perda', data_perda, 'pecas', pecas, 'valor_cents', valor_cents,
          'saldo_cents', saldo_cents, 'titulo', titulo_numero, 'title_id', title_id, 'situacao', situacao, 'ja_tinha_fiado', ja_tinha_fiado,
          'motivo', motivo) ORDER BY data_perda DESC, nome)
        FROM l
       WHERE (_situacao IS NULL OR situacao = _situacao OR (_situacao = 'em_aberto' AND saldo_cents > 0))
         AND (t IS NULL OR public.fin_unaccent_lower(coalesce(nome, nome_smalldata, '') || ' ' || coalesce(codigo, '') || ' ' || coalesce(codcli::text, '') || ' ' || coalesce(remessa_num::text, ''))
                           LIKE '%' || public.fin_unaccent_lower(t) || '%')), '[]'::jsonb)));
END $fn$;
REVOKE ALL ON FUNCTION public.cob_maletas_perdidas(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_maletas_perdidas(text, text) TO authenticated;

-- ======================================================= 2. PULAR ACERTO ===
CREATE TABLE IF NOT EXISTS public.legado_maleta_vencimento (
  remessa int NOT NULL,
  codcli int NOT NULL,
  vencimento date NOT NULL,
  vencimento_original date,
  motivo text NOT NULL,
  autor uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (remessa, codcli)
);
ALTER TABLE public.legado_maleta_vencimento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_maleta_vencimento FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.legado_maleta_vencimento TO service_role;

CREATE OR REPLACE FUNCTION public.legado_maleta_vencimento_efetivo(_remessa int, _codcli int)
RETURNS date LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  SELECT coalesce((SELECT v.vencimento FROM legado_maleta_vencimento v WHERE v.remessa = _remessa AND v.codcli = _codcli),
                  (SELECT lr.vencimento FROM legado_remessas lr WHERE lr.numero = _remessa))
$fn$;
REVOKE ALL ON FUNCTION public.legado_maleta_vencimento_efetivo(int, int) FROM PUBLIC, anon, authenticated;

-- SmallData: pula para o próximo acerto da mesma praça (ou para a data informada)
CREATE OR REPLACE FUNCTION public.legado_maleta_pular_acerto(_remessa int, _codcli int, _motivo text, _nova date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := auth.uid(); lr legado_remessas; atual date; prox date;
BEGIN
  IF uid IS NULL OR NOT (public.cob_pode(uid) OR public.has_capability(uid, 'kit.manage')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF coalesce(btrim(_motivo), '') = '' THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  SELECT * INTO lr FROM legado_remessas WHERE numero = _remessa;
  IF lr.numero IS NULL OR NOT EXISTS (SELECT 1 FROM legado_maletas WHERE remessa = _remessa AND codcli = _codcli AND fechamento IS NULL) THEN
    RAISE EXCEPTION 'Maleta sem acerto não encontrada nesta remessa.';
  END IF;
  atual := public.legado_maleta_vencimento_efetivo(_remessa, _codcli);
  prox := coalesce(_nova, (SELECT min(o.vencimento) FROM legado_remessas o
                            WHERE o.praca IS NOT DISTINCT FROM lr.praca AND o.vencimento > coalesce(atual, lr.emissao)));
  IF prox IS NULL THEN RAISE EXCEPTION 'Não há próximo acerto cadastrado para esta praça: informe a nova data.'; END IF;
  IF prox <= coalesce(atual, '-infinity'::date) THEN RAISE EXCEPTION 'A nova data precisa ser depois do vencimento atual.'; END IF;
  INSERT INTO legado_maleta_vencimento (remessa, codcli, vencimento, vencimento_original, motivo, autor)
  VALUES (_remessa, _codcli, prox, lr.vencimento, btrim(_motivo), uid)
  ON CONFLICT (remessa, codcli) DO UPDATE SET vencimento = excluded.vencimento, motivo = excluded.motivo, autor = excluded.autor, criado_em = now();
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.acerto_adiado', 'legado_maletas', _remessa || ':' || _codcli,
          jsonb_build_object('de', atual, 'para', prox, 'motivo', btrim(_motivo), 'origem', 'smalldata'));
  RETURN jsonb_build_object('de', atual, 'para', prox);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_maleta_pular_acerto(int, int, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_maleta_pular_acerto(int, int, text, date) TO authenticated;

-- Lardan: pula para o acerto da próxima remessa da mesma praça (ou para a data informada)
CREATE OR REPLACE FUNCTION public.kit_pular_acerto(_cycle uuid, _motivo text, _nova date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := auth.uid(); c kit_cycles; r remessas; atual date; prox date;
BEGIN
  IF uid IS NULL OR NOT (public.has_capability(uid, 'kit.manage') OR public.cob_pode(uid)) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF coalesce(btrim(_motivo), '') = '' THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.status IN ('encerrada', 'cancelada') THEN RAISE EXCEPTION 'Esta maleta já foi encerrada.'; END IF;
  SELECT * INTO r FROM remessas WHERE id = c.remessa_id;
  atual := coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto);
  prox := coalesce(_nova, (SELECT min(o.data_acerto) FROM remessas o
                            WHERE o.praca_id = r.praca_id AND o.status <> 'cancelada' AND o.data_acerto > coalesce(atual, current_date)));
  IF prox IS NULL THEN RAISE EXCEPTION 'Não há próxima remessa com acerto nesta praça: informe a nova data.'; END IF;
  IF prox <= coalesce(atual, '-infinity'::date) THEN RAISE EXCEPTION 'A nova data precisa ser depois do vencimento atual.'; END IF;
  UPDATE kit_cycles SET due_at = (prox::timestamp AT TIME ZONE 'America/Sao_Paulo'), updated_by = uid, updated_at = now() WHERE id = c.id;
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (c.id, 'acerto.adiado', uid, jsonb_build_object('de', atual, 'para', prox, 'motivo', btrim(_motivo)));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.acerto_adiado', 'kit_cycles', c.id::text, jsonb_build_object('de', atual, 'para', prox, 'motivo', btrim(_motivo), 'origem', 'lardan'));
  RETURN jsonb_build_object('de', atual, 'para', prox);
END $fn$;
REVOKE ALL ON FUNCTION public.kit_pular_acerto(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_pular_acerto(uuid, text, date) TO authenticated;

-- ============================================ 3. MALETA COM O REPRESENTANTE ===
CREATE OR REPLACE FUNCTION public.remessa_abrir_maleta_representante(_remessa uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r remessas; v jsonb; v_cycle uuid;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para abrir maletas.'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.status IN ('fechada', 'cancelada') THEN RAISE EXCEPTION 'Esta remessa está %.', r.status; END IF;
  IF r.representante_party_id IS NULL THEN RAISE EXCEPTION 'Esta remessa não tem representante: escolha uma consultora.'; END IF;
  v := public.kit_cycle_create(jsonb_build_object(
    'representante_party_id', r.representante_party_id, 'origin_location_id', r.origin_location_id,
    'label', 'Remessa ' || r.numero || ' · com o representante',
    'due_at', CASE WHEN r.data_acerto IS NULL THEN NULL ELSE (r.data_acerto::timestamp AT TIME ZONE 'America/Sao_Paulo') END));
  v_cycle := (v->>'cycle_id')::uuid;
  UPDATE kit_cycles SET remessa_id = r.id WHERE id = v_cycle;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_abrir_maleta_representante', 'remessas', r.id::text,
          jsonb_build_object('numero', r.numero, 'cycle', v_cycle, 'representante', r.representante_party_id));
  RETURN v || jsonb_build_object('remessa_numero', r.numero);
END $fn$;
REVOKE ALL ON FUNCTION public.remessa_abrir_maleta_representante(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_abrir_maleta_representante(uuid) TO authenticated;

-- Portal: maletas do representante (a receber, com ele sem consultora, a caminho da consultora)
CREATE OR REPLACE FUNCTION public.rep_portal_maletas(_rep uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'a_receber', coalesce((SELECT jsonb_agg(jsonb_build_object('transfer_id', t.id, 'cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero,
        'consultora', pc.display_name, 'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents, 'enviada_em', t.shipped_at) ORDER BY t.shipped_at)
      FROM kit_transfers t JOIN kit_cycles c ON c.id = t.cycle_id JOIN kits k ON k.id = c.kit_id
      LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE t.to_party_id = _rep AND t.status = 'transito'), '[]'::jsonb),
    'sem_consultora', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'praca', pr.nome,
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents, 'acerto', coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto)) ORDER BY r.numero, k.code)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN cob_pracas pr ON pr.id = r.praca_id
     WHERE c.custodian_party_id = _rep AND c.consultora_party_id IS NULL AND c.status = 'transito'), '[]'::jsonb),
    'a_caminho', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'consultora', pc.display_name,
        'pecas', c.quantity_total) ORDER BY pc.display_name)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE c.custodian_party_id = _rep AND c.status = 'transito'
       AND EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.to_party_id = c.consultora_party_id AND t.status = 'transito')), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.rep_portal_maletas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_portal_maletas(uuid) TO authenticated;

-- Para quem o representante pode passar: consultoras da carteira e candidatas dele
CREATE OR REPLACE FUNCTION public.rep_maleta_destinatarias(_rep uuid, _busca text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE t text := public.fin_unaccent_lower(coalesce(btrim(_busca), ''));
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.tipo, x.nome) FROM (
    SELECT 'consultora' tipo, p.id::text id, p.display_name nome, p.code codigo,
           (SELECT a.city FROM party_addresses a WHERE a.party_id = p.id ORDER BY a.is_primary DESC LIMIT 1) cidade
      FROM consultant_profiles cp JOIN parties p ON p.id = cp.party_id
     WHERE cp.representative_party_id = _rep AND p.is_active AND p.status NOT IN ('inativo', 'bloqueado', 'desligado')
       AND (t = '' OR public.fin_unaccent_lower(p.display_name || ' ' || coalesce(p.code, '')) LIKE '%' || t || '%')
    UNION ALL
    SELECT 'candidata', l.id::text, l.full_name, l.protocol, l.city
      FROM leads l
     WHERE l.representante_party_id = _rep AND l.party_id IS NULL AND l.archived_at IS NULL AND l.lost_at IS NULL
       AND (t = '' OR public.fin_unaccent_lower(l.full_name) LIKE '%' || t || '%')
     LIMIT 300) x), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.rep_maleta_destinatarias(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_maleta_destinatarias(uuid, text) TO authenticated;

-- Representante passa a maleta que está com ele para uma consultora (ou candidata) da carteira
CREATE OR REPLACE FUNCTION public.rep_maleta_repassar(_rep uuid, _cycle uuid, _consultora uuid DEFAULT NULL, _lead uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := auth.uid(); c kit_cycles; r remessas; le leads; pid uuid; virou_consultora boolean := false; fw jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF (_consultora IS NULL) = (_lead IS NULL) THEN RAISE EXCEPTION 'Escolha uma consultora ou uma candidata.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL OR c.custodian_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta maleta não está com você.'; END IF;
  IF c.consultora_party_id IS NOT NULL THEN RAISE EXCEPTION 'Esta maleta já tem consultora.'; END IF;
  IF c.status <> 'transito' THEN RAISE EXCEPTION 'Confirme o recebimento da maleta antes de passar.'; END IF;
  SELECT * INTO r FROM remessas WHERE id = c.remessa_id;

  IF _consultora IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM consultant_profiles WHERE party_id = _consultora AND representative_party_id = _rep) THEN
      RAISE EXCEPTION 'Esta consultora não é da sua carteira.';
    END IF;
    pid := _consultora;
  ELSE
    SELECT * INTO le FROM leads WHERE id = _lead FOR UPDATE;
    IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não é sua.'; END IF;
    pid := le.party_id;
    IF pid IS NULL AND le.cpf_digits IS NOT NULL THEN
      SELECT id INTO pid FROM parties WHERE doc_digits = le.cpf_digits AND is_active ORDER BY created_at LIMIT 1;
    END IF;
    IF pid IS NULL THEN
      INSERT INTO parties (kind, display_name, legal_name, doc, doc_digits, status, created_by)
      VALUES ('pessoa', le.full_name, le.full_name, le.cpf, le.cpf_digits, 'em_analise', uid) RETURNING id INTO pid;
      INSERT INTO contact_points (party_id, kind, value, is_primary) VALUES (pid, 'whatsapp', le.whatsapp, true);
      INSERT INTO party_addresses (party_id, label, postal_code, street, street_number, no_number, city, uf, is_primary)
      VALUES (pid, 'Principal', le.postal_code, le.street, le.street_number, le.no_number, le.city, le.uf, true);
    END IF;
    INSERT INTO party_roles (party_id, role, status, started_at, created_by) VALUES (pid, 'candidata', 'aprovado', current_date, uid) ON CONFLICT DO NOTHING;
    UPDATE leads SET party_id = pid, status = 'aprovado', updated_at = now() WHERE id = le.id;
    INSERT INTO party_links (party_id, entity_type, entity_id) VALUES (pid, 'lead', le.id) ON CONFLICT DO NOTHING;
    INSERT INTO lead_events (lead_id, event_type, note, actor_id)
    VALUES (le.id, 'conversao', 'Recebeu maleta do representante (pessoa ' || pid::text || ')', uid);
    virou_consultora := true;
  END IF;

  -- a candidata vira consultora da carteira dele, na praça da remessa
  INSERT INTO party_roles (party_id, role, status, started_at, created_by) VALUES (pid, 'consultora', 'ativo', current_date, uid) ON CONFLICT DO NOTHING;
  INSERT INTO consultant_profiles (party_id, representative_party_id, praca_id, joined_at, origin)
  VALUES (pid, _rep, r.praca_id, current_date, 'Maleta do representante')
  ON CONFLICT (party_id) DO UPDATE SET representative_party_id = coalesce(consultant_profiles.representative_party_id, excluded.representative_party_id),
                                       praca_id = coalesce(consultant_profiles.praca_id, excluded.praca_id);

  UPDATE kit_cycles SET consultora_party_id = pid, updated_by = uid, updated_at = now() WHERE id = c.id;
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (c.id, 'maleta.repassada', uid, jsonb_build_object('representante', _rep, 'consultora', pid, 'candidata', _lead));
  fw := public.kit_transfer_forward(c.id, jsonb_build_object('note', 'Repasse do representante'));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.repasse_representante', 'kit_cycles', c.id::text, jsonb_build_object('representante', _rep, 'consultora', pid, 'candidata', _lead));
  RETURN jsonb_build_object('consultora_party_id', pid, 'nova_consultora', virou_consultora) || coalesce(fw, '{}'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.rep_maleta_repassar(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_maleta_repassar(uuid, uuid, uuid, uuid) TO authenticated;

-- vencimento adiado vale nos avisos (panorama e ficha da consultora)
DO $v$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.maletas_visibilidade(integer)'::regprocedure);
  IF position('legado_maleta_vencimento_efetivo' IN def) = 0 THEN
    novo := replace(def, 'SELECT m.*, lr.vencimento, lr.praca,', 'SELECT m.*, public.legado_maleta_vencimento_efetivo(m.remessa, m.codcli) vencimento, lr.praca,');
    IF novo = def THEN RAISE EXCEPTION 'maletas_visibilidade não tem o formato esperado.'; END IF;
    EXECUTE novo;
  END IF;
  def := pg_get_functiondef('public.consultora_maletas(uuid)'::regprocedure);
  IF position('legado_maleta_vencimento_efetivo' IN def) = 0 THEN
    novo := replace(def, $q$'vencimento', lr.vencimento,$q$,
      $q$'vencimento', public.legado_maleta_vencimento_efetivo(m.remessa, m.codcli), 'vencimento_original', lr.vencimento, 'codcli', m.codcli,$q$);
    novo := replace(novo, $q$'atrasada', lr.vencimento IS NOT NULL AND lr.vencimento < hoje$q$,
      $q$'atrasada', coalesce(public.legado_maleta_vencimento_efetivo(m.remessa, m.codcli) < hoje, false)$q$);
    IF position('vencimento_original' IN novo) = 0 OR position('legado_maleta_vencimento_efetivo(m.remessa, m.codcli) < hoje' IN novo) = 0 THEN
      RAISE EXCEPTION 'consultora_maletas não tem o formato esperado.';
    END IF;
    EXECUTE novo;
  END IF;
END $v$;

-- ================= 4. código do SmallData em lote: prévia mais rápida (0129 estourava o tempo) ===
CREATE OR REPLACE FUNCTION public.party_codigos_smalldata(_party uuid)
RETURNS TABLE (codigo text, ativo boolean) LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  SELECT x.codigo, bool_or(coalesce(lc.ativo, true)) ativo
    FROM (SELECT l.codigo FROM party_codigos_legados l WHERE l.party_id = _party AND l.sistema = 'cliente' AND l.codigo ~ '^\d{1,9}$'
          UNION
          SELECT lc.codcli::text FROM legado_consultoras lc WHERE lc.party_id = _party) x
    LEFT JOIN legado_consultoras lc ON lc.codcli = x.codigo::int
   GROUP BY x.codigo
$fn$;
REVOKE ALL ON FUNCTION public.party_codigos_smalldata(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.party_codigos_smalldata_adotar(_aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := auth.uid(); r record; feitos int := 0; falhas jsonb := '[]';
BEGIN
  IF uid IS NOT NULL AND NOT (public.has_role(uid, 'master') AND public.has_capability(uid, 'registry.manage')) THEN
    RAISE EXCEPTION 'Só o Master troca o código do cadastro.' USING errcode = '42501';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _cs (party_id uuid PRIMARY KEY, nome text, code text, codigos text[], ativos text[], sugerido text,
    representante boolean, ocupado boolean) ON COMMIT DROP;
  TRUNCATE _cs;
  -- tudo de uma vez (sem consulta por cadastro)
  WITH cods AS (
    SELECT l.party_id, l.codigo FROM party_codigos_legados l WHERE l.sistema = 'cliente' AND l.codigo ~ '^\d{1,9}$'
    UNION
    SELECT lc.party_id, lc.codcli::text FROM legado_consultoras lc WHERE lc.party_id IS NOT NULL),
  agg AS (
    SELECT c.party_id,
           array_agg(DISTINCT c.codigo) codigos,
           array_agg(DISTINCT c.codigo) FILTER (WHERE coalesce(lc.ativo, true)) ativos
      FROM cods c LEFT JOIN legado_consultoras lc ON lc.codcli = c.codigo::int
     GROUP BY c.party_id)
  INSERT INTO _cs (party_id, nome, code, codigos, ativos, representante)
  SELECT p.id, p.display_name, p.code, a.codigos, a.ativos,
         EXISTS (SELECT 1 FROM party_roles pr WHERE pr.party_id = p.id AND pr.role = 'representante' AND pr.ended_at IS NULL)
    FROM agg a JOIN parties p ON p.id = a.party_id;
  UPDATE _cs SET sugerido = CASE WHEN array_length(codigos, 1) = 1 THEN codigos[1] WHEN array_length(ativos, 1) = 1 THEN ativos[1] END;
  UPDATE _cs c SET ocupado = true FROM parties o WHERE o.code = c.sugerido AND o.id <> c.party_id;
  UPDATE _cs SET ocupado = false WHERE ocupado IS NULL;

  IF _aplicar THEN
    FOR r IN SELECT * FROM _cs WHERE sugerido IS NOT NULL AND code IS DISTINCT FROM sugerido AND NOT representante AND NOT ocupado LOOP
      BEGIN
        PERFORM public.party_codigo_smalldata_adotar(r.party_id, r.sugerido, 'código do SmallData (lote)');
        feitos := feitos + 1;
      EXCEPTION WHEN OTHERS THEN
        falhas := falhas || jsonb_build_object('cadastro', r.code, 'nome', r.nome, 'erro', SQLERRM);
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'aplicado', _aplicar,
    'ligados_ao_smalldata', (SELECT count(*) FROM _cs),
    'ja_com_codigo_smalldata', (SELECT count(*) FROM _cs WHERE code = ANY (codigos)),
    'a_trocar', (SELECT count(*) FROM _cs WHERE sugerido IS NOT NULL AND NOT (code = ANY (codigos)) AND NOT representante AND NOT ocupado),
    'trocados', feitos,
    'mais_de_um_codigo', (SELECT coalesce(jsonb_agg(jsonb_build_object('cadastro', code, 'nome', nome, 'codigos', codigos) ORDER BY nome), '[]')
                            FROM _cs WHERE sugerido IS NULL AND NOT (code = ANY (codigos))),
    'representantes_mantidos', (SELECT coalesce(jsonb_agg(jsonb_build_object('cadastro', code, 'nome', nome, 'codigos', codigos) ORDER BY nome), '[]')
                                  FROM _cs WHERE representante AND sugerido IS NOT NULL AND code IS DISTINCT FROM sugerido),
    'codigo_ja_usado_por_outro', (SELECT coalesce(jsonb_agg(jsonb_build_object('cadastro', code, 'nome', nome, 'codigo', sugerido) ORDER BY nome), '[]')
                                    FROM _cs WHERE ocupado AND code IS DISTINCT FROM sugerido),
    'amostra', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'de', code, 'para', sugerido)), '[]') FROM
                 (SELECT * FROM _cs WHERE sugerido IS NOT NULL AND code IS DISTINCT FROM sugerido AND NOT (code = ANY (codigos))
                    AND NOT representante AND NOT ocupado ORDER BY nome LIMIT 20) x),
    'falhas', falhas);
END $fn$;
REVOKE ALL ON FUNCTION public.party_codigos_smalldata_adotar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_codigos_smalldata_adotar(boolean) TO authenticated, service_role;
