CREATE OR REPLACE FUNCTION public.consultora_pagamento_titulo(_order uuid, _forma text, _doc text, _venc date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE eu uuid := public.my_party_id(); uid uuid := auth.uid(); o sales_orders; cfg consultora_cobranca_config;
  d text := regexp_replace(coalesce(_doc,''),'\D','','g'); party uuid; tid uuid; inst uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date; venc date; nome_c text; nome_cad text;
BEGIN
  IF uid IS NULL OR eu IS NULL OR NOT public.has_role(uid,'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  IF _forma NOT IN ('pix','cartao','depois') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id=_order AND consultora_party_id=eu FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status IN ('cancelado','concluido') THEN RAISE EXCEPTION 'Este pedido já foi encerrado.'; END IF;
  IF coalesce(o.subtotal_cents,0) <= 0 THEN RAISE EXCEPTION 'Pedido sem valor.'; END IF;
  SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
  IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
  IF o.pay_installment_id IS NOT NULL THEN
    IF o.pay_method IS DISTINCT FROM _forma THEN RAISE EXCEPTION 'Este pedido já tem uma cobrança gerada. Use a cobrança existente.'; END IF;
    RETURN jsonb_build_object('installment_id',o.pay_installment_id,'actor',cfg.ator_user_id,'forma',o.pay_method,'vencimento',o.pay_due_date);
  END IF;
  IF length(d) <> 11 OR NOT public.cpf_is_valid(d) THEN RAISE EXCEPTION 'CPF da cliente inválido. Confira os 11 números.'; END IF;
  venc := CASE WHEN _forma='depois' THEN coalesce(_venc, hoje + 7) ELSE hoje END;
  IF venc < hoje OR venc > hoje + 60 THEN RAISE EXCEPTION 'Escolha um vencimento entre hoje e 60 dias.'; END IF;
  SELECT display_name INTO nome_c FROM parties WHERE id=eu;
  IF d = (SELECT doc_digits FROM parties WHERE id=eu) THEN
    RAISE EXCEPTION 'Use o CPF da sua cliente, não o seu.';
  END IF;
  SELECT id, display_name INTO party, nome_cad FROM parties WHERE doc_digits=d AND is_active ORDER BY created_at LIMIT 1;
  IF party IS NOT NULL THEN
    -- 0196: recusa só CPF de equipe/empresa; cliente que também é consultora, candidata ou tem login pode comprar.
    IF EXISTS (SELECT 1 FROM party_roles pr WHERE pr.party_id=party AND pr.ended_at IS NULL AND pr.role::text IN ('colaborador','representante','vendedora_interna','fornecedor','transportadora','prestador','custodiante','entidade_grupo','loja')) THEN
      RAISE EXCEPTION 'Este CPF é de alguém da equipe Lardan e não pode receber cobrança de venda. Confira o CPF da cliente.';
    END IF;
    IF public.fin_unaccent_lower(split_part(btrim(coalesce(nome_cad,'')),' ',1))
       <> public.fin_unaccent_lower(split_part(btrim(coalesce(o.customer_name,'')),' ',1)) THEN
      RAISE EXCEPTION 'Este CPF está cadastrado em nome de %***. Confira se digitou o CPF certo ou corrija o nome da cliente no pedido (o primeiro nome precisa ser igual).', left(coalesce(nome_cad,''),3);
    END IF;
  END IF;
  IF party IS NULL THEN
    INSERT INTO parties(kind,display_name,legal_name,doc,doc_digits,status,created_by)
    VALUES ('pessoa', o.customer_name, o.customer_name, d, d, 'ativo', uid) RETURNING id INTO party;
    INSERT INTO party_roles(party_id,role,created_by) VALUES (party,'cliente',uid);
  END IF;
  UPDATE sales_orders SET pay_method=_forma, pay_doc_masked='***.'||substr(d,4,3)||'.'||substr(d,7,3)||'-**', pay_due_date=venc, pay_party_id=party, payment_status='pendente' WHERE id=o.id;
  INSERT INTO sales_order_events(order_id,kind,to_status,actor_user_id,payload)
  VALUES (o.id,'pagamento.cobranca_lardan',o.status::text,uid,jsonb_build_object('forma',_forma,'vencimento',venc,'valor_cents',o.subtotal_cents));
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (uid,'consultora.cobranca_gerada','sales_orders',o.id::text,
          jsonb_build_object('ator_real',uid,'consultora',eu,'forma',_forma,'vencimento',venc,'valor_cents',o.subtotal_cents,'cliente',party));
  PERFORM public.pdv_como(cfg.ator_user_id);
  tid := public.fin_title_create(jsonb_build_object('direction','receivable','business_entity_id',cfg.business_entity_id,'party_id',party,
     'descricao','Pedido consultora '||o.code||' — '||coalesce(nome_c,'consultora'),'documento','PED-'||o.code,'emissao',hoje,'competencia',hoje,
     'valor_cents',o.subtotal_cents,'financial_account_id',cfg.financial_account_id,'origem','consultora','id_externo','pedido:'||o.id,'status','ativo',
     'parcelas',jsonb_build_array(jsonb_build_object('valor_cents',o.subtotal_cents,'vencimento',venc))));
  SELECT id INTO inst FROM financial_installments WHERE title_id=tid ORDER BY numero LIMIT 1;
  UPDATE sales_orders SET pay_title_id=tid, pay_installment_id=inst WHERE id=o.id;
  RETURN jsonb_build_object('installment_id',inst,'actor',cfg.ator_user_id,'forma',_forma,'vencimento',venc);
END $function$;