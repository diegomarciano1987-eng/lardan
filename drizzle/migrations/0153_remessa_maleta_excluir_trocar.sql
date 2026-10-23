CREATE OR REPLACE FUNCTION public.remessa_maleta_excluir(_cycle uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE uid uuid := auth.uid(); c kit_cycles; b record; total int := 0; anterior text; antes jsonb;
BEGIN
  IF NOT public.can_manage_kits(uid) THEN RAISE EXCEPTION 'Sem permissão para excluir maletas.' USING errcode='42501'; END IF;
  IF length(trim(coalesce(_motivo,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id=_cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.status = 'cancelada' THEN RETURN jsonb_build_object('repetida',true); END IF;
  IF c.status NOT IN ('rascunho','montagem','conferida') THEN
    RAISE EXCEPTION 'Só é possível excluir maleta que ainda não saiu (em montagem ou conferida).';
  END IF;
  IF EXISTS(SELECT 1 FROM kit_signature_requests WHERE cycle_id=c.id AND status NOT IN ('cancelado','cancelada','expirado','recusado'))
     OR EXISTS(SELECT 1 FROM kit_acceptances WHERE cycle_id=c.id)
     OR EXISTS(SELECT 1 FROM kit_balances WHERE cycle_id=c.id AND (qty_sold>0 OR qty_reserved>0 OR qty_return_transit>0))
     OR EXISTS(SELECT 1 FROM kit_movements WHERE cycle_id=c.id AND status='pendente') THEN
    RAISE EXCEPTION 'Esta maleta tem assinatura, aceite, venda ou movimento pendente; não pode ser excluída.';
  END IF;
  SELECT jsonb_build_object('cycle',to_jsonb(c),'balances',(SELECT jsonb_agg(to_jsonb(kb)) FROM kit_balances kb WHERE cycle_id=c.id)) INTO antes;
  anterior := coalesce(current_setting('lardan.kit_stock',true),'off');
  IF c.current_location_id IS NOT NULL AND c.current_location_id IS DISTINCT FROM c.origin_location_id THEN
    PERFORM id FROM stock_balances WHERE location_id=c.current_location_id ORDER BY variant_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM stock_balances WHERE location_id=c.current_location_id AND (quantity<0 OR reserved>0)) THEN
      RAISE EXCEPTION 'Saldo da maleta está reservado ou inválido.';
    END IF;
    FOR b IN SELECT * FROM stock_balances WHERE location_id=c.current_location_id AND quantity>0 ORDER BY variant_id LOOP
      PERFORM set_config('lardan.kit_stock','on',true);
      PERFORM public.register_stock_movement('transferencia',b.variant_id,b.quantity,c.current_location_id,c.origin_location_id,
        'transferencia',NULL,'exclusao-maleta:'||c.id,_motivo,'exclusao-maleta:'||c.id||':'||b.variant_id,NULL);
      PERFORM set_config('lardan.kit_stock',anterior,true);
      total := total + b.quantity;
    END LOOP;
  END IF;
  UPDATE kit_balances SET qty_returned=qty_returned+greatest(qty_available,0), is_published=false, updated_at=now() WHERE cycle_id=c.id;
  UPDATE kit_transfers SET status='cancelada', updated_by=uid WHERE cycle_id=c.id AND status IN ('pendente','transito');
  UPDATE kit_cycles SET status='cancelada', cancelled_at=now(), cancel_reason=_motivo, updated_by=uid WHERE id=c.id;
  INSERT INTO kit_events(cycle_id,kind,from_status,to_status,actor_user_id,reason,payload)
    VALUES(c.id,'maleta.excluida',c.status,'cancelada',uid,_motivo,jsonb_build_object('pecas_devolvidas',total));
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
    VALUES(uid,'maleta.excluir','kit_cycles',c.id::text,jsonb_build_object('antes',antes,'motivo',_motivo,'pecas_devolvidas',total));
  RETURN jsonb_build_object('cancelada',true,'pecas_devolvidas',total);
END $f$;

CREATE OR REPLACE FUNCTION public.remessa_maleta_trocar_consultora(_cycle uuid, _consultora uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE uid uuid := auth.uid(); c kit_cycles; r remessas; st party_status;
BEGIN
  IF NOT public.can_manage_kits(uid) THEN RAISE EXCEPTION 'Sem permissão para alterar maletas.' USING errcode='42501'; END IF;
  IF length(trim(coalesce(_motivo,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da troca.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id=_cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.status NOT IN ('rascunho','montagem','conferida') THEN
    RAISE EXCEPTION 'Só é possível trocar a consultora antes da maleta sair.';
  END IF;
  IF EXISTS(SELECT 1 FROM kit_signature_requests WHERE cycle_id=c.id AND status NOT IN ('cancelado','cancelada','expirado','recusado'))
     OR EXISTS(SELECT 1 FROM kit_acceptances WHERE cycle_id=c.id) THEN
    RAISE EXCEPTION 'Esta maleta já tem termo enviado ou aceite; não pode trocar a consultora.';
  END IF;
  IF c.consultora_party_id IS NOT DISTINCT FROM _consultora THEN RETURN jsonb_build_object('repetida',true); END IF;
  SELECT * INTO r FROM remessas WHERE id=c.remessa_id;
  IF _consultora IS NULL THEN
    IF coalesce(r.representante_party_id, c.representante_party_id) IS NULL THEN
      RAISE EXCEPTION 'A remessa não tem representante para ficar com a maleta.';
    END IF;
  ELSE
    SELECT status INTO st FROM parties WHERE id=_consultora;
    IF st IN ('bloqueado','desligado') THEN RAISE EXCEPTION 'Consultora bloqueada ou desligada.'; END IF;
    IF r.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM consultant_profiles WHERE party_id=_consultora AND praca_id=r.praca_id) THEN
      RAISE EXCEPTION 'Esta consultora não pertence à praça da remessa.';
    END IF;
    IF r.id IS NOT NULL AND EXISTS(SELECT 1 FROM kit_cycles WHERE remessa_id=r.id AND consultora_party_id=_consultora AND status<>'cancelada' AND id<>c.id) THEN
      RAISE EXCEPTION 'Esta consultora já tem maleta nesta remessa.';
    END IF;
  END IF;
  UPDATE kit_cycles SET consultora_party_id=_consultora, updated_by=uid, updated_at=now() WHERE id=c.id;
  INSERT INTO kit_events(cycle_id,kind,actor_user_id,reason,payload)
    VALUES(c.id,'maleta.consultora_trocada',uid,_motivo,jsonb_build_object('de',c.consultora_party_id,'para',_consultora));
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
    VALUES(uid,'maleta.trocar_consultora','kit_cycles',c.id::text,jsonb_build_object('de',c.consultora_party_id,'para',_consultora,'motivo',_motivo));
  RETURN jsonb_build_object('consultora_party_id',_consultora);
END $f$;

REVOKE ALL ON FUNCTION public.remessa_maleta_excluir(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remessa_maleta_trocar_consultora(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_maleta_excluir(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remessa_maleta_trocar_consultora(uuid,uuid,text) TO authenticated;