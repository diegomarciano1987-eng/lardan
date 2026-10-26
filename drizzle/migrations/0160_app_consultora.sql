-- 0159 — app da consultora: financeiro, pagamentos, pendências reais, indicações, caminho para líder e Liga.
-- Não apaga nada, não remove coluna e pode rodar duas vezes.

CREATE OR REPLACE FUNCTION public.pedido_pagamento_sincronizar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o sales_orders; saldo bigint;
BEGIN
  FOR o IN SELECT * FROM sales_orders WHERE pay_installment_id = NEW.installment_id AND payment_status IN ('pendente', 'pago') FOR UPDATE LOOP
    saldo := public.fin_installment_saldo(o.pay_installment_id);
    IF coalesce(saldo, 1) <= 0 AND o.payment_status = 'pendente' THEN
      UPDATE sales_orders SET payment_status = 'pago', pay_paid_at = now(),
             status = CASE WHEN status IN ('aguardando_atendimento', 'em_atendimento', 'aguardando_pagamento') THEN 'concluido' ELSE status END
       WHERE id = o.id;
      INSERT INTO sales_order_events (order_id, kind, to_status, actor_user_id, payload)
      VALUES (o.id, 'pagamento.recebido_lardan', 'concluido', NULL, jsonb_build_object('valor_cents', o.subtotal_cents, 'abate_acerto', true, 'automatico', true));
    ELSIF coalesce(saldo, 0) > 0 AND o.payment_status = 'pago' THEN
      UPDATE sales_orders SET payment_status = 'estornado' WHERE id = o.id;
      INSERT INTO sales_order_events (order_id, kind, to_status, actor_user_id, payload)
      VALUES (o.id, 'pagamento.estornado', o.status::text, NULL, jsonb_build_object('automatico', true));
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.pedido_pagamento_sincronizar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_pedido_pagamento_sincronizar ON public.financial_allocations;
CREATE TRIGGER zz_pedido_pagamento_sincronizar AFTER INSERT ON public.financial_allocations
  FOR EACH ROW EXECUTE FUNCTION public.pedido_pagamento_sincronizar();

ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_pay_method_check;
ALTER TABLE public.sales_orders ADD CONSTRAINT sales_orders_pay_method_check CHECK (pay_method IN ('pix', 'cartao', 'depois', 'dinheiro'));
CREATE OR REPLACE FUNCTION public.consultora_pedido_pago_dinheiro(_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); o sales_orders;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id = _order AND consultora_party_id = eu FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status = 'cancelado' THEN RAISE EXCEPTION 'Este pedido foi cancelado.'; END IF;
  IF o.pay_installment_id IS NOT NULL AND o.pay_method IS DISTINCT FROM 'dinheiro' THEN
    RAISE EXCEPTION 'Este pedido já tem uma cobrança da Lardan (Pix/cartão). Se ela pagou em dinheiro, cancele a cobrança com o financeiro.';
  END IF;
  IF o.payment_status = 'pago' THEN RETURN jsonb_build_object('repetido', true); END IF;
  UPDATE sales_orders SET pay_method = 'dinheiro', payment_status = 'pago', pay_paid_at = now(),
         status = CASE WHEN status IN ('aguardando_atendimento', 'em_atendimento', 'aguardando_pagamento') THEN 'concluido' ELSE status END
   WHERE id = o.id;
  INSERT INTO sales_order_events (order_id, kind, to_status, actor_user_id, payload)
  VALUES (o.id, 'pagamento.dinheiro', 'concluido', auth.uid(), jsonb_build_object('valor_cents', o.subtotal_cents, 'abate_acerto', false));
  RETURN jsonb_build_object('repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.consultora_pedido_pago_dinheiro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_pedido_pago_dinheiro(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_recebido_lardan(_cycle uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(i.quantity::bigint * i.unit_price_cents), 0)
    FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id
   WHERE i.cycle_id = _cycle AND o.status <> 'cancelado' AND o.payment_status = 'pago'
     AND o.pay_installment_id IS NOT NULL AND coalesce(o.pay_method, '') <> 'dinheiro'
$$;
REVOKE ALL ON FUNCTION public.pre_baixa_recebido_lardan(uuid) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.kit_pre_baixas ADD COLUMN IF NOT EXISTS recebido_lardan_cents bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.pre_baixa_calculo(_pb uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p kit_pre_baixas; vendido bigint; outros bigint; base bigint; pct numeric; com bigint; recebido bigint;
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
  RETURN jsonb_build_object('vendido_cents', vendido, 'base_faixa_cents', base, 'comissao_pct', pct,
                            'comissao_cents', com, 'recebido_lardan_cents', recebido, 'valor_pagar_cents', vendido - com - recebido);
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_calculo(uuid) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.pre_baixa_fechar(uuid)'::regprocedure);
  IF position('recebido_lardan_cents' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def,
    $a$comissao_cents = (calc->>'comissao_cents')::bigint, valor_pagar_cents = (calc->>'valor_pagar_cents')::bigint,$a$,
    $b$comissao_cents = (calc->>'comissao_cents')::bigint, valor_pagar_cents = (calc->>'valor_pagar_cents')::bigint,
         recebido_lardan_cents = (calc->>'recebido_lardan_cents')::bigint,$b$);
  IF novo = def THEN RAISE EXCEPTION 'pre_baixa_fechar não tem o formato esperado.'; END IF;
  EXECUTE novo;
  def := pg_get_functiondef('public.pre_baixa_conferir(uuid,jsonb,boolean)'::regprocedure);
  novo := replace(def, $a$  valor_final := vend_final - com;$a$, $b$  valor_final := vend_final - com - p.recebido_lardan_cents;$b$);
  IF novo = def THEN RAISE EXCEPTION 'pre_baixa_conferir não tem o formato esperado.'; END IF;
  EXECUTE novo;
  def := pg_get_functiondef('public.pre_baixa_ler(uuid)'::regprocedure);
  novo := replace(def, $a$'comissao_pct', p.comissao_pct, 'comissao_cents', p.comissao_cents, 'valor_pagar_cents', p.valor_pagar_cents)$a$,
                       $b$'comissao_pct', p.comissao_pct, 'comissao_cents', p.comissao_cents, 'recebido_lardan_cents', p.recebido_lardan_cents, 'valor_pagar_cents', p.valor_pagar_cents)$b$);
  IF novo = def THEN RAISE EXCEPTION 'pre_baixa_ler não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $patch$;

