-- 0305 · Cobranças do SmallData no Asaas sem título no Lardan (decisão do Diego, 13/11/2026):
-- a cobrança nova do acerto SUBSTITUI a dívida antiga (fiado histórico); cobrança de mesmo valor liga na dívida;
-- boleto repetido é cancelado pelo espelho oficial (0299) quando o título antigo é cancelado. Tudo auditado e desfazível por lote.

CREATE TABLE IF NOT EXISTS public.asaas_smalldata_substituicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote uuid NOT NULL,
  party_id uuid NOT NULL,
  acao text NOT NULL CHECK (acao IN ('ligar','duplicado','substituir','novo')),
  charge_ids uuid[] NOT NULL,
  novos_titulos uuid[] NOT NULL DEFAULT '{}',
  ligado_installment_id uuid,
  antigos_titulos uuid[] NOT NULL DEFAULT '{}',
  antigo_cents bigint NOT NULL DEFAULT 0,
  cobertura_cents bigint NOT NULL DEFAULT 0,
  data_referencia date,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz,
  desfeito_por uuid,
  desfeito_motivo text
);
GRANT SELECT ON public.asaas_smalldata_substituicoes TO authenticated;
GRANT ALL ON public.asaas_smalldata_substituicoes TO service_role;
ALTER TABLE public.asaas_smalldata_substituicoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asaas_smalldata_subst_ler ON public.asaas_smalldata_substituicoes;
CREATE POLICY asaas_smalldata_subst_ler ON public.asaas_smalldata_substituicoes FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.receivable.manage')));
CREATE INDEX IF NOT EXISTS asaas_smalldata_subst_lote ON public.asaas_smalldata_substituicoes (lote);
CREATE INDEX IF NOT EXISTS asaas_smalldata_subst_charges ON public.asaas_smalldata_substituicoes USING gin (charge_ids);

-- data do acerto/acordo que gerou a cobrança: R = codcli(5)+R+remessa(6)+parcela(2) → acerto SmallData;
-- 17 dígitos = codcli(5)+ddmmaaaa+parcela+total → acordo; senão a data em que o Asaas criou a cobrança.
CREATE OR REPLACE FUNCTION public.asaas_smalldata_data_ref(_charge uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    CASE WHEN c.raw->>'externalReference' ~ '^\d{5}R\d{8}$' THEN
      (SELECT la.data FROM public.legado_acertos_consultora la
        WHERE la.remessa = substr(c.raw->>'externalReference', 7, 6)::int
          AND la.codcli = substr(c.raw->>'externalReference', 1, 5)::int AND la.fonte = 'cobranca' LIMIT 1) END,
    CASE WHEN c.raw->>'externalReference' ~ '^\d{17}$' AND substr(c.raw->>'externalReference', 6, 8) ~ '^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])20\d\d$'
      THEN to_date(substr(c.raw->>'externalReference', 6, 8), 'DDMMYYYY') END,
    CASE WHEN c.raw->>'dateCreated' ~ '^\d{4}-\d{2}-\d{2}' THEN (left(c.raw->>'dateCreated', 10))::date END,
    c.due_date)
  FROM public.asaas_charges c WHERE c.id = _charge
$$;

