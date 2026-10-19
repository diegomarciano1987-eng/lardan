CREATE TABLE public.user_financial_access (user_id uuid PRIMARY KEY REFERENCES public.profiles(id), enabled boolean NOT NULL DEFAULT false, granted_by uuid REFERENCES public.profiles(id), reason text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.user_financial_access TO authenticated;
GRANT ALL ON public.user_financial_access TO service_role;
ALTER TABLE public.user_financial_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_access_read ON public.user_financial_access FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.has_role(auth.uid(),'master'));
CREATE FUNCTION public.access_financial_full_set(_user uuid,_enabled boolean,_actor uuid,_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_value boolean;
BEGIN
 IF auth.role()<>'service_role' OR NOT public.has_role(_actor,'master') OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=_actor AND is_active) THEN RAISE EXCEPTION 'Somente o Master pode liberar acesso financeiro completo.'; END IF;
 IF length(trim(coalesce(_reason,'')))<5 THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=_user AND is_active) THEN RAISE EXCEPTION 'Usuária inexistente ou inativa.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('financial_access:'||_user));
 SELECT enabled INTO old_value FROM user_financial_access WHERE user_id=_user;
 INSERT INTO user_financial_access(user_id,enabled,granted_by,reason) VALUES(_user,_enabled,_actor,_reason) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,granted_by=excluded.granted_by,reason=excluded.reason,updated_at=now();
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(_actor,'access.financial.full','user_financial_access',_user::text,jsonb_build_object('antes',coalesce(old_value,false),'depois',_enabled,'motivo',_reason));
END $$;
REVOKE ALL ON FUNCTION public.access_financial_full_set(uuid,boolean,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.access_financial_full_set(uuid,boolean,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.has_capability(_user_id uuid,_cap text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _user_id IS NOT NULL AND _user_id=auth.uid() AND EXISTS(SELECT 1 FROM profiles WHERE id=_user_id AND is_active)
 AND (EXISTS(SELECT 1 FROM user_roles ur JOIN role_capabilities rc ON rc.role=ur.role WHERE ur.user_id=_user_id AND rc.capability=_cap)
 OR (_cap LIKE 'finance.%' AND EXISTS(SELECT 1 FROM user_financial_access WHERE user_id=_user_id AND enabled) AND EXISTS(SELECT 1 FROM role_capabilities WHERE role='master' AND capability=_cap)))
 AND (_cap !~ '^(finance\.|users\.|access\.)' OR public.access_mfa_ok()); $$;
CREATE OR REPLACE FUNCTION public.my_capabilities() RETURNS TABLE(capability text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT DISTINCT rc.capability FROM role_capabilities rc WHERE public.has_capability(auth.uid(),rc.capability); $$;
CREATE OR REPLACE FUNCTION public.asaas_ator_pode(_actor uuid,_cap text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _actor IS NOT NULL AND EXISTS(SELECT 1 FROM profiles WHERE id=_actor AND is_active AND party_id IS NOT NULL) AND
 (EXISTS(SELECT 1 FROM user_roles ur JOIN role_capabilities rc ON rc.role=ur.role WHERE ur.user_id=_actor AND rc.capability=_cap)
 OR (_cap LIKE 'finance.%' AND EXISTS(SELECT 1 FROM user_financial_access WHERE user_id=_actor AND enabled) AND EXISTS(SELECT 1 FROM role_capabilities WHERE role='master' AND capability=_cap))); $$;
CREATE TABLE public.cob_judicial_alvara_recebimentos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), acordo_id uuid NOT NULL REFERENCES public.cob_judicial_acordos(id), parcela_numero integer NOT NULL, settlement_id uuid NOT NULL UNIQUE REFERENCES public.financial_settlements(id), valor_cents bigint NOT NULL CHECK(valor_cents>0), data date NOT NULL, conta_id uuid NOT NULL REFERENCES public.financial_accounts(id), referencia text NOT NULL, autor_id uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.cob_judicial_alvara_recebimentos TO authenticated;
GRANT ALL ON public.cob_judicial_alvara_recebimentos TO service_role;
ALTER TABLE public.cob_judicial_alvara_recebimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY alvara_read ON public.cob_judicial_alvara_recebimentos FOR SELECT TO authenticated USING(public.has_capability(auth.uid(),'finance.receivable.view'));
CREATE INDEX alvara_acordo ON public.cob_judicial_alvara_recebimentos(acordo_id,parcela_numero);
CREATE FUNCTION public.cob_judicial_desconto_final(_acordo uuid,_settlement uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a cob_judicial_acordos; recebido bigint; restante bigint; sd bigint; p record;
BEGIN
 SELECT * INTO a FROM cob_judicial_acordos WHERE id=_acordo FOR UPDATE;
 IF a.id IS NULL OR a.status='cancelado' THEN RETURN; END IF;
 SELECT coalesce(sum(s.valor_cents),0) INTO recebido FROM financial_settlements s WHERE NOT EXISTS(SELECT 1 FROM financial_settlements rev WHERE rev.reversed_of=s.id) AND
 (EXISTS(SELECT 1 FROM cob_judicial_alvara_recebimentos ar WHERE ar.acordo_id=a.id AND ar.settlement_id=s.id) OR EXISTS(SELECT 1 FROM asaas_charge_intents it JOIN asaas_charges ch ON ch.id=it.charge_id WHERE it.acordo_simulacao_id=a.simulacao_id AND s.idempotency_key='asaas:baixa:'||ch.account_id||':'||ch.external_id));
 IF recebido<a.total_cents OR a.desconto_cents<=0 THEN RETURN; END IF;
 restante:=a.desconto_cents;
 FOR p IN SELECT id FROM financial_installments WHERE id=ANY(a.installment_ids) ORDER BY vencimento DESC,id LOOP
  sd:=greatest(public.fin_installment_saldo(p.id),0); IF sd>0 AND restante>0 THEN
   INSERT INTO financial_adjustments(installment_id,settlement_id,kind,valor_cents,motivo,created_by) VALUES(p.id,_settlement,'desconto',least(sd,restante),'Desconto final do acordo judicial '||a.id,auth.uid());
   PERFORM public.fin_installment_refresh(p.id); restante:=restante-least(sd,restante);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_desconto_final(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.cob_judicial_alvara_liberar(_acordo uuid,_numero integer,_conta uuid,_data date,_referencia text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a cob_judicial_acordos; item jsonb; ex cob_judicial_alvara_recebimentos; valor bigint; resto bigint; sd bigint; primeira uuid; aloc jsonb:='[]'; p record; r jsonb; juros bigint:=0;
BEGIN
 IF NOT public.has_capability(auth.uid(),'finance.settlement.create') OR NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para registrar liberação de alvará.'; END IF;
 IF _data IS NULL OR _data>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Informe a data em que o dinheiro entrou, sem data futura.'; END IF;
 IF length(trim(coalesce(_referencia,'')))<3 THEN RAISE EXCEPTION 'Informe a identificação do alvará ou comprovante.'; END IF;
 SELECT * INTO a FROM cob_judicial_acordos WHERE id=_acordo FOR UPDATE;
 IF a.id IS NULL OR a.status='cancelado' THEN RAISE EXCEPTION 'Acordo inexistente ou cancelado.'; END IF;
 SELECT x INTO item FROM jsonb_array_elements(a.plano) x WHERE (x->>'numero')::int=_numero;
 IF item IS NULL OR coalesce((item->>'asaas')::boolean,false) AND NOT coalesce((item->>'alvara')::boolean,false) THEN RAISE EXCEPTION 'Esta parcela não é de alvará judicial.'; END IF;
 valor:=(item->>'valor_cents')::bigint;
 SELECT ar.* INTO ex FROM cob_judicial_alvara_recebimentos ar WHERE ar.acordo_id=_acordo AND ar.parcela_numero=_numero AND NOT EXISTS(SELECT 1 FROM financial_settlements rev WHERE rev.reversed_of=ar.settlement_id) ORDER BY ar.created_at DESC LIMIT 1;
 IF ex.id IS NOT NULL THEN
  IF ex.conta_id<>_conta OR ex.data<>_data OR ex.referencia<>trim(_referencia) THEN RAISE EXCEPTION 'Alvará já registrado com outros dados. Confira a baixa no Financeiro.'; END IF;
  RETURN jsonb_build_object('settlement_id',ex.settlement_id,'repetido',true);
 END IF;
 IF EXISTS(SELECT 1 FROM financial_installments i JOIN financial_titles t ON t.id=i.title_id WHERE i.id=ANY(a.installment_ids) AND t.party_id IS DISTINCT FROM a.party_id) THEN RAISE EXCEPTION 'A dívida pertence a outra cliente.'; END IF;
 PERFORM 1 FROM financial_installments WHERE id=ANY(a.installment_ids) ORDER BY id FOR UPDATE;
 resto:=valor;
 FOR p IN SELECT id FROM financial_installments WHERE id=ANY(a.installment_ids) ORDER BY vencimento,numero,id LOOP
  IF primeira IS NULL THEN primeira:=p.id; END IF;
  sd:=greatest(public.fin_installment_saldo(p.id),0); IF sd>0 AND resto>0 THEN aloc:=aloc||jsonb_build_object('installment_id',p.id,'valor_cents',least(sd,resto)); resto:=resto-least(sd,resto); END IF;
 END LOOP;
 IF primeira IS NULL THEN RAISE EXCEPTION 'Este acordo não tem dívida financeira vinculada. Vincule as contas a receber antes da baixa.'; END IF;
 IF resto>0 THEN
  juros:=resto;
  IF jsonb_array_length(aloc)=0 THEN aloc:=jsonb_build_array(jsonb_build_object('installment_id',primeira,'valor_cents',resto));
  ELSE primeira:=(aloc->0->>'installment_id')::uuid; aloc:=jsonb_set(aloc,'{0,valor_cents}',to_jsonb((aloc->0->>'valor_cents')::bigint+resto)); END IF;
 END IF;
 r:=public.fin_settlement_create_ajustes(jsonb_build_object('direction','receivable','financial_account_id',_conta,'data',_data,'valor_cents',valor,'juros_cents',juros,'referencia','Alvará judicial · '||trim(_referencia),'observacao','Acordo '||a.id||' · parcela '||_numero,'idempotency_key','judicial:alvara:'||a.id||':'||_numero||':'||(SELECT count(*) FROM cob_judicial_alvara_recebimentos WHERE acordo_id=a.id AND parcela_numero=_numero),'alocacoes',aloc));
 INSERT INTO cob_judicial_alvara_recebimentos(acordo_id,parcela_numero,settlement_id,valor_cents,data,conta_id,referencia,autor_id) VALUES(a.id,_numero,(r->>'id')::uuid,valor,_data,_conta,trim(_referencia),auth.uid());
 PERFORM public.cob_judicial_desconto_final(a.id,(r->>'id')::uuid);
 INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id) VALUES(a.party_id,'negociacao','sucesso','Alvará liberado: parcela '||_numero||', recebido em '||to_char(_data,'DD/MM/YYYY'),a.installment_ids,auth.uid());
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'cob.judicial.alvara_liberado','cob_judicial_acordos',a.id::text,jsonb_build_object('parcela',_numero,'valor_cents',valor,'data',_data,'conta',_conta,'settlement_id',r->>'id'));
 RETURN r||jsonb_build_object('settlement_id',r->>'id');
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_alvara_liberar(uuid,integer,uuid,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_alvara_liberar(uuid,integer,uuid,date,text) TO authenticated;
CREATE FUNCTION public.cob_judicial_alvaras(_acordo uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('numero',ar.parcela_numero,'data',ar.data,'valor_cents',ar.valor_cents,'conta',f.nome,'settlement_id',ar.settlement_id,'estornado',EXISTS(SELECT 1 FROM financial_settlements rev WHERE rev.reversed_of=ar.settlement_id)) ORDER BY ar.created_at) FROM cob_judicial_alvara_recebimentos ar JOIN financial_accounts f ON f.id=ar.conta_id WHERE ar.acordo_id=_acordo),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_alvaras(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_alvaras(uuid) TO authenticated;
CREATE FUNCTION public.cob_judicial_baixa_final_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE acordo uuid;
BEGIN
 IF NEW.action='cob.acordo_baixa_asaas' THEN
  SELECT judicial_acordo_id INTO acordo FROM cob_simulacoes WHERE id=NEW.entity_id::uuid;
  IF acordo IS NOT NULL THEN PERFORM public.cob_judicial_desconto_final(acordo,(NEW.payload->>'settlement')::uuid); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER judicial_baixa_final AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.cob_judicial_baixa_final_trigger();