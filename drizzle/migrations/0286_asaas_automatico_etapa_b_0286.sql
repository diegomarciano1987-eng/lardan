-- ============ 0286 — Asaas automático, etapa B ============
-- Decisões do Diego (11/11/2026): consultora com maleta aberta (em vendas ou em acerto) vai para a exceção;
-- títulos "Não identificado" já baixados pela planilha passam para a pessoa da cobrança; tarifa do Pix/boleto em 5.1.3;
-- notificações e negativação em um título por mês (5.1.1); transferência Asaas -> banco já lançada só é conferida.
-- Nada aqui cria receita nova; tudo fica registrado em asaas_auto_extrato com motivo e pode ser desfeito.

-- A) maleta em vendas/trânsito também vai para a exceção
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_receber_nucleo(uuid,uuid,boolean)'::regprocedure);
  novo := replace(def, $q$k.status = 'acerto')$q$, $q$k.status::text IN ('acerto','operacao','transito'))$q$);
  novo := replace(novo, 'Consultora com maleta em acerto: confirmar se o Pix é desse acerto',
                        'Consultora com maleta aberta (em vendas ou em acerto): confirmar se o Pix é dessa maleta');
  IF novo = def OR position($q$'operacao','transito'$q$ IN novo) = 0 THEN
    RAISE EXCEPTION '0286: trecho da maleta não encontrado em asaas_auto_receber_nucleo';
  END IF;
  EXECUTE novo;
END $patch$;

-- B) configuração da etapa B (chave própria, desligada até a prévia ser conferida)
ALTER TABLE public.asaas_auto_config
  ADD COLUMN IF NOT EXISTS extrato_ligado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS favorecido_party_id uuid,
  ADD COLUMN IF NOT EXISTS tarifa_chart_id uuid,
  ADD COLUMN IF NOT EXISTS tarifa_cost_center_id uuid,
  ADD COLUMN IF NOT EXISTS notificacao_chart_id uuid,
  ADD COLUMN IF NOT EXISTS notificacao_cost_center_id uuid;
UPDATE public.asaas_auto_config cfg SET
  favorecido_party_id = coalesce(cfg.favorecido_party_id,
    (SELECT id FROM public.parties WHERE upper(btrim(display_name)) = 'ASAAS - SISTEMA PAGAMENTO' ORDER BY created_at LIMIT 1)),
  tarifa_chart_id = coalesce(cfg.tarifa_chart_id, (SELECT id FROM public.chart_of_accounts WHERE codigo = '5.1.3' ORDER BY id LIMIT 1)),
  notificacao_chart_id = coalesce(cfg.notificacao_chart_id, (SELECT id FROM public.chart_of_accounts WHERE codigo = '5.1.1' ORDER BY id LIMIT 1))
 WHERE cfg.id;
UPDATE public.asaas_auto_config cfg SET
  tarifa_cost_center_id = coalesce(cfg.tarifa_cost_center_id, (SELECT t.cost_center_id FROM public.financial_titles t
     WHERE t.chart_account_id = cfg.tarifa_chart_id AND t.status = 'ativo' AND t.cost_center_id IS NOT NULL
     GROUP BY t.cost_center_id ORDER BY count(*) DESC LIMIT 1)),
  notificacao_cost_center_id = coalesce(cfg.notificacao_cost_center_id, (SELECT t.cost_center_id FROM public.financial_titles t
     WHERE t.chart_account_id = cfg.notificacao_chart_id AND t.status = 'ativo' AND t.cost_center_id IS NOT NULL
       AND t.party_id = cfg.favorecido_party_id
     GROUP BY t.cost_center_id ORDER BY count(*) DESC LIMIT 1))
 WHERE cfg.id;
COMMENT ON COLUMN public.asaas_auto_config.extrato_ligado IS '0286: chave da etapa B (identificar títulos da planilha, tarifas 5.1.3, notificações 5.1.1 por mês, transferências já lançadas).';

