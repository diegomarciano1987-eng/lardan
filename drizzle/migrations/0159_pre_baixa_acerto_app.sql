-- 0158 — acerto pelo app (pré-baixa). Não apaga nada, não remove coluna e pode rodar duas vezes.

CREATE TABLE IF NOT EXISTS public.kit_pre_baixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL UNIQUE REFERENCES public.kit_cycles(id),
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id),
  remessa_id uuid REFERENCES public.remessas(id),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'fechada', 'encerrada', 'pendencia', 'cancelada')),
  prazo date,
  total_vendido_cents bigint NOT NULL DEFAULT 0,
  base_faixa_cents bigint NOT NULL DEFAULT 0,
  comissao_pct numeric(5,2) NOT NULL DEFAULT 0,
  comissao_cents bigint NOT NULL DEFAULT 0,
  valor_pagar_cents bigint NOT NULL DEFAULT 0,
  title_id uuid REFERENCES public.financial_titles(id),
  installment_id uuid REFERENCES public.financial_installments(id),
  fechada_em timestamptz,
  fechada_por uuid,
  conferida_em timestamptz,
  conferida_por uuid,
  encerrada_em timestamptz,
  vendido_final_cents bigint,
  valor_final_cents bigint,
  diferenca_cents bigint,
  pendencia_title_id uuid REFERENCES public.financial_titles(id),
  pendencia_motivo text,
  pendencia_resolvida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kit_pre_baixas_consultora ON public.kit_pre_baixas (consultora_party_id, status);

CREATE TABLE IF NOT EXISTS public.kit_pre_baixa_itens (
  pre_baixa_id uuid NOT NULL REFERENCES public.kit_pre_baixas(id),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  qtd_enviada integer NOT NULL,
  qtd_app integer NOT NULL DEFAULT 0,
  qtd_vendida integer NOT NULL DEFAULT 0,
  preco_cents integer NOT NULL,
  qtd_lida integer,
  qtd_faltando integer NOT NULL DEFAULT 0,
  qtd_voltou_vendida integer NOT NULL DEFAULT 0,
  etiqueta_atualizada boolean NOT NULL DEFAULT false,
  PRIMARY KEY (pre_baixa_id, variant_id),
  CHECK (qtd_vendida BETWEEN 0 AND qtd_enviada AND qtd_app <= qtd_enviada)
);

CREATE TABLE IF NOT EXISTS public.kit_pre_baixa_liberacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id),
  motivo text NOT NULL,
  ator uuid NOT NULL,
  usada_em timestamptz,
  usada_no_ciclo uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kit_pre_baixas','kit_pre_baixa_itens','kit_pre_baixa_liberacoes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.pre_baixa_pode(_cycle uuid, _escrever boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM kit_cycles c WHERE c.id = _cycle AND c.consultora_party_id = public.my_party_id()
             AND public.has_role(auth.uid(), 'consultora'))
    OR public.has_capability(auth.uid(), 'kit.manage')
    OR (NOT _escrever AND (public.has_capability(auth.uid(), 'kit.view.all') OR public.cob_pode(auth.uid()))))
$$;
REVOKE ALL ON FUNCTION public.pre_baixa_pode(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pre_baixa_qtd_app(_cycle uuid, _variant uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(i.quantity), 0)::int FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id
   WHERE i.cycle_id = _cycle AND i.variant_id = _variant
     AND o.status <> 'cancelado' AND (o.status = 'concluido' OR o.payment_status = 'pago')
$$;
REVOKE ALL ON FUNCTION public.pre_baixa_qtd_app(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pre_baixa_faixa(_vendido bigint) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT percentual FROM consultora_comissao_faixas WHERE min_vendido_cents <= coalesce(_vendido, 0)
                    ORDER BY min_vendido_cents DESC LIMIT 1), 0)
