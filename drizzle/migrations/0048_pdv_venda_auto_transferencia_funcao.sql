CREATE OR REPLACE FUNCTION public.pdv_venda_concluir(_token_hash text, _p jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s pdv_sessoes; m pdv_membros; u pdv_unidades; cx uuid; vid uuid; ex pdv_vendas;
  it jsonb; pg jsonb; preco bigint; sub bigint := 0; desc_c bigint; tot bigint; soma bigint := 0; tem_pix boolean := false;
  lim numeric; com pdv_comissoes; nm text; sk text; q int; mov_saldo int; codigo bigint; dep uuid; sl int; sd int; falta int; tira int; resto int; a int; b int; troco bigint; uid uuid;
BEGIN
  s := public.pdv_sessao(_token_hash); m := public.pdv_exigir_operadora(s);
  IF NOT m.vende THEN RAISE EXCEPTION 'Esta pessoa não está liberada para vender.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE id=s.unidade_id;
  SELECT id INTO cx FROM pdv_caixas WHERE unidade_id=u.id AND status='aberto';
  IF cx IS NULL THEN RAISE EXCEPTION 'Abra o caixa antes de vender.'; END IF;
  IF nullif(_p->>'idem','') IS NULL THEN RAISE EXCEPTION 'Venda sem identificador.'; END IF;
  SELECT * INTO ex FROM pdv_vendas WHERE idempotency_key=_p->>'idem';
  IF ex.id IS NOT NULL THEN RETURN jsonb_build_object('venda',ex.id,'codigo',ex.codigo,'status',ex.status,'repetida',true); END IF;
  IF jsonb_array_length(coalesce(_p->'itens','[]')) = 0 THEN RAISE EXCEPTION 'Adicione ao menos uma peça.'; END IF;
  SELECT user_id INTO uid FROM pdv_membros WHERE id=m.id;

  INSERT INTO pdv_vendas(unidade_id,caixa_id,membro_id,status,subtotal_cents,total_cents,idempotency_key,cliente_nome,cliente_doc,cliente_telefone)
  VALUES (u.id,cx,m.id,'concluida',0,0,_p->>'idem',nullif(trim(_p#>>'{cliente,nome}'),''),nullif(regexp_replace(coalesce(_p#>>'{cliente,doc}',''),'\D','','g'),''),nullif(regexp_replace(coalesce(_p#>>'{cliente,telefone}',''),'\D','','g'),''))
  RETURNING id, pdv_vendas.codigo INTO vid, codigo;

  FOR it IN SELECT * FROM jsonb_array_elements(_p->'itens') LOOP
    q := (it->>'qtd')::int;
    IF q IS NULL OR q <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
    preco := public.pdv_preco((it->>'variant_id')::uuid);
    IF preco IS NULL THEN RAISE EXCEPTION 'Peça sem preço cadastrado.'; END IF;
    SELECT p.name || coalesce(' — '||nullif(v.label,''),''), coalesce(v.sku,v.reference_code) INTO nm, sk FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=(it->>'variant_id')::uuid;
    INSERT INTO pdv_venda_itens(venda_id,variant_id,sku,nome,qtd,preco_unit_cents,total_cents) VALUES (vid,(it->>'variant_id')::uuid,sk,nm,q,preco,preco*q);
    sub := sub + preco*q;
    -- Se bipou/buscou, a peça está na mão: falta na loja vem do Depósito Principal; sem saldo lá, entra marcada para conferência.
    SELECT coalesce((select quantity from stock_balances where variant_id=(it->>'variant_id')::uuid and location_id=u.location_id),0) INTO sl;
    falta := q - greatest(sl,0);
    IF falta > 0 THEN
      SELECT id INTO dep FROM locations WHERE code='DEP-01';
      SELECT coalesce((select quantity from stock_balances where variant_id=(it->>'variant_id')::uuid and location_id=dep),0) INTO sd;
      tira := least(falta, greatest(sd,0)); resto := falta - tira;
      IF tira > 0 THEN
        b := public.apply_stock_delta((it->>'variant_id')::uuid, dep, -tira);
        a := public.apply_stock_delta((it->>'variant_id')::uuid, u.location_id, tira);
        INSERT INTO stock_movements(kind,variant_id,from_location_id,to_location_id,quantity,reason_code,reference,note,balance_after,created_by,idempotency_key,balance_from_before,balance_from_after,balance_to_before,balance_to_after)
        VALUES ('transferencia',(it->>'variant_id')::uuid,dep,u.location_id,tira,'transferencia_pdv','PDV-'||codigo,'Transferência automática PDV '||u.nome,a,uid,'pdv-transf:'||vid||':'||(it->>'variant_id')||':'||gen_random_uuid(),b+tira,b,a-tira,a);
      END IF;
      IF resto > 0 THEN
        a := public.apply_stock_delta((it->>'variant_id')::uuid, u.location_id, resto);
        INSERT INTO stock_movements(kind,variant_id,to_location_id,quantity,reason_code,reference,note,balance_after,created_by,idempotency_key,balance_to_before,balance_to_after)
        VALUES ('entrada',(it->>'variant_id')::uuid,u.location_id,resto,'entrada_pdv_sem_saldo','PDV-'||codigo,'Entrada automática PDV '||u.nome||' — sem saldo na origem (conferir)',a,uid,'pdv-entrada:'||vid||':'||(it->>'variant_id')||':'||gen_random_uuid(),a-resto,a);
      END IF;
    END IF;
    mov_saldo := public.apply_stock_delta((it->>'variant_id')::uuid, u.location_id, -q);
    INSERT INTO stock_movements(kind,variant_id,from_location_id,quantity,reason_code,reference,note,balance_after,created_by,idempotency_key,balance_from_after,balance_from_before)
    VALUES ('saida',(it->>'variant_id')::uuid,u.location_id,q,'venda','PDV-'||codigo,'Venda PDV '||u.nome,mov_saldo,uid,'pdv:'||vid||':'||(it->>'variant_id')||':'||gen_random_uuid(),mov_saldo,mov_saldo+q);
  END LOOP;

  desc_c := coalesce((_p->>'desconto_cents')::bigint,0);
  IF desc_c < 0 OR desc_c >= sub THEN RAISE EXCEPTION 'Desconto inválido.'; END IF;
  lim := CASE WHEN m.papel IN ('supervisora','gestao') THEN u.desconto_max_supervisora_pct ELSE u.desconto_max_operadora_pct END;
  IF desc_c > floor(sub * lim / 100) THEN RAISE EXCEPTION 'Desconto acima do limite de %%% para %.', lim, CASE WHEN m.papel='operadora' THEN 'vendedora' ELSE 'supervisora' END; END IF;
  tot := sub - desc_c;

  FOR pg IN SELECT * FROM jsonb_array_elements(coalesce(_p->'pagamentos','[]')) LOOP
    IF (pg->>'valor_cents')::bigint <= 0 THEN RAISE EXCEPTION 'Pagamento com valor inválido.'; END IF;
    IF pg->>'forma' IN ('debito','credito') AND NOT EXISTS(select 1 from pdv_maquininhas where id=(pg->>'maquininha_id')::uuid and unidade_id=u.id and ativo) THEN RAISE EXCEPTION 'Escolha a maquininha do cartão.'; END IF;
    troco := 0;
    IF pg->>'forma'='dinheiro' THEN
      troco := greatest(coalesce((pg->>'recebido_cents')::bigint,(pg->>'valor_cents')::bigint) - (pg->>'valor_cents')::bigint, 0);
    END IF;
    IF pg->>'forma' IN ('pix','link_cartao') THEN tem_pix := true; END IF;
    INSERT INTO pdv_pagamentos(venda_id,forma,valor_cents,recebido_cents,troco_cents,maquininha_id,parcelas,nsu,status)
    VALUES (vid,pg->>'forma',(pg->>'valor_cents')::bigint,(pg->>'recebido_cents')::bigint,troco,
      CASE WHEN pg->>'forma' IN ('debito','credito') THEN nullif(pg->>'maquininha_id','')::uuid END,
      nullif(pg->>'parcelas','')::int,nullif(trim(pg->>'nsu'),''),CASE WHEN pg->>'forma' IN ('pix','link_cartao') THEN 'pendente' ELSE 'confirmado' END);
    soma := soma + (pg->>'valor_cents')::bigint;
  END LOOP;
  IF soma <> tot THEN RAISE EXCEPTION 'Os pagamentos (%) não fecham o total da venda (%).', soma, tot; END IF;
  IF (select count(*) from pdv_pagamentos where venda_id=vid and forma in ('pix','link_cartao')) > 1 THEN RAISE EXCEPTION 'Use um único Pix ou link de cartão por venda.'; END IF;
  IF tem_pix THEN
    IF u.pix_responsavel_user_id IS NULL THEN RAISE EXCEPTION 'Escolha o responsável pelo Pix desta loja em PDV Loja → Acesso.'; END IF;
    IF u.business_entity_id IS NULL THEN RAISE EXCEPTION 'Escolha a empresa desta loja em PDV Loja → Unidade.'; END IF;
    IF length(coalesce(regexp_replace(_p#>>'{cliente,doc}','\D','','g'),'')) NOT IN (11,14) OR nullif(trim(_p#>>'{cliente,nome}'),'') IS NULL THEN
      RAISE EXCEPTION 'Para Pix ou link de cartão, informe nome e CPF da cliente.'; END IF;
  END IF;

  SELECT * INTO com FROM pdv_comissoes WHERE membro_id=m.id AND vigente_de <= current_date AND (vigente_ate IS NULL OR vigente_ate > current_date) ORDER BY vigente_de DESC LIMIT 1;
  UPDATE pdv_vendas SET subtotal_cents=sub, desconto_cents=desc_c, total_cents=tot,
    status=CASE WHEN tem_pix THEN 'aguardando_pix' ELSE 'concluida' END,
    concluida_em=CASE WHEN tem_pix THEN null ELSE now() END,
    comissao_pct=com.percentual,
    comissao_cents=CASE WHEN com.id IS NULL THEN null ELSE round((CASE WHEN com.base='bruto' THEN sub ELSE tot END) * com.percentual / 100) END
  WHERE id=vid;
  RETURN jsonb_build_object('venda',vid,'codigo',codigo,'status',CASE WHEN tem_pix THEN 'aguardando_pix' ELSE 'concluida' END,'total',tot);
END $function$;
REVOKE ALL ON FUNCTION public.pdv_venda_concluir(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_venda_concluir(text,jsonb) TO service_role;