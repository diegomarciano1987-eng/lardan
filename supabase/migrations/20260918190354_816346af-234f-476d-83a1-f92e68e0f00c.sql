-- ============================================================
-- ORIGEM DAS CANDIDATURAS — classificação por primeiro contato
-- ============================================================

CREATE OR REPLACE FUNCTION public.crm_source_from_referrer(_ref text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE r text := lower(btrim(coalesce(_ref,'')));
BEGIN
  IF r = '' THEN RETURN NULL; END IF;
  IF r LIKE '%chatgpt.com%' OR r LIKE '%chat.openai.com%' OR r LIKE '%openai.com%'
     OR r LIKE '%com.openai%' THEN RETURN 'chatgpt'; END IF;
  IF r LIKE '%perplexity.ai%' THEN RETURN 'perplexity'; END IF;
  IF r LIKE '%gemini.google%' OR r LIKE '%bard.google%' THEN RETURN 'gemini'; END IF;
  IF r LIKE '%copilot.microsoft.com%' OR r LIKE '%edgeservices.bing.com%' THEN RETURN 'copilot'; END IF;
  IF r LIKE '%claude.ai%' OR r LIKE '%anthropic.com%' THEN RETURN 'claude'; END IF;
  IF r LIKE '%grok.com%' OR r LIKE '%x.ai%' THEN RETURN 'grok'; END IF;
  IF r LIKE '%google.%' OR r LIKE '%com.google.android%' THEN RETURN 'google_organico'; END IF;
  IF r LIKE '%bing.com%' THEN RETURN 'bing_organico'; END IF;
  IF r LIKE '%duckduckgo.com%' THEN RETURN 'duckduckgo'; END IF;
  IF r LIKE '%search.yahoo%' THEN RETURN 'yahoo'; END IF;
  IF r LIKE '%ecosia.org%' THEN RETURN 'ecosia'; END IF;
  IF r LIKE '%instagram.com%' THEN RETURN 'instagram'; END IF;
  IF r LIKE '%facebook.com%' OR r LIKE '%fb.com%' OR r LIKE '%messenger.com%' THEN RETURN 'meta'; END IF;
  IF r LIKE '%whatsapp%' OR r LIKE '%wa.me%' THEN RETURN 'whatsapp'; END IF;
  IF r LIKE '%tiktok.com%' THEN RETURN 'tiktok'; END IF;
  IF r LIKE '%youtube.com%' OR r LIKE '%youtu.be%' THEN RETURN 'youtube'; END IF;
  IF r LIKE '%linkedin.com%' OR r LIKE '%lnkd.in%' THEN RETURN 'linkedin'; END IF;
  IF r LIKE '%pinterest.%' THEN RETURN 'pinterest'; END IF;
  IF r LIKE '%t.me%' OR r LIKE '%telegram%' THEN RETURN 'telegram'; END IF;
  IF r LIKE '%lardan.com.br%' OR r LIKE '%lardan.lovable.app%' THEN RETURN 'interno'; END IF;
  RETURN 'outro';
END; $$;

CREATE OR REPLACE FUNCTION public.crm_normalize_source(_tracking jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  utm jsonb := coalesce(_tracking->'utm', '{}'::jsonb);
  s text := lower(btrim(coalesce(utm->>'utm_source', '')));
  m text := lower(btrim(coalesce(utm->>'utm_medium', '')));
  ref text := lower(btrim(coalesce(_tracking->>'referrer', '')));
  pri text := lower(btrim(coalesce(_tracking->>'first_referrer', '')));
  c text;
  c2 text;
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
                  WHEN m IN ('organic','organico') THEN 'google_organico'
                  ELSE 'google' END;
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

  IF c = 'interno' OR c2 = 'interno' THEN RETURN 'direto'; END IF;

  RETURN 'nao_identificado';
END; $$;

UPDATE public.leads l
   SET source_normalized = public.crm_normalize_source(l.first_touch->'tracking'),
       updated_at = now()
 WHERE l.first_touch ? 'tracking'
   AND public.crm_normalize_source(l.first_touch->'tracking') IS DISTINCT FROM l.source_normalized;