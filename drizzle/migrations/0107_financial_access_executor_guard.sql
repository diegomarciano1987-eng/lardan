CREATE OR REPLACE FUNCTION public.access_financial_full_set(_user uuid,_enabled boolean,_actor uuid,_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_value boolean;
BEGIN
 IF NOT public.has_role(_actor,'master') OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=_actor AND is_active) THEN RAISE EXCEPTION 'Somente o Master pode liberar acesso financeiro completo.'; END IF;
 IF length(trim(coalesce(_reason,'')))<5 THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=_user AND is_active) THEN RAISE EXCEPTION 'Usuária inexistente ou inativa.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('financial_access:'||_user));
 SELECT enabled INTO old_value FROM user_financial_access WHERE user_id=_user;
 INSERT INTO user_financial_access(user_id,enabled,granted_by,reason) VALUES(_user,_enabled,_actor,_reason) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,granted_by=excluded.granted_by,reason=excluded.reason,updated_at=now();
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(_actor,'access.financial.full','user_financial_access',_user::text,jsonb_build_object('antes',coalesce(old_value,false),'depois',_enabled,'motivo',_reason));
END $$;
REVOKE ALL ON FUNCTION public.access_financial_full_set(uuid,boolean,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.access_financial_full_set(uuid,boolean,uuid,text) TO service_role;