CREATE OR REPLACE FUNCTION public.showcase_save(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  eu uuid;
  alvo uuid;
  s text := lower(regexp_replace(coalesce(_payload->>'slug',''), '[^a-zA-Z0-9-]', '', 'g'));
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  eu := public.my_party_id();
  alvo := coalesce(nullif(_payload->>'party_id','')::uuid, eu);
  IF alvo IS NULL THEN RAISE EXCEPTION 'Cadastro de pessoa não vinculado ao seu usuário.'; END IF;
  IF (eu IS NULL OR alvo IS DISTINCT FROM eu)
     AND public.has_capability(uid,'kit.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem permissão para alterar a vitrine de outra consultora.' USING errcode='42501';
  END IF;
  IF length(s) < 3 THEN RAISE EXCEPTION 'Escolha um endereço com pelo menos 3 letras.'; END IF;
  IF public.showcase_slug_reserved(s) THEN RAISE EXCEPTION 'Este endereço é reservado pelo site.'; END IF;
  IF EXISTS (SELECT 1 FROM public.consultant_showcases WHERE slug = s AND party_id <> alvo) THEN
    RAISE EXCEPTION 'Este endereço já está em uso.';
  END IF;

  INSERT INTO public.consultant_showcases (party_id, slug, headline, bio, whatsapp, is_public)
  VALUES (alvo, s, nullif(_payload->>'headline',''), nullif(_payload->>'bio',''),
          regexp_replace(coalesce(_payload->>'whatsapp',''),'[^0-9]','','g'),
          coalesce((_payload->>'is_public')::boolean, false))
  ON CONFLICT (party_id) DO UPDATE SET
    slug = excluded.slug, headline = excluded.headline, bio = excluded.bio,
    whatsapp = excluded.whatsapp, is_public = excluded.is_public;

  RETURN jsonb_build_object('slug', s);
END $$;