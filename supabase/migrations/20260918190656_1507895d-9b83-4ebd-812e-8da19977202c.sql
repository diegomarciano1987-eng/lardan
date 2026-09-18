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
  IF r LIKE '%lardan.com.br%' OR r LIKE '%lardan.lovable.app%'
     OR r LIKE '%lardan.smalldata.cloud%' THEN RETURN 'interno'; END IF;
  RETURN 'outro';
END; $$;

UPDATE public.leads l
   SET source_normalized = public.crm_normalize_source(l.first_touch->'tracking'),
       updated_at = now()
 WHERE l.first_touch ? 'tracking'
   AND public.crm_normalize_source(l.first_touch->'tracking') IS DISTINCT FROM l.source_normalized;