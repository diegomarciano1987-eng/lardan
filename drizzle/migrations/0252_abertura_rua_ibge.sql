CREATE OR REPLACE FUNCTION public.rep_abertura_rua_cadastrar(_rep uuid, _dados jsonb, _perfil jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); d jsonb := coalesce(_dados,'{}'::jsonb);
  v_nome text := btrim(coalesce(d->>'nome','')); v_cpf text := regexp_replace(coalesce(d->>'cpf',''),'\D','','g');
  v_zap text := regexp_replace(coalesce(d->>'whatsapp',''),'\D','','g'); v_mail text := lower(btrim(coalesce(d->>'email','')));
  v_nasc date; v_rg text := btrim(coalesce(d->>'rg','')); v_rg_org text := nullif(btrim(coalesce(d->>'rg_orgao','')),'');
  v_civil text := btrim(coalesce(d->>'estado_civil','')); v_cep text := regexp_replace(coalesce(d->>'cep',''),'\D','','g');
  v_rua text := btrim(coalesce(d->>'rua','')); v_num text := btrim(coalesce(d->>'numero',''));
  v_comp text := nullif(btrim(coalesce(d->>'complemento','')),''); v_bairro text := btrim(coalesce(d->>'bairro',''));
  v_cidade text := btrim(coalesce(d->>'cidade','')); v_uf text := upper(btrim(coalesce(d->>'uf','')));
  pid uuid; outro uuid; v_lead uuid; pts int := 0; k text; res text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  IF length(v_nome) < 5 OR position(' ' in v_nome) = 0 THEN RAISE EXCEPTION 'Informe o nome completo.'; END IF;
  IF NOT public.cpf_is_valid(v_cpf) THEN RAISE EXCEPTION 'CPF inválido.'; END IF;
  IF v_zap LIKE '55%' AND length(v_zap) > 11 THEN v_zap := substr(v_zap,3); END IF;
  IF length(v_zap) <> 11 THEN RAISE EXCEPTION 'WhatsApp inválido: DDD + 9 dígitos.'; END IF;
  IF v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.'; END IF;
  BEGIN v_nasc := (d->>'nascimento')::date; EXCEPTION WHEN others THEN v_nasc := NULL; END;
  IF v_nasc IS NULL OR v_nasc > (current_date - interval '18 years')::date OR v_nasc < date '1920-01-01' THEN RAISE EXCEPTION 'Data de nascimento inválida (precisa ter 18 anos ou mais).'; END IF;
  IF length(v_rg) < 4 THEN RAISE EXCEPTION 'Informe o RG.'; END IF;
  IF v_civil NOT IN ('Solteira','Casada','União estável','Divorciada','Viúva') THEN RAISE EXCEPTION 'Escolha o estado civil.'; END IF;
  IF length(v_cep) <> 8 THEN RAISE EXCEPTION 'CEP inválido.'; END IF;
  IF v_rua = '' OR v_num = '' OR v_bairro = '' OR v_cidade = '' OR length(v_uf) <> 2 THEN RAISE EXCEPTION 'Endereço incompleto: rua, número, bairro, cidade e UF.'; END IF;
  IF _perfil IS NULL OR jsonb_typeof(_perfil) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(_perfil)) < 4 THEN RAISE EXCEPTION 'Responda as 4 perguntas do perfil.'; END IF;

  SELECT id INTO pid FROM parties WHERE doc_digits = v_cpf AND is_active ORDER BY created_at LIMIT 1;
  IF pid IS NOT NULL THEN
    SELECT representative_party_id INTO outro FROM consultant_profiles WHERE party_id = pid;
    IF outro IS NOT NULL AND outro <> _rep THEN RAISE EXCEPTION 'Este CPF já é consultora de outro representante. Fale com a Lardan.'; END IF;
    UPDATE parties SET rg = coalesce(nullif(rg,''), v_rg), rg_issuer = coalesce(rg_issuer, v_rg_org),
      birth_date = coalesce(birth_date, v_nasc), marital_status = coalesce(nullif(marital_status,''), v_civil), updated_at = now() WHERE id = pid;
  ELSE
    INSERT INTO parties (kind, display_name, legal_name, doc, doc_digits, rg, rg_issuer, birth_date, marital_status, status, created_by)
    VALUES ('pessoa', upper(v_nome), upper(v_nome), v_cpf, v_cpf, v_rg, v_rg_org, v_nasc, v_civil, 'em_analise', uid) RETURNING id INTO pid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contact_points WHERE party_id = pid AND kind = 'whatsapp' AND right(regexp_replace(value,'\D','','g'),11) = v_zap) THEN
    INSERT INTO contact_points (party_id, kind, value, is_primary) VALUES (pid, 'whatsapp', v_zap, NOT EXISTS (SELECT 1 FROM contact_points WHERE party_id = pid AND kind = 'whatsapp'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contact_points WHERE party_id = pid AND kind = 'email' AND lower(value) = v_mail) THEN
    INSERT INTO contact_points (party_id, kind, value, is_primary) VALUES (pid, 'email', v_mail, NOT EXISTS (SELECT 1 FROM contact_points WHERE party_id = pid AND kind = 'email'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM party_addresses WHERE party_id = pid) THEN
    INSERT INTO party_addresses (party_id, label, postal_code, street, street_number, complement, district, city, uf, ibge_city_code, is_primary)
    VALUES (pid, 'Principal', v_cep, v_rua, v_num, v_comp, v_bairro, v_cidade, v_uf, nullif(regexp_replace(coalesce(d->>'ibge',''),'\D','','g'),''), true);
  END IF;

  v_lead := public.rep_crm_lead_criar(_rep, v_nome, v_zap, v_cidade, v_uf, 'Abertura na rua');
  UPDATE leads SET cpf = coalesce(cpf, v_cpf), email = coalesce(nullif(email,''), v_mail), postal_code = v_cep, street = v_rua,
    street_number = v_num, party_id = pid, status = 'aprovado', updated_at = now() WHERE id = v_lead;
  INSERT INTO party_roles (party_id, role, status, started_at, created_by) VALUES (pid, 'candidata', 'aprovado', current_date, uid) ON CONFLICT DO NOTHING;
  INSERT INTO party_links (party_id, entity_type, entity_id) VALUES (pid, 'lead', v_lead) ON CONFLICT DO NOTHING;

  FOR k IN SELECT jsonb_object_keys(_perfil) LOOP pts := pts + coalesce((_perfil->>k)::int, 0); END LOOP;
  res := CASE WHEN pts >= 10 THEN 'Perfil forte' WHEN pts >= 7 THEN 'Perfil bom' ELSE 'Precisa de acompanhamento' END;
  INSERT INTO candidatura_assessments (lead_id, assessment_type, status, completed_at, result_reference, metadata)
  VALUES (v_lead, 'perfil_presencial', 'concluido', now(), res, jsonb_build_object('respostas', _perfil, 'pontos', pts, 'representante', _rep, 'por', uid));
  INSERT INTO lead_events (lead_id, event_type, note, actor_id) VALUES (v_lead, 'conversao', 'Abertura na rua pelo representante (decisão de campo)', uid);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'candidatura.abertura_rua', 'leads', v_lead::text, jsonb_build_object('representante', _rep, 'party', pid, 'perfil', res));
  RETURN jsonb_build_object('lead_id', v_lead, 'party_id', pid, 'perfil', res, 'pontos', pts);
END $function$;