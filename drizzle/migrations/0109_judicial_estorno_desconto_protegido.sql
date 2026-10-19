CREATE FUNCTION public.cob_judicial_estorno_desconto(_original uuid,_estorno uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE aid uuid; p record; recebido bigint; total bigint;
BEGIN
 SELECT a.id,a.total_cents INTO aid,total FROM cob_judicial_acordos a WHERE EXISTS(SELECT 1 FROM cob_judicial_alvara_recebimentos ar WHERE ar.acordo_id=a.id AND ar.settlement_id=_original) OR EXISTS(SELECT 1 FROM cob_simulacoes sim JOIN asaas_charge_intents it ON it.acordo_simulacao_id=sim.id JOIN asaas_charges ch ON ch.id=it.charge_id JOIN financial_settlements s ON s.id=_original AND s.idempotency_key='asaas:baixa:'||ch.account_id||':'||ch.external_id WHERE sim.judicial_acordo_id=a.id) LIMIT 1 FOR UPDATE;
 IF aid IS NULL THEN RETURN; END IF;
 SELECT coalesce(sum(s.valor_cents),0) INTO recebido FROM financial_settlements s WHERE NOT EXISTS(SELECT 1 FROM financial_settlements rev WHERE rev.reversed_of=s.id) AND (EXISTS(SELECT 1 FROM cob_judicial_alvara_recebimentos ar WHERE ar.acordo_id=aid AND ar.settlement_id=s.id) OR EXISTS(SELECT 1 FROM cob_judicial_acordos a JOIN asaas_charge_intents it ON it.acordo_simulacao_id=a.simulacao_id JOIN asaas_charges ch ON ch.id=it.charge_id WHERE a.id=aid AND s.idempotency_key='asaas:baixa:'||ch.account_id||':'||ch.external_id));
 IF recebido>=total THEN RETURN; END IF;
 FOR p IN SELECT installment_id,sum(valor_cents) v FROM financial_adjustments WHERE motivo LIKE '%Desconto final do acordo judicial '||aid||'%' GROUP BY installment_id HAVING sum(valor_cents)>0 LOOP
  INSERT INTO financial_adjustments(installment_id,settlement_id,kind,valor_cents,motivo,created_by) VALUES(p.installment_id,_estorno,'desconto',-p.v,'Estorno: Desconto final do acordo judicial '||aid,auth.uid());
  PERFORM fin_installment_refresh(p.installment_id);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_estorno_desconto(uuid,uuid) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.fin_settlement_reverse(uuid,text)'::regprocedure);
 IF position('  return v_new;' in d)=0 THEN RAISE EXCEPTION 'Rotina de estorno mudou'; END IF;
 d:=replace(d,'  return v_new;', '  perform public.cob_judicial_estorno_desconto(s.id,v_new);' || E'\n' || '  return v_new;');
 EXECUTE d;
END $$;
CREATE OR REPLACE FUNCTION public.cob_judicial_desconto_final(_acordo uuid,_settlement uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a cob_judicial_acordos; recebido bigint; restante bigint; aplicado bigint; sd bigint; p record;
BEGIN
 SELECT * INTO a FROM cob_judicial_acordos WHERE id=_acordo FOR UPDATE;
 IF a.id IS NULL OR a.status='cancelado' THEN RETURN; END IF;
 SELECT coalesce(sum(s.valor_cents),0) INTO recebido FROM financial_settlements s WHERE NOT EXISTS(SELECT 1 FROM financial_settlements rev WHERE rev.reversed_of=s.id) AND
 (EXISTS(SELECT 1 FROM cob_judicial_alvara_recebimentos ar WHERE ar.acordo_id=a.id AND ar.settlement_id=s.id) OR EXISTS(SELECT 1 FROM asaas_charge_intents it JOIN asaas_charges ch ON ch.id=it.charge_id WHERE it.acordo_simulacao_id=a.simulacao_id AND s.idempotency_key='asaas:baixa:'||ch.account_id||':'||ch.external_id));
 IF recebido<a.total_cents OR a.desconto_cents<=0 THEN RETURN; END IF;
 SELECT coalesce(sum(valor_cents),0) INTO aplicado FROM financial_adjustments WHERE motivo LIKE '%Desconto final do acordo judicial '||a.id||'%';
 restante:=greatest(a.desconto_cents-aplicado,0);
 FOR p IN SELECT id FROM financial_installments WHERE id=ANY(a.installment_ids) ORDER BY vencimento DESC,id LOOP
  sd:=greatest(public.fin_installment_saldo(p.id),0); IF sd>0 AND restante>0 THEN
   INSERT INTO financial_adjustments(installment_id,settlement_id,kind,valor_cents,motivo,created_by) VALUES(p.id,_settlement,'desconto',least(sd,restante),'Desconto final do acordo judicial '||a.id,auth.uid());
   PERFORM public.fin_installment_refresh(p.id); restante:=restante-least(sd,restante);
  END IF;
 END LOOP;
END $$;