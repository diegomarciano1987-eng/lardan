CREATE OR REPLACE FUNCTION public.rep_lead_atendimento(_rep uuid, _lead uuid, _dados jsonb, _perfil jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE le leads; v_cpf text := regexp_replace(coalesce(_dados->>'cpf',''),'\D','','g'); res text; pts int := 0; k text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  SELECT * INTO le FROM leads WHERE id = _lead FOR UPDATE;
  IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não está com você.'; END IF;
  IF v_cpf <> '' THEN
    IF length(v_cpf) <> 11 THEN RAISE EXCEPTION 'CPF inválido.'; END IF;
    IF le.cpf_digits IS NOT NULL AND le.cpf_digits <> v_cpf THEN RAISE EXCEPTION 'Esta candidata já tem outro CPF. Fale com a Lardan.'; END IF;
  END IF;
  UPDATE leads l SET
    cpf = CASE WHEN v_cpf <> '' AND l.cpf_digits IS NULL THEN v_cpf ELSE l.cpf END,
    email = coalesce(nullif(btrim(_dados->>'email'),''), l.email),
    postal_code = coalesce(nullif(regexp_replace(coalesce(_dados->>'cep',''),'\D','','g'),''), l.postal_code),
    street = coalesce(nullif(btrim(_dados->>'rua'),''), l.street),
    street_number = coalesce(nullif(btrim(_dados->>'numero'),''), l.street_number)
  WHERE l.id = _lead;
  IF _perfil IS NOT NULL AND jsonb_typeof(_perfil) = 'object' AND _perfil <> '{}'::jsonb THEN
    FOR k IN SELECT jsonb_object_keys(_perfil) LOOP pts := pts + coalesce((_perfil->>k)::int, 0); END LOOP;
    res := CASE WHEN pts >= 10 THEN 'Perfil forte' WHEN pts >= 7 THEN 'Perfil bom' ELSE 'Precisa de acompanhamento' END;
    INSERT INTO candidatura_assessments (lead_id, assessment_type, status, completed_at, result_reference, metadata)
    VALUES (_lead, 'perfil_presencial', 'concluido', now(), res,
            jsonb_build_object('respostas', _perfil, 'pontos', pts, 'representante', _rep, 'por', auth.uid()));
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'candidatura.atendimento_presencial', 'leads', _lead::text, jsonb_build_object('representante', _rep, 'perfil', res));
  RETURN jsonb_build_object('perfil', res, 'pontos', pts);
END $function$;