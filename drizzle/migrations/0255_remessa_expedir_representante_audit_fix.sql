CREATE OR REPLACE FUNCTION public.remessa_expedir_representante(_remessa uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := public.kit_require_manage(); c record; n int := 0; r remessas;
BEGIN
  SELECT * INTO r FROM remessas WHERE id = _remessa;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.tipo_envio = 'correio' THEN RAISE EXCEPTION 'Remessa pelos Correios: a saída é confirmada pelo rastreio.'; END IF;
  FOR c IN SELECT id FROM kit_cycles WHERE remessa_id = _remessa AND status = 'conferida' AND representante_party_id IS NOT NULL ORDER BY created_at LOOP
    PERFORM public.kit_expedir(c.id, jsonb_build_object('rota','representante','note','Remessa ' || r.numero || ' entregue ao representante'));
    n := n + 1;
  END LOOP;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'remessa.expedida_representante', 'remessas', _remessa::text, jsonb_build_object('maletas', n));
  RETURN jsonb_build_object('maletas', n);
END $function$;