-- 0263: guardas oficiais, reservas e auditoria somente leitura. Nenhuma correção de dados executada.
CREATE OR REPLACE FUNCTION public.auditoria_integridade()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $f$
DECLARE c record; n bigint; amostra text[]; res jsonb := '[]'::jsonb;
BEGIN
 IF NOT (coalesce(auth.role(),'')='service_role' OR coalesce(current_setting('role',true),'')='service_role' OR public.has_role(auth.uid(),'master'::public.app_role)) THEN RAISE EXCEPTION 'Só o Master.' USING errcode='42501'; END IF;
 FOR c IN SELECT * FROM (VALUES
 ('estoque','E1','alta','Saldo negativo de estoque',$q$SELECT l.kind||' '||coalesce(l.code,l.id::text)||' · '||coalesce(v.barcode,v.id::text)||' · '||b.quantity AS ref FROM stock_balances b JOIN locations l ON l.id=b.location_id JOIN product_variants v ON v.id=b.variant_id WHERE b.quantity<0 ORDER BY b.quantity$q$),
 ('estoque','E2','alta','Reservado maior que o saldo',$q$SELECT coalesce(l.code,l.id::text)||' · '||coalesce(v.barcode,v.id::text)||' · saldo '||b.quantity||' reservado '||b.reserved AS ref FROM stock_balances b JOIN locations l ON l.id=b.location_id JOIN product_variants v ON v.id=b.variant_id WHERE b.reserved>greatest(b.quantity,0)$q$),
 ('estoque','E3','alta','Reserva ativa em maleta que saiu, foi cancelada ou encerrada',$q$SELECT k.code||' · '||c.status||' · '||sr.quantity||' un.' AS ref FROM stock_reservations sr JOIN kit_composition_items i ON i.reservation_id=sr.id JOIN kit_compositions kc ON kc.id=i.composition_id JOIN kit_cycles c ON c.id=kc.cycle_id JOIN kits k ON k.id=c.kit_id WHERE sr.status='ativa' AND c.status NOT IN ('rascunho','montagem','conferida')$q$),
 ('estoque','E4','media','Reserva ativa vencida',$q$SELECT coalesce(sr.protocol,sr.id::text)||' · '||sr.origin||' · venceu '||to_char(sr.expires_at,'DD/MM') AS ref FROM stock_reservations sr WHERE sr.status='ativa' AND sr.expires_at<now()$q$),
 ('estoque','E5','alta','Saldo negativo dentro da maleta',$q$SELECT k.code||' · '||c.status||' · '||b.qty_available AS ref FROM kit_balances b JOIN kit_cycles c ON c.id=b.cycle_id JOIN kits k ON k.id=c.kit_id WHERE b.qty_available<0$q$),
 ('maletas','M1','alta','Maleta com consultora sem cadastro ligado',$q$SELECT k.code||' · '||c.status AS ref FROM kit_cycles c JOIN kits k ON k.id=c.kit_id WHERE c.status IN ('recebida','operacao','acerto') AND c.consultora_party_id IS NULL$q$),
 ('maletas','M2','media','Consultora com mais de uma maleta aberta',$q$SELECT p.code||' · '||count(*)||' maletas' AS ref FROM kit_cycles c JOIN parties p ON p.id=c.consultora_party_id WHERE c.status IN ('recebida','operacao') GROUP BY p.code HAVING count(*)>1$q$),
 ('maletas','M3','alta','Maleta conferida ou enviada sem peças',$q$SELECT k.code||' · '||c.status AS ref FROM kit_cycles c JOIN kits k ON k.id=c.kit_id WHERE c.status IN ('conferida','expedida','transito','recebida','operacao') AND NOT EXISTS (SELECT 1 FROM kit_balances b WHERE b.cycle_id=c.id AND b.qty_allocated>0)$q$),
 ('maletas','M4','media','Maleta em trânsito há mais de 15 dias',$q$SELECT k.code||' · saiu '||to_char(c.shipped_at,'DD/MM') AS ref FROM kit_cycles c JOIN kits k ON k.id=c.kit_id WHERE c.status IN ('expedida','transito') AND coalesce(c.shipped_at,c.updated_at)<now()-interval '15 days'$q$),
 ('maletas','M5','media','Entregue há mais de 7 dias sem aceite',$q$SELECT k.code||' · recebida '||to_char(c.received_at,'DD/MM') AS ref FROM kit_cycles c JOIN kits k ON k.id=c.kit_id WHERE c.status='recebida' AND c.received_at<now()-interval '7 days' AND NOT EXISTS (SELECT 1 FROM kit_acceptances a WHERE a.cycle_id=c.id)$q$),
 ('maletas','M6','media','Maleta em operação com acerto vencido',$q$SELECT k.code||' · venceu '||to_char(c.due_at,'DD/MM') AS ref FROM kit_cycles c JOIN kits k ON k.id=c.kit_id WHERE c.status='operacao' AND c.due_at<now()-interval '3 days'$q$),
 ('maletas','M7','alta','Remessa fechada com maleta aberta (finalização não implica encerramento)',$q$SELECT 'Remessa '||r.numero||' · '||k.code||' · '||c.status AS ref FROM kit_cycles c JOIN kits k ON k.id=c.kit_id JOIN remessas r ON r.id=c.remessa_id WHERE r.status IN ('fechada','cancelada') AND c.status NOT IN ('encerrada','cancelada')$q$),
 ('maletas','M8','info','Maletas transferidas do SmallData',$q$SELECT 'SmallData '||m.legado_remessa||' kit '||m.kit||' · '||m.situacao||coalesce(' · '||c.status::text,'') AS ref FROM legado_transferencia_maletas m LEFT JOIN kit_cycles c ON c.id=m.cycle_id$q$),
 ('pessoas','P1','alta','Documento repetido em cadastros',$q$SELECT string_agg(p.code,' = ' ORDER BY p.created_at) AS ref FROM parties p WHERE p.doc_digits IS NOT NULL AND p.status NOT IN ('desligado') GROUP BY p.doc_digits HAVING count(*)>1$q$),
 ('pessoas','P2','media','Representantes com nome repetido',$q$SELECT string_agg(p.code,' = ') AS ref FROM parties p JOIN party_roles r ON r.party_id=p.id AND r.role='representante' GROUP BY upper(btrim(split_part(p.display_name,' ',1))),upper(btrim(p.display_name)) HAVING count(DISTINCT p.id)>1$q$),
 ('pessoas','P3','media','Representante ativo sem documento',$q$SELECT p.code AS ref FROM parties p JOIN party_roles r ON r.party_id=p.id AND r.role='representante' AND r.status='ativo' WHERE p.doc_digits IS NULL$q$),
 ('pessoas','P4','alta','Representante legado ligado a cadastro com outro primeiro nome',$q$SELECT lr.codigo||' → '||p.code AS ref FROM legado_representantes lr JOIN parties p ON p.id=lr.party_id WHERE upper(split_part(btrim(lr.nome),' ',1))<>upper(split_part(btrim(p.display_name),' ',1))$q$),
 ('pessoas','P5','media','Consultora ativa sem conta',$q$SELECT p.code AS ref FROM parties p JOIN party_roles r ON r.party_id=p.id AND r.role='consultora' AND r.status='ativo' WHERE NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.party_id=p.id)$q$),
 ('pessoas','P6','alta','Conta consultora sem cadastro ligado',$q$SELECT left(pr.id::text,8) AS ref FROM user_roles ur JOIN profiles pr ON pr.id=ur.user_id WHERE ur.role='consultora' AND pr.party_id IS NULL$q$),
 ('pessoas','P7','media','Consultora ativa sem praça ou representante',$q$SELECT p.code||CASE WHEN cp.praca_id IS NULL THEN ' · sem praça' ELSE '' END||CASE WHEN cp.representative_party_id IS NULL THEN ' · sem representante' ELSE '' END AS ref FROM parties p JOIN party_roles r ON r.party_id=p.id AND r.role='consultora' AND r.status='ativo' LEFT JOIN consultant_profiles cp ON cp.party_id=p.id WHERE cp.party_id IS NULL OR cp.praca_id IS NULL OR cp.representative_party_id IS NULL$q$),
 ('pessoas','P8','media','Representante da maleta diferente do cadastro',$q$SELECT k.code||' · '||p.code AS ref FROM kit_cycles c JOIN kits k ON k.id=c.kit_id JOIN parties p ON p.id=c.consultora_party_id JOIN consultant_profiles cp ON cp.party_id=p.id WHERE c.status IN ('recebida','operacao') AND c.representante_party_id IS NOT NULL AND cp.representative_party_id IS NOT NULL AND c.representante_party_id<>cp.representative_party_id$q$),
 ('financeiro','F1','alta','Pedido pago sem título ligado',$q$SELECT o.code||' · '||o.channel AS ref FROM sales_orders o WHERE o.payment_status='pago' AND o.pay_charge_id IS NOT NULL AND o.pay_title_id IS NULL$q$),
 ('financeiro','F2','alta','Falha ao cancelar cobrança de pedido',$q$SELECT o.code AS ref FROM pedido_cobranca_cancelamentos x JOIN sales_orders o ON o.id=x.order_id WHERE x.situacao='falhou'$q$),
 ('financeiro','F3','alta','Compra da vitrine não paga com reserva vencida',$q$SELECT o.code||' · venceu '||to_char(o.reserve_expires_at,'DD/MM HH24:MI') AS ref FROM sales_orders o WHERE o.channel='vitrine' AND o.status='aguardando_pagamento' AND o.reserve_expires_at<now()-interval '30 minutes'$q$),
 ('financeiro','F4','info','Parcelas a receber vencidas há mais de 30 dias',$q$SELECT t.numero||' · '||to_char(i.vencimento,'DD/MM/YY')||' · '||i.valor_cents AS ref FROM financial_installments i JOIN financial_titles t ON t.id=i.title_id WHERE t.direction='receivable' AND t.status NOT IN ('cancelado') AND i.settlement_status IN ('nao_liquidado','parcial') AND i.vencimento<current_date-30 ORDER BY i.vencimento$q$),
 ('financeiro','F5','media','Pedido concluído sem forma de pagamento',$q$SELECT o.code AS ref FROM sales_orders o WHERE public.venda_forma(o)='sem_forma' AND o.status='concluido'$q$),
 ('financeiro','F6','alta','Aviso Asaas com erro não processado',$q$SELECT e.event||' · '||coalesce(e.charge_external_id,'') AS ref FROM asaas_events e WHERE e.processed_at IS NULL AND e.last_error IS NOT NULL$q$),
 ('financeiro','F7','media','Nenhum aviso Asaas nas últimas 48 horas',$q$SELECT 'último aviso: '||coalesce(to_char(max(received_at),'DD/MM HH24:MI'),'nunca') AS ref FROM asaas_events HAVING coalesce(max(received_at),'epoch')<now()-interval '48 hours'$q$),
 ('financeiro','F8','media','Sincronização Asaas sem rodar há mais de 36 horas',$q$SELECT 'última: '||coalesce(to_char(max(iniciado_em),'DD/MM HH24:MI'),'nunca') AS ref FROM asaas_charge_sync_runs HAVING coalesce(max(iniciado_em),'epoch')<now()-interval '36 hours'$q$),
 ('maletas','M9','alta','Maleta aberta de cadastro bloqueado, desligado ou suspenso',$q$SELECT k.code||' · '||p.code||' · '||CASE WHEN EXISTS (SELECT 1 FROM cob_casos cc WHERE cc.party_id=p.id AND cc.suspensa) THEN 'suspensa' ELSE p.status::text END AS ref FROM kit_cycles c JOIN kits k ON k.id=c.kit_id JOIN parties p ON p.id=c.consultora_party_id WHERE c.status IN ('expedida','transito','recebida','operacao') AND (p.status IN ('bloqueado','desligado') OR EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id=p.id AND r.role='consultora' AND r.status IN ('bloqueado','desligado')) OR EXISTS (SELECT 1 FROM cob_casos cc WHERE cc.party_id=p.id AND cc.suspensa))$q$),
 ('vitrine','V1','media','Vitrine pública de cadastro não ativo',$q$SELECT s.id::text AS ref FROM consultant_showcases s WHERE s.is_public AND NOT EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id=s.party_id AND r.role='consultora' AND r.status='ativo')$q$),
 ('fiscal','N1','alta','Nota parada ou rejeitada há mais de um dia',$q$SELECT d.kind||' · '||d.status||coalesce(' · '||d.rejection_code,'')||' · '||to_char(d.created_at,'DD/MM') AS ref FROM fiscal_documents d WHERE d.status IN ('preparacao','enviado','rejeitado') AND d.created_at<now()-interval '1 day' AND NOT coalesce(d.simulado,false)$q$),
 ('fiscal','N2','info','Notas em produção (inventário; não altera ambiente)',$q$SELECT d.kind||' · '||d.status||' · '||coalesce(d.number,'') AS ref FROM fiscal_documents d WHERE d.environment='producao'$q$),
 ('correios','C1','alta','Envio Correios com erro',$q$SELECT coalesce(e.codigo_objeto,left(e.id::text,8))||' · '||e.status AS ref FROM correios_envios e WHERE e.status='erro' OR e.auto_erro IS NOT NULL$q$),
 ('correios','C2','media','Entrega cinco dias além do previsto',$q$SELECT coalesce(e.codigo_objeto,'')||' · previsto '||to_char(e.previsto_entrega,'DD/MM') AS ref FROM correios_envios e WHERE e.status IN ('postada','em_transito') AND e.previsto_entrega<current_date-5$q$),
 ('correios','C3','media','Etiqueta sem postagem no prazo',$q$SELECT coalesce(e.codigo_objeto,'')||' · limite '||to_char(e.limite_postagem,'DD/MM') AS ref FROM correios_envios e WHERE e.status='pre_postada' AND e.limite_postagem<current_date$q$),
 ('acessos','A1','media','Convite com falha no envio',$q$SELECT p.code AS ref FROM access_invites i JOIN parties p ON p.id=i.party_id WHERE i.status='falha_envio'$q$),
 ('acessos','A2','info','Convites pendentes vencidos',$q$SELECT p.code AS ref FROM access_invites i JOIN parties p ON p.id=i.party_id WHERE i.status='pendente' AND i.expires_at<now()$q$),
 ('acessos','A3','info','Contas Master',$q$SELECT left(pr.id::text,8) AS ref FROM user_roles ur JOIN profiles pr ON pr.id=ur.user_id WHERE ur.role='master'$q$)
 ) AS t(area,codigo,gravidade,descricao,sql) LOOP
 BEGIN
 EXECUTE format('SELECT count(*), (array_agg(ref))[1:5] FROM (%s) q',c.sql) INTO n,amostra;
 res:=res||jsonb_build_object('area',c.area,'codigo',c.codigo,'gravidade',c.gravidade,'descricao',c.descricao,'quantidade',n,'exemplos',to_jsonb(coalesce(amostra,'{}')));
 EXCEPTION WHEN others THEN res:=res||jsonb_build_object('area',c.area,'codigo',c.codigo,'gravidade',c.gravidade,'descricao',c.descricao,'erro',SQLERRM);
 END;
 END LOOP;
 RETURN jsonb_build_object('gerado_em',now(),'itens',res);