CREATE OR REPLACE FUNCTION public.consultora_vendido_ciclo(_cycle uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p.id IS NOT NULL THEN
      (SELECT jsonb_build_object('vendido_cents', coalesce(sum(qtd_vendida::bigint * preco_cents), 0), 'pecas', coalesce(sum(qtd_vendida), 0))
         FROM kit_pre_baixa_itens WHERE pre_baixa_id = p.id)
    ELSE
      (SELECT jsonb_build_object('vendido_cents', coalesce(sum(i.quantity::bigint * i.unit_price_cents), 0), 'pecas', coalesce(sum(i.quantity), 0))
         FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id
        WHERE i.cycle_id = _cycle AND o.status <> 'cancelado' AND (o.payment_status = 'pago' OR o.status = 'concluido'))
    END
  FROM (SELECT 1) x LEFT JOIN kit_pre_baixas p ON p.cycle_id = _cycle
$$;
REVOKE ALL ON FUNCTION public.consultora_vendido_ciclo(uuid) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.consultora_ganhos()'::regprocedure);
  IF position('consultora_vendido_ciclo' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def,
$a$  SELECT coalesce(sum(i.quantity * i.unit_price_cents),0), coalesce(sum(i.quantity),0) INTO vendido, pecas
    FROM public.sales_order_items i JOIN public.sales_orders o ON o.id = i.order_id
   WHERE i.cycle_id = ANY (ciclos) AND o.consultora_party_id = eu AND o.status <> 'cancelado' AND (o.payment_status = 'pago' OR o.status = 'concluido');$a$,
$b$  SELECT coalesce(sum((public.consultora_vendido_ciclo(x)->>'vendido_cents')::bigint), 0), coalesce(sum((public.consultora_vendido_ciclo(x)->>'pecas')::int), 0)
    INTO vendido, pecas FROM unnest(ciclos) x;$b$);
  IF novo = def THEN RAISE EXCEPTION 'consultora_ganhos não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $patch$;

CREATE OR REPLACE FUNCTION public.consultora_meu_financeiro() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'acertos', coalesce((SELECT jsonb_agg(x ORDER BY x->>'data' DESC) FROM (
        SELECT jsonb_build_object('origem', 'lardan', 'data', coalesce(p.encerrada_em, p.fechada_em)::date, 'maleta', k.code,
          'vendido_cents', coalesce(p.vendido_final_cents, p.total_vendido_cents), 'comissao_cents', p.comissao_cents,
          'pagar_cents', coalesce(p.valor_final_cents, p.valor_pagar_cents), 'situacao', public.pre_baixa_situacao(p)) x
          FROM kit_pre_baixas p JOIN kit_cycles kc ON kc.id = p.cycle_id JOIN kits k ON k.id = kc.kit_id
         WHERE p.consultora_party_id = eu AND p.status <> 'aberta'
        UNION ALL
        SELECT jsonb_build_object('origem', 'smalldata', 'data', lc.data, 'maleta', 'Remessa ' || lc.remessa,
          'vendido_cents', lc.venda_bruta_cents, 'comissao_cents', lc.venda_bruta_cents - lc.venda_liquida_cents,
          'pagar_cents', lc.venda_liquida_cents, 'pago_cents', lc.total_pago_cents, 'situacao', 'encerrada')
          FROM legado_cobrancas lc WHERE lc.codcli = ANY (cods) AND lc.tipo IN (1, 2)
        ORDER BY 1 LIMIT 60) s), '[]'::jsonb),
    'pix', (SELECT jsonb_build_object('tipo', pix_tipo, 'chave', pix_chave, 'favorecido', pix_favorecido) FROM pedido_config));
