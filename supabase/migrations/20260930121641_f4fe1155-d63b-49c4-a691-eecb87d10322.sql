CREATE OR REPLACE FUNCTION public.crm_source_from_user_agent(_ua text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _ua IS NULL OR _ua = '' THEN NULL
    WHEN _ua ILIKE '%Instagram%' THEN 'instagram'
    WHEN _ua ~* '(FBAN|FBAV|FB_IAB|FBIOS|FB4A)' THEN 'meta'
    WHEN _ua ~* '(musical_ly|BytedanceWebview|TikTok|trill_)' THEN 'tiktok'
    WHEN _ua ILIKE '%LinkedInApp%' THEN 'linkedin'
    WHEN _ua ILIKE '%Pinterest%' THEN 'pinterest'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.crm_normalize_source(_tracking jsonb)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE
  utm jsonb := coalesce(_tracking->'utm', '{}'::jsonb);
  s text := lower(btrim(coalesce(utm->>'utm_source', '')));
  m text := lower(btrim(coalesce(utm->>'utm_medium', '')));
  ref text := lower(btrim(coalesce(_tracking->>'referrer', '')));
  pri text := lower(btrim(coalesce(_tracking->>'first_referrer', '')));
  c text; c2 text; app text;
BEGIN
  IF coalesce(_tracking->>'gclid','')   <> '' THEN RETURN 'google_ads'; END IF;
  IF coalesce(_tracking->>'fbclid','')  <> '' THEN RETURN 'meta_ads';   END IF;
  IF coalesce(_tracking->>'msclkid','') <> '' THEN RETURN 'bing_ads';   END IF;
  IF s <> '' THEN
    IF s LIKE '%chatgpt%' OR s LIKE '%openai%' THEN RETURN 'chatgpt'; END IF;
    IF s LIKE '%perplexity%' THEN RETURN 'perplexity'; END IF;
    IF s LIKE '%gemini%' OR s LIKE '%bard%' THEN RETURN 'gemini'; END IF;
    IF s LIKE '%copilot%' THEN RETURN 'copilot'; END IF;
    IF s LIKE '%claude%' OR s LIKE '%anthropic%' THEN RETURN 'claude'; END IF;
    IF s LIKE '%grok%' THEN RETURN 'grok'; END IF;
    IF s LIKE '%instagram%' THEN RETURN 'instagram'; END IF;
    IF s LIKE '%tiktok%' THEN RETURN 'tiktok'; END IF;
    IF s LIKE '%youtube%' THEN RETURN 'youtube'; END IF;
    IF s LIKE '%linkedin%' THEN RETURN 'linkedin'; END IF;
    IF s LIKE '%facebook%' OR s LIKE '%meta%' THEN RETURN 'meta'; END IF;
    IF s LIKE '%google%' THEN
      RETURN CASE WHEN m IN ('cpc','ppc','paid','paid_search','paidsearch') THEN 'google_ads'
                  WHEN m IN ('organic','organico') THEN 'google_organico' ELSE 'google' END;
    END IF;
    IF s LIKE '%bing%' THEN
      RETURN CASE WHEN m IN ('cpc','ppc','paid','paid_search') THEN 'bing_ads' ELSE 'bing' END;
    END IF;
    IF s LIKE '%whatsapp%' THEN RETURN 'whatsapp'; END IF;
    IF s LIKE '%indica%' OR s LIKE '%referral%' THEN RETURN 'indicacao'; END IF;
    IF s LIKE '%email%' OR s LIKE '%newsletter%' OR m = 'email' THEN RETURN 'email'; END IF;
    RETURN 'outro';
  END IF;
  c  := public.crm_source_from_referrer(pri);
  IF c IS NOT NULL AND c <> 'interno' THEN RETURN c; END IF;
  c2 := public.crm_source_from_referrer(ref);
  IF c2 IS NOT NULL AND c2 <> 'interno' THEN RETURN c2; END IF;
  -- Navegador interno de app (Instagram, Facebook, TikTok...) não envia referência,
  -- mas se identifica no user-agent.
  app := public.crm_source_from_user_agent(_tracking->>'user_agent');
  IF app IS NOT NULL THEN RETURN app; END IF;
  IF c = 'interno' OR c2 = 'interno' THEN RETURN 'direto'; END IF;
  RETURN 'nao_identificado';
END; $function$;

UPDATE public.leads
SET source_normalized = public.crm_source_from_user_agent(user_agent),
    first_touch = jsonb_set(first_touch, '{source}', to_jsonb(public.crm_source_from_user_agent(user_agent))),
    last_touch  = jsonb_set(last_touch,  '{source}', to_jsonb(public.crm_source_from_user_agent(user_agent)))
WHERE source_normalized = 'nao_identificado'
  AND public.crm_source_from_user_agent(user_agent) IS NOT NULL;