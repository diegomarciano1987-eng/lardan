CREATE OR REPLACE FUNCTION public.kit_cycle_create(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  v_kit uuid := nullif(_payload->>'kit_id','')::uuid;
  k public.kits; n integer; cyc uuid; comp uuid; origem uuid;
BEGIN
  origem := nullif(_payload->>'origin_location_id','')::uuid;
  IF origem IS NULL THEN
    SELECT id INTO origem FROM public.locations
     WHERE kind = 'deposito' AND is_active ORDER BY code LIMIT 1;
  END IF;
  IF origem IS NULL THEN RAISE EXCEPTION 'Nenhum depósito ativo para montar a maleta.'; END IF;

  IF v_kit IS NULL THEN
    INSERT INTO public.kits (label, notes, created_by, updated_by)
    VALUES (nullif(_payload->>'label',''), nullif(_payload->>'notes',''), uid, uid)
    RETURNING * INTO k;
  ELSE
    SELECT * INTO k FROM public.kits WHERE id = v_kit;
    IF k.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
    IF EXISTS (SELECT 1 FROM public.kit_cycles c
                WHERE c.kit_id = k.id AND c.status NOT IN ('encerrada','cancelada')) THEN
      RAISE EXCEPTION 'Esta maleta já possui um ciclo em aberto.';
    END IF;
  END IF;

  SELECT coalesce(max(c.cycle_no),0) + 1 INTO n FROM public.kit_cycles c WHERE c.kit_id = k.id;

  INSERT INTO public.kit_cycles (
    kit_id, cycle_no, status, consultora_party_id, representante_party_id,
    origin_location_id, current_location_id, due_at, notes, created_by, updated_by)
  VALUES (
    k.id, n, 'montagem',
    nullif(_payload->>'consultora_party_id','')::uuid,
    nullif(_payload->>'representante_party_id','')::uuid,
    origem, origem,
    nullif(_payload->>'due_at','')::timestamptz,
    nullif(_payload->>'notes',''), uid, uid)
  RETURNING id INTO cyc;

  INSERT INTO public.kit_compositions (cycle_id, version, created_by)
  VALUES (cyc, 1, uid) RETURNING id INTO comp;

  INSERT INTO public.kit_events (cycle_id, kind, to_status, actor_user_id, payload)
  VALUES (cyc, 'ciclo.criado', 'montagem', uid,
          jsonb_build_object('maleta', k.code, 'ciclo', n));

  RETURN jsonb_build_object('cycle_id', cyc, 'kit_id', k.id, 'code', k.code,
                            'qr_token', k.qr_token, 'cycle_no', n, 'composition_id', comp);
END $$;

REVOKE EXECUTE ON FUNCTION public.kit_cycle_create(jsonb) FROM anon;