CREATE TABLE IF NOT EXISTS public.asaas_auto_extrato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('identificacao','tarifa','notificacoes','transferencia')),
  chave text NOT NULL,
  financial_account_id uuid,
  line_ids uuid[] NOT NULL DEFAULT '{}',
  charge_id uuid, title_id uuid, reconciliation_id uuid, transfer_id uuid,
  valor_cents bigint,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  motivo text NOT NULL,
  actor_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz, desfeito_por uuid, desfeito_motivo text
);
CREATE UNIQUE INDEX IF NOT EXISTS asaas_auto_extrato_chave_ativa_uq ON public.asaas_auto_extrato (tipo, chave) WHERE desfeito_em IS NULL;
CREATE INDEX IF NOT EXISTS asaas_auto_extrato_criado_idx ON public.asaas_auto_extrato (criado_em DESC);
CREATE INDEX IF NOT EXISTS asaas_auto_extrato_linhas_idx ON public.asaas_auto_extrato USING gin (line_ids);
GRANT SELECT ON public.asaas_auto_extrato TO authenticated;
GRANT ALL ON public.asaas_auto_extrato TO service_role;
ALTER TABLE public.asaas_auto_extrato ENABLE ROW LEVEL SECURITY;
CREATE POLICY asaas_auto_extrato_ler ON public.asaas_auto_extrato FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.reconcile')));
COMMENT ON TABLE public.asaas_auto_extrato IS '0286: o que o Asaas automático conferiu no extrato (identificação de título, tarifa, notificações do mês, transferência); um registro ativo por chave, desfazer guarda o histórico.';

