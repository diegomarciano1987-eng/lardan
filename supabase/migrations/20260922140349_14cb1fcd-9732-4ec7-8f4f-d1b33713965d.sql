
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS cpf_digits text;

CREATE INDEX IF NOT EXISTS leads_cpf_digits_idx ON public.leads (cpf_digits);

CREATE OR REPLACE FUNCTION public.leads_cpf_norm()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.cpf_digits := nullif(regexp_replace(coalesce(NEW.cpf,''), '\D', '', 'g'), '');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_leads_cpf_norm ON public.leads;
CREATE TRIGGER trg_leads_cpf_norm BEFORE INSERT OR UPDATE OF cpf ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.leads_cpf_norm();

CREATE OR REPLACE FUNCTION public.submit_candidatura(_payload jsonb, _tracking jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  v_src := public.crm_normalize_source(_tracking);
  v_parsed := public.crm_parse_ua(v_ua);

  -- duplicidade: mesmo CPF, WhatsApp ou e-mail (nunca por nome)
  SELECT * INTO v_lead FROM public.leads
   WHERE cpf_digits = v_cpf OR whatsapp_norm = v_wa OR (v_email IS NOT NULL AND email_norm = v_email)
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
      last_touch = jsonb_build_object('source', v_src, 'tracking', _tracking, 'at', now()),
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
    financial_goal, availability, experience, audience, motivation,
    source, entry_url, utm, privacy_version, marketing_consent,
    stage_id, stage_entered_at, landing_page, referrer, first_referrer,
    gclid, fbclid, msclkid, ip, user_agent, browser, os, device_type, language,
    source_normalized, first_touch, last_touch
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
    jsonb_build_object('source', v_src, 'tracking', _tracking - 'ip', 'at', now())
  ) RETURNING * INTO v_lead;

  INSERT INTO public.candidatura_submissions (lead_id, protocol, payload, tracking, ip, user_agent)
  VALUES (v_lead.id, v_lead.protocol, (_payload - 'email') - 'cpf', _tracking - 'ip', v_ip, v_ua);

  PERFORM public.crm_log(v_lead.id, 'submissao', 'Candidatura recebida pelo site', NULL,
    jsonb_build_object('protocol', v_lead.protocol), NULL);
  PERFORM public.crm_log(v_lead.id, 'origem',
    'Origem identificada: ' || v_src, NULL, jsonb_build_object('source', v_src), NULL);

  INSERT INTO public.candidatura_stage_history (lead_id, to_stage_id, note)
  VALUES (v_lead.id, v_stage, 'Entrada automática pelo formulário');

  INSERT INTO public.candidatura_assessments (lead_id, assessment_type, status)
  VALUES (v_lead.id, 'disc', 'nao_realizado');

  RETURN jsonb_build_object('protocol', v_lead.protocol, 'duplicate', false);
END; $fn$;

-- Ficha: CPF completo só para quem pode ver dados pessoais; demais veem mascarado.
CREATE OR REPLACE FUNCTION public.crm_detail(_lead uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_l public.leads%ROWTYPE; v_pii boolean; v_cpf text;
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  v_pii := public.has_capability(auth.uid(), 'candidaturas.pii.view');
  SELECT * INTO v_l FROM public.leads WHERE id = _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;

  v_cpf := CASE
    WHEN v_l.cpf_digits IS NULL THEN NULL
    WHEN v_pii THEN regexp_replace(v_l.cpf_digits, '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4')
    ELSE '***.' || substr(v_l.cpf_digits,4,3) || '.' || substr(v_l.cpf_digits,7,3) || '-**'
  END;

  RETURN jsonb_build_object(
    'candidatura', public.crm_card(v_l) || jsonb_build_object(
      'nome_proprio', v_l.first_name, 'sobrenome', v_l.last_name,
      'cpf', v_cpf, 'cpf_visivel', v_pii,
      'rua', v_l.street, 'numero', v_l.street_number, 'sem_numero', v_l.no_number, 'cep', v_l.postal_code,
      'objetivo', v_l.financial_goal, 'disponibilidade', v_l.availability,
      'experiencia', v_l.experience, 'canais', v_l.audience, 'motivacao', v_l.motivation,
      'consentimento_marketing', v_l.marketing_consent, 'versao_privacidade', v_l.privacy_version,
      'motivo_perda', (SELECT r.label FROM public.candidatura_lost_reasons r WHERE r.id = v_l.lost_reason_id),
      'motivo_perda_id', v_l.lost_reason_id,
      'perda_observacao', v_l.lost_notes, 'perdida_em', v_l.lost_at,
      'ganha_em', v_l.won_at, 'ganho_observacao', v_l.won_notes,
      'party_id', v_l.party_id
    ),
    'origem', jsonb_build_object(
      'normalizada', v_l.source_normalized,
      'utm', v_l.utm, 'landing_page', v_l.landing_page,
      'referrer', v_l.referrer, 'first_referrer', v_l.first_referrer,
      'gclid', v_l.gclid, 'fbclid', v_l.fbclid, 'msclkid', v_l.msclkid,
      'first_touch', v_l.first_touch, 'last_touch', v_l.last_touch,
      'origem_bruta', v_l.source
    ),
    'tecnico', CASE WHEN v_pii THEN jsonb_build_object(
        'ip', host(v_l.ip), 'user_agent', v_l.user_agent, 'navegador', v_l.browser,
        'sistema', v_l.os, 'dispositivo', v_l.device_type, 'idioma', v_l.language)
      ELSE NULL END,
    'timeline', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'tipo', e.event_type, 'titulo', coalesce(e.title, e.event_type),
        'descricao', e.note, 'metadata', e.metadata, 'em', e.created_at,
        'autor', (SELECT p.full_name FROM public.profiles p WHERE p.id = e.actor_id))
        ORDER BY e.created_at DESC)
      FROM public.lead_events e WHERE e.lead_id = _lead), '[]'::jsonb),
    'notas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'texto', n.body, 'em', n.created_at, 'editada_em', n.updated_at,
        'edicoes', n.edits_count, 'autor_id', n.author_id,
        'autor', (SELECT p.full_name FROM public.profiles p WHERE p.id = n.author_id))
        ORDER BY n.created_at DESC)
      FROM public.candidatura_notes n WHERE n.lead_id = _lead), '[]'::jsonb),
    'followups', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'quando', f.due_at, 'tipo', f.kind, 'situacao', f.status,
        'observacao', f.note, 'resultado', f.outcome_note,
        'responsavel_id', f.assigned_to,
        'responsavel', (SELECT p.full_name FROM public.profiles p WHERE p.id = f.assigned_to),
        'concluido_em', f.completed_at, 'atrasado', (f.status='pendente' AND f.due_at < now()))
        ORDER BY f.due_at)
      FROM public.candidatura_followups f WHERE f.lead_id = _lead), '[]'::jsonb),
    'avaliacoes', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'tipo', a.assessment_type, 'situacao', a.status,
        'enviado_em', a.sent_at, 'concluido_em', a.completed_at, 'referencia', a.result_reference))
      FROM public.candidatura_assessments a WHERE a.lead_id = _lead), '[]'::jsonb),
    'envios', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'em', s.created_at, 'reenvio', s.is_duplicate,
        'respostas', s.payload,
        'ip', CASE WHEN v_pii THEN host(s.ip) ELSE NULL END)
        ORDER BY s.created_at DESC)
      FROM public.candidatura_submissions s WHERE s.lead_id = _lead), '[]'::jsonb),
    'historico_etapas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'de', (SELECT name FROM public.candidatura_stages WHERE id = h.from_stage_id),
        'para', (SELECT name FROM public.candidatura_stages WHERE id = h.to_stage_id),
        'em', h.created_at,
        'autor', (SELECT p.full_name FROM public.profiles p WHERE p.id = h.actor_id))
        ORDER BY h.created_at DESC)
      FROM public.candidatura_stage_history h WHERE h.lead_id = _lead), '[]'::jsonb)
  );
