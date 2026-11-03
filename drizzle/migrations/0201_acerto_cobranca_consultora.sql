-- 0200 — Cobrança da consultora e o acerto da maleta (03/11/2026). Acerto conferido intocado; ajuste idempotente.
CREATE TABLE IF NOT EXISTS public.consultora_acerto_ajustes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_baixa_id uuid NOT NULL REFERENCES public.kit_pre_baixas(id),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id),
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id),
  order_id uuid NOT NULL REFERENCES public.sales_orders(id),
  tipo text NOT NULL CHECK (tipo IN ('credito','debito')),
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  abatido_cents bigint NOT NULL DEFAULT 0 CHECK (abatido_cents >= 0),
  compensado_cents bigint NOT NULL DEFAULT 0 CHECK (compensado_cents >= 0),
  title_id uuid REFERENCES public.financial_titles(id),
  motivo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consultora_acerto_ajustes_party_idx ON public.consultora_acerto_ajustes (consultora_party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS consultora_acerto_ajustes_pedido_idx ON public.consultora_acerto_ajustes (order_id, cycle_id);
ALTER TABLE public.consultora_acerto_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consultora_acerto_ajustes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consultora_acerto_ajustes TO authenticated;
GRANT ALL ON public.consultora_acerto_ajustes TO service_role;
DROP POLICY IF EXISTS consultora_acerto_ajustes_ler ON public.consultora_acerto_ajustes;
CREATE POLICY consultora_acerto_ajustes_ler ON public.consultora_acerto_ajustes FOR SELECT TO authenticated
  USING (consultora_party_id = public.my_party_id() OR public.kit_cycle_in_scope(cycle_id) OR public.cob_pode(auth.uid()));
COMMENT ON TABLE public.consultora_acerto_ajustes IS
  '0200: crédito/débito da consultora quando a cliente paga (ou estorna) à Lardan depois da conferência do acerto. Só acerto_ajuste_conciliar escreve; linhas nunca mudam.';

CREATE OR REPLACE FUNCTION public.acerto_ajuste_conciliar(_order uuid, _aplicar boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o sales_orders; r record; pb kit_pre_baixas; ev text; pago_agora boolean; pago_conf boolean;
  desejado bigint; atual bigint; delta bigint; res jsonb := '[]'::jsonb; resto bigint; abat bigint; inst record; sd bigint;
  pend bigint; comp bigint; tit bigint; cfg consultora_cobranca_config; tid uuid; prev text; txt text; valor text;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO o FROM sales_orders WHERE id = _order;
  IF o.id IS NULL OR o.pay_installment_id IS NULL OR coalesce(o.pay_method, '') = 'dinheiro' THEN RETURN res; END IF;
  pago_agora := o.payment_status = 'pago' AND o.status <> 'cancelado';
  FOR r IN SELECT i.cycle_id, sum(i.quantity::bigint * i.unit_price_cents)::bigint AS v
             FROM sales_order_items i WHERE i.order_id = _order AND i.cycle_id IS NOT NULL GROUP BY i.cycle_id ORDER BY i.cycle_id
  LOOP
    IF _aplicar THEN SELECT * INTO pb FROM kit_pre_baixas WHERE cycle_id = r.cycle_id FOR UPDATE;
    ELSE SELECT * INTO pb FROM kit_pre_baixas WHERE cycle_id = r.cycle_id; END IF;
    CONTINUE WHEN pb.id IS NULL OR pb.conferida_em IS NULL OR coalesce(r.v, 0) <= 0;
    ev := NULL;
    SELECT e.kind INTO ev FROM sales_order_events e
     WHERE e.order_id = _order AND e.kind IN ('pagamento.recebido_lardan', 'pagamento.estornado') AND e.created_at <= pb.conferida_em
     ORDER BY e.created_at DESC LIMIT 1;
    pago_conf := CASE WHEN ev IS NOT NULL THEN ev = 'pagamento.recebido_lardan'
                      ELSE o.pay_paid_at IS NOT NULL AND o.pay_paid_at <= pb.conferida_em AND o.payment_status IN ('pago', 'estornado') END;
    desejado := (CASE WHEN pago_agora THEN r.v ELSE 0 END) - (CASE WHEN pago_conf THEN r.v ELSE 0 END);
    SELECT coalesce(sum(CASE WHEN a.tipo = 'credito' THEN a.valor_cents ELSE -a.valor_cents END), 0) INTO atual
      FROM consultora_acerto_ajustes a WHERE a.order_id = _order AND a.cycle_id = r.cycle_id;
    delta := desejado - atual;
    CONTINUE WHEN delta = 0;
    res := res || jsonb_build_object('pedido', o.code, 'order_id', _order, 'cycle_id', r.cycle_id, 'pre_baixa_id', pb.id,
                                     'consultora_party_id', pb.consultora_party_id,
                                     'tipo', CASE WHEN delta > 0 THEN 'credito' ELSE 'debito' END, 'valor_cents', abs(delta));
    CONTINUE WHEN NOT _aplicar;

    IF delta > 0 THEN
      resto := delta; abat := 0;
      FOR inst IN SELECT fi.id FROM financial_installments fi JOIN financial_titles t ON t.id = fi.title_id
                   WHERE t.id IN (pb.title_id, pb.pendencia_title_id) AND t.direction = 'receivable'
                     AND t.status NOT IN ('cancelado', 'rascunho')
                   ORDER BY fi.vencimento, fi.id
      LOOP
        EXIT WHEN resto <= 0;
        sd := greatest(coalesce(public.fin_installment_saldo(inst.id), 0), 0);
        CONTINUE WHEN sd <= 0;
        INSERT INTO financial_adjustments (installment_id, kind, valor_cents, motivo, created_by)
        VALUES (inst.id, 'abatimento', least(sd, resto),
                'Cliente pagou à Lardan depois da conferência do acerto (pedido ' || coalesce(o.code, '?') || ')', auth.uid());
        PERFORM public.fin_installment_refresh(inst.id);
        abat := abat + least(sd, resto); resto := resto - least(sd, resto);
      END LOOP;
      valor := replace(to_char(delta / 100.0, 'FM999999990.00'), '.', ',');
      txt := 'Cliente pagou à Lardan depois da conferência (pedido ' || coalesce(o.code, '?') || '): crédito de R$ ' || valor
          || CASE WHEN abat > 0 THEN ', R$ ' || replace(to_char(abat / 100.0, 'FM999999990.00'), '.', ',') || ' abatido do acerto em aberto' ELSE '' END
          || CASE WHEN resto > 0 THEN ', R$ ' || replace(to_char(resto / 100.0, 'FM999999990.00'), '.', ',') || ' a devolver à consultora' ELSE '' END || '.';
      INSERT INTO consultora_acerto_ajustes (pre_baixa_id, cycle_id, consultora_party_id, order_id, tipo, valor_cents, abatido_cents, motivo)
      VALUES (pb.id, r.cycle_id, pb.consultora_party_id, _order, 'credito', delta, abat, txt);
      UPDATE kit_pre_baixas
         SET status = CASE WHEN resto > 0 THEN 'pendencia' ELSE status END,
             pendencia_resolvida_em = CASE WHEN resto > 0 THEN NULL ELSE pendencia_resolvida_em END,
             pendencia_motivo = concat_ws(' · ', nullif(btrim(coalesce(pendencia_motivo, '')), ''), txt),
             updated_at = now()
       WHERE id = pb.id;
    ELSE
      SELECT greatest(coalesce(sum(CASE WHEN a.tipo = 'credito' THEN a.valor_cents - a.abatido_cents ELSE -a.compensado_cents END), 0), 0)
        INTO pend FROM consultora_acerto_ajustes a WHERE a.order_id = _order AND a.cycle_id = r.cycle_id;
      IF pb.status <> 'pendencia' THEN pend := 0; END IF;
      comp := least(-delta, pend); tit := -delta - comp; tid := NULL;
      IF tit > 0 THEN
        SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
        IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan não configurada: não dá para lançar o débito do estorno.'; END IF;
        prev := current_setting('request.jwt.claims', true);
        PERFORM public.pdv_como(cfg.ator_user_id);
        tid := public.fin_title_create(jsonb_build_object('direction', 'receivable', 'business_entity_id', cfg.business_entity_id,
          'party_id', pb.consultora_party_id, 'descricao', 'Estorno de pagamento da cliente (pedido ' || coalesce(o.code, '?') || ') depois do acerto',
          'documento', 'ACERTO-AJ-' || coalesce(o.code, left(_order::text, 8)), 'emissao', hoje, 'competencia', hoje,
          'valor_cents', tit, 'financial_account_id', cfg.financial_account_id, 'origem', 'pre_baixa', 'sistema_origem', 'pre_baixa_ajuste',
          'id_externo', 'acerto-ajuste:' || _order || ':' || r.cycle_id || ':' || (SELECT count(*) FROM consultora_acerto_ajustes a WHERE a.order_id = _order AND a.cycle_id = r.cycle_id),
          'status', 'ativo', 'parcelas', jsonb_build_array(jsonb_build_object('valor_cents', tit, 'vencimento', hoje + 7))));
        PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);
      END IF;
      valor := replace(to_char(-delta / 100.0, 'FM999999990.00'), '.', ',');
      txt := 'Pagamento da cliente estornado depois da conferência (pedido ' || coalesce(o.code, '?') || '): R$ ' || valor
          || CASE WHEN comp > 0 THEN ' descontado do crédito ainda não devolvido' ELSE '' END
          || CASE WHEN tit > 0 THEN CASE WHEN comp > 0 THEN ' e' ELSE '' END || ' R$ ' || replace(to_char(tit / 100.0, 'FM999999990.00'), '.', ',') || ' lançado como débito da consultora' ELSE '' END || '.';
      INSERT INTO consultora_acerto_ajustes (pre_baixa_id, cycle_id, consultora_party_id, order_id, tipo, valor_cents, compensado_cents, title_id, motivo)
      VALUES (pb.id, r.cycle_id, pb.consultora_party_id, _order, 'debito', -delta, comp, tid, txt);
      UPDATE kit_pre_baixas SET pendencia_motivo = concat_ws(' · ', nullif(btrim(coalesce(pendencia_motivo, '')), ''), txt), updated_at = now()
       WHERE id = pb.id;
    END IF;
    INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
    SELECT r.cycle_id, 'acerto.ajuste_pos_conferencia', c.status, c.status, NULL,
           jsonb_build_object('pedido', _order, 'tipo', CASE WHEN delta > 0 THEN 'credito' ELSE 'debito' END, 'valor_cents', abs(delta), 'pre_baixa', pb.id)
      FROM kit_cycles c WHERE c.id = r.cycle_id;
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'pre_baixa.ajuste_pos_conferencia', 'kit_pre_baixas', pb.id::text,
            jsonb_build_object('pedido', _order, 'tipo', CASE WHEN delta > 0 THEN 'credito' ELSE 'debito' END, 'valor_cents', abs(delta), 'cycle_id', r.cycle_id));
  END LOOP;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.acerto_ajuste_conciliar(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acerto_ajuste_conciliar(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.acerto_ajustes_reprocessar(_aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o record; res jsonb := '[]'::jsonb; servico boolean := auth.uid() IS NULL
  AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
BEGIN
  IF NOT (servico OR coalesce(public.has_role(auth.uid(), 'master'), false)) THEN
    RAISE EXCEPTION 'Somente o Master.' USING errcode = '42501';
  END IF;
  FOR o IN SELECT DISTINCT so.id FROM sales_orders so
             JOIN sales_order_items i ON i.order_id = so.id
             JOIN kit_pre_baixas pb ON pb.cycle_id = i.cycle_id
            WHERE so.pay_installment_id IS NOT NULL AND pb.conferida_em IS NOT NULL
  LOOP
    res := res || public.acerto_ajuste_conciliar(o.id, coalesce(_aplicar, false));
  END LOOP;
  IF coalesce(_aplicar, false) THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'pre_baixa.ajustes_reprocessados', 'consultora_acerto_ajustes', NULL, jsonb_build_object('ajustes', jsonb_array_length(res)));
  END IF;
  RETURN jsonb_build_object('aplicado', coalesce(_aplicar, false), 'total', jsonb_array_length(res), 'ajustes', res);
END $$;
REVOKE ALL ON FUNCTION public.acerto_ajustes_reprocessar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acerto_ajustes_reprocessar(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pedido_pagamento_sincronizar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o sales_orders; saldo bigint; novo sales_order_status;
BEGIN
  FOR o IN SELECT * FROM sales_orders WHERE pay_installment_id = NEW.installment_id AND payment_status IN ('pendente', 'pago') FOR UPDATE LOOP
    saldo := public.fin_installment_saldo(o.pay_installment_id);
    IF coalesce(saldo, 1) <= 0 AND o.payment_status = 'pendente' THEN
      novo := CASE WHEN o.status = 'aguardando_pagamento' THEN 'em_atendimento'::sales_order_status ELSE o.status END;
      UPDATE sales_orders SET payment_status = 'pago', pay_paid_at = now(), status = novo WHERE id = o.id;
      INSERT INTO sales_order_events (order_id, kind, from_status, to_status, actor_user_id, payload)
      VALUES (o.id, 'pagamento.recebido_lardan', o.status::text, novo::text, NULL, jsonb_build_object('valor_cents', o.subtotal_cents, 'abate_acerto', true, 'automatico', true));
      BEGIN
        PERFORM public.acerto_ajuste_conciliar(o.id, true);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
        VALUES (NULL, 'pre_baixa.ajuste_falhou', 'sales_orders', o.id::text, jsonb_build_object('erro', SQLERRM, 'tipo', 'credito'));
      END;
    ELSIF coalesce(saldo, 0) > 0 AND o.payment_status = 'pago' THEN
      UPDATE sales_orders SET payment_status = 'estornado' WHERE id = o.id;
      INSERT INTO sales_order_events (order_id, kind, from_status, to_status, actor_user_id, payload)
      VALUES (o.id, 'pagamento.estornado', o.status::text, o.status::text, NULL, jsonb_build_object('automatico', true));
      BEGIN
        PERFORM public.acerto_ajuste_conciliar(o.id, true);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
        VALUES (NULL, 'pre_baixa.ajuste_falhou', 'sales_orders', o.id::text, jsonb_build_object('erro', SQLERRM, 'tipo', 'debito'));
      END;
    END IF;
  END LOOP;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.pre_baixa_calculo(_pb uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p kit_pre_baixas; vendido bigint; outros bigint; base bigint; pct numeric; com bigint; recebido bigint; aguardando bigint;
BEGIN
  SELECT * INTO p FROM kit_pre_baixas WHERE id = _pb;
  SELECT coalesce(sum(qtd_vendida::bigint * preco_cents), 0) INTO vendido FROM kit_pre_baixa_itens WHERE pre_baixa_id = _pb;
  SELECT coalesce(sum(coalesce(o.vendido_final_cents, o.total_vendido_cents)), 0) INTO outros
    FROM kit_pre_baixas o WHERE o.remessa_id = p.remessa_id AND p.remessa_id IS NOT NULL
     AND o.consultora_party_id = p.consultora_party_id AND o.id <> p.id AND o.status IN ('fechada', 'encerrada', 'pendencia');
  base := vendido + outros;
  pct := public.pre_baixa_faixa(base);
  com := round(vendido * pct / 100);
  recebido := public.pre_baixa_recebido_lardan(p.cycle_id);
  SELECT coalesce(sum(i.quantity::bigint * i.unit_price_cents), 0) INTO aguardando
    FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id
   WHERE i.cycle_id = p.cycle_id AND o.status <> 'cancelado' AND o.payment_status = 'pendente'
     AND o.pay_installment_id IS NOT NULL AND coalesce(o.pay_method, '') <> 'dinheiro';
  RETURN jsonb_build_object('vendido_cents', vendido, 'base_faixa_cents', base, 'comissao_pct', pct,
                            'comissao_cents', com, 'recebido_lardan_cents', recebido, 'aguardando_lardan_cents', aguardando, 'valor_pagar_cents', vendido - com - recebido);
END $function$;

CREATE OR REPLACE FUNCTION public.pre_baixa_comissao_final(_p public.kit_pre_baixas)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN _p.vendido_final_cents IS NOT NULL AND _p.valor_final_cents IS NOT NULL
              THEN _p.vendido_final_cents - _p.valor_final_cents - coalesce(_p.recebido_lardan_cents, 0)
              ELSE _p.comissao_cents END
$$;
REVOKE ALL ON FUNCTION public.pre_baixa_comissao_final(public.kit_pre_baixas) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_comissao_final(public.kit_pre_baixas) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_meu_financeiro()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE eu uuid := public.my_party_id(); hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; c kit_cycles; prox jsonb; cods int[];
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE consultora_party_id = eu AND status IN ('recebida', 'operacao', 'acerto') ORDER BY created_at LIMIT 1;
  IF c.id IS NOT NULL THEN
    SELECT jsonb_build_object('cycle_id', c.id, 'maleta', (SELECT code FROM kits WHERE id = c.kit_id),
      'data', coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto),
      'dias', coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto) - hoje,
      'situacao', coalesce(public.pre_baixa_situacao(p), 'sem_pre_baixa'),
      'valor_cents', CASE WHEN p.id IS NULL THEN NULL WHEN p.status = 'aberta' THEN (public.pre_baixa_calculo(p.id)->>'valor_pagar_cents')::bigint ELSE p.valor_pagar_cents END,
      'installment_id', p.installment_id)
      INTO prox FROM (SELECT 1) x LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN kit_pre_baixas p ON p.cycle_id = c.id;
  END IF;
  cods := public.legado_codigos_da_pessoa(eu);
  RETURN jsonb_build_object(
    'proximo_acerto', prox,
    'debitos', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'installment_id', i.id, 'descricao', t.descricao, 'origem', t.sistema_origem, 'vencimento', i.vencimento,
        'valor_cents', i.valor_cents, 'saldo_cents', public.fin_installment_saldo(i.id), 'atraso', greatest(hoje - i.vencimento, 0),
        'url', (SELECT ch.invoice_url FROM asaas_charges ch WHERE ch.installment_id = i.id AND ch.external_status NOT IN ('DELETED', 'REFUNDED') ORDER BY ch.updated_at DESC NULLS LAST LIMIT 1))
        ORDER BY i.vencimento)
      FROM financial_installments i JOIN financial_titles t ON t.id = i.title_id
     WHERE t.direction = 'receivable' AND coalesce(t.pagador_party_id, t.party_id) = eu AND t.status NOT IN ('cancelado', 'rascunho')
       AND public.fin_installment_saldo(i.id) > 0), '[]'::jsonb),
    'acertos', coalesce((SELECT jsonb_agg(x ORDER BY x->>'data' DESC) FROM (SELECT u.x FROM (
        SELECT jsonb_build_object('origem', 'lardan', 'data', coalesce(p.encerrada_em, p.fechada_em)::date, 'maleta', k.code,
          'vendido_cents', coalesce(p.vendido_final_cents, p.total_vendido_cents), 'comissao_cents', public.pre_baixa_comissao_final(p),
          'pagar_cents', coalesce(p.valor_final_cents, p.valor_pagar_cents), 'situacao', public.pre_baixa_situacao(p),
          'motivo', CASE WHEN p.status = 'pendencia' THEN p.pendencia_motivo END) x
          FROM kit_pre_baixas p JOIN kit_cycles kc ON kc.id = p.cycle_id JOIN kits k ON k.id = kc.kit_id
         WHERE p.consultora_party_id = eu AND p.status <> 'aberta'
        UNION ALL
        SELECT jsonb_build_object('origem', 'smalldata', 'data', lc.data, 'maleta', 'Remessa ' || lc.remessa,
          'vendido_cents', lc.venda_bruta_cents, 'comissao_cents', lc.venda_bruta_cents - lc.venda_liquida_cents,
          'pagar_cents', lc.venda_liquida_cents, 'pago_cents', lc.total_pago_cents, 'situacao', 'encerrada')
          FROM legado_cobrancas lc WHERE lc.codcli = ANY (cods) AND lc.tipo IN (1, 2)
        ) u ORDER BY (u.x->>'data') DESC NULLS LAST LIMIT 60) s), '[]'::jsonb),
    'cobrancas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'codigo', o.code, 'cliente', o.customer_name, 'valor_cents', o.subtotal_cents,
        'forma', o.pay_method, 'vencimento', o.pay_due_date, 'situacao', o.payment_status, 'pago_em', o.pay_paid_at,
        'url', o.pay_url, 'criado_em', o.created_at) ORDER BY o.created_at DESC)
      FROM (SELECT * FROM sales_orders s WHERE s.consultora_party_id = eu AND s.pay_installment_id IS NOT NULL
               AND s.status <> 'cancelado' AND coalesce(s.pay_method, '') <> 'dinheiro'
             ORDER BY s.created_at DESC LIMIT 40) o), '[]'::jsonb),
    'ajustes', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', a.tipo, 'valor_cents', a.valor_cents, 'abatido_cents', a.abatido_cents,
        'motivo', a.motivo, 'data', a.created_at,
        'maleta', (SELECT k.code FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id WHERE kc.id = a.cycle_id),
        'resolvido', (SELECT pb.status = 'encerrada' FROM kit_pre_baixas pb WHERE pb.id = a.pre_baixa_id)) ORDER BY a.created_at DESC)
      FROM consultora_acerto_ajustes a WHERE a.consultora_party_id = eu), '[]'::jsonb),
    'pix', (SELECT jsonb_build_object('tipo', pix_tipo, 'chave', pix_chave, 'favorecido', pix_favorecido) FROM pedido_config));
