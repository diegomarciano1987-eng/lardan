-- Etapa E: cobrança histórica (dívidas vencidas até o corte, padrão 31/12/2025) consolidada numa fatura única por pessoa.
-- A fatura única é um acordo de 1 parcela, sem juros nem desconto, que reaproveita o fluxo oficial de acordo no Asaas.
ALTER TABLE public.cob_simulacoes ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'acordo';
ALTER TABLE public.cob_simulacoes DROP CONSTRAINT IF EXISTS cob_simulacoes_origem_check;
ALTER TABLE public.cob_simulacoes ADD CONSTRAINT cob_simulacoes_origem_check CHECK (origem IN ('acordo','historica'));

CREATE OR REPLACE FUNCTION public.cob_historica_lista(_corte date DEFAULT '2025-12-31')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.saldo_cents DESC) FROM (
    WITH ab AS (SELECT * FROM public.cob_parcelas_abertas() WHERE saldo_cents > 0),
    ant AS (SELECT party_id, array_agg(installment_id ORDER BY vencimento) ids, count(*)::int n, sum(saldo_cents)::bigint saldo,
                   min(vencimento) vmin, max(vencimento) vmax
              FROM ab WHERE vencimento <= _corte GROUP BY party_id)
    SELECT a.party_id, coalesce(p.display_name, p.legal_name) nome, p.code codigo,
      a.n parcelas, a.saldo saldo_cents, a.vmin venc_min, a.vmax venc_max, a.ids installment_ids,
      EXISTS (SELECT 1 FROM ab WHERE ab.party_id = a.party_id AND ab.vencimento > _corte) tem_recente,
      coalesce(c.etapa = 'acompanhamento', false) judicial,
      (SELECT count(*)::int FROM asaas_charges ch WHERE ch.installment_id = ANY (a.ids)
          AND ch.external_status IN ('PENDING','OVERDUE','AWAITING_RISK_ANALYSIS')
          AND NOT EXISTS (SELECT 1 FROM asaas_charge_intents ai WHERE ai.charge_id = ch.id AND ai.acordo_simulacao_id IS NOT NULL)) asaas_abertas,
      (SELECT s.id FROM cob_simulacoes s WHERE s.party_id = a.party_id AND s.status IN ('simulada','aguardando_entrada','efetivada')
          AND s.installment_ids && a.ids ORDER BY s.created_at DESC LIMIT 1) acordo_id,
      (SELECT s.origem FROM cob_simulacoes s WHERE s.party_id = a.party_id AND s.status IN ('simulada','aguardando_entrada','efetivada')
          AND s.installment_ids && a.ids ORDER BY s.created_at DESC LIMIT 1) acordo_origem
    FROM ant a JOIN parties p ON p.id = a.party_id LEFT JOIN cob_casos c ON c.party_id = a.party_id
  ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.cob_historica_lista(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_historica_lista(date) TO authenticated;

-- Prévia (_aplicar=false) ou criação das faturas únicas. Nunca cria cobrança no Asaas aqui: só o acordo de 1 parcela.
CREATE OR REPLACE FUNCTION public.cob_historica_consolidar(_parties uuid[], _vencimento date, _aplicar boolean DEFAULT false, _corte date DEFAULT '2025-12-31')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; it jsonb; res jsonb := '[]'; v_id uuid; v_lote uuid := gen_random_uuid(); motivo text; criadas int := 0; total bigint := 0;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF _aplicar AND NOT public.asaas_ator_pode(auth.uid(),'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão para gerar cobrança.'; END IF;
  IF _vencimento IS NULL OR _vencimento < hoje THEN RAISE EXCEPTION 'Vencimento da fatura precisa ser hoje ou depois.'; END IF;
  IF coalesce(array_length(_parties,1),0) = 0 THEN RAISE EXCEPTION 'Selecione ao menos uma pessoa.'; END IF;
  IF array_length(_parties,1) > 200 THEN RAISE EXCEPTION 'No máximo 200 pessoas por lote.'; END IF;
  r := public.cob_historica_lista(_corte);
  FOR it IN SELECT e FROM jsonb_array_elements(r) e WHERE (e->>'party_id')::uuid = ANY (_parties) LOOP
    motivo := CASE
      WHEN (it->>'judicial')::boolean THEN 'Está no Judicial'
      WHEN it->>'acordo_id' IS NOT NULL THEN CASE WHEN it->>'acordo_origem'='historica' THEN 'Já tem fatura única' ELSE 'Já tem acordo ativo' END
      WHEN (it->>'asaas_abertas')::int > 0 THEN 'Tem '||(it->>'asaas_abertas')||' cobrança(s) aberta(s) no Asaas: cancele antes para não cobrar duas vezes'
      ELSE NULL END;
    v_id := NULL;
    IF motivo IS NULL AND _aplicar THEN
      INSERT INTO cob_simulacoes(party_id, installment_ids, data_base, multa_pct, juros_mes_pct, principal_cents, encargos_cents, desconto_cents,
        total_cents, entrada_cents, parcelas, primeira_data, plano, observacao, status, autor_id, origem)
      VALUES ((it->>'party_id')::uuid, ARRAY(SELECT jsonb_array_elements_text(it->'installment_ids')::uuid), hoje, 0, 0,
        (it->>'saldo_cents')::bigint, 0, 0, (it->>'saldo_cents')::bigint, 0, 1, _vencimento,
        jsonb_build_array(jsonb_build_object('numero',1,'valor_cents',(it->>'saldo_cents')::bigint,'data',_vencimento)),
        'Fatura única das dívidas até '||to_char(_corte,'DD/MM/YYYY')||' (lote '||left(v_lote::text,8)||')', 'simulada', auth.uid(), 'historica')
      RETURNING id INTO v_id;
      INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
      VALUES ((it->>'party_id')::uuid,'negociacao','simulacao',
        'Fatura única histórica: '||(it->>'parcelas')||' parcela(s) somando R$ '||replace(to_char((it->>'saldo_cents')::bigint/100.0,'FM999999990.00'),'.',',')
        ||' com vencimento '||to_char(_vencimento,'DD/MM/YYYY'), ARRAY(SELECT jsonb_array_elements_text(it->'installment_ids')::uuid), auth.uid());
      criadas := criadas + 1;
    END IF;
    IF motivo IS NULL THEN total := total + (it->>'saldo_cents')::bigint; END IF;
    res := res || jsonb_build_object('party_id', it->'party_id', 'nome', it->'nome', 'saldo_cents', it->'saldo_cents',
      'parcelas', it->'parcelas', 'ok', motivo IS NULL, 'motivo', motivo, 'simulacao_id', v_id);
  END LOOP;
  IF _aplicar THEN
    INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
    VALUES (auth.uid(),'cob.historica_consolidar','cob_simulacoes',v_lote::text,
      jsonb_build_object('vencimento',_vencimento,'corte',_corte,'criadas',criadas,'total_cents',total,'itens',res));
  END IF;
  RETURN jsonb_build_object('lote', CASE WHEN _aplicar THEN v_lote END, 'aplicado', _aplicar, 'criadas', criadas, 'total_cents', total, 'itens', res);
END $$;
REVOKE ALL ON FUNCTION public.cob_historica_consolidar(uuid[], date, boolean, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_historica_consolidar(uuid[], date, boolean, date) TO authenticated;