-- Contato que a ZapSign vai usar (mostrado antes do envio do acordo judicial).
CREATE OR REPLACE FUNCTION public.cob_judicial_contato(_party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE zap text; mail text;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança' USING errcode='42501'; END IF;
  SELECT regexp_replace(value,'\D','','g') INTO zap FROM contact_points WHERE party_id=_party AND kind='whatsapp' ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT value INTO mail FROM contact_points WHERE party_id=_party AND kind='email' ORDER BY is_primary DESC, created_at LIMIT 1;
  RETURN jsonb_build_object('whatsapp', zap, 'email', mail);
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_contato(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_contato(uuid) TO authenticated;