END $$;
REVOKE ALL ON FUNCTION public.consultora_meu_financeiro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_meu_financeiro() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_debito_cobranca(_installment uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); cfg consultora_cobranca_config; i financial_installments; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501'; END IF;
  SELECT i2.* INTO i FROM financial_installments i2 JOIN financial_titles t ON t.id = i2.title_id
   WHERE i2.id = _installment AND t.direction = 'receivable' AND coalesce(t.pagador_party_id, t.party_id) = eu AND t.status NOT IN ('cancelado', 'rascunho');
  IF NOT FOUND THEN RAISE EXCEPTION 'Débito não encontrado.'; END IF;
  IF public.fin_installment_saldo(i.id) <= 0 THEN RAISE EXCEPTION 'Este débito já está pago.'; END IF;
  SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
  IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'consultora.segunda_via', 'financial_installments', i.id::text, jsonb_build_object('consultora', eu));
  RETURN jsonb_build_object('installment_id', i.id, 'actor', cfg.ator_user_id, 'vencimento', greatest(i.vencimento, hoje));
END $$;
REVOKE ALL ON FUNCTION public.consultora_debito_cobranca(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_debito_cobranca(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_debito_asaas_preparar(_actor uuid, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM consultora_cobranca_config WHERE ator_user_id = _actor) THEN RAISE EXCEPTION 'Assinatura técnica inválida.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM financial_installments i JOIN financial_titles t ON t.id = i.title_id
                   JOIN party_roles pr ON pr.party_id = coalesce(t.pagador_party_id, t.party_id) AND pr.role = 'consultora'
                 WHERE i.id = (_payload->>'installment_id')::uuid AND t.direction = 'receivable') THEN
    RAISE EXCEPTION 'Parcela não é de uma consultora.';
  END IF;
  PERFORM public.pdv_como(_actor);
  RETURN public.asaas_cobranca_preparar(_payload);
END $$;
REVOKE ALL ON FUNCTION public.consultora_debito_asaas_preparar(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_debito_asaas_preparar(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.consultant_home() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; c kit_cycles; pb kit_pre_baixas;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501';
  END IF;
  SELECT * INTO c FROM kit_cycles WHERE consultora_party_id = eu AND status IN ('recebida', 'operacao', 'acerto') ORDER BY created_at LIMIT 1;
  SELECT * INTO pb FROM kit_pre_baixas WHERE cycle_id = c.id;
  RETURN jsonb_build_object(
    'nome', (SELECT coalesce(nullif(p.social_name, ''), p.display_name) FROM parties p WHERE p.id = eu),
    'clientes', (SELECT count(*) FROM consultant_clients WHERE consultora_party_id = eu),
    'retornos_hoje', (SELECT count(*) FROM consultant_clients WHERE consultora_party_id = eu AND proximo_retorno = hoje),
    'retornos_atrasados', (SELECT count(*) FROM consultant_clients WHERE consultora_party_id = eu AND proximo_retorno < hoje),
    'pedidos_abertos', (SELECT count(*) FROM sales_orders WHERE consultora_party_id = eu AND status IN ('aguardando_atendimento', 'em_atendimento', 'aguardando_pagamento')),
    'pedidos_novos', (SELECT count(*) FROM sales_orders WHERE consultora_party_id = eu AND status = 'aguardando_atendimento'),
    'pedidos_em_atendimento', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'cliente', split_part(coalesce(o.customer_name, ''), ' ', 1),
                                 'total_cents', o.subtotal_cents, 'dias', hoje - (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'status', o.status) ORDER BY o.created_at), '[]')
                               FROM sales_orders o WHERE o.consultora_party_id = eu AND o.status IN ('em_atendimento', 'aguardando_pagamento')),
    'pedidos_mes', (SELECT count(*) FROM sales_orders WHERE consultora_party_id = eu AND created_at >= date_trunc('month', now())),
    'maletas_receber', (SELECT count(*) FROM kit_cycles WHERE consultora_party_id = eu AND status = 'transito'),
    'maletas_conferir', (SELECT count(*) FROM kit_cycles WHERE consultora_party_id = eu AND status = 'recebida'),
    'pecas_disponiveis', (SELECT coalesce(sum(b.qty_available), 0) FROM kit_balances b JOIN kit_cycles k ON k.id = b.cycle_id
                           WHERE k.consultora_party_id = eu AND k.status IN ('recebida', 'operacao')),
    'acerto', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
        'cycle_id', c.id, 'data', coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, (SELECT r.data_acerto FROM remessas r WHERE r.id = c.remessa_id)),
        'situacao', CASE WHEN pb.id IS NULL THEN 'sem_pre_baixa' ELSE public.pre_baixa_situacao(pb) END,
        'pecas_total', (SELECT coalesce(sum(qty_accepted), 0) FROM kit_balances WHERE cycle_id = c.id),
        'pecas_vendidas', (public.consultora_vendido_ciclo(c.id)->>'pecas')::int,
        'valor_cents', CASE WHEN pb.id IS NULL THEN NULL WHEN pb.status = 'aberta' THEN (public.pre_baixa_calculo(pb.id)->>'valor_pagar_cents')::bigint ELSE pb.valor_pagar_cents END) END,
    'debitos_vencidos_cents', (SELECT coalesce(sum(public.fin_installment_saldo(i.id)), 0) FROM financial_installments i JOIN financial_titles t ON t.id = i.title_id
                                WHERE t.direction = 'receivable' AND coalesce(t.pagador_party_id, t.party_id) = eu AND t.status NOT IN ('cancelado', 'rascunho')
                                  AND i.vencimento < hoje AND public.fin_installment_saldo(i.id) > 0),
    'debitos_abertos_cents', (SELECT coalesce(sum(public.fin_installment_saldo(i.id)), 0) FROM financial_installments i JOIN financial_titles t ON t.id = i.title_id
                                WHERE t.direction = 'receivable' AND coalesce(t.pagador_party_id, t.party_id) = eu AND t.status NOT IN ('cancelado', 'rascunho')
                                  AND public.fin_installment_saldo(i.id) > 0),
    'aniversarios', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', cc.id, 'nome', split_part(cc.nome, ' ', 1), 'telefone', cc.telefone,
                       'quando', CASE WHEN to_char(cc.aniversario, 'MM-DD') = to_char(hoje, 'MM-DD') THEN 'hoje' ELSE 'amanhã' END)), '[]')
                     FROM consultant_clients cc WHERE cc.consultora_party_id = eu AND cc.aniversario IS NOT NULL
                       AND to_char(cc.aniversario, 'MM-DD') IN (to_char(hoje, 'MM-DD'), to_char(hoje + 1, 'MM-DD'))),
    'recompra', (SELECT count(*) FROM consultant_clients cc WHERE cc.consultora_party_id = eu
                   AND EXISTS (SELECT 1 FROM sales_orders o WHERE o.client_id = cc.id AND o.status = 'concluido')
                   AND NOT EXISTS (SELECT 1 FROM sales_orders o WHERE o.client_id = cc.id AND o.created_at > now() - interval '45 days'))
  );