END $f$;
REVOKE ALL ON FUNCTION public.auditoria_integridade() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.auditoria_integridade() TO authenticated,service_role;
DO $$ DECLARE f text; BEGIN FOREACH f IN ARRAY ARRAY['public.kit_devolver_custodia_representante(uuid,text)','public.remessa_expedir_representante(uuid)','public.rep_abertura_rua_cadastrar(uuid,jsonb,jsonb)','public.qualidade_correios_dados(uuid,text)','public.pdv_membro_pin(uuid,text)'] LOOP IF to_regprocedure(f) IS NOT NULL THEN EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',f); END IF; END LOOP; END $$;
ALTER TABLE IF EXISTS public.asaas_import_pages ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.consultora_pode_receber_maleta(_party uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE st text; m text;
BEGIN
 IF _party IS NULL THEN RETURN; END IF;
 SELECT suspensa_motivo INTO m FROM cob_casos WHERE party_id=_party AND suspensa LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'Consultora suspensa pela cobrança (%). Libere na Central de Cobrança antes.',coalesce(m,'sem motivo') USING errcode='P0001'; END IF;
 SELECT status::text INTO st FROM parties WHERE id=_party;
 IF st IN ('bloqueado','desligado') OR EXISTS(SELECT 1 FROM party_roles WHERE party_id=_party AND role='consultora' AND status IN ('bloqueado','desligado')) THEN RAISE EXCEPTION 'Este cadastro está bloqueado ou desligado e não pode receber maleta. Fale com a Lardan.' USING errcode='P0001'; END IF;
END $f$;
REVOKE ALL ON FUNCTION public.consultora_pode_receber_maleta(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.kit_consultora_nova_guarda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN IF NEW.consultora_party_id IS NOT NULL AND NEW.consultora_party_id IS DISTINCT FROM OLD.consultora_party_id THEN PERFORM public.consultora_pode_receber_maleta(NEW.consultora_party_id); END IF; RETURN NEW; END $f$;
DROP TRIGGER IF EXISTS kit_consultora_nova_guarda ON public.kit_cycles;
CREATE TRIGGER kit_consultora_nova_guarda BEFORE UPDATE OF consultora_party_id ON public.kit_cycles FOR EACH ROW EXECUTE FUNCTION public.kit_consultora_nova_guarda();
CREATE OR REPLACE FUNCTION public.kit_consultora_insert_guarda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN IF NEW.consultora_party_id IS NOT NULL AND NEW.status NOT IN ('encerrada','cancelada') THEN PERFORM public.consultora_pode_receber_maleta(NEW.consultora_party_id); END IF; RETURN NEW; END $f$;
DROP TRIGGER IF EXISTS kit_consultora_insert_guarda ON public.kit_cycles;
CREATE TRIGGER kit_consultora_insert_guarda BEFORE INSERT ON public.kit_cycles FOR EACH ROW EXECUTE FUNCTION public.kit_consultora_insert_guarda();
REVOKE ALL ON FUNCTION public.kit_consultora_nova_guarda(),public.kit_consultora_insert_guarda() FROM PUBLIC,anon,authenticated;
DO $do$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.rep_maleta_repassar(uuid,uuid,uuid,uuid)'::regprocedure);
 IF position('doc_digits = le.cpf_digits AND is_active ORDER BY created_at' IN def)>0 THEN def:=replace(def,'doc_digits = le.cpf_digits AND is_active ORDER BY created_at','doc_digits = le.cpf_digits ORDER BY is_active DESC, created_at'); EXECUTE def;
 ELSIF position('doc_digits = le.cpf_digits ORDER BY is_active DESC' IN def)=0 THEN RAISE EXCEPTION 'rep_maleta_repassar mudou; revisar a 0263 antes de aplicar.'; END IF;
 def:=pg_get_functiondef('public.rep_abertura_rua_cadastrar(uuid,jsonb,jsonb)'::regprocedure);
 IF position('doc_digits = v_cpf AND is_active ORDER BY created_at LIMIT 1;' IN def)>0 THEN def:=replace(def,'doc_digits = v_cpf AND is_active ORDER BY created_at LIMIT 1;','doc_digits = v_cpf ORDER BY is_active DESC, created_at LIMIT 1;'||chr(10)||'  PERFORM public.consultora_pode_receber_maleta(pid);'); EXECUTE def;
 ELSIF position('PERFORM public.consultora_pode_receber_maleta(pid);' IN def)=0 THEN RAISE EXCEPTION 'rep_abertura_rua_cadastrar mudou; revisar a 0263 antes de aplicar.'; END IF;
END $do$;
DO $do$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.remessa_maleta_excluir(uuid,text)'::regprocedure);
 IF position('exclusao-maleta-reserva:' IN def)=0 THEN
 IF position('DECLARE uid uuid := auth.uid(); c kit_cycles; b record;' IN def)=0 OR position('  UPDATE kit_balances SET qty_returned=qty_returned+greatest(qty_available,0)' IN def)=0 THEN RAISE EXCEPTION 'remessa_maleta_excluir mudou; revisar a 0263 antes de aplicar.'; END IF;
 def:=replace(def,'DECLARE uid uuid := auth.uid(); c kit_cycles; b record;','DECLARE uid uuid := auth.uid(); c kit_cycles; b record; rr record;');
 def:=replace(def,'  UPDATE kit_balances SET qty_returned=qty_returned+greatest(qty_available,0)','  FOR rr IN SELECT i.id, i.reservation_id FROM kit_composition_items i JOIN kit_compositions kc ON kc.id=i.composition_id'||chr(10)||'             JOIN stock_reservations sr ON sr.id=i.reservation_id AND sr.status=''ativa'' WHERE kc.cycle_id=c.id LOOP'||chr(10)||'    PERFORM public.colab_kit_reserva_liberar_interna(rr.reservation_id, false, ''Maleta excluída: ''||_motivo, ''exclusao-maleta-reserva:''||rr.id::text);'||chr(10)||'  END LOOP;'||chr(10)||'  UPDATE kit_balances SET qty_returned=qty_returned+greatest(qty_available,0)'); EXECUTE def;
 END IF;
END $do$;
CREATE OR REPLACE FUNCTION public.estoque_reservas_presas(_aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r record; n int:=0; un int:=0; lista jsonb:='[]';
BEGIN
 IF NOT public.has_role(auth.uid(),'master'::public.app_role) THEN RAISE EXCEPTION 'Só o Master.' USING errcode='42501'; END IF;
 FOR r IN SELECT i.id item,sr.id res,sr.quantity q,k.code label,c.status::text st FROM stock_reservations sr JOIN kit_composition_items i ON i.reservation_id=sr.id JOIN kit_compositions kc ON kc.id=i.composition_id JOIN kit_cycles c ON c.id=kc.cycle_id JOIN kits k ON k.id=c.kit_id WHERE sr.status='ativa' AND c.status NOT IN ('rascunho','montagem','conferida') ORDER BY k.code LOOP
 IF _aplicar THEN PERFORM public.colab_kit_reserva_liberar_interna(r.res,false,'Reserva presa de maleta '||r.st||' (auditoria 0263)','reserva-presa-0263:'||r.item::text); END IF;
 n:=n+1; un:=un+r.q;
 IF n<=50 THEN lista:=lista||jsonb_build_object('maleta',r.label,'situacao',r.st,'quantidade',r.q); END IF;
 END LOOP;
 IF _aplicar AND n>0 THEN INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'estoque.reservas_presas_liberadas','stock_reservations',NULL,jsonb_build_object('reservas',n,'unidades',un)); END IF;
 RETURN jsonb_build_object('aplicado',_aplicar,'reservas',n,'unidades',un,'exemplos',lista);
END $f$;
REVOKE ALL ON FUNCTION public.estoque_reservas_presas(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.estoque_reservas_presas(boolean) TO authenticated;