-- Plano (somente leitura). Uma linha por pessoa (ou por cobrança quando liga/duplicado).
CREATE OR REPLACE FUNCTION public.asaas_smalldata_plano(_parties uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p record; ch record; o record; v_out jsonb := '[]'::jsonb; v_resto uuid[]; v_usados uuid[]; v_cand uuid; v_ncand int;
  v_tem_cob boolean; v_ref date; v_cob bigint; v_ant bigint; v_antigos jsonb; v_aloc boolean; v_multi boolean; v_acordo boolean;
  v_judicial boolean; v_nmesmo int; v_mantidas jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability(auth.uid(), 'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  FOR p IN
    SELECT c.party_id, array_agg(c.id ORDER BY c.due_date, c.external_id) cobs
      FROM public.asaas_charges c
     WHERE c.installment_id IS NULL AND c.title_id IS NULL AND c.party_id IS NOT NULL
       AND c.external_status IN ('PENDING','OVERDUE')
       AND (_parties IS NULL OR c.party_id = ANY(_parties))
       AND NOT EXISTS (SELECT 1 FROM public.asaas_charge_intents x WHERE x.acordo_simulacao_id IS NOT NULL
                        AND (x.charge_id = c.id OR (x.account_id = c.account_id AND x.external_id = c.external_id)))
       AND NOT EXISTS (SELECT 1 FROM public.asaas_baixas_outra_forma b WHERE b.charge_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.asaas_smalldata_substituicoes s WHERE c.id = ANY(s.charge_ids) AND s.desfeito_em IS NULL)
     GROUP BY c.party_id
  LOOP
    v_judicial := EXISTS (SELECT 1 FROM public.cob_judicial_processos jp WHERE jp.party_id = p.party_id)
               OR EXISTS (SELECT 1 FROM public.cob_judicial j WHERE j.party_id = p.party_id);
    IF v_judicial THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('party_id', p.party_id, 'acao', 'excecao', 'motivo', 'cliente_judicial', 'charge_ids', to_jsonb(p.cobs)));
      CONTINUE;
    END IF;
    v_resto := '{}'; v_usados := '{}';
    -- 1) mesmo valor de uma dívida antiga única
    FOR ch IN SELECT * FROM public.asaas_charges WHERE id = ANY(p.cobs) ORDER BY due_date, external_id LOOP
      SELECT count(*) INTO v_nmesmo FROM public.asaas_charges z WHERE z.id = ANY(p.cobs) AND z.value_cents = ch.value_cents;
      SELECT count(*), (array_agg(i.id))[1] INTO v_ncand, v_cand
        FROM public.financial_installments i JOIN public.financial_titles t ON t.id = i.title_id
       WHERE t.party_id = p.party_id AND t.direction = 'receivable' AND t.status = 'ativo' AND t.sistema_origem = 'fiado_historico'
         AND public.fin_installment_saldo(i.id) = ch.value_cents AND NOT (i.id = ANY(v_usados))
         AND NOT EXISTS (SELECT 1 FROM public.cob_simulacoes s WHERE i.id = ANY(s.installment_ids) AND s.status IN ('simulada','aguardando_entrada','efetivada'));
      IF v_ncand = 1 AND v_nmesmo = 1 THEN
        v_usados := v_usados || v_cand;
        v_tem_cob := EXISTS (SELECT 1 FROM public.asaas_charges l WHERE l.installment_id = v_cand AND l.external_status IN ('PENDING','OVERDUE'));
        IF NOT v_tem_cob THEN
          v_out := v_out || jsonb_build_array(jsonb_build_object('party_id', p.party_id, 'acao', 'ligar', 'charge_ids', jsonb_build_array(ch.id),
                     'installment_id', v_cand, 'cobertura_cents', ch.value_cents, 'antigo_cents', ch.value_cents));
        ELSE
          SELECT (SELECT count(*) FROM public.financial_installments x WHERE x.title_id = i.title_id) > 1,
                 EXISTS (SELECT 1 FROM public.financial_allocations a WHERE a.installment_id = i.id)
            INTO v_multi, v_aloc FROM public.financial_installments i WHERE i.id = v_cand;
          IF v_multi OR v_aloc THEN
            v_out := v_out || jsonb_build_array(jsonb_build_object('party_id', p.party_id, 'acao', 'excecao', 'motivo', 'repetido_com_pagamento_ou_parcelas',
                       'charge_ids', jsonb_build_array(ch.id), 'installment_id', v_cand));
          ELSE
            v_out := v_out || jsonb_build_array(jsonb_build_object('party_id', p.party_id, 'acao', 'duplicado', 'charge_ids', jsonb_build_array(ch.id),
                       'antigos', jsonb_build_array(jsonb_build_object('installment_id', v_cand,
                          'title_id', (SELECT title_id FROM public.financial_installments WHERE id = v_cand), 'saldo_cents', ch.value_cents)),
                       'cobertura_cents', ch.value_cents, 'antigo_cents', ch.value_cents));
          END IF;
        END IF;
      ELSE
        v_resto := v_resto || ch.id;
      END IF;
    END LOOP;
    IF coalesce(array_length(v_resto, 1), 0) = 0 THEN CONTINUE; END IF;
    -- 2) as demais cobranças substituem a dívida antiga vencida até a data do acerto/acordo
    SELECT max(public.asaas_smalldata_data_ref(x)) INTO v_ref FROM unnest(v_resto) x;
    SELECT coalesce(sum(value_cents), 0) INTO v_cob FROM public.asaas_charges WHERE id = ANY(v_resto);
    v_antigos := '[]'; v_ant := 0; v_aloc := false; v_multi := false; v_acordo := false; v_mantidas := '[]';
    FOR o IN
      SELECT i.id inst, t.id tit, t.numero, i.vencimento, public.fin_installment_saldo(i.id) saldo,
             EXISTS (SELECT 1 FROM public.asaas_charges l WHERE l.installment_id = i.id AND l.external_status IN ('PENDING','OVERDUE')) tem_cob,
             EXISTS (SELECT 1 FROM public.financial_allocations a JOIN public.financial_installments y ON y.id = a.installment_id WHERE y.title_id = t.id) aloc,
             (SELECT count(*) FROM public.financial_installments y WHERE y.title_id = t.id) > 1 multi,
             EXISTS (SELECT 1 FROM public.cob_simulacoes s JOIN public.financial_installments y ON y.id = ANY(s.installment_ids)
                      WHERE y.title_id = t.id AND s.status IN ('simulada','aguardando_entrada','efetivada')) acordo
        FROM public.financial_installments i JOIN public.financial_titles t ON t.id = i.title_id
       WHERE t.party_id = p.party_id AND t.direction = 'receivable' AND t.status = 'ativo' AND t.sistema_origem = 'fiado_historico'
         AND i.vencimento <= v_ref AND NOT (i.id = ANY(v_usados)) AND public.fin_installment_saldo(i.id) > 0
       ORDER BY i.vencimento
    LOOP
      IF o.tem_cob THEN
        v_mantidas := v_mantidas || jsonb_build_array(jsonb_build_object('numero', o.numero, 'saldo_cents', o.saldo, 'motivo', 'tem_boleto_proprio'));
        CONTINUE;
      END IF;
      v_antigos := v_antigos || jsonb_build_array(jsonb_build_object('installment_id', o.inst, 'title_id', o.tit, 'numero', o.numero,
                     'vencimento', o.vencimento, 'saldo_cents', o.saldo));
      v_ant := v_ant + o.saldo; v_aloc := v_aloc OR o.aloc; v_multi := v_multi OR o.multi; v_acordo := v_acordo OR o.acordo;
    END LOOP;
    IF v_acordo THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('party_id', p.party_id, 'acao', 'excecao', 'motivo', 'divida_antiga_em_acordo', 'charge_ids', to_jsonb(v_resto), 'antigos', v_antigos));
    ELSIF v_aloc OR v_multi THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('party_id', p.party_id, 'acao', 'excecao', 'motivo', 'divida_antiga_com_pagamento_parcial', 'charge_ids', to_jsonb(v_resto), 'antigos', v_antigos, 'antigo_cents', v_ant, 'cobertura_cents', v_cob));
    ELSIF v_ant > v_cob THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('party_id', p.party_id, 'acao', 'excecao', 'motivo', 'divida_antiga_maior_que_a_nova', 'charge_ids', to_jsonb(v_resto), 'antigos', v_antigos, 'antigo_cents', v_ant, 'cobertura_cents', v_cob));
    ELSE
      v_out := v_out || jsonb_build_array(jsonb_build_object('party_id', p.party_id, 'acao', CASE WHEN v_ant > 0 THEN 'substituir' ELSE 'novo' END,
                 'charge_ids', to_jsonb(v_resto), 'antigos', v_antigos, 'antigo_cents', v_ant, 'cobertura_cents', v_cob,
                 'data_referencia', v_ref, 'mantidas', v_mantidas));
    END IF;
  END LOOP;
  RETURN v_out;