END $$;
REVOKE ALL ON FUNCTION public.consultant_home() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_home() TO authenticated, service_role;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS indicado_por_texto text;

CREATE OR REPLACE FUNCTION public.indicacao_texto_da_submissao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE txt text := nullif(left(btrim(coalesce(NEW.payload->>'quem_indicou', '')), 120), ''); quem uuid;
BEGIN
  IF txt IS NULL OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  UPDATE leads SET indicado_por_texto = txt WHERE id = NEW.lead_id AND indicado_por_texto IS NULL;
  SELECT party_id INTO quem FROM consultant_profiles WHERE referral_code = lower(txt);
  IF quem IS NOT NULL THEN
    UPDATE leads SET referred_by_party_id = quem, referred_at = now()
     WHERE id = NEW.lead_id AND referred_by_party_id IS NULL AND party_id IS DISTINCT FROM quem;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.indicacao_texto_da_submissao() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_indicacao_texto ON public.candidatura_submissions;
CREATE TRIGGER zz_indicacao_texto AFTER INSERT ON public.candidatura_submissions FOR EACH ROW EXECUTE FUNCTION public.indicacao_texto_da_submissao();

CREATE OR REPLACE FUNCTION public.indicacao_representante_do_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rep uuid;
BEGIN
  IF NEW.referred_by_party_id IS NULL OR NEW.representante_party_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT representative_party_id INTO rep FROM consultant_profiles WHERE party_id = NEW.referred_by_party_id;
  IF rep IS NOT NULL THEN NEW.representante_party_id := rep; NEW.representante_origem := 'madrinha'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.indicacao_representante_do_lead() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_indicacao_representante ON public.leads;
