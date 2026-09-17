-- ============================================================
-- CRM DE CANDIDATURAS — motor (RPCs)
-- ============================================================

-- AUXILIARES --------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_require(_cap text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(), _cap) THEN
    RAISE EXCEPTION 'sem_permissao:%', _cap USING ERRCODE = '42501';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.crm_log(
  _lead uuid, _kind text, _title text, _note text DEFAULT NULL, _meta jsonb DEFAULT '{}'::jsonb,
  _actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.lead_events (lead_id, event_type, title, note, metadata, actor_id)
  VALUES (_lead, _kind, _title, _note, coalesce(_meta,'{}'::jsonb), coalesce(_actor, auth.uid()));
END; $$;

CREATE OR REPLACE FUNCTION public.crm_audit(_action text, _lead uuid, _payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), _action, 'candidatura', _lead::text, coalesce(_payload,'{}'::jsonb));
END; $$;

-- marca primeiro atendimento e último contato
CREATE OR REPLACE FUNCTION public.crm_touch_contact(_lead uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.leads
     SET last_contact_at = now(),
         first_response_at = coalesce(first_response_at, now()),
         updated_at = now()
   WHERE id = _lead;
END; $$;

CREATE OR REPLACE FUNCTION public.crm_refresh_next(_lead uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.leads l
     SET next_followup_at = (
       SELECT min(f.due_at) FROM public.candidatura_followups f
        WHERE f.lead_id = _lead AND f.status = 'pendente'),
       updated_at = now()
   WHERE l.id = _lead;
END; $$;

-- ORIGEM: normalização comprovável ---------------------------
CREATE OR REPLACE FUNCTION public.crm_normalize_source(_tracking jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  s text := lower(btrim(coalesce(_tracking->'utm'->>'utm_source', '')));
  m text := lower(btrim(coalesce(_tracking->'utm'->>'utm_medium', '')));
  ref text := lower(btrim(coalesce(_tracking->>'referrer', '')));
BEGIN
  IF coalesce(_tracking->>'gclid','') <> '' THEN RETURN 'google_ads'; END IF;
  IF coalesce(_tracking->>'fbclid','') <> '' THEN RETURN 'meta_ads'; END IF;
  IF coalesce(_tracking->>'msclkid','') <> '' THEN RETURN 'bing_ads'; END IF;

  IF s <> '' THEN
    IF s LIKE '%chatgpt%' OR s LIKE '%openai%' THEN RETURN 'chatgpt'; END IF;
    IF s LIKE '%perplexity%' THEN RETURN 'perplexity'; END IF;
    IF s LIKE '%gemini%' OR s LIKE '%bard%' THEN RETURN 'gemini'; END IF;
    IF s LIKE '%instagram%' THEN RETURN 'instagram'; END IF;
    IF s LIKE '%facebook%' OR s = 'meta' OR s LIKE '%meta%' THEN RETURN 'meta'; END IF;
    IF s LIKE '%google%' THEN
      RETURN CASE WHEN m IN ('cpc','ppc','paid','paid_search') THEN 'google_ads' ELSE 'google' END;
    END IF;
    IF s LIKE '%bing%' THEN RETURN 'bing'; END IF;
    IF s LIKE '%whatsapp%' THEN RETURN 'whatsapp'; END IF;
    IF s LIKE '%indica%' OR s LIKE '%referral%' THEN RETURN 'indicacao'; END IF;
    RETURN 'outro';
  END IF;

  IF ref <> '' THEN
    IF ref LIKE '%chatgpt.com%' OR ref LIKE '%chat.openai.com%' THEN RETURN 'chatgpt'; END IF;
    IF ref LIKE '%perplexity.ai%' THEN RETURN 'perplexity'; END IF;
    IF ref LIKE '%gemini.google%' THEN RETURN 'gemini'; END IF;
    IF ref LIKE '%instagram.com%' THEN RETURN 'instagram'; END IF;
    IF ref LIKE '%facebook.com%' THEN RETURN 'meta'; END IF;
    IF ref LIKE '%google.%' THEN RETURN 'google_organico'; END IF;
    IF ref LIKE '%bing.com%' THEN RETURN 'bing_organico'; END IF;
    IF ref LIKE '%lardan%' THEN RETURN 'direto'; END IF;
    RETURN 'outro';
  END IF;

  -- Sem UTM e sem referência: NÃO se inventa origem.
  RETURN 'nao_identificado';
END; $$;

CREATE OR REPLACE FUNCTION public.crm_parse_ua(_ua text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE u text := lower(coalesce(_ua,'')); nav text; os text; disp text;
BEGIN
  nav := CASE WHEN u LIKE '%edg/%' THEN 'Edge'
              WHEN u LIKE '%opr/%' OR u LIKE '%opera%' THEN 'Opera'
              WHEN u LIKE '%chrome%' AND u NOT LIKE '%chromium%' THEN 'Chrome'
              WHEN u LIKE '%firefox%' THEN 'Firefox'
              WHEN u LIKE '%safari%' THEN 'Safari' ELSE NULL END;
  os  := CASE WHEN u LIKE '%iphone%' OR u LIKE '%ipad%' THEN 'iOS'
              WHEN u LIKE '%android%' THEN 'Android'
              WHEN u LIKE '%mac os%' THEN 'macOS'
              WHEN u LIKE '%windows%' THEN 'Windows'
              WHEN u LIKE '%linux%' THEN 'Linux' ELSE NULL END;
  disp := CASE WHEN u LIKE '%ipad%' OR u LIKE '%tablet%' THEN 'tablet'
               WHEN u LIKE '%mobi%' OR u LIKE '%iphone%' OR u LIKE '%android%' THEN 'celular'
               WHEN u = '' THEN NULL ELSE 'computador' END;
  RETURN jsonb_build_object('browser', nav, 'os', os, 'device_type', disp);
END; $$;

-- ============================================================
-- RECEBIMENTO PÚBLICO DO FORMULÁRIO
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_candidatura(
  _payload jsonb, _tracking jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  -- validações
  IF length(btrim(coalesce(_payload->>'full_name',''))) < 2 THEN RAISE EXCEPTION 'nome_invalido'; END IF;
  IF length(v_wa) < 10 THEN RAISE EXCEPTION 'whatsapp_invalido'; END IF;
  IF length(btrim(coalesce(_payload->>'city',''))) < 2 THEN RAISE EXCEPTION 'cidade_invalida'; END IF;
  IF upper(coalesce(_payload->>'uf','')) !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'uf_invalida'; END IF;
  IF coalesce(_payload->>'privacy_version','') = '' THEN RAISE EXCEPTION 'privacidade_ausente'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalido'; END IF;

  -- limite anti-spam por origem (5 envios / 10 minutos)
  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_recent FROM public.candidatura_submissions
     WHERE ip = v_ip AND created_at > now() - interval '10 minutes';
    IF v_recent >= 5 THEN RAISE EXCEPTION 'limite_envios'; END IF;
  END IF;

  v_src := public.crm_normalize_source(_tracking);
  v_parsed := public.crm_parse_ua(v_ua);

  -- duplicidade: mesmo WhatsApp ou mesmo e-mail (nunca por nome)
  SELECT * INTO v_lead FROM public.leads
   WHERE whatsapp_norm = v_wa OR (v_email IS NOT NULL AND email_norm = v_email)
   ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    v_dup := true;
    UPDATE public.leads SET
      submissions_count = submissions_count + 1,
      email = coalesce(email, v_email),
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
    VALUES (v_lead.id, v_lead.protocol, _payload - 'email', _tracking - 'ip', v_ip, v_ua, true);

    PERFORM public.crm_log(v_lead.id, 'submissao',
      'Nova candidatura recebida novamente pelo site',
      'Mesma pessoa identificada por WhatsApp ou e-mail. O histórico anterior foi mantido.',
      jsonb_build_object('source', v_src, 'duplicate', true), NULL);

    RETURN jsonb_build_object('protocol', v_lead.protocol, 'duplicate', true);
  END IF;

  SELECT id INTO v_stage FROM public.candidatura_stages
   WHERE is_initial AND is_active ORDER BY sort_order LIMIT 1;
  IF v_stage IS NULL THEN
    SELECT id INTO v_stage FROM public.candidatura_stages WHERE is_active ORDER BY sort_order LIMIT 1;
  END IF;

  INSERT INTO public.leads (
    full_name, whatsapp, email, street, street_number, no_number, city, uf, postal_code,
    financial_goal, availability, experience, audience, motivation,
    source, entry_url, utm, privacy_version, marketing_consent,
    stage_id, stage_entered_at, landing_page, referrer, first_referrer,
    gclid, fbclid, msclkid, ip, user_agent, browser, os, device_type, language,
    source_normalized, first_touch, last_touch
  ) VALUES (
    left(btrim(_payload->>'full_name'), 160),
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
  VALUES (v_lead.id, v_lead.protocol, _payload - 'email', _tracking - 'ip', v_ip, v_ua);

  PERFORM public.crm_log(v_lead.id, 'submissao', 'Candidatura recebida pelo site', NULL,
    jsonb_build_object('protocol', v_lead.protocol), NULL);
  PERFORM public.crm_log(v_lead.id, 'origem',
    'Origem identificada: ' || v_src, NULL, jsonb_build_object('source', v_src), NULL);

  INSERT INTO public.candidatura_stage_history (lead_id, to_stage_id, note)
  VALUES (v_lead.id, v_stage, 'Entrada automática pelo formulário');

  INSERT INTO public.candidatura_assessments (lead_id, assessment_type, status)
  VALUES (v_lead.id, 'disc', 'nao_realizado');

  RETURN jsonb_build_object('protocol', v_lead.protocol, 'duplicate', false);
END; $$;

REVOKE ALL ON FUNCTION public.submit_candidatura(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_candidatura(jsonb, jsonb) TO anon, authenticated, service_role;

-- ============================================================
-- LEITURA
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_filtrar(_f jsonb)
RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id
  FROM public.leads l
  WHERE (coalesce(_f->>'arquivadas','false')::boolean OR l.archived_at IS NULL)
    AND (coalesce(_f->>'q','') = '' OR (
         l.full_name ILIKE '%'||(_f->>'q')||'%'
      OR l.whatsapp_norm LIKE '%'||regexp_replace(_f->>'q','\D','','g')||'%'
      OR coalesce(l.email_norm,'') LIKE '%'||lower(_f->>'q')||'%'
      OR l.city ILIKE '%'||(_f->>'q')||'%'
      OR l.protocol ILIKE '%'||(_f->>'q')||'%'))
    AND (coalesce(_f->>'etapa','') = '' OR l.stage_id = (_f->>'etapa')::uuid)
    AND (coalesce(_f->>'desfecho','') = '' OR l.outcome = _f->>'desfecho')
    AND (coalesce(_f->>'prioridade','') = '' OR l.priority = _f->>'prioridade')
    AND (coalesce(_f->>'responsavel','') = ''
         OR (_f->>'responsavel' = 'sem' AND l.assigned_to IS NULL)
         OR (_f->>'responsavel' = 'meu' AND l.assigned_to = auth.uid())
         OR (_f->>'responsavel' NOT IN ('sem','meu') AND l.assigned_to = (_f->>'responsavel')::uuid))
    AND (coalesce(_f->>'origem','') = '' OR l.source_normalized = _f->>'origem')
    AND (coalesce(_f->>'campanha','') = '' OR coalesce(l.utm->>'utm_campaign','') = _f->>'campanha')
    AND (coalesce(_f->>'cidade','') = '' OR l.city ILIKE _f->>'cidade')
    AND (coalesce(_f->>'uf','') = '' OR l.uf = upper(_f->>'uf'))
    AND (coalesce(_f->>'de','') = '' OR l.created_at >= (_f->>'de')::timestamptz)
    AND (coalesce(_f->>'ate','') = '' OR l.created_at < ((_f->>'ate')::date + 1)::timestamptz)
    AND (coalesce(_f->>'tag','') = '' OR EXISTS (
          SELECT 1 FROM public.candidatura_tag_links tl
           WHERE tl.lead_id = l.id AND tl.tag_id = (_f->>'tag')::uuid))
    AND (coalesce(_f->>'followup','') = ''
         OR (_f->>'followup' = 'atrasado'  AND l.next_followup_at < now())
         OR (_f->>'followup' = 'hoje'      AND l.next_followup_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
                                           AND l.next_followup_at <  (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo')
         OR (_f->>'followup' = 'proximas'  AND l.next_followup_at BETWEEN now() AND now() + interval '4 hours')
         OR (_f->>'followup' = 'sem'       AND l.next_followup_at IS NULL AND l.outcome = 'aberta')
         OR (_f->>'followup' = 'novas'     AND l.first_response_at IS NULL AND l.outcome = 'aberta'));
$$;

CREATE OR REPLACE FUNCTION public.crm_card(_l public.leads)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'ultimo_contato', _l.last_contact_at,
    'primeiro_atendimento', _l.first_response_at,
    'proximo_followup', _l.next_followup_at,
    'arquivada_em', _l.archived_at,
    'reenvios', _l.submissions_count,
    'responsavel_id', _l.assigned_to,
    'responsavel', (SELECT p.full_name FROM public.profiles p WHERE p.id = _l.assigned_to),
    'tags', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.name, 'cor', t.color) ORDER BY t.name)
                        FROM public.candidatura_tag_links tl
                        JOIN public.candidatura_tags t ON t.id = tl.tag_id
                       WHERE tl.lead_id = _l.id), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.crm_radar()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d0 timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN (
    SELECT jsonb_build_object(
      'atrasados',    count(*) FILTER (WHERE l.next_followup_at < now()),
      'hoje',         count(*) FILTER (WHERE l.next_followup_at >= d0 AND l.next_followup_at < d0 + interval '1 day'),
      'proximas',     count(*) FILTER (WHERE l.next_followup_at BETWEEN now() AND now() + interval '4 hours'),
      'sem_acao',     count(*) FILTER (WHERE l.next_followup_at IS NULL AND l.outcome = 'aberta'),
      'novas',        count(*) FILTER (WHERE l.first_response_at IS NULL AND l.outcome = 'aberta'),
      'sem_responsavel', count(*) FILTER (WHERE l.assigned_to IS NULL AND l.outcome = 'aberta'),
      'total',        count(*)
    )
    FROM public.leads l WHERE l.archived_at IS NULL
  );
END; $$;

CREATE OR REPLACE FUNCTION public.crm_board(_f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN jsonb_build_object(
    'etapas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'chave', s.key, 'nome', s.name, 'ordem', s.sort_order,
        'cor', s.color, 'inicial', s.is_initial, 'ativa', s.is_active) ORDER BY s.sort_order)
      FROM public.candidatura_stages s WHERE s.is_active), '[]'::jsonb),
    'cards', coalesce((SELECT jsonb_agg(public.crm_card(l) ORDER BY l.created_at DESC)
      FROM public.leads l WHERE l.id IN (SELECT id FROM public.crm_filtrar(_f))), '[]'::jsonb),
    'radar', public.crm_radar()
  );
END; $$;

CREATE OR REPLACE FUNCTION public.crm_list(_f jsonb DEFAULT '{}'::jsonb, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total bigint;
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  SELECT count(*) INTO v_total FROM public.crm_filtrar(_f);
  RETURN jsonb_build_object(
    'total', v_total,
    'itens', coalesce((SELECT jsonb_agg(c ORDER BY ord)
       FROM (SELECT public.crm_card(l) c, l.created_at ord
               FROM public.leads l
              WHERE l.id IN (SELECT id FROM public.crm_filtrar(_f))
              ORDER BY l.created_at DESC
              LIMIT greatest(1, least(_limit, 200)) OFFSET greatest(0, _offset)) t), '[]'::jsonb)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.crm_detail(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l public.leads%ROWTYPE; v_pii boolean;
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  v_pii := public.has_capability(auth.uid(), 'candidaturas.pii.view');
  SELECT * INTO v_l FROM public.leads WHERE id = _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;

  RETURN jsonb_build_object(
    'candidatura', public.crm_card(v_l) || jsonb_build_object(
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
END; $$;

CREATE OR REPLACE FUNCTION public.crm_followups_list(_escopo text DEFAULT 'hoje', _somente_meus boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d0 timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'quando', f.due_at, 'tipo', f.kind, 'situacao', f.status,
      'observacao', f.note,
      'responsavel', (SELECT p.full_name FROM public.profiles p WHERE p.id = f.assigned_to),
      'responsavel_id', f.assigned_to,
      'candidatura_id', l.id, 'candidata', l.full_name,
      'whatsapp', l.whatsapp_norm, 'cidade', l.city, 'uf', l.uf,
      'etapa', (SELECT s.name FROM public.candidatura_stages s WHERE s.id = l.stage_id))
      ORDER BY f.due_at)
    FROM public.candidatura_followups f
    JOIN public.leads l ON l.id = f.lead_id
   WHERE (NOT _somente_meus OR f.assigned_to = auth.uid())
     AND CASE _escopo
       WHEN 'atrasados' THEN f.status = 'pendente' AND f.due_at < now()
       WHEN 'hoje'      THEN f.status = 'pendente' AND f.due_at >= d0 AND f.due_at < d0 + interval '1 day'
       WHEN 'amanha'    THEN f.status = 'pendente' AND f.due_at >= d0 + interval '1 day' AND f.due_at < d0 + interval '2 days'
       WHEN 'semana'    THEN f.status = 'pendente' AND f.due_at >= d0 AND f.due_at < d0 + interval '7 days'
       WHEN 'concluidos' THEN f.status = 'concluido'
       ELSE f.status = 'pendente' END), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_metrics(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d1 timestamptz := coalesce(_de, (now() - interval '30 days')::date)::timestamptz;
        d2 timestamptz := (coalesce(_ate, now()::date) + 1)::timestamptz;
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN (
    SELECT jsonb_build_object(
      'periodo', jsonb_build_object('de', d1, 'ate', d2),
      'total', count(*),
      'novas', count(*) FILTER (WHERE l.first_response_at IS NULL AND l.outcome = 'aberta'),
      'em_atendimento', count(*) FILTER (WHERE l.first_response_at IS NOT NULL AND l.outcome = 'aberta'),
      'ganhas', count(*) FILTER (WHERE l.outcome = 'ganha'),
      'perdidas', count(*) FILTER (WHERE l.outcome = 'perdida'),
      'taxa_conversao', CASE WHEN count(*) = 0 THEN 0
        ELSE round(100.0 * count(*) FILTER (WHERE l.outcome = 'ganha') / count(*), 1) END,
      'minutos_primeiro_atendimento', coalesce(round(avg(
          EXTRACT(EPOCH FROM (l.first_response_at - l.created_at))/60)
          FILTER (WHERE l.first_response_at IS NOT NULL)), 0),
      'dias_no_funil', coalesce(round(avg(
          EXTRACT(EPOCH FROM (coalesce(l.won_at, l.lost_at, now()) - l.created_at))/86400)::numeric, 1), 0),
      'por_origem', coalesce((SELECT jsonb_object_agg(src, n) FROM (
          SELECT l2.source_normalized src, count(*) n FROM public.leads l2
           WHERE l2.created_at >= d1 AND l2.created_at < d2 GROUP BY 1) o), '{}'::jsonb),
      'motivos_perda', coalesce((SELECT jsonb_object_agg(lbl, n) FROM (
          SELECT coalesce(r.label,'Não informado') lbl, count(*) n
            FROM public.leads l3 LEFT JOIN public.candidatura_lost_reasons r ON r.id = l3.lost_reason_id
           WHERE l3.outcome = 'perdida' AND l3.created_at >= d1 AND l3.created_at < d2
           GROUP BY 1) m), '{}'::jsonb)
    )
    FROM public.leads l WHERE l.created_at >= d1 AND l.created_at < d2
  );
END; $$;

-- ============================================================
-- AÇÕES
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_move_stage(_lead uuid, _stage uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from uuid; v_fn text; v_tn text;
BEGIN
  PERFORM public.crm_require('candidaturas.move');
  SELECT stage_id INTO v_from FROM public.leads WHERE id = _lead FOR UPDATE;
  IF v_from IS NULL THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.candidatura_stages WHERE id = _stage AND is_active) THEN
    RAISE EXCEPTION 'etapa_invalida';
  END IF;
  IF v_from = _stage THEN RETURN jsonb_build_object('ok', true, 'sem_mudanca', true); END IF;

  SELECT name INTO v_fn FROM public.candidatura_stages WHERE id = v_from;
  SELECT name INTO v_tn FROM public.candidatura_stages WHERE id = _stage;

  UPDATE public.leads SET stage_id = _stage, stage_entered_at = now(), updated_at = now() WHERE id = _lead;
  INSERT INTO public.candidatura_stage_history (lead_id, from_stage_id, to_stage_id, actor_id, note)
  VALUES (_lead, v_from, _stage, auth.uid(), _note);
  PERFORM public.crm_log(_lead, 'etapa', 'Etapa alterada: ' || v_fn || ' → ' || v_tn, _note,
    jsonb_build_object('de', v_from, 'para', _stage));
  PERFORM public.crm_audit('candidatura.etapa', _lead, jsonb_build_object('de', v_fn, 'para', v_tn));
  RETURN jsonb_build_object('ok', true, 'de', v_fn, 'para', v_tn);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_assign(_lead uuid, _user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old uuid; v_nome text;
BEGIN
  PERFORM public.crm_require('candidaturas.assign');
  SELECT assigned_to INTO v_old FROM public.leads WHERE id = _lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  IF _user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user AND is_active) THEN
    RAISE EXCEPTION 'usuario_invalido';
  END IF;
  UPDATE public.leads SET assigned_to = _user, updated_at = now() WHERE id = _lead;
  SELECT full_name INTO v_nome FROM public.profiles WHERE id = _user;
  PERFORM public.crm_log(_lead, 'responsavel',
    CASE WHEN _user IS NULL THEN 'Responsável removido'
         WHEN _user = auth.uid() THEN coalesce(v_nome,'Usuário') || ' assumiu a candidatura'
         ELSE 'Candidatura atribuída a ' || coalesce(v_nome,'usuário') END,
    NULL, jsonb_build_object('de', v_old, 'para', _user));
  PERFORM public.crm_audit('candidatura.responsavel', _lead, jsonb_build_object('de', v_old, 'para', _user));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_set_priority(_lead uuid, _priority text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.edit');
  IF _priority NOT IN ('normal','alta','urgente') THEN RAISE EXCEPTION 'prioridade_invalida'; END IF;
  UPDATE public.leads SET priority = _priority, updated_at = now() WHERE id = _lead;
  PERFORM public.crm_log(_lead, 'prioridade', 'Prioridade definida como ' || _priority);
  PERFORM public.crm_audit('candidatura.prioridade', _lead, jsonb_build_object('para', _priority));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_note_add(_lead uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.crm_require('candidaturas.notes');
  IF length(btrim(coalesce(_body,''))) < 2 THEN RAISE EXCEPTION 'nota_vazia'; END IF;
  INSERT INTO public.candidatura_notes (lead_id, body, author_id)
  VALUES (_lead, left(btrim(_body), 5000), auth.uid()) RETURNING id INTO v_id;
  PERFORM public.crm_log(_lead, 'nota', 'Nota adicionada', left(btrim(_body), 280),
    jsonb_build_object('note_id', v_id));
  PERFORM public.crm_audit('candidatura.nota.criar', _lead, jsonb_build_object('note_id', v_id));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.crm_note_edit(_note uuid, _body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text; v_lead uuid; v_author uuid;
BEGIN
  PERFORM public.crm_require('candidaturas.notes');
  SELECT body, lead_id, author_id INTO v_old, v_lead, v_author
    FROM public.candidatura_notes WHERE id = _note FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'nota_inexistente'; END IF;
  IF v_author <> auth.uid() AND NOT public.has_capability(auth.uid(), 'candidaturas.settings') THEN
    RAISE EXCEPTION 'nota_de_outro_usuario' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.candidatura_note_revisions (note_id, previous_body, edited_by)
  VALUES (_note, v_old, auth.uid());
  UPDATE public.candidatura_notes
     SET body = left(btrim(_body), 5000), edits_count = edits_count + 1 WHERE id = _note;
  PERFORM public.crm_log(v_lead, 'nota', 'Nota editada', NULL, jsonb_build_object('note_id', _note));
  PERFORM public.crm_audit('candidatura.nota.editar', v_lead,
    jsonb_build_object('note_id', _note, 'antes', v_old, 'depois', _body));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_followup_create(
  _lead uuid, _due_at timestamptz, _kind text DEFAULT 'whatsapp',
  _assigned_to uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_resp uuid := coalesce(_assigned_to, auth.uid());
BEGIN
  PERFORM public.crm_require('candidaturas.followups');
  IF _due_at IS NULL THEN RAISE EXCEPTION 'data_obrigatoria'; END IF;
  INSERT INTO public.candidatura_followups (lead_id, due_at, kind, assigned_to, note, created_by)
  VALUES (_lead, _due_at, _kind, v_resp, _note, auth.uid()) RETURNING id INTO v_id;
  PERFORM public.crm_refresh_next(_lead);
  PERFORM public.crm_log(_lead, 'followup', 'Follow-up agendado (' || _kind || ')', _note,
    jsonb_build_object('followup_id', v_id, 'quando', _due_at));
  PERFORM public.crm_audit('candidatura.followup.criar', _lead,
    jsonb_build_object('id', v_id, 'quando', _due_at, 'tipo', _kind));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.crm_followup_complete(_id uuid, _outcome text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead uuid;
BEGIN
  PERFORM public.crm_require('candidaturas.followups');
  UPDATE public.candidatura_followups
     SET status = 'concluido', completed_at = now(), completed_by = auth.uid(), outcome_note = _outcome
   WHERE id = _id AND status = 'pendente' RETURNING lead_id INTO v_lead;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'followup_nao_pendente'; END IF;
  PERFORM public.crm_refresh_next(v_lead);
  PERFORM public.crm_touch_contact(v_lead);
  PERFORM public.crm_log(v_lead, 'followup', 'Follow-up concluído', _outcome,
    jsonb_build_object('followup_id', _id));
  PERFORM public.crm_audit('candidatura.followup.concluir', v_lead, jsonb_build_object('id', _id));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_followup_cancel(_id uuid, _motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead uuid;
BEGIN
  PERFORM public.crm_require('candidaturas.followups');
  UPDATE public.candidatura_followups
     SET status = 'cancelado', cancelled_at = now(), cancelled_by = auth.uid(), outcome_note = _motivo
   WHERE id = _id AND status = 'pendente' RETURNING lead_id INTO v_lead;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'followup_nao_pendente'; END IF;
  PERFORM public.crm_refresh_next(v_lead);
  PERFORM public.crm_log(v_lead, 'followup', 'Follow-up cancelado', _motivo,
    jsonb_build_object('followup_id', _id));
  PERFORM public.crm_audit('candidatura.followup.cancelar', v_lead, jsonb_build_object('id', _id));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_tag_set(_lead uuid, _tag uuid, _aplicar boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nome text;
BEGIN
  PERFORM public.crm_require('candidaturas.tags');
  SELECT name INTO v_nome FROM public.candidatura_tags WHERE id = _tag;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'etiqueta_inexistente'; END IF;
  IF _aplicar THEN
    INSERT INTO public.candidatura_tag_links (lead_id, tag_id, created_by)
    VALUES (_lead, _tag, auth.uid()) ON CONFLICT DO NOTHING;
    PERFORM public.crm_log(_lead, 'etiqueta', 'Etiqueta aplicada: ' || v_nome);
  ELSE
    DELETE FROM public.candidatura_tag_links WHERE lead_id = _lead AND tag_id = _tag;
    PERFORM public.crm_log(_lead, 'etiqueta', 'Etiqueta removida: ' || v_nome);
  END IF;
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_whatsapp_click(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nome text;
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  SELECT full_name INTO v_nome FROM public.profiles WHERE id = auth.uid();
  PERFORM public.crm_touch_contact(_lead);
  PERFORM public.crm_log(_lead, 'whatsapp',
    'WhatsApp acionado por ' || coalesce(v_nome, 'usuário'),
    'O sistema não tem integração com o WhatsApp: não é possível confirmar que a mensagem foi enviada.');
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_mark_won(_lead uuid, _nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_etapa text;
BEGIN
  PERFORM public.crm_require('candidaturas.mark_won');
  SELECT s.name INTO v_etapa FROM public.leads l JOIN public.candidatura_stages s ON s.id = l.stage_id WHERE l.id = _lead;
  IF v_etapa IS NULL THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  UPDATE public.leads SET outcome = 'ganha', won_at = now(), won_by = auth.uid(), won_notes = _nota,
         status = 'aprovado', lost_reason_id = NULL, lost_at = NULL, lost_by = NULL, updated_at = now()
   WHERE id = _lead;
  PERFORM public.crm_log(_lead, 'ganho', 'Candidatura marcada como aprovada', _nota,
    jsonb_build_object('etapa_anterior', v_etapa));
  PERFORM public.crm_audit('candidatura.ganho', _lead, jsonb_build_object('etapa_anterior', v_etapa, 'nota', _nota));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_mark_lost(_lead uuid, _reason uuid, _nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_label text; v_req boolean; v_etapa text;
BEGIN
  PERFORM public.crm_require('candidaturas.mark_lost');
  SELECT label, requires_note INTO v_label, v_req FROM public.candidatura_lost_reasons WHERE id = _reason AND is_active;
  IF v_label IS NULL THEN RAISE EXCEPTION 'motivo_invalido'; END IF;
  IF v_req AND length(btrim(coalesce(_nota,''))) < 3 THEN RAISE EXCEPTION 'observacao_obrigatoria'; END IF;
  SELECT s.name INTO v_etapa FROM public.leads l JOIN public.candidatura_stages s ON s.id = l.stage_id WHERE l.id = _lead;
  IF v_etapa IS NULL THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  UPDATE public.leads SET outcome = 'perdida', lost_reason_id = _reason, lost_notes = _nota,
         lost_at = now(), lost_by = auth.uid(), status = 'recusado', updated_at = now()
   WHERE id = _lead;
  PERFORM public.crm_log(_lead, 'perda', 'Candidatura marcada como perdida: ' || v_label, _nota,
    jsonb_build_object('motivo', v_label, 'etapa_anterior', v_etapa));
  PERFORM public.crm_audit('candidatura.perda', _lead, jsonb_build_object('motivo', v_label, 'nota', _nota));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_reopen(_lead uuid, _nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.reopen');
  UPDATE public.leads SET outcome = 'aberta', status = 'em_analise',
         archived_at = NULL, archived_by = NULL, updated_at = now()
   WHERE id = _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  PERFORM public.crm_log(_lead, 'reabertura', 'Candidatura reaberta', _nota);
  PERFORM public.crm_audit('candidatura.reabrir', _lead, jsonb_build_object('nota', _nota));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_archive(_lead uuid, _nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.archive');
  UPDATE public.leads SET archived_at = now(), archived_by = auth.uid(),
         status = 'arquivado', updated_at = now() WHERE id = _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  PERFORM public.crm_log(_lead, 'arquivamento', 'Candidatura arquivada', _nota);
  PERFORM public.crm_audit('candidatura.arquivar', _lead, jsonb_build_object('nota', _nota));
  RETURN jsonb_build_object('ok', true);
END; $$;

-- CONFIGURAÇÃO ------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_stage_save(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(_payload->>'id','')::uuid; v_key text;
BEGIN
  PERFORM public.crm_require('candidaturas.settings');
  IF length(btrim(coalesce(_payload->>'nome',''))) < 2 THEN RAISE EXCEPTION 'nome_invalido'; END IF;
  IF v_id IS NULL THEN
    v_key := coalesce(nullif(_payload->>'chave',''),
      regexp_replace(lower(btrim(_payload->>'nome')), '[^a-z0-9]+', '_', 'g'));
    INSERT INTO public.candidatura_stages (key, name, sort_order, color, is_active)
    VALUES (v_key, btrim(_payload->>'nome'),
      coalesce((_payload->>'ordem')::int, 999), coalesce(_payload->>'cor', '#8C7A5B'),
      coalesce((_payload->>'ativa')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    -- etapa em uso não pode ser desativada enquanto houver candidatura nela
    IF coalesce((_payload->>'ativa')::boolean, true) = false
       AND EXISTS (SELECT 1 FROM public.leads WHERE stage_id = v_id AND archived_at IS NULL) THEN
      RAISE EXCEPTION 'etapa_em_uso';
    END IF;
    UPDATE public.candidatura_stages SET
      name = btrim(_payload->>'nome'),
      sort_order = coalesce((_payload->>'ordem')::int, sort_order),
      color = coalesce(_payload->>'cor', color),
      is_active = coalesce((_payload->>'ativa')::boolean, is_active)
    WHERE id = v_id;
  END IF;

  IF coalesce((_payload->>'inicial')::boolean, false) THEN
    UPDATE public.candidatura_stages SET is_initial = false WHERE is_initial AND id <> v_id;
    UPDATE public.candidatura_stages SET is_initial = true WHERE id = v_id;
  END IF;

  PERFORM public.crm_audit('candidatura.etapa.config', NULL, _payload);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.crm_stage_reorder(_ordem jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  PERFORM public.crm_require('candidaturas.settings');
  FOR r IN SELECT (value->>'id')::uuid id, (value->>'ordem')::int ordem FROM jsonb_array_elements(_ordem) LOOP
    UPDATE public.candidatura_stages SET sort_order = r.ordem WHERE id = r.id;
  END LOOP;
  PERFORM public.crm_audit('candidatura.etapa.reordenar', NULL, _ordem);
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_tag_save(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(_payload->>'id','')::uuid;
BEGIN
  PERFORM public.crm_require('candidaturas.settings');
  IF length(btrim(coalesce(_payload->>'nome',''))) < 2 THEN RAISE EXCEPTION 'nome_invalido'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.candidatura_tags (slug, name, color, is_active)
    VALUES (regexp_replace(lower(btrim(_payload->>'nome')), '[^a-z0-9]+', '-', 'g'),
            btrim(_payload->>'nome'), coalesce(_payload->>'cor', '#8C7A5B'),
            coalesce((_payload->>'ativa')::boolean, true))
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, is_active = true
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.candidatura_tags SET name = btrim(_payload->>'nome'),
      color = coalesce(_payload->>'cor', color),
      is_active = coalesce((_payload->>'ativa')::boolean, is_active)
    WHERE id = v_id;
  END IF;
  PERFORM public.crm_audit('candidatura.etiqueta.config', NULL, _payload);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.crm_options()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN jsonb_build_object(
    'etapas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'chave', s.key, 'nome', s.name,
        'ordem', s.sort_order, 'cor', s.color, 'inicial', s.is_initial, 'ativa', s.is_active)
        ORDER BY s.sort_order) FROM public.candidatura_stages s), '[]'::jsonb),
    'etiquetas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.name, 'cor', t.color,
        'ativa', t.is_active) ORDER BY t.name) FROM public.candidatura_tags t), '[]'::jsonb),
    'motivos_perda', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'rotulo', r.label,
        'exige_observacao', r.requires_note) ORDER BY r.sort_order)
        FROM public.candidatura_lost_reasons r WHERE r.is_active), '[]'::jsonb),
    'usuarios', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.full_name) ORDER BY p.full_name)
        FROM public.profiles p WHERE p.is_active), '[]'::jsonb),
    'origens', coalesce((SELECT jsonb_agg(DISTINCT l.source_normalized) FROM public.leads l), '[]'::jsonb),
    'campanhas', coalesce((SELECT jsonb_agg(DISTINCT l.utm->>'utm_campaign')
        FROM public.leads l WHERE coalesce(l.utm->>'utm_campaign','') <> ''), '[]'::jsonb),
    'permissoes', coalesce((SELECT jsonb_agg(c.capability) FROM public.my_capabilities() c
        WHERE c.capability LIKE 'candidaturas.%'), '[]'::jsonb)
  );
END; $$;

-- ============================================================
-- SUPERFÍCIE PÚBLICA: nenhuma rotina do CRM é anônima
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'crm\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;