END; $fn$;

-- Conversão: nome, sobrenome e CPF entram no cadastro canônico da pessoa.
CREATE OR REPLACE FUNCTION public.convert_lead_to_consultant(_lead_id uuid, _party_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE le public.leads; pid uuid;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.manage') THEN
    RAISE EXCEPTION 'sem permissão para converter candidaturas';
  END IF;

  SELECT * INTO le FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura não encontrada'; END IF;

  IF le.party_id IS NOT NULL THEN
    INSERT INTO public.party_roles (party_id, role, created_by)
    VALUES (le.party_id, 'consultora', auth.uid()) ON CONFLICT DO NOTHING;
    INSERT INTO public.consultant_profiles (party_id) VALUES (le.party_id) ON CONFLICT DO NOTHING;
    RETURN le.party_id;
  END IF;

  IF _party_id IS NOT NULL THEN
    SELECT id INTO pid FROM public.parties WHERE id = _party_id;
    IF pid IS NULL THEN RAISE EXCEPTION 'pessoa informada não existe'; END IF;
    UPDATE public.parties
       SET doc = coalesce(doc, le.cpf), doc_digits = coalesce(doc_digits, le.cpf_digits)
     WHERE id = pid;
  ELSE
    INSERT INTO public.parties (kind, display_name, legal_name, doc, doc_digits, status, created_by)
    VALUES ('pessoa', le.full_name, le.full_name, le.cpf, le.cpf_digits, 'em_analise', auth.uid())
    RETURNING id INTO pid;

    INSERT INTO public.contact_points (party_id, kind, value, is_primary)
    VALUES (pid, 'whatsapp', le.whatsapp, true);

    INSERT INTO public.party_addresses (party_id, label, postal_code, street, street_number, no_number, city, uf, is_primary)
    VALUES (pid, 'Principal', le.postal_code, le.street, le.street_number, le.no_number, le.city, le.uf, true);
  END IF;

  INSERT INTO public.party_roles (party_id, role, status, started_at, created_by)
  VALUES (pid, 'candidata', 'aprovado', current_date, auth.uid()) ON CONFLICT DO NOTHING;
  INSERT INTO public.party_roles (party_id, role, status, started_at, created_by)
  VALUES (pid, 'consultora', 'ativo', current_date, auth.uid()) ON CONFLICT DO NOTHING;

  INSERT INTO public.consultant_profiles (party_id, origin, joined_at, experience, audience, availability)
  VALUES (pid, COALESCE(le.source, 'Seja Lardan'), current_date, le.experience, le.audience, le.availability)
  ON CONFLICT (party_id) DO NOTHING;

  UPDATE public.leads SET party_id = pid, status = 'aprovado', updated_at = now() WHERE id = _lead_id;

  INSERT INTO public.party_links (party_id, entity_type, entity_id)
  VALUES (pid, 'lead', _lead_id) ON CONFLICT DO NOTHING;

  INSERT INTO public.lead_events (lead_id, event_type, note, actor_id)
  VALUES (_lead_id, 'conversao', 'Convertida em consultora (pessoa ' || pid::text || ')', auth.uid());

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'registry.convert_lead', 'parties', pid::text,
          jsonb_build_object('lead_id', _lead_id, 'protocol', le.protocol));

  RETURN pid;
END; $fn$;
