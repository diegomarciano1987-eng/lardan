-- Calibração Argox única para todas as colaboradoras (configurada em Remessas).
ALTER TABLE public.pedido_config ADD COLUMN IF NOT EXISTS etiqueta_calibracao jsonb;

CREATE OR REPLACE FUNCTION public.etiqueta_calibracao_ler() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT etiqueta_calibracao FROM pedido_config WHERE auth.uid() IS NOT NULL LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.etiqueta_calibracao_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etiqueta_calibracao_ler() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.etiqueta_calibracao_salvar(_cfg jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); antes jsonb;
BEGIN
  IF uid IS NULL OR NOT (public.has_role(uid, 'master') OR public.can_manage_kits(uid)) THEN
    RAISE EXCEPTION 'Sem permissão para calibrar a Argox.' USING errcode = '42501';
  END IF;
  IF jsonb_typeof(_cfg) <> 'object' THEN RAISE EXCEPTION 'Calibração inválida.'; END IF;
  SELECT etiqueta_calibracao INTO antes FROM pedido_config LIMIT 1;
  UPDATE pedido_config SET etiqueta_calibracao = _cfg;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'etiqueta.calibracao_salva', 'pedido_config', 'argox', jsonb_build_object('antes', antes, 'depois', _cfg));
  RETURN _cfg;
END $$;
REVOKE ALL ON FUNCTION public.etiqueta_calibracao_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etiqueta_calibracao_salvar(jsonb) TO authenticated, service_role;