END $function$;

-- Aplicar: só Master com contas a receber; cria/ligar pelos motores oficiais (fin_title_create, asaas_vincular_interno, fin_title_cancel).
CREATE OR REPLACE FUNCTION public.asaas_smalldata_aplicar(_parties uuid[] DEFAULT NULL, _limite int DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_lote uuid := gen_random_uuid(); r jsonb; c record; v_tit uuid; v_inst uuid; v_novos uuid[]; v_ant uuid[]; a jsonb;
  v_n int := 0; v_conta uuid; v_emp uuid; v_desc text; v_res jsonb := '[]'::jsonb; v_rem text; v_ref date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') OR NOT public.has_capability(auth.uid(), 'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Somente o Master com contas a receber aplica a substituição.';
  END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(public.asaas_smalldata_plano(_parties)) x
            WHERE x->>'acao' IN ('ligar','duplicado','substituir','novo') LOOP
    EXIT WHEN v_n >= greatest(coalesce(_limite, 10), 1);
    v_n := v_n + 1; v_novos := '{}'; v_ant := '{}';
    IF r->>'acao' = 'ligar' THEN
      SELECT * INTO c FROM public.asaas_charges WHERE id = (r->'charge_ids'->>0)::uuid FOR UPDATE;
      IF c.installment_id IS NOT NULL OR c.external_status NOT IN ('PENDING','OVERDUE') THEN CONTINUE; END IF;
      v_inst := (r->>'installment_id')::uuid;
      PERFORM public.asaas_vincular_interno(c.id, (SELECT title_id FROM public.financial_installments WHERE id = v_inst), v_inst,
        'SmallData: cobrança de mesmo valor ligada à dívida já lançada (0305)', auth.uid());
    ELSE
      FOR c IN SELECT * FROM public.asaas_charges WHERE id IN (SELECT (j#>>'{}')::uuid FROM jsonb_array_elements(r->'charge_ids') j) ORDER BY due_date FOR UPDATE LOOP
        IF c.installment_id IS NOT NULL OR c.title_id IS NOT NULL OR c.external_status NOT IN ('PENDING','OVERDUE') THEN
          RAISE EXCEPTION 'A cobrança % mudou desde a prévia: rode de novo.', c.external_id;
        END IF;
        SELECT financial_account_id, owner_entity_id INTO v_conta, v_emp FROM public.asaas_accounts WHERE id = c.account_id;
        v_rem := CASE WHEN c.raw->>'externalReference' ~ '^\d{5}R\d{8}$' THEN ' remessa ' || substr(c.raw->>'externalReference', 7, 6)::int ELSE '' END;
        v_ref := public.asaas_smalldata_data_ref(c.id);
        v_desc := 'Acerto SmallData' || v_rem || ' · cobrança Asaas ' || c.external_id;
        SELECT id INTO v_tit FROM public.financial_titles WHERE sistema_origem = 'asaas' AND id_externo = 'asaas:' || c.external_id;
        IF v_tit IS NULL THEN
          v_tit := public.fin_title_create(jsonb_build_object(
            'direction','receivable','party_id',c.party_id,'descricao',v_desc,'documento',c.external_id,
            'emissao', coalesce(v_ref, c.due_date)::text,'competencia', coalesce(v_ref, c.due_date)::text,'financial_account_id',v_conta,'business_entity_id',v_emp,
            'valor_cents',c.value_cents,'status','ativo','origem','conciliacao','sistema_origem','asaas','id_externo','asaas:' || c.external_id,
            'observacao','Cobrança do SmallData no Asaas: substitui a dívida antiga (decisão Diego 13/11/2026, 0305)',
            'parcelas', jsonb_build_array(jsonb_build_object('vencimento', c.due_date::text, 'valor_cents', c.value_cents))));
        END IF;
        SELECT id INTO v_inst FROM public.financial_installments WHERE title_id = v_tit ORDER BY numero LIMIT 1;
        PERFORM public.asaas_vincular_interno(c.id, v_tit, v_inst, 'SmallData: título criado para a cobrança do acerto (0305)', auth.uid());
        v_novos := v_novos || v_tit;
      END LOOP;
      FOR a IN SELECT * FROM jsonb_array_elements(coalesce(r->'antigos', '[]'::jsonb)) LOOP
        PERFORM public.fin_title_cancel((a->>'title_id')::uuid,
          'Substituída pela cobrança do SmallData ' || (SELECT string_agg(external_id, ', ') FROM public.asaas_charges
             WHERE id IN (SELECT (j#>>'{}')::uuid FROM jsonb_array_elements(r->'charge_ids') j)) || ' (0305, lote ' || v_lote || ')');
        v_ant := v_ant || (a->>'title_id')::uuid;
      END LOOP;
    END IF;
    INSERT INTO public.asaas_smalldata_substituicoes (lote, party_id, acao, charge_ids, novos_titulos, ligado_installment_id, antigos_titulos,
        antigo_cents, cobertura_cents, data_referencia, detalhe, actor_id)
    VALUES (v_lote, (r->>'party_id')::uuid, r->>'acao', ARRAY(SELECT (j#>>'{}')::uuid FROM jsonb_array_elements(r->'charge_ids') j), v_novos,
        CASE WHEN r->>'acao' = 'ligar' THEN (r->>'installment_id')::uuid END, v_ant,
        coalesce((r->>'antigo_cents')::bigint, 0), coalesce((r->>'cobertura_cents')::bigint, 0), (r->>'data_referencia')::date, r, auth.uid());
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'financeiro.asaas_smalldata_substituicao', 'parties', r->>'party_id', r || jsonb_build_object('lote', v_lote, 'novos', v_novos));
    v_res := v_res || jsonb_build_array(jsonb_build_object('party_id', r->>'party_id', 'acao', r->>'acao', 'novos', v_novos, 'antigos', v_ant));
  END LOOP;
  RETURN jsonb_build_object('lote', v_lote, 'aplicadas', v_n, 'itens', v_res);
END $function$;

-- Desfazer um lote: desliga as cobranças, cancela os títulos novos (sem pagamento) e reativa os antigos.
CREATE OR REPLACE FUNCTION public.asaas_smalldata_desfazer(_lote uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; v_n int := 0; t uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') OR NOT public.has_capability(auth.uid(), 'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Somente o Master com contas a receber desfaz.';
  END IF;
  IF length(coalesce(trim(_motivo), '')) < 5 THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  FOR s IN SELECT * FROM public.asaas_smalldata_substituicoes WHERE lote = _lote AND desfeito_em IS NULL FOR UPDATE LOOP
    IF EXISTS (SELECT 1 FROM public.financial_allocations a JOIN public.financial_installments i ON i.id = a.installment_id
                WHERE i.title_id = ANY(s.novos_titulos)) THEN
      RAISE EXCEPTION 'Um título novo já recebeu pagamento: estorne antes de desfazer.';
    END IF;
    PERFORM set_config('lardann.asaas_link', 'on', true);
    UPDATE public.asaas_charges SET title_id = NULL, installment_id = NULL, reconcile_status = 'pendente',
           reconcile_note = 'Desfeito (0305): ' || trim(_motivo), linked_by = NULL, linked_at = NULL
     WHERE id = ANY(s.charge_ids);
    PERFORM set_config('lardann.asaas_link', 'off', true);
    FOREACH t IN ARRAY s.novos_titulos LOOP
      UPDATE public.financial_titles SET status = 'cancelado', cancel_reason = left('Substituição SmallData desfeita: ' || trim(_motivo), 500) WHERE id = t;
      INSERT INTO public.financial_title_events (title_id, evento, motivo, actor_id) VALUES (t, 'cancelado', 'Substituição SmallData desfeita: ' || trim(_motivo), auth.uid());
    END LOOP;
    FOREACH t IN ARRAY s.antigos_titulos LOOP
      UPDATE public.financial_titles SET status = 'ativo', cancel_reason = NULL WHERE id = t AND status = 'cancelado';
      INSERT INTO public.financial_title_events (title_id, evento, motivo, actor_id) VALUES (t, 'reativado', 'Substituição SmallData desfeita: ' || trim(_motivo), auth.uid());
    END LOOP;
    UPDATE public.asaas_smalldata_substituicoes SET desfeito_em = now(), desfeito_por = auth.uid(), desfeito_motivo = trim(_motivo) WHERE id = s.id;
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'financeiro.asaas_smalldata_desfeita', 'asaas_smalldata_substituicoes', _lote::text, jsonb_build_object('motivo', trim(_motivo), 'itens', v_n));
  RETURN jsonb_build_object('ok', true, 'desfeitas', v_n);
END $function$;

REVOKE ALL ON FUNCTION public.asaas_smalldata_data_ref(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.asaas_smalldata_plano(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.asaas_smalldata_aplicar(uuid[], int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.asaas_smalldata_desfazer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_smalldata_data_ref(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asaas_smalldata_plano(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asaas_smalldata_aplicar(uuid[], int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asaas_smalldata_desfazer(uuid, text) TO authenticated, service_role;