-- núcleo da etapa B (sem portão: chamado pela rotina ou pela entrada de serviço, já em nome do responsável técnico)
CREATE OR REPLACE FUNCTION public.asaas_auto_extrato_nucleo(_ator uuid, _limite int DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cfg record; r record; g record; t0 timestamptz := clock_timestamp(); lim int := greatest(coalesce(_limite, 300), 1);
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  n_id int := 0; n_id_conc int := 0; v_id bigint := 0; n_tar int := 0; v_tar bigint := 0; n_not int := 0; v_not bigint := 0;
  n_tr int := 0; v_tr bigint := 0; erros int := 0; pulos jsonb := '{}'::jsonb; ult_erro text;
  lin uuid; sid uuid; nl int; ns int; res jsonb; rid uuid; tit uuid; inst uuid; ent uuid; ch text; k int; mov record;
BEGIN
  SELECT * INTO cfg FROM public.asaas_auto_config WHERE id;

  -- 1) título "Não identificado" já baixado pela planilha + cobrança confirmada pelo nº da fatura (1 para 1, mesmo valor)
  FOR r IN
    SELECT c.id cid, c.external_id, c.party_id cp, a.financial_account_id conta, i.id iid, t.id tid, t.party_id tp,
           coalesce(c.received_cents, c.value_cents) v
      FROM public.asaas_charges c JOIN public.asaas_accounts a ON a.id = c.account_id
      JOIN public.asaas_charge_matches m ON m.charge_id = c.id AND m.status = 'confirmado'
      JOIN public.financial_installments i ON i.id = m.installment_id
      JOIN public.financial_titles t ON t.id = i.title_id
      JOIN public.parties p ON p.id = t.party_id
     WHERE c.installment_id IS NULL AND c.title_id IS NULL AND c.external_status = 'RECEIVED' AND c.party_id IS NOT NULL
       AND lower(btrim(p.display_name)) = 'não identificado' AND t.pagador_party_id IS NULL
       AND t.direction = 'receivable' AND t.status = 'ativo' AND i.settlement_status = 'liquidado'
       AND i.valor_cents = coalesce(c.received_cents, c.value_cents)
       AND (SELECT count(*) FROM public.financial_installments i2 WHERE i2.title_id = t.id) = 1
       AND (SELECT count(*) FROM public.asaas_charge_matches m2 WHERE m2.charge_id = c.id AND m2.status = 'confirmado') = 1
       AND (SELECT count(*) FROM public.asaas_charge_matches m3 WHERE m3.installment_id = i.id AND m3.status = 'confirmado') = 1
       AND NOT EXISTS (SELECT 1 FROM public.asaas_charges x WHERE x.installment_id = i.id AND x.id <> c.id AND x.external_status <> 'DELETED')
       AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE e.tipo = 'identificacao' AND e.chave = c.external_id)
     ORDER BY c.payment_date DESC NULLS LAST LIMIT lim
  LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '40 seconds';
    BEGIN
      UPDATE public.financial_titles SET party_id = r.cp WHERE id = r.tid;
      INSERT INTO public.financial_title_events (title_id, evento, payload, actor_id)
      VALUES (r.tid, 'pessoa_identificada', jsonb_build_object('de', r.tp, 'para', r.cp, 'cobranca', r.external_id,
              'motivo', 'Asaas automático: cobrança confirmada pelo número da fatura'), _ator);
      PERFORM public.asaas_vincular_interno(r.cid, r.tid, r.iid,
        'Automático: título da planilha identificado pela cobrança (vínculo confirmado pelo número da fatura); nenhum lançamento novo', _ator);
      rid := NULL; lin := NULL; sid := NULL;
      SELECT count(*), min(l.id::text)::uuid INTO nl, lin FROM public.financial_statement_lines l
       WHERE l.financial_account_id = r.conta AND l.kind = 'entrada' AND l.raw->>'type' = 'PAYMENT_RECEIVED'
         AND l.raw->>'paymentId' = r.external_id AND l.status = 'pendente' AND l.conciliado_cents = 0 AND l.valor_cents = r.v;
      SELECT count(*), min(s.id::text)::uuid INTO ns, sid FROM public.financial_allocations al
        JOIN public.financial_settlements s ON s.id = al.settlement_id
       WHERE al.installment_id = r.iid AND NOT s.is_reversal
         AND NOT EXISTS (SELECT 1 FROM public.financial_settlements x WHERE x.reversed_of = s.id);
      IF nl = 1 AND ns = 1
         AND (SELECT count(*) FROM public.financial_allocations a2 WHERE a2.settlement_id = sid) = 1
         AND (SELECT financial_account_id FROM public.financial_settlements WHERE id = sid) = r.conta
         AND coalesce((SELECT sum(valor_cents) FROM public.financial_account_movements WHERE settlement_id = sid), 0) = r.v
         AND NOT EXISTS (SELECT 1 FROM public.financial_reconciliations rc WHERE rc.settlement_id = sid AND rc.status = 'ativa') THEN
        res := public.fin_reconcile_baixa_existente(ARRAY[lin], sid, 'asaas:extrato-planilha:' || r.external_id,
          'Automático: recebimento do Asaas ligado à baixa da planilha já lançada (nenhum dinheiro novo)');
        rid := nullif(res->>'id', '')::uuid;
      END IF;
      INSERT INTO public.asaas_auto_extrato (tipo, chave, financial_account_id, line_ids, charge_id, title_id, reconciliation_id,
             valor_cents, detalhe, motivo, actor_id)
      VALUES ('identificacao', r.external_id, r.conta, CASE WHEN rid IS NULL THEN '{}'::uuid[] ELSE ARRAY[lin] END, r.cid, r.tid, rid, r.v,
              jsonb_build_object('party_de', r.tp, 'party_para', r.cp, 'installment_id', r.iid, 'settlement_id', sid),
              CASE WHEN rid IS NULL THEN 'Título "Não identificado" passou para a pessoa da cobrança e foi ligado a ela'
                   ELSE 'Título "Não identificado" passou para a pessoa da cobrança; linha do extrato ligada à baixa já lançada' END, _ator);
      n_id := n_id + 1; v_id := v_id + r.v; IF rid IS NOT NULL THEN n_id_conc := n_id_conc + 1; END IF;
    EXCEPTION WHEN OTHERS THEN erros := erros + 1; ult_erro := left('identificacao ' || r.external_id || ': ' || SQLERRM, 300);
    END;
  END LOOP;

  -- 2) tarifa do Pix/boleto que não está no razão (recebimento conciliado com baixa sem tarifa) -> 5.1.3
  IF cfg.favorecido_party_id IS NULL OR cfg.tarifa_chart_id IS NULL THEN
    pulos := pulos || jsonb_build_object('tarifa', 'sem_favorecido_ou_conta');
  ELSE
    FOR r IN
      SELECT f.id lid, f.financial_account_id conta, f.valor_cents v, f.data, f.raw->>'paymentId' pay
        FROM public.financial_statement_lines f
       WHERE f.kind = 'saida' AND f.raw->>'type' = 'PAYMENT_FEE' AND f.status = 'pendente' AND f.conciliado_cents = 0 AND f.valor_cents > 0
         AND coalesce(f.raw->>'paymentId', '') ~ '^pay_'
         AND EXISTS (SELECT 1 FROM public.asaas_accounts a WHERE a.financial_account_id = f.financial_account_id)
         AND EXISTS (SELECT 1 FROM public.financial_statement_lines rl WHERE rl.financial_account_id = f.financial_account_id
                       AND rl.kind = 'entrada' AND rl.raw->>'type' = 'PAYMENT_RECEIVED' AND rl.raw->>'paymentId' = f.raw->>'paymentId'
                       AND rl.status = 'conciliada')
         AND NOT EXISTS (SELECT 1 FROM public.financial_settlements s WHERE s.idempotency_key LIKE 'asaas:baixa:%:' || (f.raw->>'paymentId')
                           AND NOT s.is_reversal AND NOT EXISTS (SELECT 1 FROM public.financial_settlements x WHERE x.reversed_of = s.id))
         -- a baixa ligada ao recebimento não descontou tarifa (senão ela já está no razão)
         AND NOT EXISTS (SELECT 1 FROM public.financial_statement_lines rl
                           JOIN public.financial_reconciliation_allocations ra ON ra.line_id = rl.id
                           JOIN public.financial_reconciliations rc ON rc.id = ra.reconciliation_id AND rc.status = 'ativa'
                           JOIN public.financial_account_movements mv ON mv.settlement_id = rc.settlement_id
                          WHERE rl.financial_account_id = f.financial_account_id AND rl.raw->>'type' = 'PAYMENT_RECEIVED'
                            AND rl.raw->>'paymentId' = f.raw->>'paymentId' AND mv.valor_cents < 0)
         AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE f.id = ANY(e.line_ids))
       ORDER BY f.data, f.line_no LIMIT lim
    LOOP
      EXIT WHEN clock_timestamp() - t0 > interval '40 seconds';
      BEGIN
        SELECT owner_entity_id INTO ent FROM public.asaas_accounts WHERE financial_account_id = r.conta ORDER BY created_at LIMIT 1;
        res := public.fin_mesa_novo_conciliar(jsonb_build_object('line_id', r.lid, 'party_id', cfg.favorecido_party_id,
          'descricao', 'Tarifa Asaas do recebimento ' || r.pay, 'documento', r.pay,
          'chart_account_id', cfg.tarifa_chart_id, 'cost_center_id', cfg.tarifa_cost_center_id, 'business_entity_id', ent,
          'observacao', 'Lançado sozinho pelo Asaas: tarifa do recebimento ' || r.pay || ' (5.1.3)'));
        INSERT INTO public.asaas_auto_extrato (tipo, chave, financial_account_id, line_ids, title_id, reconciliation_id, valor_cents, detalhe, motivo, actor_id)
        VALUES ('tarifa', r.lid::text, r.conta, ARRAY[r.lid], nullif(res->>'title_id','')::uuid, nullif(res->>'id','')::uuid, r.v,
                jsonb_build_object('pay', r.pay, 'settlement_id', res->>'settlement_id'), 'Tarifa do Pix/boleto lançada em 5.1.3 (Asaas - Sistema Pagamento)', _ator);
        n_tar := n_tar + 1; v_tar := v_tar + r.v;
      EXCEPTION WHEN OTHERS THEN erros := erros + 1; ult_erro := left('tarifa ' || r.pay || ': ' || SQLERRM, 300);
      END;
    END LOOP;
  END IF;

  -- 3) notificações (WhatsApp, SMS, robô de voz) e negativação: um título por mês em 5.1.1, só de mês já fechado (+3 dias)
  IF cfg.favorecido_party_id IS NULL OR cfg.notificacao_chart_id IS NULL THEN
    pulos := pulos || jsonb_build_object('notificacoes', 'sem_favorecido_ou_conta');
  ELSE
    FOR g IN
      SELECT f.financial_account_id conta, date_trunc('month', f.data)::date mes, array_agg(f.id ORDER BY f.data, f.line_no) ids,
             sum(f.valor_cents - f.conciliado_cents)::bigint v, max(f.data) ultimo, count(*) n
        FROM public.financial_statement_lines f
       WHERE f.kind = 'saida' AND f.status = 'pendente' AND f.conciliado_cents = 0 AND f.valor_cents > 0
         AND coalesce(f.raw->>'type', '') ~ '(NOTIFICATION|MESSAGE|DUNNING).*FEE$'
         AND EXISTS (SELECT 1 FROM public.asaas_accounts a WHERE a.financial_account_id = f.financial_account_id)
         AND (date_trunc('month', f.data) + interval '1 month' + interval '3 days')::date <= hoje
         AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE f.id = ANY(e.line_ids))
       GROUP BY 1, 2 ORDER BY 2 LIMIT 24
    LOOP
      EXIT WHEN clock_timestamp() - t0 > interval '40 seconds';
      BEGIN
        SELECT owner_entity_id INTO ent FROM public.asaas_accounts WHERE financial_account_id = g.conta ORDER BY created_at LIMIT 1;
        IF public.fin_periodo_fechado(g.ultimo, ent) THEN
          pulos := pulos || jsonb_build_object('notificacoes_' || to_char(g.mes, 'YYYY-MM'), 'periodo_fechado');
          CONTINUE;
        END IF;
        SELECT count(*) INTO k FROM public.asaas_auto_extrato e
         WHERE e.tipo = 'notificacoes' AND e.chave LIKE g.conta || ':' || to_char(g.mes, 'YYYY-MM') || '%';
        ch := g.conta || ':' || to_char(g.mes, 'YYYY-MM') || CASE WHEN k > 0 THEN ':' || (k + 1) ELSE '' END;
        tit := public.fin_title_create(jsonb_build_object(
          'direction', 'payable', 'party_id', cfg.favorecido_party_id,
          'descricao', 'Notificações e negativação Asaas ' || to_char(g.mes, 'MM/YYYY') || CASE WHEN k > 0 THEN ' (complemento)' ELSE '' END,
          'documento', 'ASAAS-NOTIF-' || to_char(g.mes, 'YYYY-MM'),
          'emissao', g.ultimo::text, 'competencia', g.ultimo::text,
          'chart_account_id', cfg.notificacao_chart_id, 'cost_center_id', cfg.notificacao_cost_center_id,
          'business_entity_id', ent, 'financial_account_id', g.conta,
          'valor_cents', g.v, 'status', 'ativo', 'origem', 'conciliacao', 'sistema_origem', 'asaas', 'id_externo', 'asaas:notificacoes:' || ch,
          'observacao', 'Lançado sozinho pelo Asaas: ' || g.n || ' tarifas de notificação/negativação do mês (5.1.1)',
          'parcelas', jsonb_build_array(jsonb_build_object('vencimento', g.ultimo::text, 'valor_cents', g.v))));
        SELECT id INTO inst FROM public.financial_installments WHERE title_id = tit ORDER BY numero LIMIT 1;
        res := public.fin_reconcile(jsonb_build_object('line_ids', to_jsonb(g.ids),
          'alocacoes', jsonb_build_array(jsonb_build_object('installment_id', inst, 'valor_cents', g.v)),
          'observacao', 'Automático: notificações e negativação do Asaas ' || to_char(g.mes, 'MM/YYYY'),
          'idempotency_key', 'asaas:notificacoes:' || ch));
        INSERT INTO public.asaas_auto_extrato (tipo, chave, financial_account_id, line_ids, title_id, reconciliation_id, valor_cents, detalhe, motivo, actor_id)
        VALUES ('notificacoes', ch, g.conta, g.ids, tit, nullif(res->>'id','')::uuid, g.v,
                jsonb_build_object('mes', to_char(g.mes, 'YYYY-MM'), 'linhas', g.n, 'settlement_id', res->>'settlement_id'),
                'Notificações e negativação do mês em um título 5.1.1 (Asaas - Sistema Pagamento)', _ator);
        n_not := n_not + 1; v_not := v_not + g.v;
      EXCEPTION WHEN OTHERS THEN erros := erros + 1; ult_erro := left('notificacoes ' || to_char(g.mes, 'YYYY-MM') || ': ' || SQLERRM, 300);
      END;
    END LOOP;
  END IF;

  -- 4) transferência Asaas -> banco que já está lançada como transferência entre contas: só confere a linha
  FOR r IN
    SELECT f.id lid, f.financial_account_id conta, f.valor_cents v, f.data
      FROM public.financial_statement_lines f
     WHERE f.kind = 'saida' AND f.raw->>'type' = 'TRANSFER' AND f.status = 'pendente' AND f.conciliado_cents = 0 AND f.valor_cents > 0
       AND EXISTS (SELECT 1 FROM public.asaas_accounts a WHERE a.financial_account_id = f.financial_account_id)
       AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE f.id = ANY(e.line_ids))
     ORDER BY f.data, f.line_no LIMIT lim
  LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '40 seconds';
    BEGIN
      SELECT count(*) n, min(m.transfer_id::text)::uuid tid, min(m.data) dia INTO mov
        FROM public.financial_account_movements m JOIN public.financial_transfers tr ON tr.id = m.transfer_id
       WHERE m.financial_account_id = r.conta AND m.kind = 'transferencia_saida' AND m.valor_cents = -r.v
         AND m.data BETWEEN r.data - 2 AND r.data + 2 AND NOT tr.is_reversal
         AND NOT EXISTS (SELECT 1 FROM public.financial_transfers x WHERE x.reversed_of = tr.id)
         AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE e.tipo = 'transferencia' AND e.transfer_id = m.transfer_id AND e.desfeito_em IS NULL);
      IF mov.n <> 1 THEN
        pulos := pulos || jsonb_build_object('transferencia_' || CASE WHEN mov.n = 0 THEN 'sem_lancamento' ELSE 'ambigua' END,
                   coalesce((pulos->>('transferencia_' || CASE WHEN mov.n = 0 THEN 'sem_lancamento' ELSE 'ambigua' END))::int, 0) + 1);
        CONTINUE;
      END IF;
      -- a mesma transferência não pode servir para duas linhas iguais
      IF (SELECT count(*) FROM public.financial_statement_lines f2
           WHERE f2.financial_account_id = r.conta AND f2.kind = 'saida' AND f2.raw->>'type' = 'TRANSFER' AND f2.status = 'pendente'
             AND f2.valor_cents = r.v AND mov.dia BETWEEN f2.data - 2 AND f2.data + 2) <> 1 THEN
        pulos := pulos || jsonb_build_object('transferencia_ambigua', coalesce((pulos->>'transferencia_ambigua')::int, 0) + 1);
        CONTINUE;
      END IF;
      PERFORM public.fin_statement_line_flag(r.lid, 'ignorada',
        'Transferência entre contas já lançada em ' || to_char(mov.dia, 'DD/MM/YYYY') || ' (sem receita nem despesa) — Asaas automático');
      INSERT INTO public.asaas_auto_extrato (tipo, chave, financial_account_id, line_ids, transfer_id, valor_cents, detalhe, motivo, actor_id)
      VALUES ('transferencia', r.lid::text, r.conta, ARRAY[r.lid], mov.tid, r.v, jsonb_build_object('data_transferencia', mov.dia),
              'Transferência Asaas para o banco já lançada como transferência entre contas: linha conferida', _ator);
      n_tr := n_tr + 1; v_tr := v_tr + r.v;
    EXCEPTION WHEN OTHERS THEN erros := erros + 1; ult_erro := left('transferencia ' || r.lid || ': ' || SQLERRM, 300);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'identificados', n_id, 'identificados_cents', v_id, 'identificados_linha_conciliada', n_id_conc,
    'tarifas', n_tar, 'tarifas_cents', v_tar, 'notificacoes_meses', n_not, 'notificacoes_cents', v_not,
    'transferencias', n_tr, 'transferencias_cents', v_tr, 'pulos', pulos, 'erros', erros, 'ultimo_erro', ult_erro,
    'ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int);
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_extrato_nucleo(uuid,int) FROM PUBLIC, anon, authenticated;

