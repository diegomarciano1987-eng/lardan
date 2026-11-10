-- 0278 (Diego, 10/11/2026): candidata que vem pelo link do representante entra na carteira dele na hora;
-- maletas de abertura com o número do pedido e em ordem; card do painel mostra o representante.
CREATE OR REPLACE FUNCTION public.submit_candidatura(_payload jsonb, _tracking jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_stage uuid;
  v_wa text := regexp_replace(coalesce(_payload->>'whatsapp',''), '\D', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(_payload->>'email',''))), '');
  v_ip inet := nullif(btrim(coalesce(_tracking->>'ip','')), '')::inet;
  v_ua text := left(coalesce(_tracking->>'user_agent',''), 500);
  v_src text;
  v_parsed jsonb;
  v_dup boolean := false;
  v_recent integer;
  v_first text := left(btrim(coalesce(_payload->>'first_name','')), 80);
  v_last  text := left(btrim(coalesce(_payload->>'last_name','')), 120);
  v_cpf   text := nullif(regexp_replace(coalesce(_payload->>'cpf',''), '\D', '', 'g'), '');
  v_full  text;
  -- 0278: link do representante (?rep=lc-000000) grava a candidata na carteira dele na hora
  v_rep_cod text := lower(btrim(coalesce(_tracking->>'representante','')));
  v_rep uuid;