END $function$;

CREATE OR REPLACE FUNCTION public.consultant_order_create(_client uuid, _itens jsonb, _idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  eu uuid := public.my_party_id(); cli public.consultant_clients; existente public.sales_orders;
  pedido uuid; item jsonb; vid uuid; cyc uuid; q integer; preco integer; b public.kit_balances;
  total bigint := 0; contagem integer := 0; ja integer;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501';
  END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN RAISE EXCEPTION 'Chave do pedido inválida.'; END IF;
  SELECT * INTO existente FROM public.sales_orders WHERE idempotency_key = _idempotency_key;
  IF existente.id IS NOT NULL THEN
    IF existente.consultora_party_id IS DISTINCT FROM eu THEN RAISE EXCEPTION 'Chave do pedido inválida.'; END IF;
    RETURN jsonb_build_object('order_id', existente.id, 'codigo', existente.code, 'total_cents', existente.subtotal_cents, 'repetido', true);
  END IF;
  SELECT * INTO cli FROM public.consultant_clients WHERE id = _client AND consultora_party_id = eu;
  IF cli.id IS NULL THEN RAISE EXCEPTION 'Escolha uma cliente sua.'; END IF;
  IF jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 THEN RAISE EXCEPTION 'Escolha pelo menos uma peça.'; END IF;
  IF jsonb_array_length(_itens) > 60 THEN RAISE EXCEPTION 'Pedido grande demais.'; END IF;

  INSERT INTO public.sales_orders (consultora_party_id, client_id, customer_name, customer_phone, customer_email, channel, status, idempotency_key)
  VALUES (eu, cli.id, cli.nome, cli.telefone, cli.email, 'consultora', 'em_atendimento', _idempotency_key)
  RETURNING id INTO pedido;

  FOR item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    vid := (item->>'variant_id')::uuid; cyc := (item->>'cycle_id')::uuid;
    q := coalesce((item->>'quantidade')::integer, 0);
    IF q < 1 OR q > 99 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.kit_cycles c WHERE c.id = cyc AND c.consultora_party_id = eu AND c.status IN ('recebida','operacao')) THEN
      RAISE EXCEPTION 'Essa peça não está numa maleta ativa sua.';
    END IF;
    SELECT * INTO b FROM public.kit_balances WHERE cycle_id = cyc AND variant_id = vid FOR UPDATE;
    IF b.id IS NULL OR b.qty_available < q THEN
      RAISE EXCEPTION 'Restam apenas % unidade(s) de uma das peças.', greatest(coalesce(b.qty_available,0),0);
    END IF;
    SELECT coalesce(sum(i.quantity), 0)::int INTO ja FROM public.sales_order_items i JOIN public.sales_orders o ON o.id = i.order_id
     WHERE i.cycle_id = cyc AND i.variant_id = vid AND o.status <> 'cancelado' AND o.channel = 'consultora' AND o.client_id IS NOT NULL;
    IF b.qty_available - ja < q THEN
      RAISE EXCEPTION 'Esta peça já está em outro pedido seu. Restam % unidade(s) livre(s) na maleta.', greatest(b.qty_available - ja, 0);
    END IF;
    preco := public.kit_preco(cyc, vid);
    INSERT INTO public.sales_order_items (order_id, cycle_id, variant_id, product_name, variant_label, quantity, unit_price_cents)
    SELECT pedido, cyc, vid, pr.name, v.label, q, preco FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id WHERE v.id = vid;
    total := total + preco::bigint * q; contagem := contagem + q;
  END LOOP;

  UPDATE public.sales_orders SET subtotal_cents = total, items_count = contagem WHERE id = pedido;
  INSERT INTO public.sales_order_events (order_id, kind, to_status, actor_user_id, payload)
  VALUES (pedido, 'pedido.criado_consultora', 'em_atendimento', auth.uid(), jsonb_build_object('itens', contagem, 'reserva', false));
  RETURN jsonb_build_object('order_id', pedido, 'codigo', (SELECT code FROM public.sales_orders WHERE id = pedido), 'total_cents', total);
END $function$;