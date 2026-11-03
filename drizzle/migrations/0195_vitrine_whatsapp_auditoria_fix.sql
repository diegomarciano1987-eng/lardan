CREATE OR REPLACE FUNCTION public.vitrine_whatsapp_registrar(_numero text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := public.my_party_id();
  dig text := regexp_replace(coalesce(_numero,''), '[^0-9]', '', 'g');
  norm text; existe uuid; novo uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF dig LIKE '55%' AND length(dig) IN (12,13) THEN dig := substr(dig, 3); END IF;
  IF length(dig) NOT IN (10,11) THEN RAISE EXCEPTION 'Informe o WhatsApp com DDD.'; END IF;
  norm := '+55' || dig;
  SELECT id INTO existe FROM public.contact_points
   WHERE party_id = me AND kind IN ('whatsapp','telefone') AND value_norm = norm LIMIT 1;
  IF existe IS NOT NULL THEN
    RETURN jsonb_build_object('situacao','ja_existe','id',existe);
  END IF;
  INSERT INTO public.contact_points (party_id, kind, label, value, is_primary)
  VALUES (me, 'whatsapp', 'WhatsApp da vitrine (informado pela consultora)', dig, false)
  RETURNING id INTO novo;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'vitrine.whatsapp_adicional', 'contact_points', novo,
          jsonb_build_object('party_id', me, 'numero', norm));
  RETURN jsonb_build_object('situacao','registrado','id',novo);
END $$;
REVOKE ALL ON FUNCTION public.vitrine_whatsapp_registrar(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vitrine_whatsapp_registrar(text) TO authenticated;