BEGIN
  IF length(v_first) < 2 THEN RAISE EXCEPTION 'nome_invalido'; END IF;
  IF length(v_last) < 2 THEN RAISE EXCEPTION 'sobrenome_invalido'; END IF;
  v_full := left(btrim(v_first || ' ' || v_last), 160);

  IF v_cpf IS NULL OR NOT public.cpf_is_valid(v_cpf) THEN RAISE EXCEPTION 'cpf_invalido'; END IF;
  IF length(v_wa) < 10 THEN RAISE EXCEPTION 'whatsapp_invalido'; END IF;
  IF length(btrim(coalesce(_payload->>'city',''))) < 2 THEN RAISE EXCEPTION 'cidade_invalida'; END IF;
  IF upper(coalesce(_payload->>'uf','')) !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'uf_invalida'; END IF;
  IF coalesce(_payload->>'privacy_version','') = '' THEN RAISE EXCEPTION 'privacidade_ausente'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalido'; END IF;

  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_recent FROM public.candidatura_submissions
     WHERE ip = v_ip AND created_at > now() - interval '10 minutes';
    IF v_recent >= 5 THEN RAISE EXCEPTION 'limite_envios'; END IF;
  END IF;

  IF v_rep_cod ~ '^lc-[0-9]{6}$' THEN
    SELECT p.id INTO v_rep FROM public.parties p
      JOIN public.party_roles pr ON pr.party_id = p.id AND pr.role = 'representante' AND pr.status = 'ativo'
     WHERE lower(p.code) = v_rep_cod
     ORDER BY p.created_at LIMIT 1;
  END IF;

  v_src := public.crm_normalize_source(_tracking);
  v_parsed := public.crm_parse_ua(v_ua);

  -- duplicidade: mesmo CPF, WhatsApp ou e-mail (nunca por nome)
  SELECT * INTO v_lead FROM public.leads
   WHERE cpf_digits = v_cpf OR (cpf_digits IS NULL AND (whatsapp_norm = v_wa OR (v_email IS NOT NULL AND email_norm = v_email)))
   ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    v_dup := true;
    UPDATE public.leads SET
      submissions_count = submissions_count + 1,
      email = coalesce(email, v_email),
      cpf = coalesce(cpf, v_cpf),
      first_name = coalesce(first_name, v_first),
      last_name = coalesce(last_name, v_last),
      financial_goal = coalesce(nullif(btrim(_payload->>'financial_goal'),''), financial_goal),
      availability   = coalesce(nullif(btrim(_payload->>'availability'),''), availability),
      experience     = coalesce(nullif(btrim(_payload->>'experience'),''), experience),
      audience       = coalesce(nullif(btrim(_payload->>'audience'),''), audience),
      motivation     = coalesce(nullif(btrim(_payload->>'motivation'),''), motivation),
      dream          = coalesce(nullif(left(btrim(_payload->>'dream'), 300),''), dream),
      dream_value_cents = coalesce(CASE WHEN coalesce(_payload->>'dream_value_cents','') ~ '^[0-9]{1,12}$' THEN (_payload->>'dream_value_cents')::bigint END, dream_value_cents),
      last_touch = jsonb_build_object('source', v_src, 'tracking', _tracking, 'at', now()),
      representante_origem = CASE WHEN representante_party_id IS NULL AND v_rep IS NOT NULL THEN 'link' ELSE representante_origem END,
      representante_party_id = coalesce(representante_party_id, v_rep),
      updated_at = now()
    WHERE id = v_lead.id
    RETURNING * INTO v_lead;

    INSERT INTO public.candidatura_submissions (lead_id, protocol, payload, tracking, ip, user_agent, is_duplicate)
    VALUES (v_lead.id, v_lead.protocol, (_payload - 'email') - 'cpf', _tracking - 'ip', v_ip, v_ua, true);

    PERFORM public.crm_log(v_lead.id, 'submissao',
      'Nova candidatura recebida novamente pelo site',
      'Mesma pessoa identificada por CPF, WhatsApp ou e-mail. O histórico anterior foi mantido.',
      jsonb_build_object('source', v_src, 'duplicate', true), NULL);

    RETURN jsonb_build_object('protocol', v_lead.protocol, 'duplicate', true);
  END IF;

  SELECT id INTO v_stage FROM public.candidatura_stages
   WHERE is_initial AND is_active ORDER BY sort_order LIMIT 1;
  IF v_stage IS NULL THEN
    SELECT id INTO v_stage FROM public.candidatura_stages WHERE is_active ORDER BY sort_order LIMIT 1;
  END IF;

  INSERT INTO public.leads (
    full_name, first_name, last_name, cpf,
    whatsapp, email, street, street_number, no_number, city, uf, postal_code,
    financial_goal, availability, experience, audience, motivation, dream, dream_value_cents,
    source, entry_url, utm, privacy_version, marketing_consent,
    stage_id, stage_entered_at, landing_page, referrer, first_referrer,
    gclid, fbclid, msclkid, ip, user_agent, browser, os, device_type, language,
    source_normalized, first_touch, last_touch,
    representante_party_id, representante_origem
  ) VALUES (
    v_full, v_first, v_last, v_cpf,
    left(btrim(_payload->>'whatsapp'), 32),
    v_email,
    left(btrim(_payload->>'street'), 200),
    CASE WHEN (_payload->>'no_number')::boolean IS TRUE THEN NULL ELSE left(btrim(_payload->>'street_number'), 20) END,
    coalesce((_payload->>'no_number')::boolean, false),
    left(btrim(_payload->>'city'), 120),
    upper(_payload->>'uf'),
    left(btrim(_payload->>'postal_code'), 20),
    left(btrim(_payload->>'financial_goal'), 200),
    left(btrim(_payload->>'availability'), 200),
    left(btrim(_payload->>'experience'), 400),
    left(btrim(_payload->>'audience'), 400),
    left(btrim(_payload->>'motivation'), 2000),
    nullif(left(btrim(coalesce(_payload->>'dream','')), 300), ''),
    CASE WHEN coalesce(_payload->>'dream_value_cents','') ~ '^[0-9]{1,12}$' THEN (_payload->>'dream_value_cents')::bigint END,
    left(coalesce(_payload->>'source', 'site/seja-lardan'), 120),
    left(_tracking->>'landing_page', 500),
    coalesce(_tracking->'utm', '{}'::jsonb),
    left(_payload->>'privacy_version', 60),
    coalesce((_payload->>'marketing_consent')::boolean, false),
    v_stage, now(),
    left(_tracking->>'landing_page', 500),
    left(_tracking->>'referrer', 500),
    left(coalesce(_tracking->>'first_referrer', _tracking->>'referrer'), 500),
    left(_tracking->>'gclid', 200), left(_tracking->>'fbclid', 200), left(_tracking->>'msclkid', 200),
    v_ip, v_ua,
    v_parsed->>'browser', v_parsed->>'os', v_parsed->>'device_type',
    left(_tracking->>'language', 20),
    v_src,
    jsonb_build_object('source', v_src, 'tracking', _tracking - 'ip', 'at', now()),
    jsonb_build_object('source', v_src, 'tracking', _tracking - 'ip', 'at', now()),
    v_rep, CASE WHEN v_rep IS NOT NULL THEN 'link' END
  ) RETURNING * INTO v_lead;

  INSERT INTO public.candidatura_submissions (lead_id, protocol, payload, tracking, ip, user_agent)
  VALUES (v_lead.id, v_lead.protocol, (_payload - 'email') - 'cpf', _tracking - 'ip', v_ip, v_ua);

  PERFORM public.crm_log(v_lead.id, 'submissao', 'Candidatura recebida pelo site', NULL,
    jsonb_build_object('protocol', v_lead.protocol), NULL);
  PERFORM public.crm_log(v_lead.id, 'origem',
    'Origem identificada: ' || v_src, NULL, jsonb_build_object('source', v_src), NULL);

  IF v_rep IS NOT NULL THEN
    PERFORM public.crm_log(v_lead.id, 'responsavel',
      'Veio pelo link do representante ' || coalesce((SELECT display_name FROM public.parties WHERE id = v_rep), ''), NULL,
      jsonb_build_object('representante', v_rep, 'codigo', v_rep_cod), NULL);
  END IF;

  INSERT INTO public.candidatura_stage_history (lead_id, to_stage_id, note)
  VALUES (v_lead.id, v_stage, 'Entrada automática pelo formulário');

  INSERT INTO public.candidatura_assessments (lead_id, assessment_type, status)
  VALUES (v_lead.id, 'disc', 'nao_realizado');

  RETURN jsonb_build_object('protocol', v_lead.protocol, 'duplicate', false);
