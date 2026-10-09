-- 1) Loja nova herda sozinha a empresa (quando só existe uma) e a conta Asaas (quando só existe uma).
CREATE OR REPLACE FUNCTION public.pdv_unidade_padroes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e uuid; c uuid;
BEGIN
  IF NEW.business_entity_id IS NULL AND (SELECT count(*) FROM business_entities WHERE is_active) = 1 THEN
    SELECT id INTO e FROM business_entities WHERE is_active; NEW.business_entity_id := e;
  END IF;
  IF NEW.conta_pix_id IS NULL AND (SELECT count(DISTINCT fa.id) FROM financial_accounts fa JOIN asaas_accounts aa ON aa.financial_account_id=fa.id WHERE fa.is_active) = 1 THEN
    SELECT fa.id INTO c FROM financial_accounts fa JOIN asaas_accounts aa ON aa.financial_account_id=fa.id WHERE fa.is_active LIMIT 1; NEW.conta_pix_id := c;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pdv_unidade_padroes() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pdv_unidade_padroes ON public.pdv_unidades;
CREATE TRIGGER pdv_unidade_padroes BEFORE INSERT OR UPDATE ON public.pdv_unidades FOR EACH ROW EXECUTE FUNCTION public.pdv_unidade_padroes();
-- backfill das lojas existentes sem empresa/conta Pix (o gatilho completa)
UPDATE public.pdv_unidades SET updated_at = updated_at WHERE business_entity_id IS NULL OR conta_pix_id IS NULL;

-- 2) Nova forma: link de cartão de crédito pelo Asaas.
ALTER TABLE public.pdv_pagamentos DROP CONSTRAINT IF EXISTS pdv_pagamentos_forma_check;
ALTER TABLE public.pdv_pagamentos ADD CONSTRAINT pdv_pagamentos_forma_check CHECK (forma = ANY (ARRAY['dinheiro','debito','credito','pix','link_cartao']));

-- 3) Estado: Pix/link liberados quando há responsável e empresa (empresa agora vem sozinha).
CREATE OR REPLACE FUNCTION public.pdv_estado(_token_hash text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s pdv_sessoes; u pdv_unidades; cx pdv_caixas; r jsonb; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT * INTO u FROM pdv_unidades WHERE id=s.unidade_id;
  SELECT * INTO cx FROM pdv_caixas WHERE unidade_id=u.id AND status='aberto';
  r := jsonb_build_object(
    'unidade', jsonb_build_object('nome',u.nome,'numero',u.numero,'desc_operadora',u.desconto_max_operadora_pct,'desc_supervisora',u.desconto_max_supervisora_pct,'rodape',u.texto_comprovante,'pix', u.pix_responsavel_user_id is not null and u.business_entity_id is not null),
    'membros', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'nome',public.pdv_nome_usuario(m.user_id),'papel',m.papel,'tem_pin',m.pin_hash is not null) order by public.pdv_nome_usuario(m.user_id)) from pdv_membros m where m.unidade_id=u.id and m.ativo and (m.vende or m.papel='supervisora')),'[]'),
    'operadora', (select jsonb_build_object('id',m.id,'nome',public.pdv_nome_usuario(m.user_id),'papel',m.papel) from pdv_membros m where m.id=s.membro_id and m.ativo),
    'maquininhas', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nome',nome,'max_parcelas',max_parcelas) order by nome) from pdv_maquininhas where unidade_id=u.id and ativo),'[]'),
    'caixa', CASE WHEN cx.id IS NULL THEN null ELSE jsonb_build_object('id',cx.id,'aberto_em',cx.aberto_em,'fundo',cx.fundo_cents,'esperado',public.pdv_caixa_esperado(cx.id),
       'aberto_por', (select public.pdv_nome_usuario(user_id) from pdv_membros where id=cx.aberto_por),
       'por_forma', coalesce((select jsonb_object_agg(forma, t) from (select p.forma, sum(p.valor_cents) t from pdv_pagamentos p join pdv_vendas v on v.id=p.venda_id where v.caixa_id=cx.id and v.status<>'cancelada' and p.status='confirmado' group by 1) z),'{}'),
       'vendas', (select count(*) from pdv_vendas where caixa_id=cx.id and status='concluida')) END,
    'hoje', coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'codigo',v.codigo,'total',v.total_cents,'status',v.status,'hora',v.created_at,'vendedora',public.pdv_nome_usuario(m.user_id),
        'online', (select p.forma from pdv_pagamentos p where p.venda_id=v.id and p.forma in ('pix','link_cartao') limit 1)) order by v.created_at desc)
        from pdv_vendas v join pdv_membros m on m.id=v.membro_id where v.unidade_id=u.id and (v.created_at at time zone 'America/Sao_Paulo')::date=hoje),'[]'));
  RETURN r;
