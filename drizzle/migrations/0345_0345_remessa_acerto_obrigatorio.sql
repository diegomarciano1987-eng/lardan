CREATE OR REPLACE FUNCTION public.remessa_criar(_praca uuid, _numero integer DEFAULT NULL::integer, _data_emissao date DEFAULT NULL::date, _data_acerto date DEFAULT NULL::date, _representante uuid DEFAULT NULL::uuid, _deposito uuid DEFAULT NULL::uuid, _observacoes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_num integer; v_id uuid;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para abrir remessas.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cob_pracas WHERE id = _praca AND ativo) THEN RAISE EXCEPTION 'Escolha uma praça ativa.'; END IF;
  -- 0345 (Diego, 19/11/2026): data de acerto é obrigatória (a baixa pelo app depende dela)
  IF _data_acerto IS NULL THEN RAISE EXCEPTION 'Informe a data de acerto da remessa: ela é obrigatória.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('remessa_numero'));
  v_num := coalesce(_numero, greatest((SELECT coalesce(max(numero), 874) FROM remessas), coalesce((SELECT max(numero) FROM legado_remessas), 0)) + 1);
  IF EXISTS (SELECT 1 FROM remessas WHERE numero = v_num) THEN RAISE EXCEPTION 'Já existe a remessa nº %.', v_num; END IF;
  IF EXISTS (SELECT 1 FROM legado_remessas WHERE numero = v_num) THEN RAISE EXCEPTION 'A remessa nº % já foi usada no SmallData.', v_num; END IF;
  IF _data_acerto < coalesce(_data_emissao, current_date) THEN
    RAISE EXCEPTION 'A data de acerto não pode ser antes da emissão.';
  END IF;
  INSERT INTO remessas (numero, praca_id, representante_party_id, origin_location_id, data_emissao, data_acerto, observacoes, created_by)
  VALUES (v_num, _praca, _representante, _deposito,
          coalesce(_data_emissao, (now() AT TIME ZONE 'America/Sao_Paulo')::date), _data_acerto, nullif(btrim(_observacoes),''), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_criar', 'remessas', v_id::text, jsonb_build_object('numero', v_num, 'praca', _praca, 'acerto', _data_acerto));
  RETURN jsonb_build_object('id', v_id, 'numero', v_num);
END; $function$;

CREATE OR REPLACE FUNCTION public.remessa_atualizar(_id uuid, _data_acerto date, _representante uuid, _status text, _observacoes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para alterar remessas.'; END IF;
  -- 0345: data de acerto obrigatória
  IF _data_acerto IS NULL THEN RAISE EXCEPTION 'Informe a data de acerto da remessa: ela é obrigatória.'; END IF;
  UPDATE remessas SET data_acerto = _data_acerto, representante_party_id = _representante,
    status = coalesce(_status, status), observacoes = nullif(btrim(_observacoes),''), updated_at = now()
  WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_atualizar', 'remessas', _id::text,
          jsonb_build_object('acerto', _data_acerto, 'representante', _representante, 'status', _status));
END; $function$;