END; $function$;

-- Maletas de abertura com o número que está no pedido impresso ("ABERTURA 01 · Remessa 925")
-- e em ordem de remessa + número, para o representante achar sem procurar pelo valor.
CREATE OR REPLACE FUNCTION public.rep_portal_maletas(_rep uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'a_receber', coalesce((SELECT jsonb_agg(jsonb_build_object('transfer_id', t.id, 'cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero,
        'consultora', pc.display_name, 'consultora_codigo', pc.code, 'abertura_numero', c.abertura_numero,
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents, 'enviada_em', t.shipped_at)
        ORDER BY r.numero NULLS LAST, (c.consultora_party_id IS NOT NULL), c.abertura_numero NULLS LAST, pc.display_name NULLS LAST, k.code)
      FROM kit_transfers t JOIN kit_cycles c ON c.id = t.cycle_id JOIN kits k ON k.id = c.kit_id
      LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE t.to_party_id = _rep AND t.status = 'transito'), '[]'::jsonb),
    'sem_consultora', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'praca', pr.nome,
        'abertura_numero', c.abertura_numero,
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents, 'acerto', coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto))
        ORDER BY r.numero NULLS LAST, c.abertura_numero NULLS LAST, k.code)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN cob_pracas pr ON pr.id = r.praca_id
     WHERE c.custodian_party_id = _rep AND c.consultora_party_id IS NULL AND c.status = 'transito'), '[]'::jsonb),
    'para_entregar', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero,
        'consultora', pc.display_name, 'consultora_codigo', pc.code, 'abertura_numero', c.abertura_numero,
        'telefone', (SELECT cp.value FROM contact_points cp WHERE cp.party_id = pc.id AND cp.kind IN ('whatsapp','telefone')
                      ORDER BY (cp.kind = 'whatsapp') DESC, cp.is_primary DESC, cp.created_at LIMIT 1),
        'cidade', (SELECT pa.city FROM party_addresses pa WHERE pa.party_id = pc.id ORDER BY pa.created_at DESC LIMIT 1),
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents) ORDER BY pc.display_name)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE c.custodian_party_id = _rep AND c.status = 'transito'
       AND NOT EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.status IN ('pendente','transito'))), '[]'::jsonb),
    'a_caminho', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'consultora', pc.display_name,
        'abertura_numero', c.abertura_numero, 'pecas', c.quantity_total) ORDER BY pc.display_name)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE c.custodian_party_id = _rep AND c.status = 'transito'
       AND EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.to_party_id = c.consultora_party_id AND t.status = 'transito')), '[]'::jsonb));
END $function$;

-- O card do painel mostra com qual representante a candidata está (além do responsável interno).
CREATE OR REPLACE FUNCTION public.crm_card(_l leads)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', _l.id,
    'protocolo', _l.protocol,
    'nome', _l.full_name,
    'whatsapp', _l.whatsapp,
    'whatsapp_norm', _l.whatsapp_norm,
    'email', _l.email,
    'cidade', _l.city,
    'uf', _l.uf,
    'etapa_id', _l.stage_id,
    'etapa_desde', _l.stage_entered_at,
    'prioridade', _l.priority,
    'desfecho', _l.outcome,
    'origem', _l.source_normalized,
    'campanha', _l.utm->>'utm_campaign',
    'criada_em', _l.created_at,
    'ultimo_envio', coalesce(
      (SELECT max(cs.created_at) FROM public.candidatura_submissions cs WHERE cs.lead_id = _l.id),
      _l.created_at
    ),
    'ultimo_contato', _l.last_contact_at,
    'primeiro_atendimento', _l.first_response_at,
    'proximo_followup', _l.next_followup_at,
    'arquivada_em', _l.archived_at,
    'reenvios', _l.submissions_count,
    'responsavel_id', _l.assigned_to,
    'responsavel', (SELECT p.full_name FROM public.profiles p WHERE p.id = _l.assigned_to),
    'representante_id', _l.representante_party_id,
    'representante', (SELECT p.display_name FROM public.parties p WHERE p.id = _l.representante_party_id),
    'representante_origem', _l.representante_origem,
    'tags', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.name, 'cor', t.color) ORDER BY t.name)
                        FROM public.candidatura_tag_links tl
                        JOIN public.candidatura_tags t ON t.id = tl.tag_id
                       WHERE tl.lead_id = _l.id), '[]'::jsonb)
  );
$function$;