CREATE TRIGGER zz_indicacao_representante BEFORE INSERT OR UPDATE OF referred_by_party_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.indicacao_representante_do_lead();

CREATE OR REPLACE FUNCTION public.indicacao_representante_do_perfil() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m consultant_profiles;
BEGIN
  IF NEW.sponsor_party_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO m FROM consultant_profiles WHERE party_id = NEW.sponsor_party_id;
  NEW.representative_party_id := coalesce(NEW.representative_party_id, m.representative_party_id);
  NEW.praca_id := coalesce(NEW.praca_id, m.praca_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.indicacao_representante_do_perfil() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_indicacao_representante_perfil ON public.consultant_profiles;
CREATE TRIGGER zz_indicacao_representante_perfil BEFORE INSERT OR UPDATE OF sponsor_party_id ON public.consultant_profiles
  FOR EACH ROW EXECUTE FUNCTION public.indicacao_representante_do_perfil();

CREATE OR REPLACE FUNCTION public.consultora_madrinha_definir(_party uuid, _madrinha uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE antes uuid;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.manage') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF _madrinha = _party THEN RAISE EXCEPTION 'A consultora não pode ser madrinha dela mesma.'; END IF;
  IF _madrinha IS NOT NULL AND NOT EXISTS (SELECT 1 FROM party_roles WHERE party_id = _madrinha AND role = 'consultora') THEN
    RAISE EXCEPTION 'A madrinha precisa ser consultora.';
  END IF;
  SELECT sponsor_party_id INTO antes FROM consultant_profiles WHERE party_id = _party;
  INSERT INTO consultant_profiles (party_id, sponsor_party_id, sponsor_set_at, sponsor_origin) VALUES (_party, _madrinha, now(), 'manual')
  ON CONFLICT (party_id) DO UPDATE SET sponsor_party_id = excluded.sponsor_party_id, sponsor_set_at = now(), sponsor_origin = 'manual';
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'consultora.madrinha', 'consultant_profiles', _party::text, jsonb_build_object('antes', antes, 'depois', _madrinha));
END $$;
REVOKE ALL ON FUNCTION public.consultora_madrinha_definir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_madrinha_definir(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_madrinha_ler(_party uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('madrinha_id', cp.sponsor_party_id, 'madrinha', mp.display_name, 'origem', cp.sponsor_origin, 'em', cp.sponsor_set_at,
         'texto_formulario', (SELECT l.indicado_por_texto FROM leads l WHERE l.party_id = _party AND l.indicado_por_texto IS NOT NULL ORDER BY l.created_at DESC LIMIT 1))
    FROM (SELECT 1) x LEFT JOIN consultant_profiles cp ON cp.party_id = _party LEFT JOIN parties mp ON mp.id = cp.sponsor_party_id
   WHERE public.has_capability(auth.uid(), 'registry.view')
$$;
REVOKE ALL ON FUNCTION public.consultora_madrinha_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_madrinha_ler(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.indicada_situacao(_lead leads) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _lead.outcome = 'perdida' THEN 'nao_seguiu'
    WHEN _lead.party_id IS NOT NULL AND (SELECT count(*) FROM kit_cycles c WHERE c.consultora_party_id = _lead.party_id AND c.status NOT IN ('cancelada', 'rascunho', 'montagem')) >= 2
         AND EXISTS (SELECT 1 FROM parties p WHERE p.id = _lead.party_id AND p.status = 'ativo') THEN 'ativa'
    WHEN _lead.party_id IS NOT NULL AND EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id = _lead.party_id AND c.status NOT IN ('cancelada', 'rascunho')) THEN 'primeira_maleta'
    WHEN _lead.outcome = 'ganha' OR _lead.party_id IS NOT NULL THEN 'aprovada'
    ELSE 'candidata' END
$$;
REVOKE ALL ON FUNCTION public.indicada_situacao(leads) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.minhas_indicacoes()'::regprocedure);
  IF position('indicada_situacao' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def, $a$'situacao', CASE WHEN l.outcome='ganha' THEN 'aprovada' WHEN l.outcome='perdida' THEN 'nao_seguiu' ELSE 'em_analise' END)$a$,
                       $b$'situacao', public.indicada_situacao(l))$b$);
  IF novo = def THEN RAISE EXCEPTION 'minhas_indicacoes não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $patch$;

CREATE TABLE IF NOT EXISTS public.lider_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  indicadas_ativas_min integer NOT NULL DEFAULT 3,
  venda_ciclo_min_cents bigint NOT NULL DEFAULT 65000,
  comissao_pct numeric(5,2) NOT NULL DEFAULT 0,
  comissao_ativa boolean NOT NULL DEFAULT false,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.lider_config (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lideres (
  party_id uuid PRIMARY KEY REFERENCES public.parties(id),
  status text NOT NULL CHECK (status IN ('solicitado', 'aprovado', 'recusado', 'suspenso')),
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  decidido_por uuid,
  decidido_em timestamptz,
  motivo text
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lider_config','lideres'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.lider_indicadas_ativas(_party uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT cp.party_id)::int FROM consultant_profiles cp JOIN parties p ON p.id = cp.party_id AND p.status = 'ativo'
   WHERE cp.sponsor_party_id = _party
     AND EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id = cp.party_id AND c.status NOT IN ('cancelada', 'rascunho', 'montagem')
                  AND coalesce(c.shipped_at, c.created_at) > now() - interval '90 days')
$$;
REVOKE ALL ON FUNCTION public.lider_indicadas_ativas(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.meu_caminho_lider() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); cfg lider_config; ativas int; venda bigint; c kit_cycles; st text;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501'; END IF;
  SELECT * INTO cfg FROM lider_config;
  ativas := public.lider_indicadas_ativas(eu);
  SELECT * INTO c FROM kit_cycles WHERE consultora_party_id = eu AND status NOT IN ('cancelada', 'rascunho', 'montagem') ORDER BY created_at DESC LIMIT 1;
  venda := CASE WHEN c.id IS NULL THEN 0 ELSE (public.consultora_vendido_ciclo(c.id)->>'vendido_cents')::bigint END;
  SELECT status INTO st FROM lideres WHERE party_id = eu;
  RETURN jsonb_build_object('indicadas_ativas', ativas, 'indicadas_ativas_min', cfg.indicadas_ativas_min,
    'venda_ciclo_cents', venda, 'venda_ciclo_min_cents', cfg.venda_ciclo_min_cents,
    'cumpre', ativas >= cfg.indicadas_ativas_min AND venda >= cfg.venda_ciclo_min_cents, 'status', st);
END $$;
REVOKE ALL ON FUNCTION public.meu_caminho_lider() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_caminho_lider() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lider_solicitar() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); c jsonb;
BEGIN
  c := public.meu_caminho_lider();
  IF NOT (c->>'cumpre')::boolean THEN RAISE EXCEPTION 'Você ainda não cumpre os critérios para líder.'; END IF;
  IF c->>'status' IN ('solicitado', 'aprovado') THEN RETURN c->>'status'; END IF;
  INSERT INTO lideres (party_id, status) VALUES (eu, 'solicitado')
  ON CONFLICT (party_id) DO UPDATE SET status = 'solicitado', solicitado_em = now(), decidido_por = NULL, decidido_em = NULL, motivo = NULL;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload) VALUES (auth.uid(), 'lider.solicitado', 'lideres', eu::text, c);
  RETURN 'solicitado';