END $function$;

-- 4) Concluir venda: Pix e link de cartão ficam pendentes até o Asaas confirmar.
CREATE OR REPLACE FUNCTION public.pdv_venda_concluir(_token_hash text, _p jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s pdv_sessoes; m pdv_membros; u pdv_unidades; cx uuid; vid uuid; ex pdv_vendas;
  it jsonb; pg jsonb; preco bigint; sub bigint := 0; desc_c bigint; tot bigint; soma bigint := 0; tem_pix boolean := false;
  lim numeric; com pdv_comissoes; nm text; sk text; q int; mov_saldo int; codigo bigint; troco bigint; uid uuid;
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
    BEGIN
      mov_saldo := public.apply_stock_delta((it->>'variant_id')::uuid, u.location_id, -q);
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Sem estoque na loja para "%".', nm; END;
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

-- 5) Título da cobrança online (Pix ou link de cartão); devolve a forma para o servidor escolher no Asaas.
CREATE OR REPLACE FUNCTION public.pdv_pix_titulo(_token_hash text, _venda uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s pdv_sessoes; u pdv_unidades; v pdv_vendas; pv bigint; fm text; party uuid; tid uuid; inst uuid; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT * INTO v FROM pdv_vendas WHERE id=_venda AND unidade_id=s.unidade_id FOR UPDATE;
  IF v.id IS NULL OR v.status<>'aguardando_pix' THEN RAISE EXCEPTION 'Venda não está aguardando pagamento.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE id=v.unidade_id;
  SELECT valor_cents, forma INTO pv, fm FROM pdv_pagamentos WHERE venda_id=v.id AND forma in ('pix','link_cartao') LIMIT 1;
  IF v.installment_id IS NOT NULL THEN RETURN jsonb_build_object('installment_id',v.installment_id,'actor',u.pix_responsavel_user_id,'forma',fm); END IF;
  IF u.pix_responsavel_user_id IS NULL THEN RAISE EXCEPTION 'Escolha o responsável pelo Pix desta loja em PDV Loja → Acesso.'; END IF;
  SELECT id INTO party FROM parties WHERE doc_digits=v.cliente_doc AND is_active ORDER BY created_at LIMIT 1;
  IF party IS NULL THEN
    INSERT INTO parties(kind,display_name,legal_name,doc,doc_digits,status,created_by) VALUES (CASE WHEN length(v.cliente_doc)=14 THEN 'organizacao' ELSE 'pessoa' END::party_kind, v.cliente_nome, v.cliente_nome, v.cliente_doc, v.cliente_doc,'ativo',u.pix_responsavel_user_id) RETURNING id INTO party;
    INSERT INTO party_roles(party_id,role,created_by) VALUES (party,'cliente',u.pix_responsavel_user_id);
  END IF;
  PERFORM public.pdv_como(u.pix_responsavel_user_id);
  tid := public.fin_title_create(jsonb_build_object('direction','receivable','business_entity_id',u.business_entity_id,'party_id',party,
     'descricao','Venda PDV '||u.nome||' nº '||v.codigo||CASE WHEN fm='link_cartao' THEN ' (link cartão)' ELSE '' END,'documento','PDV-'||v.codigo,'emissao',hoje,'competencia',hoje,'valor_cents',pv,
     'financial_account_id',u.conta_pix_id,'origem','pdv','id_externo','pdv:'||v.id,'status','ativo',
     'parcelas',jsonb_build_array(jsonb_build_object('valor_cents',pv,'vencimento',hoje))));
  SELECT id INTO inst FROM financial_installments WHERE title_id=tid ORDER BY numero LIMIT 1;
  UPDATE pdv_vendas SET party_id=party, title_id=tid, installment_id=inst WHERE id=v.id;
  RETURN jsonb_build_object('installment_id',inst,'actor',u.pix_responsavel_user_id,'forma',fm);
END $function$;

-- 6) Situação: conclui quando a parcela foi baixada ou quando o Asaas confirmou/recebeu a cobrança.
CREATE OR REPLACE FUNCTION public.pdv_pix_situacao(_token_hash text, _venda uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s pdv_sessoes; v pdv_vendas; saldo bigint; pago boolean;
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT * INTO v FROM pdv_vendas WHERE id=_venda AND unidade_id=s.unidade_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF v.status='aguardando_pix' AND v.installment_id IS NOT NULL THEN
    saldo := public.fin_installment_saldo(v.installment_id);
    pago := coalesce(saldo,1) <= 0 OR EXISTS(select 1 from asaas_charges c where c.id=v.pix_charge_id and c.external_status in ('CONFIRMED','RECEIVED','RECEIVED_IN_CASH'));
    IF pago THEN
      UPDATE pdv_pagamentos SET status='confirmado' WHERE venda_id=v.id AND forma in ('pix','link_cartao');
      UPDATE pdv_vendas SET status='concluida', concluida_em=now() WHERE id=v.id;
      v.status := 'concluida';
    END IF;
  END IF;
  RETURN jsonb_build_object('status',v.status,'pix_url',v.pix_url);
END $function$;

-- 7) Cancelar: bloqueia também quando o cartão já foi confirmado no Asaas.
CREATE OR REPLACE FUNCTION public.pdv_venda_cancelar(_token_hash text, _venda uuid, _motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s pdv_sessoes; m pdv_membros; v pdv_vendas; u pdv_unidades; it record; saldo int; uid uuid;
BEGIN
  s := public.pdv_sessao(_token_hash); m := public.pdv_exigir_operadora(s);
  SELECT * INTO v FROM pdv_vendas WHERE id=_venda AND unidade_id=s.unidade_id FOR UPDATE;
  IF v.id IS NULL OR v.status='cancelada' THEN RAISE EXCEPTION 'Venda não encontrada ou já cancelada.'; END IF;
  IF v.status='concluida' AND m.papel='operadora' THEN RAISE EXCEPTION 'Só a supervisora cancela venda concluída.'; END IF;
  IF EXISTS(select 1 from pdv_caixas where id=v.caixa_id and status='fechado') THEN RAISE EXCEPTION 'O caixa desta venda já foi fechado.'; END IF;
  IF nullif(trim(coalesce(_motivo,'')),'') IS NULL THEN RAISE EXCEPTION 'Escreva o motivo do cancelamento.'; END IF;
  IF v.pix_charge_id IS NOT NULL AND (coalesce(public.fin_installment_saldo(v.installment_id),1) <= 0
     OR EXISTS(select 1 from asaas_charges c where c.id=v.pix_charge_id and c.external_status in ('CONFIRMED','RECEIVED','RECEIVED_IN_CASH'))) THEN
    RAISE EXCEPTION 'O pagamento já foi feito no Asaas. Cancelamento exige estorno pelo financeiro.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE id=v.unidade_id;
  SELECT user_id INTO uid FROM pdv_membros WHERE id=m.id;
  FOR it IN SELECT variant_id, qtd FROM pdv_venda_itens WHERE venda_id=v.id LOOP
    saldo := public.apply_stock_delta(it.variant_id, u.location_id, it.qtd);
    INSERT INTO stock_movements(kind,variant_id,to_location_id,quantity,reason_code,reference,note,balance_after,created_by,idempotency_key,balance_to_after,balance_to_before)
    VALUES ('entrada',it.variant_id,u.location_id,it.qtd,'devolucao_cliente','PDV-'||v.codigo,'Cancelamento venda PDV: '||trim(_motivo),saldo,uid,'pdv-cancel:'||v.id||':'||it.variant_id||':'||gen_random_uuid(),saldo,saldo-it.qtd);
  END LOOP;
  UPDATE pdv_pagamentos SET status='cancelado' WHERE venda_id=v.id;
  UPDATE pdv_vendas SET status='cancelada', cancel_motivo=trim(_motivo), cancelada_por=m.id WHERE id=v.id;
END $function$;