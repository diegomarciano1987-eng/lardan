CREATE OR REPLACE FUNCTION public.crm_normalize_source(_tracking jsonb)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE
  utm jsonb := coalesce(_tracking->'utm', '{}'::jsonb);
  s text := lower(btrim(coalesce(utm->>'utm_source', '')));
  m text := lower(btrim(coalesce(utm->>'utm_medium', '')));
  ref text := lower(btrim(coalesce(_tracking->>'referrer', '')));
  pri text := lower(btrim(coalesce(_tracking->>'first_referrer', '')));
  ua text := lower(coalesce(_tracking->>'user_agent', ''));
  pago boolean := m IN ('cpc','ppc','paid','paid_social','paidsocial','paid_search','paidsearch','ads','anuncio');
  c text; c2 text; app text;
BEGIN
  -- gclid/msclkid só existem em clique de anúncio.
  IF coalesce(_tracking->>'gclid','')   <> '' THEN RETURN 'google_ads'; END IF;
  IF coalesce(_tracking->>'msclkid','') <> '' THEN RETURN 'bing_ads';   END IF;
  -- UTM declarada vence. fbclid NÃO prova anúncio: Instagram/Facebook o anexam
  -- a todo link externo, inclusive o link da bio.
  IF s <> '' THEN
    IF s LIKE '%chatgpt%' OR s LIKE '%openai%' THEN RETURN 'chatgpt'; END IF;
    IF s LIKE '%perplexity%' THEN RETURN 'perplexity'; END IF;
    IF s LIKE '%gemini%' OR s LIKE '%bard%' THEN RETURN 'gemini'; END IF;
    IF s LIKE '%copilot%' THEN RETURN 'copilot'; END IF;
    IF s LIKE '%claude%' OR s LIKE '%anthropic%' THEN RETURN 'claude'; END IF;
    IF s LIKE '%grok%' THEN RETURN 'grok'; END IF;
    IF s LIKE '%instagram%' OR s IN ('ig','insta','igshopping','linktree','linktr.ee') THEN
      RETURN CASE WHEN pago THEN 'meta_ads' ELSE 'instagram' END; END IF;
    IF s LIKE '%tiktok%' OR s = 'tt' THEN RETURN 'tiktok'; END IF;
    IF s LIKE '%youtube%' OR s = 'yt' THEN RETURN 'youtube'; END IF;
    IF s LIKE '%linkedin%' OR s = 'li' THEN RETURN 'linkedin'; END IF;
    IF s LIKE '%pinterest%' THEN RETURN 'pinterest'; END IF;
    IF s LIKE '%facebook%' OR s LIKE '%meta%' OR s IN ('fb','an','msg') THEN
      RETURN CASE WHEN pago THEN 'meta_ads' ELSE 'meta' END; END IF;
    IF s LIKE '%google%' THEN
      RETURN CASE WHEN pago THEN 'google_ads'
                  WHEN m IN ('organic','organico') THEN 'google_organico' ELSE 'google' END;
    END IF;
    IF s LIKE '%bing%' THEN RETURN CASE WHEN pago THEN 'bing_ads' ELSE 'bing' END; END IF;
    IF s LIKE '%whatsapp%' OR s IN ('wa','wpp','zap') THEN RETURN 'whatsapp'; END IF;
    IF s LIKE '%telegram%' THEN RETURN 'telegram'; END IF;
    IF s LIKE '%indica%' OR s LIKE '%referral%' THEN RETURN 'indicacao'; END IF;
    IF s LIKE '%email%' OR s LIKE '%newsletter%' OR m = 'email' THEN RETURN 'email'; END IF;
    RETURN 'outro';
  END IF;
  IF coalesce(_tracking->>'fbclid','') <> '' THEN
    RETURN CASE WHEN ua LIKE '%instagram%' THEN 'instagram' ELSE 'meta' END;
  END IF;
  -- Linktree é a bio: o app de origem aparece no user-agent.
  IF (pri LIKE '%linktr.ee%' OR ref LIKE '%linktr.ee%') THEN
    app := public.crm_source_from_user_agent(_tracking->>'user_agent');
    RETURN coalesce(app, 'instagram');
  END IF;
  c  := public.crm_source_from_referrer(pri);
  IF c IS NOT NULL AND c <> 'interno' THEN RETURN c; END IF;
  c2 := public.crm_source_from_referrer(ref);
  IF c2 IS NOT NULL AND c2 <> 'interno' THEN RETURN c2; END IF;
  app := public.crm_source_from_user_agent(_tracking->>'user_agent');
  IF app IS NOT NULL THEN RETURN app; END IF;
  IF c = 'interno' OR c2 = 'interno' THEN RETURN 'direto'; END IF;
  RETURN 'nao_identificado';
END; $function$;

-- Auditoria e reclassificação das candidaturas existentes.
WITH calc AS (
  SELECT id, source_normalized AS antes,
    public.crm_normalize_source(jsonb_build_object(
      'utm', coalesce(utm,'{}'::jsonb), 'referrer', referrer, 'first_referrer', first_referrer,
      'gclid', gclid, 'fbclid', fbclid, 'msclkid', msclkid, 'user_agent', user_agent)) AS depois
  FROM public.leads
), aud AS (
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, payload)
  SELECT NULL, 'origem.reclassificada', 'leads', id::text,
    jsonb_build_object('antes', antes, 'depois', depois, 'motivo', 'regra de origem corrigida (ig, fbclid orgânico, linktree)')
  FROM calc WHERE antes IS DISTINCT FROM depois
  RETURNING entity_id
)
UPDATE public.leads l SET source_normalized = c.depois
FROM calc c WHERE c.id = l.id AND c.antes IS DISTINCT FROM c.depois;