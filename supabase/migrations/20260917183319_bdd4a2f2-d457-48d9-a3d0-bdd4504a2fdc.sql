CREATE OR REPLACE FUNCTION public.submit_lead(p_full_name text, p_whatsapp text, p_city text, p_uf text, p_street text DEFAULT NULL::text, p_street_number text DEFAULT NULL::text, p_no_number boolean DEFAULT false, p_postal_code text DEFAULT NULL::text, p_financial_goal text DEFAULT NULL::text, p_availability text DEFAULT NULL::text, p_experience text DEFAULT NULL::text, p_audience text DEFAULT NULL::text, p_motivation text DEFAULT NULL::text, p_source text DEFAULT 'site/seja-lardan'::text, p_entry_url text DEFAULT NULL::text, p_utm jsonb DEFAULT '{}'::jsonb, p_privacy_version text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_protocol text;
  v_lead uuid;
  v_stage uuid;
BEGIN
  IF length(btrim(coalesce(p_full_name,''))) < 2 THEN
    RAISE EXCEPTION 'nome_invalido';
  END IF;
  IF length(regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'whatsapp_invalido';
  END IF;
  IF length(btrim(coalesce(p_city,''))) < 2 THEN
    RAISE EXCEPTION 'cidade_invalida';
  END IF;
  IF upper(coalesce(p_uf,'')) !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'uf_invalida';
  END IF;
  IF coalesce(p_privacy_version,'') = '' THEN
    RAISE EXCEPTION 'privacidade_ausente';
  END IF;

  SELECT id INTO v_stage FROM public.candidatura_stages
   WHERE is_initial AND is_active ORDER BY sort_order LIMIT 1;
  IF v_stage IS NULL THEN
    SELECT id INTO v_stage FROM public.candidatura_stages WHERE is_active ORDER BY sort_order LIMIT 1;
  END IF;

  INSERT INTO public.leads (
    full_name, whatsapp, street, street_number, no_number, city, uf, postal_code,
    financial_goal, availability, experience, audience, motivation,
    source, entry_url, utm, privacy_version, marketing_consent,
    stage_id, stage_entered_at
  ) VALUES (
    left(btrim(p_full_name), 160),
    left(btrim(p_whatsapp), 32),
    left(btrim(p_street), 200),
    CASE WHEN p_no_number THEN NULL ELSE left(btrim(p_street_number), 20) END,
    coalesce(p_no_number, false),
    left(btrim(p_city), 120),
    upper(p_uf),
    left(btrim(p_postal_code), 20),
    left(btrim(p_financial_goal), 200),
    left(btrim(p_availability), 200),
    left(btrim(p_experience), 400),
    left(btrim(p_audience), 400),
    left(btrim(p_motivation), 2000),
    left(coalesce(p_source, 'site/seja-lardan'), 120),
    left(p_entry_url, 500),
    coalesce(p_utm, '{}'::jsonb),
    left(p_privacy_version, 60),
    coalesce(p_marketing_consent, false),
    v_stage, now()
  )
  RETURNING id, protocol INTO v_lead, v_protocol;

  IF v_stage IS NOT NULL THEN
    INSERT INTO public.candidatura_stage_history (lead_id, to_stage_id, note)
    VALUES (v_lead, v_stage, 'Entrada automática pelo formulário');
  END IF;

  PERFORM public.crm_log(v_lead, 'submissao', 'Candidatura recebida pelo site', NULL,
    jsonb_build_object('protocol', v_protocol), NULL);

  RETURN v_protocol;
END;
$function$;