-- entrada de serviço: aplica ou só mostra (prévia desfaz tudo no fim)
CREATE OR REPLACE FUNCTION public.asaas_auto_extrato_rodar(_aplicar boolean DEFAULT false, _limite int DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ator uuid; prev text; res jsonb; det text;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin'))) THEN
    RAISE EXCEPTION 'Somente o serviço roda esta função.';
  END IF;
  SELECT ator_user_id INTO ator FROM public.consultora_cobranca_config WHERE id;
  IF ator IS NULL THEN RAISE EXCEPTION 'Responsável técnico da cobrança não configurado.'; END IF;
  prev := current_setting('request.jwt.claims', true);
  PERFORM public.pdv_como(ator);
  IF _aplicar THEN
    res := public.asaas_auto_extrato_nucleo(ator, _limite);
  ELSE
    BEGIN
      res := public.asaas_auto_extrato_nucleo(ator, _limite);
      RAISE EXCEPTION USING ERRCODE = 'LDPRV', MESSAGE = 'previa', DETAIL = res::text;
    EXCEPTION WHEN SQLSTATE 'LDPRV' THEN
      GET STACKED DIAGNOSTICS det = PG_EXCEPTION_DETAIL;
      res := det::jsonb || jsonb_build_object('previa', true);
    END;
  END IF;
  PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_extrato_rodar(boolean,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_auto_extrato_rodar(boolean,int) TO service_role;

-- desfazer com motivo (pessoa com permissão de desfazer conciliação e estornar baixa)
CREATE OR REPLACE FUNCTION public.asaas_auto_extrato_desfazer(_id uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e record; c record; mot text; rc record; v_new uuid; a record; uid uuid := auth.uid();
BEGIN
  IF NOT (public.has_capability(uid, 'finance.reconcile.undo') AND public.has_capability(uid, 'finance.settlement.reverse')) THEN
    RAISE EXCEPTION 'Sem permissão para desfazer lançamentos do Asaas.';
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo para desfazer.'; END IF;
  SELECT * INTO e FROM public.asaas_auto_extrato WHERE id = _id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Registro automático não encontrado.'; END IF;
  IF e.desfeito_em IS NOT NULL THEN RAISE EXCEPTION 'Este registro já foi desfeito.'; END IF;
  mot := 'Desfeito (Asaas automático): ' || btrim(_motivo);

  IF e.tipo = 'identificacao' THEN
    -- solta a linha do extrato sem estornar a baixa da planilha (o dinheiro já estava lançado antes)
    IF e.reconciliation_id IS NOT NULL THEN
      SELECT * INTO rc FROM public.financial_reconciliations WHERE id = e.reconciliation_id FOR UPDATE;
      IF rc.status = 'ativa' THEN
        INSERT INTO public.financial_reconciliations (financial_account_id, settlement_id, status, motivo, reversed_of, is_reversal, created_by)
        VALUES (rc.financial_account_id, rc.settlement_id, 'estorno', mot, rc.id, true, uid) RETURNING id INTO v_new;
        UPDATE public.financial_reconciliations SET status = 'estornada', motivo = mot WHERE id = rc.id;
        FOR a IN SELECT * FROM public.financial_reconciliation_allocations WHERE reconciliation_id = rc.id LOOP
          UPDATE public.financial_statement_lines l
             SET conciliado_cents = greatest(l.conciliado_cents - a.valor_cents, 0),
                 status = (CASE WHEN greatest(l.conciliado_cents - a.valor_cents, 0) = 0 THEN 'pendente' ELSE 'parcial' END)::fin_statement_line_status,
                 updated_at = now()
           WHERE l.id = a.line_id;
        END LOOP;
        INSERT INTO public.financial_reconciliation_events (reconciliation_id, evento, motivo, payload, actor_id)
        VALUES (rc.id, 'desfeita', mot, jsonb_build_object('estorno_id', v_new, 'baixa_mantida', true), uid);
      END IF;
    END IF;
    SELECT * INTO c FROM public.asaas_charges WHERE id = e.charge_id FOR UPDATE;
    IF c.title_id = e.title_id THEN
      PERFORM set_config('lardann.asaas_link', 'on', true);
      UPDATE public.asaas_charges SET title_id = NULL, installment_id = NULL, reconcile_status = 'pendente',
             reconcile_note = left(mot, 500), linked_by = NULL, linked_at = NULL WHERE id = c.id;
      PERFORM set_config('lardann.asaas_link', 'off', true);
      INSERT INTO public.asaas_charge_changes (charge_id, campo, de, para, origem, actor_user_id)
      VALUES (c.id, 'title_id', c.title_id::text, NULL, 'executor_interno', uid),
             (c.id, 'installment_id', c.installment_id::text, NULL, 'executor_interno', uid);
    END IF;
    UPDATE public.financial_titles SET party_id = (e.detalhe->>'party_de')::uuid
     WHERE id = e.title_id AND party_id = (e.detalhe->>'party_para')::uuid;
    INSERT INTO public.financial_title_events (title_id, evento, payload, actor_id)
    VALUES (e.title_id, 'pessoa_identificada_desfeita', jsonb_build_object('volta_para', e.detalhe->>'party_de', 'motivo', btrim(_motivo)), uid);
  ELSIF e.tipo IN ('tarifa','notificacoes') THEN
    IF e.reconciliation_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.financial_reconciliations WHERE id = e.reconciliation_id AND status = 'ativa') THEN
      PERFORM public.fin_reconcile_undo(e.reconciliation_id, mot);
    END IF;
    IF e.title_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.financial_titles WHERE id = e.title_id AND status <> 'cancelado') THEN
      PERFORM public.fin_title_cancel(e.title_id, mot);
    END IF;
  ELSIF e.tipo = 'transferencia' THEN
    PERFORM public.fin_statement_line_flag(e.line_ids[1], 'pendente', mot);
  END IF;

  UPDATE public.asaas_auto_extrato SET desfeito_em = now(), desfeito_por = uid, desfeito_motivo = btrim(_motivo) WHERE id = e.id;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'asaas.auto.extrato.desfazer', 'asaas_auto_extrato', e.id,
          jsonb_build_object('tipo', e.tipo, 'chave', e.chave, 'motivo', btrim(_motivo), 'title_id', e.title_id, 'valor_cents', e.valor_cents));
  RETURN jsonb_build_object('ok', true, 'tipo', e.tipo);
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_extrato_desfazer(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_auto_extrato_desfazer(uuid,text) TO authenticated;

-- relatório da etapa B
CREATE OR REPLACE FUNCTION public.asaas_auto_extrato_relatorio(_de date, _ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ini timestamptz; fim timestamptz;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'finance.reconcile') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  ini := (coalesce(_de, current_date)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  fim := ((coalesce(_ate, _de, current_date) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  RETURN jsonb_build_object(
    'ligado', (SELECT extrato_ligado FROM public.asaas_auto_config WHERE id),
    'resumo', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'qtd', qtd, 'valor_cents', v) ORDER BY tipo)
       FROM (SELECT tipo, count(*) qtd, coalesce(sum(valor_cents), 0) v FROM public.asaas_auto_extrato
              WHERE desfeito_em IS NULL AND criado_em >= ini AND criado_em < fim GROUP BY tipo) z), '[]'::jsonb),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.quando DESC) FROM (
       SELECT e.id, e.tipo, e.motivo, e.valor_cents, e.criado_em quando, e.desfeito_em, e.desfeito_motivo, e.detalhe,
              c.external_id pay, p.display_name pessoa, p.code pessoa_codigo, t.numero titulo_numero
         FROM public.asaas_auto_extrato e
         LEFT JOIN public.asaas_charges c ON c.id = e.charge_id
         LEFT JOIN public.parties p ON p.id = (e.detalhe->>'party_para')::uuid
         LEFT JOIN public.financial_titles t ON t.id = e.title_id
        WHERE e.criado_em >= ini AND e.criado_em < fim
        ORDER BY e.criado_em DESC LIMIT 300) y), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_extrato_relatorio(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_auto_extrato_relatorio(date,date) TO authenticated;

-- rotina dos 10 minutos passa a rodar também a etapa B (quando a chave dela estiver ligada)
CREATE OR REPLACE FUNCTION public.asaas_auto_rodar(_limite int DEFAULT 150)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ator uuid; prev text; r record; res jsonb; t0 timestamptz := clock_timestamp();
  fila_ok int := 0; fila_erro int := 0; conta jsonb := '{}'::jsonb; erros int := 0; k text; info int := 0; recebidos int := 0;
  extrato jsonb;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin'))) THEN
    RAISE EXCEPTION 'Somente a rotina automática roda esta função.';
  END IF;
  IF NOT coalesce((SELECT ligado FROM public.asaas_auto_config WHERE id), false) THEN
    RETURN jsonb_build_object('desligado', true);
  END IF;
  SELECT ator_user_id INTO ator FROM public.consultora_cobranca_config WHERE id;
  IF ator IS NULL THEN RAISE EXCEPTION 'Responsável técnico da cobrança não configurado.'; END IF;
  prev := current_setting('request.jwt.claims', true);
  PERFORM public.pdv_como(ator);

  FOR r IN SELECT e.id FROM public.asaas_events e
            WHERE e.status = 'na_fila' AND e.processed_at IS NULL
              AND EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.account_id = e.account_id AND c.external_id = e.charge_external_id)
            ORDER BY e.received_at LIMIT 100 LOOP
    BEGIN PERFORM public.asaas_evento_processar(r.id); fila_ok := fila_ok + 1;
    EXCEPTION WHEN OTHERS THEN fila_erro := fila_erro + 1; END;
  END LOOP;

  FOR r IN SELECT c.id FROM public.asaas_charges c
            WHERE c.external_status = 'RECEIVED' AND c.installment_id IS NULL AND c.title_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_decisoes d WHERE d.charge_id = c.id
                                AND (d.desfeito_em IS NOT NULL OR d.acao <> 'excecao' OR d.atualizado_em > now() - interval '50 minutes'))
            ORDER BY c.payment_date DESC NULLS LAST LIMIT greatest(coalesce(_limite, 150), 1) LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '45 seconds';
    BEGIN
      res := public.asaas_auto_receber_nucleo(r.id, ator, false);
      k := coalesce(res->>'acao', '?') || CASE WHEN res->>'acao' = 'ignorado' THEN ':' || coalesce(res->>'motivo','') ELSE '' END;
      conta := conta || jsonb_build_object(k, coalesce((conta->>k)::int, 0) + 1);
    EXCEPTION WHEN OTHERS THEN
      erros := erros + 1;
      PERFORM public.asaas_auto_decidir(r.id, 'excecao', left('Erro ao lançar sozinho: ' || SQLERRM, 400), '{}'::jsonb,
        NULL, NULL, NULL, NULL, NULL, 0, ator);
    END;
  END LOOP;

  UPDATE public.asaas_events e SET status = 'processado'
    FROM public.asaas_event_types t
   WHERE t.event = e.event AND e.status = 'na_fila' AND e.processed_at IS NOT NULL
     AND t.efeito_recebivel IN ('atraso','confirmado_sem_baixa') AND NOT t.revisao_manual;
  GET DIAGNOSTICS info = ROW_COUNT;
  UPDATE public.asaas_events e SET status = 'processado', last_error = NULL
    FROM public.asaas_charges c JOIN public.financial_installments i ON i.id = c.installment_id
   WHERE c.account_id = e.account_id AND c.external_id = e.charge_external_id
     AND e.status = 'na_fila' AND e.processed_at IS NOT NULL AND e.event = 'PAYMENT_RECEIVED'
     AND i.settlement_status = 'liquidado';
  GET DIAGNOSTICS recebidos = ROW_COUNT;

  -- 0286: etapa B (identificar títulos da planilha, tarifas, notificações do mês, transferências)
  IF coalesce((SELECT extrato_ligado FROM public.asaas_auto_config WHERE id), false) THEN
    BEGIN
      extrato := public.asaas_auto_extrato_nucleo(ator, 200);
    EXCEPTION WHEN OTHERS THEN
      extrato := jsonb_build_object('erro', left(SQLERRM, 300));
    END;
  END IF;

  PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);
  RETURN jsonb_build_object('fila_processados', fila_ok, 'fila_erros', fila_erro, 'cobrancas', conta, 'erros', erros,
    'avisos_informativos_fechados', info, 'avisos_recebidos_fechados', recebidos, 'extrato', extrato,
    'ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int);
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_rodar(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_auto_rodar(int) TO service_role;