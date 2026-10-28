CREATE OR REPLACE FUNCTION public.etiqueta_calibracao_salvar(_cfg jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); antes jsonb; n int;
BEGIN
  IF uid IS NULL OR NOT (public.has_role(uid, 'master') OR public.can_manage_kits(uid)) THEN
    RAISE EXCEPTION 'Sem permissão para calibrar a Argox.' USING errcode = '42501';
  END IF;
  IF jsonb_typeof(_cfg) <> 'object' THEN RAISE EXCEPTION 'Calibração inválida.'; END IF;
  SELECT etiqueta_calibracao INTO antes FROM pedido_config LIMIT 1;
  UPDATE pedido_config SET etiqueta_calibracao = _cfg WHERE true;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Configuração do pedido não encontrada.'; END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'etiqueta.calibracao_salva', 'pedido_config', 'argox', jsonb_build_object('antes', antes, 'depois', _cfg));
  RETURN _cfg;
END $function$;