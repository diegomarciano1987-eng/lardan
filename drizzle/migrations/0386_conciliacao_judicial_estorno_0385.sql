CREATE OR REPLACE FUNCTION public.fin_reconcile_undo(_reconciliation uuid, _motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r financial_reconciliations%rowtype; v_new uuid; a record; ja_estornada boolean;
BEGIN
 IF NOT public.has_capability(auth.uid(),'finance.reconcile.undo') THEN RAISE EXCEPTION 'Sem permissão para desfazer conciliação'; END IF;
 IF length(trim(coalesce(_motivo,'')))=0 THEN RAISE EXCEPTION 'Desfazer conciliação exige motivo'; END IF;
 SELECT * INTO r FROM financial_reconciliations WHERE id=_reconciliation FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Conciliação não encontrada'; END IF;
 IF r.status<>'ativa' THEN RAISE EXCEPTION 'Esta conciliação já foi desfeita'; END IF;
 PERFORM 1 FROM financial_settlements WHERE id=r.settlement_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM financial_settlements rev WHERE rev.reversed_of=r.settlement_id) INTO ja_estornada;
 IF NOT ja_estornada THEN PERFORM public.fin_settlement_reverse(r.settlement_id,trim(_motivo)); END IF;
 INSERT INTO financial_reconciliations(financial_account_id,settlement_id,status,motivo,reversed_of,is_reversal,created_by)
 VALUES(r.financial_account_id,r.settlement_id,'estorno',trim(_motivo),r.id,true,auth.uid()) RETURNING id INTO v_new;
 UPDATE financial_reconciliations SET status='estornada',motivo=trim(_motivo) WHERE id=r.id;
 FOR a IN SELECT line_id,sum(valor_cents) valor_cents FROM financial_reconciliation_allocations WHERE reconciliation_id=r.id GROUP BY line_id ORDER BY line_id LOOP
  UPDATE financial_statement_lines l SET conciliado_cents=greatest(l.conciliado_cents-a.valor_cents,0),
   status=(CASE WHEN greatest(l.conciliado_cents-a.valor_cents,0)=0 THEN 'pendente' ELSE 'parcial' END)::fin_statement_line_status,updated_at=now() WHERE l.id=a.line_id;
 END LOOP;
 INSERT INTO financial_reconciliation_events(reconciliation_id,evento,motivo,payload,actor_id)
 VALUES(r.id,'desfeita',trim(_motivo),jsonb_build_object('estorno_id',v_new,'baixa_ja_estornada',ja_estornada),auth.uid());
 RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.fin_reconcile_undo(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fin_reconcile_undo(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.cob_judicial_alvara_receber(_acordo uuid,_numero integer,_conta uuid,_data date,_referencia text,_valor_recebido bigint,_juros_confirmados bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a cob_judicial_acordos; item jsonb; ex cob_judicial_alvara_recebimentos; valor bigint; principal bigint; resto bigint; sd bigint; primeira uuid; aloc jsonb:='[]'; p record; r jsonb; juros bigint:=0;
BEGIN
 IF NOT public.has_capability(auth.uid(),'finance.settlement.create') OR NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para registrar liberação de alvará.'; END IF;
 IF _data IS NULL OR _data>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Informe a data em que o dinheiro entrou, sem data futura.'; END IF;
 IF length(trim(coalesce(_referencia,'')))<3 THEN RAISE EXCEPTION 'Informe a identificação do alvará ou comprovante.'; END IF;
 SELECT * INTO a FROM cob_judicial_acordos WHERE id=_acordo FOR UPDATE;
 IF a.id IS NULL OR a.status='cancelado' THEN RAISE EXCEPTION 'Acordo inexistente ou cancelado.'; END IF;
 SELECT x INTO item FROM jsonb_array_elements(a.plano) x WHERE (x->>'numero')::int=_numero;
 IF item IS NULL OR NOT coalesce((item->>'alvara')::boolean,false) AND coalesce((item->>'asaas')::boolean,false) THEN RAISE EXCEPTION 'Esta parcela não é de alvará judicial.'; END IF;
 principal:=(item->>'valor_cents')::bigint; valor:=coalesce(_valor_recebido,principal); juros:=coalesce(_juros_confirmados,0);
 IF valor<principal OR juros<0 OR valor<>principal+juros THEN RAISE EXCEPTION 'O recebimento deve ser igual ao alvará mais os juros confirmados. Confira a diferença.'; END IF;
 SELECT ar.* INTO ex FROM cob_judicial_alvara_recebimentos ar WHERE ar.acordo_id=_acordo AND ar.parcela_numero=_numero AND NOT EXISTS(SELECT 1 FROM financial_settlements rev WHERE rev.reversed_of=ar.settlement_id) ORDER BY ar.created_at DESC LIMIT 1;
 IF ex.id IS NOT NULL THEN
  IF ex.conta_id<>_conta OR ex.data<>_data OR ex.referencia<>trim(_referencia) OR ex.valor_cents<>valor THEN RAISE EXCEPTION 'Alvará já registrado com outros dados. Confira a baixa no Financeiro.'; END IF;
  RETURN jsonb_build_object('settlement_id',ex.settlement_id,'repetido',true);
 END IF;
 IF EXISTS(SELECT 1 FROM financial_installments i JOIN financial_titles t ON t.id=i.title_id WHERE i.id=ANY(a.installment_ids) AND t.party_id IS DISTINCT FROM a.party_id) THEN RAISE EXCEPTION 'A dívida pertence a outra cliente.'; END IF;
 PERFORM 1 FROM financial_installments WHERE id=ANY(a.installment_ids) ORDER BY id FOR UPDATE;
 resto:=principal;
 FOR p IN SELECT id FROM financial_installments WHERE id=ANY(a.installment_ids) ORDER BY vencimento,numero,id LOOP
  IF primeira IS NULL THEN primeira:=p.id; END IF;
  sd:=greatest(public.fin_installment_saldo(p.id),0);
  IF sd>0 AND resto>0 THEN aloc:=aloc||jsonb_build_object('installment_id',p.id,'valor_cents',least(sd,resto)); resto:=resto-least(sd,resto); END IF;
 END LOOP;
 IF primeira IS NULL THEN RAISE EXCEPTION 'Este acordo não tem dívida financeira vinculada. Vincule as contas a receber antes da baixa.'; END IF;
 juros:=juros+resto;
 IF juros>0 THEN
  IF jsonb_array_length(aloc)=0 THEN aloc:=jsonb_build_array(jsonb_build_object('installment_id',primeira,'valor_cents',juros));
  ELSE primeira:=(aloc->0->>'installment_id')::uuid; aloc:=jsonb_set(aloc,'{0,valor_cents}',to_jsonb((aloc->0->>'valor_cents')::bigint+juros)); END IF;
 END IF;
 r:=public.fin_settlement_create_ajustes(jsonb_build_object('direction','receivable','financial_account_id',_conta,'data',_data,'valor_cents',valor,'juros_cents',juros,'referencia','Alvará judicial · '||trim(_referencia),'observacao','Acordo '||a.id||' · parcela '||_numero,'idempotency_key','judicial:alvara:'||a.id||':'||_numero||':'||(SELECT count(*) FROM cob_judicial_alvara_recebimentos WHERE acordo_id=a.id AND parcela_numero=_numero),'alocacoes',aloc));
 INSERT INTO cob_judicial_alvara_recebimentos(acordo_id,parcela_numero,settlement_id,valor_cents,data,conta_id,referencia,autor_id) VALUES(a.id,_numero,(r->>'id')::uuid,valor,_data,_conta,trim(_referencia),auth.uid());
 PERFORM public.cob_judicial_desconto_final(a.id,(r->>'id')::uuid);
 INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id) VALUES(a.party_id,'negociacao','sucesso','Alvará liberado: parcela '||_numero||', recebido em '||to_char(_data,'DD/MM/YYYY'),a.installment_ids,auth.uid());
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'cob.judicial.alvara_liberado','cob_judicial_acordos',a.id::text,jsonb_build_object('parcela',_numero,'valor_cents',valor,'juros_confirmados_cents',_juros_confirmados,'data',_data,'conta',_conta,'settlement_id',r->>'id'));
 RETURN r||jsonb_build_object('settlement_id',r->>'id');
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_alvara_receber(uuid,integer,uuid,date,text,bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_alvara_receber(uuid,integer,uuid,date,text,bigint,bigint) TO authenticated;
CREATE OR REPLACE FUNCTION public.cob_judicial_alvara_liberar(_acordo uuid,_numero integer,_conta uuid,_data date,_referencia text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN RETURN public.cob_judicial_alvara_receber(_acordo,_numero,_conta,_data,_referencia,NULL,0); END $$;
CREATE OR REPLACE FUNCTION public.fin_mesa_alvaras(_line uuid,_busca text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE l financial_statement_lines; res jsonb;
BEGIN
 IF NOT public.has_capability(auth.uid(),'finance.reconcile') OR NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para consultar alvarás na conciliação.'; END IF;
 SELECT * INTO l FROM financial_statement_lines WHERE id=_line;
 IF l.id IS NULL OR l.kind<>'entrada' THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO res FROM (
  SELECT a.id acordo_id,a.party_id,p.display_name party_nome,p.code party_code,a.data_acordo,(x->>'numero')::integer numero,(x->>'data')::date data,(x->>'valor_cents')::bigint valor_cents
  FROM cob_judicial_acordos a JOIN parties p ON p.id=a.party_id CROSS JOIN LATERAL jsonb_array_elements(a.plano) x
  WHERE a.status<>'cancelado' AND coalesce((x->>'alvara')::boolean,false)
   AND NOT EXISTS(SELECT 1 FROM cob_judicial_alvara_recebimentos ar WHERE ar.acordo_id=a.id AND ar.parcela_numero=(x->>'numero')::int AND NOT EXISTS(SELECT 1 FROM financial_settlements rev WHERE rev.reversed_of=ar.settlement_id))
   AND (nullif(trim(_busca),'') IS NULL OR public.busca_casa(p.display_name||' '||coalesce(p.code,''),_busca))
  ORDER BY abs((x->>'data')::date-l.data),p.display_name,a.id,(x->>'numero')::int LIMIT 30
 ) q;
 RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.fin_mesa_alvaras(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fin_mesa_alvaras(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.fin_mesa_alvara_conciliar(_line uuid,_acordo uuid,_numero integer,_juros_confirmados bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l financial_statement_lines; r jsonb; chave text; existente financial_reconciliations;
BEGIN
 IF NOT public.has_capability(auth.uid(),'finance.reconcile') OR NOT public.has_capability(auth.uid(),'finance.settlement.create') OR NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para conciliar alvará.'; END IF;
 chave:='mesa:alvara:'||_line||':'||_acordo||':'||_numero;
 PERFORM pg_advisory_xact_lock(hashtext(chave));
 SELECT * INTO existente FROM financial_reconciliations WHERE (idempotency_key=chave OR idempotency_key LIKE chave||':refeita:%') AND status='ativa' AND NOT is_reversal ORDER BY created_at DESC LIMIT 1;
 IF existente.id IS NOT NULL THEN
  IF existente.observacao IS DISTINCT FROM 'Alvará judicial conciliado · juros confirmados: '||_juros_confirmados THEN RAISE EXCEPTION 'Esta conciliação já foi registrada com outros juros.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM cob_judicial_alvara_recebimentos ar JOIN financial_settlements s ON s.id=ar.settlement_id WHERE ar.settlement_id=existente.settlement_id AND ar.acordo_id=_acordo AND ar.parcela_numero=_numero AND NOT EXISTS(SELECT 1 FROM financial_settlements rev WHERE rev.reversed_of=s.id)) THEN RAISE EXCEPTION 'A baixa vinculada foi estornada. Desfaça o vínculo antes de refazer.'; END IF;
  RETURN jsonb_build_object('id',existente.id,'settlement_id',existente.settlement_id,'repetido',true);
 END IF;
 SELECT * INTO l FROM financial_statement_lines WHERE id=_line FOR UPDATE;
 IF l.id IS NULL OR l.kind<>'entrada' OR l.status NOT IN ('pendente','divergente') OR l.conciliado_cents<>0 THEN RAISE EXCEPTION 'Selecione uma entrada pendente sem conciliação parcial.'; END IF;
 r:=public.cob_judicial_alvara_receber(_acordo,_numero,l.financial_account_id,l.data,coalesce(nullif(l.bank_id,''),l.id::text),l.valor_cents,_juros_confirmados);
 RETURN public.fin_reconcile_baixa_existente(ARRAY[l.id],(r->>'settlement_id')::uuid,chave,'Alvará judicial conciliado · juros confirmados: '||_juros_confirmados);
END $$;
REVOKE ALL ON FUNCTION public.fin_mesa_alvara_conciliar(uuid,uuid,integer,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fin_mesa_alvara_conciliar(uuid,uuid,integer,bigint) TO authenticated;
DO $$ DECLARE d text; novo text; BEGIN
 d:=pg_get_functiondef('public.cob_judicial_desconto_final(uuid,uuid)'::regprocedure);
 novo:=replace(d,'sum(s.valor_cents)', 'sum(s.valor_cents-coalesce((SELECT sum(fa.valor_cents) FROM financial_adjustments fa WHERE fa.settlement_id=s.id AND fa.kind=''juros''),0))');
 IF novo=d THEN RAISE EXCEPTION 'Não encontrado cálculo de desconto judicial'; END IF; EXECUTE novo;
 d:=pg_get_functiondef('public.cob_judicial_estorno_desconto(uuid,uuid)'::regprocedure);
 novo:=replace(d,'sum(s.valor_cents)', 'sum(s.valor_cents-coalesce((SELECT sum(fa.valor_cents) FROM financial_adjustments fa WHERE fa.settlement_id=s.id AND fa.kind=''juros''),0))');
 IF novo=d THEN RAISE EXCEPTION 'Não encontrado cálculo de estorno judicial'; END IF; EXECUTE novo;
END $$;