END $$;
REVOKE ALL ON FUNCTION public.lider_solicitar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lider_solicitar() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lider_decidir(_party uuid, _status text, _motivo text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master aprova líderes.' USING errcode = '42501'; END IF;
  IF _status NOT IN ('aprovado', 'recusado', 'suspenso') THEN RAISE EXCEPTION 'Situação inválida.'; END IF;
  INSERT INTO lideres (party_id, status, decidido_por, decidido_em, motivo) VALUES (_party, _status, auth.uid(), now(), _motivo)
  ON CONFLICT (party_id) DO UPDATE SET status = excluded.status, decidido_por = auth.uid(), decidido_em = now(), motivo = excluded.motivo;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload) VALUES (auth.uid(), 'lider.' || _status, 'lideres', _party::text, jsonb_build_object('motivo', _motivo));
END $$;
REVOKE ALL ON FUNCTION public.lider_decidir(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lider_decidir(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lider_admin() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'master') OR public.has_role(auth.uid(), 'diretoria')) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object('config', (SELECT to_jsonb(c) - 'id' FROM lider_config c),
    'lideres', coalesce((SELECT jsonb_agg(jsonb_build_object('party_id', l.party_id, 'nome', p.display_name, 'status', l.status, 'solicitado_em', l.solicitado_em,
                 'indicadas_ativas', public.lider_indicadas_ativas(l.party_id), 'motivo', l.motivo) ORDER BY l.status, l.solicitado_em DESC)
               FROM lideres l JOIN parties p ON p.id = l.party_id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.lider_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lider_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lider_config_salvar(_indicadas int, _venda_cents bigint, _comissao_pct numeric, _comissao_ativa boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master altera os critérios de líder.' USING errcode = '42501'; END IF;
  IF _indicadas < 1 OR _venda_cents < 0 OR _comissao_pct < 0 OR _comissao_pct > 20 THEN RAISE EXCEPTION 'Valores inválidos.'; END IF;
  UPDATE lider_config SET indicadas_ativas_min = _indicadas, venda_ciclo_min_cents = _venda_cents, comissao_pct = _comissao_pct,
         comissao_ativa = coalesce(_comissao_ativa, false), atualizado_por = auth.uid(), atualizado_em = now();
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'lider.config', 'lider_config', 'lider', jsonb_build_object('indicadas', _indicadas, 'venda_cents', _venda_cents, 'comissao_pct', _comissao_pct, 'comissao_ativa', _comissao_ativa));
END $$;
REVOKE ALL ON FUNCTION public.lider_config_salvar(int, bigint, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lider_config_salvar(int, bigint, numeric, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.minha_equipe() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id();
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT EXISTS (SELECT 1 FROM lideres WHERE party_id = eu AND status = 'aprovado') THEN
    RAISE EXCEPTION 'A aba Minha equipe é liberada para líderes aprovadas pela Lardan.' USING errcode = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'nome', split_part(p.display_name, ' ', 1) || ' ' || left(coalesce(nullif(split_part(p.display_name, ' ', 2), ''), ''), 1) || '.',
      'status', p.status,
      'maleta', (SELECT jsonb_build_object('acerto', (c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, 'vendido_cents', (public.consultora_vendido_ciclo(c.id)->>'vendido_cents')::bigint)
                   FROM kit_cycles c WHERE c.consultora_party_id = p.id AND c.status IN ('recebida', 'operacao', 'acerto') ORDER BY c.created_at DESC LIMIT 1),
      'ativa', public.lider_indicadas_ativas(eu) > 0 AND EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id = p.id AND coalesce(c.shipped_at, c.created_at) > now() - interval '90 days'))
      ORDER BY p.display_name)
    FROM consultant_profiles cp JOIN parties p ON p.id = cp.party_id WHERE cp.sponsor_party_id = eu), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.minha_equipe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minha_equipe() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.liga_niveis (
  ordem integer PRIMARY KEY,
  nome text NOT NULL,
  ciclos_min integer NOT NULL,
  venda_min_cents bigint NOT NULL
);
ALTER TABLE public.liga_niveis ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.liga_niveis FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.liga_niveis TO service_role;
INSERT INTO public.liga_niveis (ordem, nome, ciclos_min, venda_min_cents)
SELECT * FROM (VALUES (1, 'Bronze', 0, 65000), (2, 'Prata', 2, 65000), (3, 'Ouro', 4, 65000), (4, 'Diamante', 8, 65000)) v
 WHERE NOT EXISTS (SELECT 1 FROM public.liga_niveis);

CREATE OR REPLACE FUNCTION public.liga_ciclos(_party uuid, _min bigint) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT count(*) FROM kit_pre_baixas p WHERE p.consultora_party_id = _party AND p.status IN ('encerrada', 'pendencia')
            AND p.encerrada_em > now() - interval '12 months' AND coalesce(p.vendido_final_cents, p.total_vendido_cents) >= _min)::int
       + (SELECT count(*) FROM legado_maletas m WHERE m.codcli = ANY (public.legado_codigos_da_pessoa(_party)) AND m.tipo = 'remessa'
            AND m.fechamento > (now() - interval '12 months')::date AND coalesce(m.valor_venda_cents, m.valor_vendido_cents, 0) >= _min)::int
$$;
REVOKE ALL ON FUNCTION public.liga_ciclos(uuid, bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.minha_liga() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); atual liga_niveis; prox liga_niveis; n int;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501'; END IF;
  SELECT l.* INTO atual FROM liga_niveis l WHERE public.liga_ciclos(eu, l.venda_min_cents) >= l.ciclos_min ORDER BY l.ordem DESC LIMIT 1;
  SELECT l.* INTO prox FROM liga_niveis l WHERE l.ordem > coalesce(atual.ordem, 0) ORDER BY l.ordem LIMIT 1;
  n := CASE WHEN prox.ordem IS NULL THEN NULL ELSE public.liga_ciclos(eu, prox.venda_min_cents) END;
  RETURN jsonb_build_object('nivel', atual.nome, 'proximo', prox.nome, 'ciclos', n, 'ciclos_min', prox.ciclos_min,
    'faltam', CASE WHEN prox.ordem IS NULL THEN 0 ELSE greatest(prox.ciclos_min - n, 0) END, 'venda_min_cents', prox.venda_min_cents,
    'niveis', (SELECT jsonb_agg(jsonb_build_object('nome', nome, 'ciclos_min', ciclos_min, 'venda_min_cents', venda_min_cents) ORDER BY ordem) FROM liga_niveis));
END $$;
REVOKE ALL ON FUNCTION public.minha_liga() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minha_liga() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.liga_niveis_ler() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY ordem), '[]'::jsonb) FROM liga_niveis l WHERE auth.uid() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.liga_niveis_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liga_niveis_ler() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.liga_niveis_salvar(_niveis jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master altera a Liga.' USING errcode = '42501'; END IF;
  IF jsonb_typeof(_niveis) <> 'array' OR jsonb_array_length(_niveis) < 1 THEN RAISE EXCEPTION 'Informe os níveis.'; END IF;
  DELETE FROM liga_niveis;
  INSERT INTO liga_niveis (ordem, nome, ciclos_min, venda_min_cents)
  SELECT (x->>'ordem')::int, btrim(x->>'nome'), (x->>'ciclos_min')::int, (x->>'venda_min_cents')::bigint FROM jsonb_array_elements(_niveis) x;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload) VALUES (auth.uid(), 'liga.niveis', 'liga_niveis', 'liga', _niveis);
END $$;
REVOKE ALL ON FUNCTION public.liga_niveis_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liga_niveis_salvar(jsonb) TO authenticated, service_role;

UPDATE public.help_articles SET
  titulo = regexp_replace(titulo, 'Jornada', 'Minhas clientes', 'g'),
  resumo = regexp_replace(coalesce(resumo, ''), 'Jornada', 'Minhas clientes', 'g'),
  corpo = regexp_replace(regexp_replace(coalesce(corpo, ''), 'Jornada', 'Minhas clientes', 'g'), '(aba|menu|em) “?Clientes”?', '\1 “Minhas clientes”', 'g'),
  updated_at = now()
 WHERE titulo ~ 'Jornada' OR coalesce(resumo, '') ~ 'Jornada' OR coalesce(corpo, '') ~ 'Jornada|(aba|menu|em) “?Clientes”?';