$$;
REVOKE ALL ON FUNCTION public.pre_baixa_faixa(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_faixa(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_pago(_pb public.kit_pre_baixas) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _pb.status IN ('fechada', 'encerrada', 'pendencia') AND (
    coalesce(_pb.valor_pagar_cents, 0) = 0
    OR EXISTS (SELECT 1 FROM financial_installments i WHERE i.id = _pb.installment_id AND i.settlement_status IN ('liquidado', 'excedente')))
$$;
REVOKE ALL ON FUNCTION public.pre_baixa_pago(public.kit_pre_baixas) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pre_baixa_situacao(_pb public.kit_pre_baixas) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _pb.status = 'fechada' AND public.pre_baixa_pago(_pb) THEN 'aguardando_conferencia'
    WHEN _pb.status = 'fechada' THEN 'aguardando_pagamento'
    ELSE _pb.status END
$$;
REVOKE ALL ON FUNCTION public.pre_baixa_situacao(public.kit_pre_baixas) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pre_baixa_abrir(_cycle uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c kit_cycles; v uuid; r remessas;
BEGIN
  IF NOT public.pre_baixa_pode(_cycle, true) THEN RAISE EXCEPTION 'Sem acesso a esta maleta.' USING errcode = '42501'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora.'; END IF;
  SELECT id INTO v FROM kit_pre_baixas WHERE cycle_id = _cycle;
  IF v IS NOT NULL THEN
    UPDATE kit_pre_baixa_itens i SET qtd_app = least(public.pre_baixa_qtd_app(_cycle, i.variant_id), i.qtd_enviada),
           qtd_vendida = greatest(i.qtd_vendida, least(public.pre_baixa_qtd_app(_cycle, i.variant_id), i.qtd_enviada))
      FROM kit_pre_baixas p WHERE p.id = v AND p.status = 'aberta' AND i.pre_baixa_id = v;
    RETURN v;
  END IF;
  IF c.status NOT IN ('recebida', 'operacao', 'acerto') THEN
    RAISE EXCEPTION 'A pré-baixa abre depois que a consultora aceita a maleta.';
  END IF;
  SELECT * INTO r FROM remessas WHERE id = c.remessa_id;
  INSERT INTO kit_pre_baixas (cycle_id, consultora_party_id, remessa_id, prazo)
  VALUES (_cycle, c.consultora_party_id, c.remessa_id,
          coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto))
  RETURNING id INTO v;
  INSERT INTO kit_pre_baixa_itens (pre_baixa_id, variant_id, qtd_enviada, qtd_app, qtd_vendida, preco_cents)
  SELECT v, b.variant_id, b.qty_accepted,
         least(public.pre_baixa_qtd_app(_cycle, b.variant_id), b.qty_accepted),
         least(public.pre_baixa_qtd_app(_cycle, b.variant_id), b.qty_accepted),
         public.kit_preco(_cycle, b.variant_id)
    FROM kit_balances b WHERE b.cycle_id = _cycle AND b.qty_accepted > 0;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'pre_baixa.aberta', c.status, c.status, auth.uid(), jsonb_build_object('pre_baixa', v));
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_abrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_abrir(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_calculo(_pb uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p kit_pre_baixas; vendido bigint; outros bigint; base bigint; pct numeric; com bigint;
BEGIN
  SELECT * INTO p FROM kit_pre_baixas WHERE id = _pb;
  SELECT coalesce(sum(qtd_vendida::bigint * preco_cents), 0) INTO vendido FROM kit_pre_baixa_itens WHERE pre_baixa_id = _pb;
  SELECT coalesce(sum(coalesce(o.vendido_final_cents, o.total_vendido_cents)), 0) INTO outros
    FROM kit_pre_baixas o WHERE o.remessa_id = p.remessa_id AND p.remessa_id IS NOT NULL
     AND o.consultora_party_id = p.consultora_party_id AND o.id <> p.id AND o.status IN ('fechada', 'encerrada', 'pendencia');
  base := vendido + outros;
  pct := public.pre_baixa_faixa(base);
  com := round(vendido * pct / 100);
  RETURN jsonb_build_object('vendido_cents', vendido, 'base_faixa_cents', base, 'comissao_pct', pct,
                            'comissao_cents', com, 'valor_pagar_cents', vendido - com);
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_calculo(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pre_baixa_ler(_cycle uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p kit_pre_baixas; calc jsonb; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.pre_baixa_pode(_cycle) THEN RAISE EXCEPTION 'Sem acesso a esta maleta.' USING errcode = '42501'; END IF;
  SELECT * INTO p FROM kit_pre_baixas WHERE cycle_id = _cycle;
  IF NOT FOUND THEN RETURN NULL; END IF;
  calc := CASE WHEN p.status = 'aberta' THEN public.pre_baixa_calculo(p.id)
               ELSE jsonb_build_object('vendido_cents', p.total_vendido_cents, 'base_faixa_cents', p.base_faixa_cents,
                      'comissao_pct', p.comissao_pct, 'comissao_cents', p.comissao_cents, 'valor_pagar_cents', p.valor_pagar_cents) END;
  RETURN jsonb_build_object(
    'id', p.id, 'cycle_id', p.cycle_id, 'status', p.status, 'situacao', public.pre_baixa_situacao(p),
    'prazo', p.prazo, 'dias_para_prazo', CASE WHEN p.prazo IS NOT NULL THEN p.prazo - hoje END,
    'fechada_em', p.fechada_em, 'encerrada_em', p.encerrada_em, 'installment_id', p.installment_id,
    'diferenca_cents', p.diferenca_cents, 'pendencia_motivo', p.pendencia_motivo,
    'calculo', calc,
    'faixas', coalesce((SELECT jsonb_agg(jsonb_build_object('min_cents', min_vendido_cents, 'percentual', percentual) ORDER BY min_vendido_cents)
                         FROM consultora_comissao_faixas), '[]'::jsonb),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'variant_id', i.variant_id, 'sku', coalesce(nullif(v.sku, ''), pr.internal_code), 'barcode', v.barcode, 'produto', pr.name, 'variante', v.label,
        'media_id', (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1),
        'enviada', i.qtd_enviada, 'app', i.qtd_app, 'vendida', i.qtd_vendida, 'preco_cents', i.preco_cents,
        'lida', i.qtd_lida, 'faltando', i.qtd_faltando, 'voltou_vendida', i.qtd_voltou_vendida,
        'etiqueta_nova', i.preco_cents <> public.kit_reference_price(i.variant_id), 'etiqueta_atualizada', i.etiqueta_atualizada)
        ORDER BY pr.name, v.label)
      FROM kit_pre_baixa_itens i JOIN product_variants v ON v.id = i.variant_id JOIN products pr ON pr.id = v.product_id
     WHERE i.pre_baixa_id = p.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_ler(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_vender(_cycle uuid, _variant uuid, _qtd integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid; it kit_pre_baixa_itens;
BEGIN
  v := public.pre_baixa_abrir(_cycle);
  IF (SELECT status FROM kit_pre_baixas WHERE id = v) <> 'aberta' THEN
    RAISE EXCEPTION 'A pré-baixa desta maleta já foi fechada.';
  END IF;
  SELECT * INTO it FROM kit_pre_baixa_itens WHERE pre_baixa_id = v AND variant_id = _variant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta peça não está na sua maleta.'; END IF;
  IF _qtd IS NULL OR _qtd < it.qtd_app THEN
    RAISE EXCEPTION 'Esta peça já tem % venda(s) paga(s) pelo app; não dá para marcar menos.', it.qtd_app;
  END IF;
  IF _qtd > it.qtd_enviada THEN RAISE EXCEPTION 'Você recebeu só % desta peça.', it.qtd_enviada; END IF;
  UPDATE kit_pre_baixa_itens SET qtd_vendida = _qtd WHERE pre_baixa_id = v AND variant_id = _variant;
  UPDATE kit_pre_baixas SET updated_at = now() WHERE id = v;
  RETURN public.pre_baixa_calculo(v);
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_vender(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_vender(uuid, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_fechar(_cycle uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v uuid; p kit_pre_baixas; calc jsonb; cfg consultora_cobranca_config; tid uuid; inst uuid;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; k text; nome text;
BEGIN
  v := public.pre_baixa_abrir(_cycle);
  SELECT * INTO p FROM kit_pre_baixas WHERE id = v FOR UPDATE;
  IF p.status <> 'aberta' THEN
    RETURN jsonb_build_object('pre_baixa', p.id, 'repetida', true, 'installment_id', p.installment_id,
      'actor', (SELECT ator_user_id FROM consultora_cobranca_config WHERE id), 'valor_pagar_cents', p.valor_pagar_cents,
      'vencimento', greatest(coalesce(p.prazo, hoje), hoje));
  END IF;
  calc := public.pre_baixa_calculo(v);
  UPDATE kit_pre_baixas SET status = 'fechada', total_vendido_cents = (calc->>'vendido_cents')::bigint,
         base_faixa_cents = (calc->>'base_faixa_cents')::bigint, comissao_pct = (calc->>'comissao_pct')::numeric,
         comissao_cents = (calc->>'comissao_cents')::bigint, valor_pagar_cents = (calc->>'valor_pagar_cents')::bigint,
         fechada_em = now(), fechada_por = uid, updated_at = now()
   WHERE id = v;
  IF (calc->>'valor_pagar_cents')::bigint > 0 THEN
    SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
    IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
    SELECT kk.code INTO k FROM kits kk JOIN kit_cycles c ON c.kit_id = kk.id WHERE c.id = _cycle;
    SELECT display_name INTO nome FROM parties WHERE id = p.consultora_party_id;
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (uid, 'pre_baixa.fechada', 'kit_pre_baixas', v::text, calc || jsonb_build_object('ator_real', uid));
    PERFORM public.pdv_como(cfg.ator_user_id);
    tid := public.fin_title_create(jsonb_build_object('direction', 'receivable', 'business_entity_id', cfg.business_entity_id,
      'party_id', p.consultora_party_id, 'descricao', 'Acerto da maleta ' || coalesce(k, '') || ' — ' || coalesce(nome, 'consultora'),
      'documento', 'ACERTO-' || coalesce(k, left(v::text, 8)), 'emissao', hoje, 'competencia', hoje,
      'valor_cents', (calc->>'valor_pagar_cents')::bigint, 'financial_account_id', cfg.financial_account_id,
      'origem', 'pre_baixa', 'sistema_origem', 'pre_baixa', 'id_externo', 'prebaixa:' || v, 'status', 'ativo',
      'parcelas', jsonb_build_array(jsonb_build_object('valor_cents', (calc->>'valor_pagar_cents')::bigint,
                                                       'vencimento', greatest(coalesce(p.prazo, hoje), hoje)))));
    SELECT id INTO inst FROM financial_installments WHERE title_id = tid ORDER BY numero LIMIT 1;
    UPDATE kit_pre_baixas SET title_id = tid, installment_id = inst WHERE id = v;
  END IF;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  SELECT _cycle, 'pre_baixa.fechada', c.status, c.status, uid, calc FROM kit_cycles c WHERE c.id = _cycle;
  RETURN jsonb_build_object('pre_baixa', v, 'repetida', false, 'installment_id', inst,
    'actor', (SELECT ator_user_id FROM consultora_cobranca_config WHERE id), 'valor_pagar_cents', (calc->>'valor_pagar_cents')::bigint,
    'vencimento', greatest(coalesce(p.prazo, hoje), hoje));
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_fechar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_fechar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_asaas_preparar(_actor uuid, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM consultora_cobranca_config WHERE ator_user_id = _actor) THEN RAISE EXCEPTION 'Assinatura técnica inválida.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM kit_pre_baixas WHERE installment_id = (_payload->>'installment_id')::uuid AND status IN ('fechada', 'pendencia')) THEN
    RAISE EXCEPTION 'Parcela não pertence a uma pré-baixa fechada.';
  END IF;
  PERFORM public.pdv_como(_actor);
  RETURN public.asaas_cobranca_preparar(_payload);
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_asaas_preparar(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pre_baixa_asaas_preparar(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_conferir(_cycle uuid, _leituras jsonb, _aplicar boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p kit_pre_baixas; c kit_cycles; it record; vend_final bigint := 0; outros bigint; base bigint; pct numeric; com bigint;
  valor_final bigint; dif bigint; faltam int := 0; voltaram int := 0; itens jsonb := '[]'::jsonb; ret jsonb; mov uuid; conf jsonb;
  cfg consultora_cobranca_config; tid uuid; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; desconhecida text;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid, 'kit.manage') THEN RAISE EXCEPTION 'Sem permissão para conferir o acerto.' USING errcode = '42501'; END IF;
  SELECT * INTO p FROM kit_pre_baixas WHERE cycle_id = _cycle FOR UPDATE;
  IF NOT FOUND OR p.status = 'aberta' THEN RAISE EXCEPTION 'A consultora ainda não fechou a pré-baixa desta maleta.'; END IF;
  IF p.status IN ('encerrada', 'pendencia') THEN RAISE EXCEPTION 'Este acerto já foi conferido.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  SELECT string_agg(x->>'variant_id', ', ') INTO desconhecida FROM jsonb_array_elements(coalesce(_leituras, '[]')) x
   WHERE NOT EXISTS (SELECT 1 FROM kit_pre_baixa_itens i WHERE i.pre_baixa_id = p.id AND i.variant_id = (x->>'variant_id')::uuid);
  IF desconhecida IS NOT NULL THEN RAISE EXCEPTION 'Peça lida que não é desta maleta: %', desconhecida; END IF;

  FOR it IN
    SELECT i.*, greatest(coalesce((SELECT sum((x->>'qtd')::int) FROM jsonb_array_elements(coalesce(_leituras, '[]')) x
                                    WHERE (x->>'variant_id')::uuid = i.variant_id), 0), 0)::int lida
      FROM kit_pre_baixa_itens i WHERE i.pre_baixa_id = p.id
  LOOP
    IF it.lida > it.qtd_enviada THEN RAISE EXCEPTION 'Foram lidas mais peças (%) do que as enviadas (%) de %.', it.lida, it.qtd_enviada, it.variant_id; END IF;
    faltam := faltam + greatest(it.qtd_enviada - it.qtd_vendida - it.lida, 0);
    voltaram := voltaram + greatest(it.lida - (it.qtd_enviada - it.qtd_vendida), 0);
    vend_final := vend_final + (it.qtd_enviada - it.lida)::bigint * it.preco_cents;
    itens := itens || jsonb_build_object('variant_id', it.variant_id, 'enviada', it.qtd_enviada, 'vendida', it.qtd_vendida, 'lida', it.lida,
      'faltando', greatest(it.qtd_enviada - it.qtd_vendida - it.lida, 0), 'voltou_vendida', greatest(it.lida - (it.qtd_enviada - it.qtd_vendida), 0),
      'preco_cents', it.preco_cents);
  END LOOP;
  SELECT coalesce(sum(coalesce(o.vendido_final_cents, o.total_vendido_cents)), 0) INTO outros
    FROM kit_pre_baixas o WHERE o.remessa_id = p.remessa_id AND p.remessa_id IS NOT NULL
     AND o.consultora_party_id = p.consultora_party_id AND o.id <> p.id AND o.status IN ('fechada', 'encerrada', 'pendencia');
  base := vend_final + outros;
  pct := public.pre_baixa_faixa(base);
  com := round(vend_final * pct / 100);
  valor_final := vend_final - com;
  dif := valor_final - p.valor_pagar_cents;

  ret := jsonb_build_object('pecas_faltando', faltam, 'pecas_voltaram_vendidas', voltaram, 'vendido_declarado_cents', p.total_vendido_cents,
    'vendido_final_cents', vend_final, 'comissao_pct', pct, 'comissao_cents', com, 'valor_final_cents', valor_final,
    'valor_pre_baixa_cents', p.valor_pagar_cents, 'diferenca_cents', dif, 'bateu', faltam = 0 AND voltaram = 0,
    'pre_baixa_paga', public.pre_baixa_pago(p), 'itens', itens);
  IF NOT coalesce(_aplicar, false) THEN RETURN ret || jsonb_build_object('aplicado', false); END IF;

  UPDATE kit_pre_baixa_itens i SET qtd_lida = (x->>'lida')::int, qtd_faltando = (x->>'faltando')::int, qtd_voltou_vendida = (x->>'voltou_vendida')::int
    FROM jsonb_array_elements(itens) x WHERE i.pre_baixa_id = p.id AND i.variant_id = (x->>'variant_id')::uuid;

  IF (SELECT coalesce(sum((x->>'lida')::int), 0) FROM jsonb_array_elements(itens) x) > 0 THEN
    mov := (public.kit_retorno(_cycle, jsonb_build_object('idempotency_key', 'pre-baixa-retorno:' || p.id, 'note', 'Conferência do acerto (pré-baixa)',
            'itens', (SELECT jsonb_agg(jsonb_build_object('variant_id', x->>'variant_id', 'quantity', (x->>'lida')::int, 'destino', 'retorno'))
                        FROM jsonb_array_elements(itens) x WHERE (x->>'lida')::int > 0)))->>'movement_id')::uuid;
    SELECT jsonb_agg(jsonb_build_object('item_id', mi.id, 'qty_recebida', mi.quantity, 'qty_aprovada', mi.quantity, 'qty_divergente', 0))
      INTO conf FROM kit_movement_items mi WHERE mi.movement_id = mov;
    PERFORM public.kit_retorno_confirmar(mov, jsonb_build_object('itens', conf));
  END IF;
  UPDATE kit_balances b SET qty_sold = (x->>'enviada')::int - (x->>'lida')::int, updated_at = now()
    FROM jsonb_array_elements(itens) x WHERE b.cycle_id = _cycle AND b.variant_id = (x->>'variant_id')::uuid;

  IF dif <> 0 THEN
    SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
    IF dif > 0 AND cfg.ator_user_id IS NOT NULL THEN
      PERFORM public.pdv_como(cfg.ator_user_id);
      tid := public.fin_title_create(jsonb_build_object('direction', 'receivable', 'business_entity_id', cfg.business_entity_id,
        'party_id', p.consultora_party_id, 'descricao', 'Diferença do acerto (peças que faltaram na maleta)',
        'documento', 'ACERTO-DIF', 'emissao', hoje, 'competencia', hoje, 'valor_cents', dif,
        'financial_account_id', cfg.financial_account_id, 'origem', 'pre_baixa', 'sistema_origem', 'pre_baixa_diferenca',
        'id_externo', 'prebaixa-dif:' || p.id, 'status', 'ativo',
        'parcelas', jsonb_build_array(jsonb_build_object('valor_cents', dif, 'vencimento', hoje + 7))));
    END IF;
  END IF;

  UPDATE kit_pre_baixas SET status = CASE WHEN dif = 0 THEN 'encerrada' ELSE 'pendencia' END,
         conferida_em = now(), conferida_por = uid, encerrada_em = CASE WHEN dif = 0 THEN now() END,
         vendido_final_cents = vend_final, valor_final_cents = valor_final, diferenca_cents = dif, pendencia_title_id = tid,
         pendencia_motivo = CASE WHEN dif > 0 THEN faltam || ' peça(s) faltando na maleta: cobradas como vendidas pelo preço da remessa.'
                                 WHEN dif < 0 THEN voltaram || ' peça(s) marcadas como vendidas voltaram: crédito de ' || to_char(-dif / 100.0, 'FM999G999G990D00') || ' a devolver à consultora.'
                            END,
         updated_at = now()
   WHERE id = p.id;
  UPDATE kit_cycles SET status = 'encerrada', closed_at = now(), updated_by = uid, updated_at = now() WHERE id = _cycle;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, CASE WHEN dif = 0 THEN 'acerto.encerrado' ELSE 'acerto.pendencia' END, c.status, 'encerrada', uid, ret - 'itens');
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, CASE WHEN dif = 0 THEN 'pre_baixa.encerrada' ELSE 'pre_baixa.pendencia' END, 'kit_pre_baixas', p.id::text, ret - 'itens');
  RETURN ret || jsonb_build_object('aplicado', true, 'status', CASE WHEN dif = 0 THEN 'encerrada' ELSE 'pendencia' END, 'pendencia_title_id', tid);
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_conferir(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_conferir(uuid, jsonb, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_pendencia_resolver(_cycle uuid, _motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p kit_pre_baixas;
BEGIN
  IF NOT (public.has_capability(auth.uid(), 'kit.manage') OR public.cob_pode(auth.uid())) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva como a pendência foi resolvida.'; END IF;
  SELECT * INTO p FROM kit_pre_baixas WHERE cycle_id = _cycle AND status = 'pendencia' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este acerto não tem pendência aberta.'; END IF;
  UPDATE kit_pre_baixas SET status = 'encerrada', encerrada_em = now(), pendencia_resolvida_em = now(),
         pendencia_motivo = pendencia_motivo || ' · Resolvida: ' || btrim(_motivo), updated_at = now() WHERE id = p.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'pre_baixa.pendencia_resolvida', 'kit_pre_baixas', p.id::text, jsonb_build_object('motivo', _motivo, 'diferenca_cents', p.diferenca_cents));
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_pendencia_resolver(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_pendencia_resolver(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_etiqueta_atualizada(_cycle uuid, _variants uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'kit.manage') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  UPDATE kit_pre_baixa_itens i SET etiqueta_atualizada = true
    FROM kit_pre_baixas p WHERE p.id = i.pre_baixa_id AND p.cycle_id = _cycle AND i.variant_id = ANY (_variants);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_etiqueta_atualizada(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_etiqueta_atualizada(uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_liberar_kit(_consultora uuid, _motivo text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master libera kit sem pré-baixa.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo da liberação.'; END IF;
  INSERT INTO kit_pre_baixa_liberacoes (consultora_party_id, motivo, ator) VALUES (_consultora, btrim(_motivo), auth.uid()) RETURNING id INTO v;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'pre_baixa.kit_liberado', 'parties', _consultora::text, jsonb_build_object('motivo', _motivo));
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_liberar_kit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_liberar_kit(uuid, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.kit_exige_pre_baixa();
CREATE OR REPLACE FUNCTION public.kit_exige_pre_baixa_checar(_consultora uuid, _cycle uuid, _remessa uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pendente text; lib uuid;
BEGIN
  SELECT k.code INTO pendente FROM kit_cycles c JOIN kits k ON k.id = c.kit_id
   WHERE c.consultora_party_id = _consultora AND c.id <> _cycle
     AND c.status IN ('recebida', 'operacao', 'acerto')
     AND c.remessa_id IS DISTINCT FROM _remessa
     AND NOT EXISTS (SELECT 1 FROM kit_pre_baixas p WHERE p.cycle_id = c.id AND p.status NOT IN ('aberta', 'cancelada'))
   ORDER BY c.created_at LIMIT 1;
  IF pendente IS NULL THEN RETURN; END IF;
  SELECT id INTO lib FROM kit_pre_baixa_liberacoes WHERE consultora_party_id = _consultora AND usada_em IS NULL
   ORDER BY criado_em LIMIT 1 FOR UPDATE;
  IF lib IS NOT NULL THEN
    UPDATE kit_pre_baixa_liberacoes SET usada_em = now(), usada_no_ciclo = _cycle WHERE id = lib;
    RETURN;
  END IF;
  RAISE EXCEPTION 'A consultora ainda não fechou a pré-baixa da maleta % no app. Sem pré-baixa fechada não sai kit novo (o Master pode liberar com motivo).', pendente;
END $$;
REVOKE ALL ON FUNCTION public.kit_exige_pre_baixa_checar(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.pedido_config ADD COLUMN IF NOT EXISTS exigir_pre_baixa boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.kit_exige_pre_baixa_gatilho() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.consultora_party_id IS NULL OR NEW.remessa_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.remessa_id IS NOT DISTINCT FROM NEW.remessa_id AND OLD.consultora_party_id IS NOT DISTINCT FROM NEW.consultora_party_id THEN RETURN NEW; END IF;
  IF NOT coalesce((SELECT exigir_pre_baixa FROM pedido_config), false) THEN RETURN NEW; END IF;
  PERFORM public.kit_exige_pre_baixa_checar(NEW.consultora_party_id, NEW.id, NEW.remessa_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kit_exige_pre_baixa_gatilho() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS kit_exige_pre_baixa ON public.kit_cycles;
CREATE TRIGGER kit_exige_pre_baixa BEFORE INSERT OR UPDATE OF remessa_id, consultora_party_id ON public.kit_cycles
  FOR EACH ROW EXECUTE FUNCTION public.kit_exige_pre_baixa_gatilho();

CREATE OR REPLACE FUNCTION public.pre_baixa_exigir_definir(_ligar boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master liga a regra.' USING errcode = '42501'; END IF;
  UPDATE pedido_config SET exigir_pre_baixa = coalesce(_ligar, false), atualizado_por = auth.uid(), atualizado_em = now();
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'pre_baixa.regra_kit_novo', 'pedido_config', 'pedido', jsonb_build_object('exigir', _ligar));
  RETURN _ligar;
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_exigir_definir(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_exigir_definir(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_painel(_situacao text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_capability(auth.uid(), 'kit.manage') OR public.has_capability(auth.uid(), 'kit.view.all') OR public.cob_pode(auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'prazo') FROM (
    SELECT jsonb_build_object('cycle_id', p.cycle_id, 'maleta', k.code, 'consultora', pa.display_name, 'remessa', r.numero,
      'situacao', public.pre_baixa_situacao(p), 'prazo', p.prazo, 'valor_pagar_cents', p.valor_pagar_cents,
      'diferenca_cents', p.diferenca_cents, 'pendencia', p.pendencia_motivo) x
      FROM kit_pre_baixas p JOIN kit_cycles c ON c.id = p.cycle_id JOIN kits k ON k.id = c.kit_id
      JOIN parties pa ON pa.id = p.consultora_party_id LEFT JOIN remessas r ON r.id = p.remessa_id
     WHERE _situacao IS NULL OR public.pre_baixa_situacao(p) = _situacao
     LIMIT 500) s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_painel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_painel(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_indicadores(_de date DEFAULT NULL, _ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE de date := coalesce(_de, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 180); ate date := coalesce(_ate, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
BEGIN
  IF NOT (public.has_capability(auth.uid(), 'kit.manage') OR public.has_capability(auth.uid(), 'kit.view.all') OR public.cob_pode(auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', de, 'ate', ate),
    'geral', (SELECT jsonb_build_object(
        'conferidos', count(*) FILTER (WHERE conferida_em IS NOT NULL),
        'sem_divergencia_pct', round(100.0 * count(*) FILTER (WHERE conferida_em IS NOT NULL AND coalesce(diferenca_cents, 0) = 0)
                                     / nullif(count(*) FILTER (WHERE conferida_em IS NOT NULL), 0), 1),
        'horas_media_pre_baixa_ate_encerrar', round((avg(extract(epoch FROM encerrada_em - fechada_em)) FILTER (WHERE encerrada_em IS NOT NULL) / 3600)::numeric, 1),
        'no_prazo_pct', round(100.0 * count(*) FILTER (WHERE fechada_em IS NOT NULL AND (prazo IS NULL OR (fechada_em AT TIME ZONE 'America/Sao_Paulo')::date <= prazo))
                              / nullif(count(*) FILTER (WHERE fechada_em IS NOT NULL OR prazo < ate), 0), 1))
      FROM kit_pre_baixas WHERE (coalesce(fechada_em, created_at) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN de AND ate),
    'por_consultora', coalesce((SELECT jsonb_agg(jsonb_build_object('consultora', pa.display_name, 'acertos', s.n, 'sem_divergencia_pct', s.ok,
                                  'no_prazo_pct', s.prazo, 'horas_media', s.horas) ORDER BY s.n DESC)
      FROM (SELECT consultora_party_id, count(*) FILTER (WHERE conferida_em IS NOT NULL) n,
                   round(100.0 * count(*) FILTER (WHERE conferida_em IS NOT NULL AND coalesce(diferenca_cents, 0) = 0) / nullif(count(*) FILTER (WHERE conferida_em IS NOT NULL), 0), 1) ok,
                   round(100.0 * count(*) FILTER (WHERE fechada_em IS NOT NULL AND (prazo IS NULL OR (fechada_em AT TIME ZONE 'America/Sao_Paulo')::date <= prazo)) / nullif(count(*), 0), 1) prazo,
                   round((avg(extract(epoch FROM encerrada_em - fechada_em)) FILTER (WHERE encerrada_em IS NOT NULL) / 3600)::numeric, 1) horas
              FROM kit_pre_baixas WHERE (coalesce(fechada_em, created_at) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN de AND ate GROUP BY 1) s
      JOIN parties pa ON pa.id = s.consultora_party_id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.pre_baixa_indicadores(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_indicadores(date, date) TO authenticated, service_role;