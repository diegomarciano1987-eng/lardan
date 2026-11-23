-- 0369 (Diego, 23/11/2026) — Transferência entre contas próprias a partir do extrato.
-- 1) Mesa: "Transferência entre contas" cria a transferência oficial (sem receita/despesa) e já confere a linha
--    e, se houver, a linha da outra conta. 2) Rotina automática pareia saída × entrada entre contas da empresa
--    somente quando OS DOIS lados citam o CNPJ/razão social da empresa e o par é único (valor igual, até 3 dias).
-- Tudo registrado em fin_transferencias_extrato e desfazível com motivo; par desfeito nunca é refeito sozinho.

ALTER TABLE public.asaas_auto_config ADD COLUMN IF NOT EXISTS transferencias_ligado boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.asaas_auto_config.transferencias_ligado IS
  '0369: pareamento automático de transferências entre contas próprias (CNPJ/razão social dos dois lados, par único).';

CREATE TABLE IF NOT EXISTS public.fin_transferencias_extrato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem text NOT NULL CHECK (origem IN ('automatico','mesa')),
  modo text NOT NULL CHECK (modo IN ('nova','existente')),
  transfer_id uuid NOT NULL REFERENCES public.financial_transfers(id),
  line_saida uuid REFERENCES public.financial_statement_lines(id),
  line_entrada uuid REFERENCES public.financial_statement_lines(id),
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  motivo text NOT NULL,
  actor_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz, desfeito_por uuid, desfeito_motivo text,
  estorno_transfer_id uuid REFERENCES public.financial_transfers(id),
  CHECK (line_saida IS NOT NULL OR line_entrada IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS fin_transferencias_extrato_saida_ix ON public.fin_transferencias_extrato (line_saida);
CREATE INDEX IF NOT EXISTS fin_transferencias_extrato_entrada_ix ON public.fin_transferencias_extrato (line_entrada);
CREATE INDEX IF NOT EXISTS fin_transferencias_extrato_criado_ix ON public.fin_transferencias_extrato (criado_em DESC);
GRANT SELECT ON public.fin_transferencias_extrato TO authenticated;
GRANT ALL ON public.fin_transferencias_extrato TO service_role;
ALTER TABLE public.fin_transferencias_extrato ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_transferencias_extrato_ler ON public.fin_transferencias_extrato;
CREATE POLICY fin_transferencias_extrato_ler ON public.fin_transferencias_extrato FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.statement.view')));
COMMENT ON TABLE public.fin_transferencias_extrato IS
  '0369: transferências entre contas próprias criadas/ligadas a partir do extrato (Mesa ou rotina). Desfazer estorna a transferência criada e devolve as linhas para pendente.';

CREATE OR REPLACE FUNCTION public.fin_texto_conta_propria(_txt text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH t AS (SELECT regexp_replace(coalesce(_txt, ''), '\D', '', 'g') dig,
                    regexp_replace(upper(coalesce(_txt, '')), '\s+', ' ', 'g') txt)
  SELECT EXISTS (
    SELECT 1 FROM public.business_entities be, t
     WHERE be.is_active AND (
       (length(regexp_replace(coalesce(be.tax_id, ''), '\D', '', 'g')) = 14
          AND t.dig LIKE '%' || regexp_replace(be.tax_id, '\D', '', 'g') || '%')
       OR (array_length(regexp_split_to_array(btrim(regexp_replace(upper(coalesce(be.legal_name, '')), '\s+', ' ', 'g')), ' '), 1) >= 3
          AND length(btrim(coalesce(be.legal_name, ''))) >= 8
          AND t.txt LIKE '%' || array_to_string((regexp_split_to_array(btrim(regexp_replace(upper(be.legal_name), '\s+', ' ', 'g')), ' '))[1:3], ' ') || '%')))
  OR EXISTS (
    SELECT 1 FROM public.financial_accounts a, t
     WHERE length(regexp_replace(coalesce(a.titular_documento, ''), '\D', '', 'g')) = 14
       AND t.dig LIKE '%' || regexp_replace(a.titular_documento, '\D', '', 'g') || '%')
$$;
REVOKE ALL ON FUNCTION public.fin_texto_conta_propria(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_texto_conta_propria(text) TO service_role;

CREATE OR REPLACE FUNCTION public.fin_linha_livre_transferencia(_line uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.financial_statement_lines l JOIN public.financial_accounts a ON a.id = l.financial_account_id
     WHERE l.id = _line AND l.status IN ('pendente','divergente') AND l.conciliado_cents = 0 AND l.kind IN ('entrada','saida')
       AND a.is_active AND NOT coalesce(a.is_homologacao, false) AND a.excluida_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.fin_extrato_transferencias v WHERE v.line_id = l.id AND v.desfeito_em IS NULL))
$$;
REVOKE ALL ON FUNCTION public.fin_linha_livre_transferencia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_linha_livre_transferencia(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fin_transferencia_contras(_line uuid)
RETURNS TABLE (line_id uuid, financial_account_id uuid, conta text, data date, valor_cents bigint, historico text, propria boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id, c.financial_account_id, a.nome, c.data, c.valor_cents, c.historico, public.fin_texto_conta_propria(c.historico)
    FROM public.financial_statement_lines l
    JOIN public.financial_statement_lines c ON c.financial_account_id <> l.financial_account_id
         AND c.kind = CASE WHEN l.kind = 'entrada' THEN 'saida' ELSE 'entrada' END
         AND c.valor_cents = l.valor_cents AND c.data BETWEEN l.data - 3 AND l.data + 3
    JOIN public.financial_accounts a ON a.id = c.financial_account_id
   WHERE l.id = _line AND public.fin_linha_livre_transferencia(c.id)
   ORDER BY abs(c.data - l.data), c.data, c.id
   LIMIT 20
$$;
REVOKE ALL ON FUNCTION public.fin_transferencia_contras(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_transferencia_contras(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fin_transf_criar_interno(_from uuid, _to uuid, _data date, _valor bigint, _ref text, _motivo text, _chave text, _ator uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_key text := _chave; n int := 0; ex financial_transfers%rowtype; v_fp text;
BEGIN
  IF _valor IS NULL OR _valor <= 0 THEN RAISE EXCEPTION 'Valor da transferência deve ser maior que zero'; END IF;
  IF _from = _to THEN RAISE EXCEPTION 'Origem e destino da transferência precisam ser contas diferentes'; END IF;
  v_fp := fin_fingerprint(jsonb_build_object('from', _from::text, 'to', _to::text, 'data', _data::text, 'valor_cents', _valor));
  LOOP
    SELECT * INTO ex FROM financial_transfers WHERE idempotency_key = v_key;
    EXIT WHEN ex.id IS NULL;
    IF EXISTS (SELECT 1 FROM financial_transfers x WHERE x.reversed_of = ex.id) THEN
      n := n + 1; v_key := _chave || ':refeita:' || n; ex := NULL; CONTINUE;
    END IF;
    IF ex.payload_fingerprint IS DISTINCT FROM v_fp THEN
      RAISE EXCEPTION 'Já existe uma transferência lançada para esta linha com outras contas/valor. Estorne a anterior antes.';
    END IF;
    RETURN ex.id;
  END LOOP;
  INSERT INTO financial_transfers (from_account_id, to_account_id, data, valor_cents, referencia, motivo, idempotency_key, payload_fingerprint, created_by)
  VALUES (_from, _to, _data, _valor, nullif(_ref, ''), nullif(_motivo, ''), v_key, v_fp, _ator) RETURNING id INTO v_id;
  INSERT INTO financial_account_movements (financial_account_id, kind, data, valor_cents, transfer_id, descricao, created_by)
  VALUES (_from, 'transferencia_saida', _data, -_valor, v_id, nullif(_motivo, ''), _ator),
         (_to, 'transferencia_entrada', _data, _valor, v_id, nullif(_motivo, ''), _ator);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fin_transf_criar_interno(uuid,uuid,date,bigint,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_transf_criar_interno(uuid,uuid,date,bigint,text,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fin_transf_ligar_interno(_line uuid, _transfer uuid, _obs text, _ator uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l financial_statement_lines%rowtype; tr financial_transfers%rowtype; v_mov bigint; v_id uuid;
BEGIN
  SELECT * INTO l FROM financial_statement_lines WHERE id = _line FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Linha não encontrada'; END IF;
  IF NOT fin_linha_livre_transferencia(l.id) THEN
    RAISE EXCEPTION 'Linha % não está disponível (situação: %). Desfaça o que estiver ligado a ela antes.', l.line_no, l.status;
  END IF;
  SELECT * INTO tr FROM financial_transfers WHERE id = _transfer;
  IF tr.id IS NULL OR tr.is_reversal OR EXISTS (SELECT 1 FROM financial_transfers x WHERE x.reversed_of = tr.id) THEN
    RAISE EXCEPTION 'Transferência não encontrada ou estornada';
  END IF;
  SELECT abs(m.valor_cents) INTO v_mov FROM financial_account_movements m
   WHERE m.transfer_id = tr.id AND m.financial_account_id = l.financial_account_id
     AND m.kind = (CASE WHEN l.kind = 'entrada' THEN 'transferencia_entrada' ELSE 'transferencia_saida' END)::fin_movement_kind LIMIT 1;
  IF v_mov IS NULL THEN RAISE EXCEPTION 'A transferência não passa pela conta desta linha (ou está no sentido contrário).'; END IF;
  IF v_mov <> l.valor_cents THEN RAISE EXCEPTION 'Valor da linha diferente do valor da transferência.'; END IF;
  IF EXISTS (SELECT 1 FROM fin_extrato_transferencias v WHERE v.transfer_id = tr.id AND v.financial_account_id = l.financial_account_id AND v.desfeito_em IS NULL)
     OR EXISTS (SELECT 1 FROM asaas_auto_extrato e WHERE e.tipo = 'transferencia' AND e.transfer_id = tr.id AND e.desfeito_em IS NULL
                  AND e.financial_account_id = l.financial_account_id) THEN
    RAISE EXCEPTION 'Esta transferência já está ligada a outra linha do extrato desta conta.';
  END IF;
  INSERT INTO fin_extrato_transferencias (line_id, transfer_id, financial_account_id, valor_cents, observacao, criado_por)
  VALUES (l.id, tr.id, l.financial_account_id, l.valor_cents, nullif(btrim(coalesce(_obs, '')), ''), _ator) RETURNING id INTO v_id;
  UPDATE financial_statement_lines SET status = 'ignorada',
         flag_reason = left('Transferência entre contas de ' || to_char(tr.data, 'DD/MM/YYYY') || ' (sem receita nem despesa)'
                            || coalesce(' — ' || nullif(btrim(coalesce(_obs, '')), ''), ''), 300),
         updated_at = now()
   WHERE id = l.id;
  INSERT INTO financial_reconciliation_events (line_id, evento, motivo, actor_id, payload)
  VALUES (l.id, 'linha_ignorada', 'Transferência entre contas', _ator, jsonb_build_object('transfer_id', tr.id, 'vinculo', v_id));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fin_transf_ligar_interno(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_transf_ligar_interno(uuid,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fin_mesa_transferencia_sugestao(_line_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l financial_statement_lines%rowtype; v_contas jsonb; v_contras jsonb;
BEGIN
  IF NOT has_capability(auth.uid(), 'finance.reconcile') THEN RAISE EXCEPTION 'Sem permissão para conciliar'; END IF;
  SELECT * INTO l FROM financial_statement_lines WHERE id = _line_id;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Linha não encontrada'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'kind', a.kind) ORDER BY a.nome), '[]'::jsonb) INTO v_contas
    FROM financial_accounts a
   WHERE a.id <> l.financial_account_id AND a.is_active AND NOT coalesce(a.is_homologacao, false) AND a.excluida_em IS NULL;
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_contras FROM fin_transferencia_contras(l.id) c;
  RETURN jsonb_build_object(
    'propria', fin_texto_conta_propria(l.historico),
    'livre', fin_linha_livre_transferencia(l.id),
    'sentido', CASE WHEN l.kind = 'saida' THEN 'saiu_desta_conta' ELSE 'entrou_nesta_conta' END,
    'contas', v_contas, 'contras', v_contras);
END $$;
REVOKE ALL ON FUNCTION public.fin_mesa_transferencia_sugestao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_mesa_transferencia_sugestao(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fin_mesa_nova_transferencia(_line_id uuid, _outra_conta uuid, _contra_line_id uuid DEFAULT NULL, _observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l financial_statement_lines%rowtype; c financial_statement_lines%rowtype; a financial_accounts%rowtype;
  v_from uuid; v_to uuid; v_data date; v_tr uuid; v_log uuid; v_obs text := nullif(btrim(coalesce(_observacao, '')), '');
  v_ex uuid;
BEGIN
  IF NOT (has_capability(auth.uid(), 'finance.reconcile') AND has_capability(auth.uid(), 'finance.statement.flag')
          AND has_capability(auth.uid(), 'finance.bank.manage')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar transferência entre contas (precisa conciliar e movimentar contas).';
  END IF;
  SELECT * INTO l FROM financial_statement_lines WHERE id = _line_id FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Linha não encontrada'; END IF;
  SELECT id INTO v_ex FROM fin_transferencias_extrato
   WHERE desfeito_em IS NULL AND (line_saida = l.id OR line_entrada = l.id)
     AND EXISTS (SELECT 1 FROM fin_extrato_transferencias v WHERE v.line_id = l.id AND v.desfeito_em IS NULL);
  IF v_ex IS NOT NULL THEN
    RETURN (SELECT jsonb_build_object('id', id, 'transfer_id', transfer_id, 'repetido', true,
                                      'contra_ligada', line_saida IS NOT NULL AND line_entrada IS NOT NULL)
              FROM fin_transferencias_extrato WHERE id = v_ex);
  END IF;
  IF NOT fin_linha_livre_transferencia(l.id) THEN
    RAISE EXCEPTION 'Linha % não está disponível (situação: %). Desfaça o que estiver ligado a ela antes.', l.line_no, l.status;
  END IF;
  SELECT * INTO a FROM financial_accounts WHERE id = _outra_conta;
  IF a.id IS NULL OR NOT a.is_active OR coalesce(a.is_homologacao, false) OR a.excluida_em IS NOT NULL THEN
    RAISE EXCEPTION 'Escolha uma conta ativa da empresa para a outra ponta.';
  END IF;
  IF a.id = l.financial_account_id THEN RAISE EXCEPTION 'A outra conta precisa ser diferente da conta desta linha.'; END IF;
  IF _contra_line_id IS NOT NULL THEN
    SELECT * INTO c FROM financial_statement_lines WHERE id = _contra_line_id FOR UPDATE;
    IF c.id IS NULL OR c.financial_account_id <> _outra_conta THEN RAISE EXCEPTION 'A linha da outra conta não pertence à conta escolhida.'; END IF;
    IF c.kind = l.kind THEN RAISE EXCEPTION 'A linha da outra conta precisa estar no sentido contrário (uma saída e uma entrada).'; END IF;
    IF c.valor_cents <> l.valor_cents THEN RAISE EXCEPTION 'A linha da outra conta precisa ter o mesmo valor.'; END IF;
    IF abs(c.data - l.data) > 3 THEN RAISE EXCEPTION 'A linha da outra conta está a mais de 3 dias desta.'; END IF;
    IF NOT fin_linha_livre_transferencia(c.id) THEN RAISE EXCEPTION 'A linha da outra conta já está conferida ou ligada.'; END IF;
  END IF;
  IF l.kind = 'saida' THEN v_from := l.financial_account_id; v_to := _outra_conta; v_data := l.data;
  ELSE v_from := _outra_conta; v_to := l.financial_account_id; v_data := coalesce(CASE WHEN c.id IS NOT NULL THEN c.data END, l.data);
  END IF;
  v_tr := fin_transf_criar_interno(v_from, v_to, v_data, l.valor_cents, 'Extrato linha ' || l.line_no,
            coalesce(v_obs, 'Transferência entre contas (lançada na conciliação)'), 'mesa:transf:' || l.id, auth.uid());
  PERFORM fin_transf_ligar_interno(l.id, v_tr, v_obs, auth.uid());
  IF c.id IS NOT NULL THEN PERFORM fin_transf_ligar_interno(c.id, v_tr, v_obs, auth.uid()); END IF;
  INSERT INTO fin_transferencias_extrato (origem, modo, transfer_id, line_saida, line_entrada, valor_cents, motivo, actor_id)
  VALUES ('mesa', 'nova', v_tr,
          CASE WHEN l.kind = 'saida' THEN l.id ELSE c.id END, CASE WHEN l.kind = 'entrada' THEN l.id ELSE c.id END,
          l.valor_cents, coalesce(v_obs, 'Lançada na Mesa de conciliação'), auth.uid()) RETURNING id INTO v_log;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'fin.extrato.transferencia.nova', 'financial_statement_lines', l.id::text,
          jsonb_build_object('registro', v_log, 'transfer_id', v_tr, 'de', v_from, 'para', v_to, 'valor_cents', l.valor_cents,
                             'contra_line_id', c.id, 'data', v_data));
  RETURN jsonb_build_object('id', v_log, 'transfer_id', v_tr, 'repetido', false, 'contra_ligada', c.id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.fin_mesa_nova_transferencia(uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_mesa_nova_transferencia(uuid,uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fin_transferencias_parear_nucleo(_ator uuid, _limite integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; c record; n_c int; n_volta int; n_m int; trs uuid[]; v_tr uuid; s_id uuid; e_id uuid; s_data date;
  s_conta uuid; e_conta uuid; novas int := 0; existentes int := 0; sem_par int := 0; ambiguas int := 0; erros int := 0;
  t0 timestamptz := clock_timestamp();
BEGIN
  FOR r IN SELECT l.* FROM financial_statement_lines l JOIN financial_accounts a ON a.id = l.financial_account_id
            WHERE l.status IN ('pendente','divergente') AND l.conciliado_cents = 0 AND l.kind IN ('entrada','saida')
              AND l.data >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 120
              AND a.is_active AND NOT coalesce(a.is_homologacao, false) AND a.excluida_em IS NULL
              AND NOT EXISTS (SELECT 1 FROM fin_extrato_transferencias v WHERE v.line_id = l.id AND v.desfeito_em IS NULL)
              AND NOT EXISTS (SELECT 1 FROM fin_transferencias_extrato x WHERE x.line_saida = l.id OR x.line_entrada = l.id)
              AND fin_texto_conta_propria(l.historico)
            ORDER BY l.data, l.id LIMIT greatest(coalesce(_limite, 200), 1) LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '20 seconds';
    IF NOT fin_linha_livre_transferencia(r.id) THEN CONTINUE; END IF;
    BEGIN
      SELECT count(*), array_agg(t.id) INTO n_m, trs
        FROM financial_account_movements m JOIN financial_transfers t ON t.id = m.transfer_id
       WHERE m.financial_account_id = r.financial_account_id
         AND m.kind = (CASE WHEN r.kind = 'entrada' THEN 'transferencia_entrada' ELSE 'transferencia_saida' END)::fin_movement_kind
         AND abs(m.valor_cents) = r.valor_cents AND m.data BETWEEN r.data - 3 AND r.data + 3
         AND NOT t.is_reversal AND NOT EXISTS (SELECT 1 FROM financial_transfers x WHERE x.reversed_of = t.id)
         AND NOT EXISTS (SELECT 1 FROM fin_extrato_transferencias v WHERE v.transfer_id = t.id AND v.financial_account_id = r.financial_account_id AND v.desfeito_em IS NULL)
         AND NOT EXISTS (SELECT 1 FROM asaas_auto_extrato e WHERE e.tipo = 'transferencia' AND e.transfer_id = t.id AND e.desfeito_em IS NULL
                           AND e.financial_account_id = r.financial_account_id);
      IF n_m = 1 THEN
        PERFORM fin_transf_ligar_interno(r.id, trs[1], 'Conferida sozinha: transferência já lançada', _ator);
        INSERT INTO fin_transferencias_extrato (origem, modo, transfer_id, line_saida, line_entrada, valor_cents, motivo, actor_id)
        VALUES ('automatico', 'existente', trs[1], CASE WHEN r.kind = 'saida' THEN r.id END, CASE WHEN r.kind = 'entrada' THEN r.id END,
                r.valor_cents, 'Transferência já lançada no Lardan; linha com CNPJ/razão social da empresa', _ator);
        existentes := existentes + 1; CONTINUE;
      ELSIF n_m > 1 THEN ambiguas := ambiguas + 1; CONTINUE;
      END IF;
      SELECT count(*) INTO n_c FROM fin_transferencia_contras(r.id);
      IF n_c = 0 THEN sem_par := sem_par + 1; CONTINUE; END IF;
      IF n_c > 1 THEN ambiguas := ambiguas + 1; CONTINUE; END IF;
      SELECT * INTO c FROM fin_transferencia_contras(r.id);
      IF NOT c.propria THEN sem_par := sem_par + 1; CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM fin_transferencias_extrato x WHERE x.line_saida = c.line_id OR x.line_entrada = c.line_id) THEN
        sem_par := sem_par + 1; CONTINUE;
      END IF;
      SELECT count(*) INTO n_volta FROM fin_transferencia_contras(c.line_id); -- a outra ponta também só pode casar com esta linha
      IF n_volta <> 1 THEN ambiguas := ambiguas + 1; CONTINUE; END IF;
      IF r.kind = 'saida' THEN s_id := r.id; s_conta := r.financial_account_id; s_data := r.data; e_id := c.line_id; e_conta := c.financial_account_id;
      ELSE s_id := c.line_id; s_conta := c.financial_account_id; s_data := c.data; e_id := r.id; e_conta := r.financial_account_id;
      END IF;
      v_tr := fin_transf_criar_interno(s_conta, e_conta, s_data, r.valor_cents, 'Extrato (pareada sozinha)',
                'Transferência entre contas próprias (pareada pelo extrato)', 'auto:transf:' || s_id || ':' || e_id, _ator);
      PERFORM fin_transf_ligar_interno(s_id, v_tr, 'Pareada sozinha (CNPJ/razão social nos dois extratos)', _ator);
      PERFORM fin_transf_ligar_interno(e_id, v_tr, 'Pareada sozinha (CNPJ/razão social nos dois extratos)', _ator);
      INSERT INTO fin_transferencias_extrato (origem, modo, transfer_id, line_saida, line_entrada, valor_cents, motivo, actor_id)
      VALUES ('automatico', 'nova', v_tr, s_id, e_id, r.valor_cents,
              'Saída e entrada de mesmo valor em contas da empresa, até 3 dias, par único; as duas linhas citam o CNPJ/razão social', _ator);
      novas := novas + 1;
    EXCEPTION WHEN OTHERS THEN erros := erros + 1;
    END;
  END LOOP;
  IF novas + existentes > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (_ator, 'fin.extrato.transferencia.parear', 'financial_transfers', NULL,
            jsonb_build_object('novas', novas, 'existentes', existentes, 'sem_par', sem_par, 'ambiguas', ambiguas, 'erros', erros));
  END IF;
  RETURN jsonb_build_object('novas', novas, 'existentes', existentes, 'sem_par', sem_par, 'ambiguas', ambiguas, 'erros', erros,
                            'ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int);
END $$;
REVOKE ALL ON FUNCTION public.fin_transferencias_parear_nucleo(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_transferencias_parear_nucleo(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.fin_transferencias_parear_agora()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (has_capability(auth.uid(), 'finance.reconcile') AND has_capability(auth.uid(), 'finance.statement.flag')
          AND has_capability(auth.uid(), 'finance.bank.manage')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar transferência entre contas.';
  END IF;
  RETURN fin_transferencias_parear_nucleo(auth.uid(), 400);
END $$;
REVOKE ALL ON FUNCTION public.fin_transferencias_parear_agora() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_transferencias_parear_agora() TO authenticated;

CREATE OR REPLACE FUNCTION public.fin_transferencia_extrato_desfazer(_id uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE x fin_transferencias_extrato%rowtype; t financial_transfers%rowtype; v_est uuid; ln uuid;
BEGIN
  IF NOT (has_capability(auth.uid(), 'finance.reconcile') AND has_capability(auth.uid(), 'finance.statement.flag')
          AND has_capability(auth.uid(), 'finance.bank.manage')) THEN
    RAISE EXCEPTION 'Sem permissão para desfazer transferência entre contas.';
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo para desfazer.'; END IF;
  SELECT * INTO x FROM fin_transferencias_extrato WHERE id = _id FOR UPDATE;
  IF x.id IS NULL THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;
  IF x.desfeito_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'repetido', true); END IF;
  FOREACH ln IN ARRAY ARRAY[x.line_saida, x.line_entrada] LOOP
    CONTINUE WHEN ln IS NULL;
    IF EXISTS (SELECT 1 FROM fin_extrato_transferencias v WHERE v.line_id = ln AND v.transfer_id = x.transfer_id AND v.desfeito_em IS NULL) THEN
      UPDATE fin_extrato_transferencias SET desfeito_em = now(), desfeito_por = auth.uid(), desfeito_motivo = btrim(_motivo)
       WHERE line_id = ln AND transfer_id = x.transfer_id AND desfeito_em IS NULL;
      UPDATE financial_statement_lines SET status = 'pendente', flag_reason = left('Transferência desfeita: ' || btrim(_motivo), 300), updated_at = now()
       WHERE id = ln AND status = 'ignorada';
      INSERT INTO financial_reconciliation_events (line_id, evento, motivo, actor_id, payload)
      VALUES (ln, 'linha_pendente', 'Transferência desfeita: ' || btrim(_motivo), auth.uid(), jsonb_build_object('registro', x.id, 'transfer_id', x.transfer_id));
    END IF;
  END LOOP;
  IF x.modo = 'nova' THEN
    SELECT * INTO t FROM financial_transfers WHERE id = x.transfer_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM financial_transfers WHERE reversed_of = t.id)
       AND NOT EXISTS (SELECT 1 FROM fin_extrato_transferencias v WHERE v.transfer_id = t.id AND v.desfeito_em IS NULL)
       AND NOT EXISTS (SELECT 1 FROM asaas_auto_extrato e WHERE e.tipo = 'transferencia' AND e.transfer_id = t.id AND e.desfeito_em IS NULL) THEN
      INSERT INTO financial_transfers (from_account_id, to_account_id, data, valor_cents, motivo, reversed_of, is_reversal, created_by)
      VALUES (t.to_account_id, t.from_account_id, t.data, t.valor_cents, 'Estorno: ' || btrim(_motivo), t.id, true, auth.uid())
      RETURNING id INTO v_est;
      INSERT INTO financial_account_movements (financial_account_id, kind, data, valor_cents, transfer_id, descricao, created_by)
      VALUES (t.to_account_id, 'transferencia_saida', t.data, -t.valor_cents, v_est, 'Estorno: ' || btrim(_motivo), auth.uid()),
             (t.from_account_id, 'transferencia_entrada', t.data, t.valor_cents, v_est, 'Estorno: ' || btrim(_motivo), auth.uid());
    END IF;
  END IF;
  UPDATE fin_transferencias_extrato SET desfeito_em = now(), desfeito_por = auth.uid(), desfeito_motivo = btrim(_motivo), estorno_transfer_id = v_est
   WHERE id = x.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'fin.extrato.transferencia.desfazer', 'fin_transferencias_extrato', x.id::text,
          jsonb_build_object('transfer_id', x.transfer_id, 'estorno', v_est, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('ok', true, 'repetido', false, 'estorno_transfer_id', v_est);
END $$;
REVOKE ALL ON FUNCTION public.fin_transferencia_extrato_desfazer(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_transferencia_extrato_desfazer(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fin_transferencias_extrato_painel(_dias integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_feitas jsonb; v_aguardando jsonb; d0 date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - greatest(coalesce(_dias, 60), 1);
BEGIN
  IF NOT has_capability(auth.uid(), 'finance.statement.view') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.criado_em DESC), '[]'::jsonb) INTO v_feitas FROM (
    SELECT x.id, x.origem, x.modo, x.valor_cents, x.motivo, x.criado_em, x.desfeito_em, x.desfeito_motivo,
           t.data, fo.nome conta_origem, fd.nome conta_destino,
           ls.historico historico_saida, le.historico historico_entrada,
           coalesce(p.display_name, p.legal_name) quem
      FROM fin_transferencias_extrato x
      JOIN financial_transfers t ON t.id = x.transfer_id
      LEFT JOIN financial_accounts fo ON fo.id = t.from_account_id
      LEFT JOIN financial_accounts fd ON fd.id = t.to_account_id
      LEFT JOIN financial_statement_lines ls ON ls.id = x.line_saida
      LEFT JOIN financial_statement_lines le ON le.id = x.line_entrada
      LEFT JOIN profiles pr ON pr.id = x.actor_id
      LEFT JOIN parties p ON p.id = pr.party_id
     WHERE x.criado_em >= d0 ORDER BY x.criado_em DESC LIMIT 100) z;
  SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.data DESC), '[]'::jsonb) INTO v_aguardando FROM (
    SELECT l.id, l.data, l.kind, l.valor_cents, l.historico, a.nome conta
      FROM financial_statement_lines l JOIN financial_accounts a ON a.id = l.financial_account_id
     WHERE l.data >= d0 AND l.status IN ('pendente','divergente') AND l.conciliado_cents = 0
       AND a.is_active AND NOT coalesce(a.is_homologacao, false) AND a.excluida_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM fin_extrato_transferencias v WHERE v.line_id = l.id AND v.desfeito_em IS NULL)
       AND fin_texto_conta_propria(l.historico)
     ORDER BY l.data DESC LIMIT 100) z;
  RETURN jsonb_build_object('feitas', v_feitas, 'aguardando', v_aguardando);
END $$;
REVOKE ALL ON FUNCTION public.fin_transferencias_extrato_painel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_transferencias_extrato_painel(integer) TO authenticated;

DO $do$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_rodar(integer)'::regprocedure);
  IF position('fin_transferencias_parear_nucleo' IN def) > 0 THEN RETURN; END IF;
  IF position('extrato jsonb;' IN def) = 0 OR position($q$PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);$q$ IN def) = 0
     OR position($q$'extrato', extrato,$q$ IN def) = 0 THEN
    RAISE EXCEPTION '0369: trecho não encontrado em asaas_auto_rodar';
  END IF;
  novo := replace(def, 'extrato jsonb;', 'extrato jsonb; transf jsonb;');
  novo := replace(novo, $q$PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);$q$,
$q$-- 0369: transferências entre contas próprias (dois lados com CNPJ/razão social, par único)
  IF coalesce((SELECT transferencias_ligado FROM public.asaas_auto_config WHERE id), true) THEN
    BEGIN
      transf := public.fin_transferencias_parear_nucleo(ator, 200);
    EXCEPTION WHEN OTHERS THEN
      transf := jsonb_build_object('erro', left(SQLERRM, 300));
    END;
  END IF;

  PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);$q$);
  novo := replace(novo, $q$'extrato', extrato,$q$, $q$'extrato', extrato, 'transferencias', transf,$q$);
  EXECUTE novo;
END $do$;