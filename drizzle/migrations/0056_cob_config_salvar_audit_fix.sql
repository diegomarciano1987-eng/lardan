CREATE OR REPLACE FUNCTION public.cob_config_salvar(_multa numeric, _juros numeric, _carencia int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE antes jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), array['master','diretoria','financeiro']::app_role[]) THEN RAISE EXCEPTION 'Só diretoria/financeiro altera os encargos'; END IF;
  SELECT to_jsonb(c) INTO antes FROM cob_config c;
  UPDATE cob_config SET multa_pct=_multa, juros_mes_pct=_juros, carencia_dias=_carencia, updated_by=auth.uid(), updated_at=now() WHERE id;
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'cob_config_salvar', 'cob_config', null, jsonb_build_object('antes', antes, 'multa', _multa, 'juros', _juros, 'carencia', _carencia));
END $$;