DO $$
DECLARE _t text; _tp uuid[]; _tprod uuid[];
BEGIN
  PERFORM set_config('statement_timeout', '300s', true);

  SELECT coalesce(array_agg(id),'{}') INTO _tprod FROM public.products
   WHERE slug IN ('123','brinco01','homolog-peca-importada-72e3eb','homolog-peca-importada-6c0c9d77-bd5886');

  SELECT coalesce(array_agg(id),'{}') INTO _tp FROM public.parties
   WHERE display_name IS NULL
      OR display_name ILIKE 'HOMOLOG%'
      OR display_name ILIKE 'IMPHOMOLOG%'
      OR display_name ILIKE 'Registro hist_rico de homologa%';

  FOR _t IN SELECT unnest(ARRAY['products','product_variants','product_media','public_price_list','variant_costs',
      'product_slug_history','parties','party_roles','contact_points','party_addresses','party_links',
      'consultant_profiles','media_assets','profiles','suppliers','business_entities','leads'])
  LOOP EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', _t); END LOOP;

  DELETE FROM public.variant_costs vc USING public.product_variants pv
   WHERE pv.id = vc.variant_id AND pv.product_id = ANY(_tprod);
  DELETE FROM public.public_price_list WHERE product_id = ANY(_tprod);
  DELETE FROM public.product_media WHERE product_id = ANY(_tprod);
  DELETE FROM public.product_slug_history WHERE product_id = ANY(_tprod);
  DELETE FROM public.product_variants WHERE product_id = ANY(_tprod);
  DELETE FROM public.products WHERE id = ANY(_tprod);

  UPDATE public.profiles SET party_id = NULL WHERE party_id = ANY(_tp);
  UPDATE public.suppliers SET party_id = NULL WHERE party_id = ANY(_tp);
  UPDATE public.business_entities SET party_id = NULL WHERE party_id = ANY(_tp);
  UPDATE public.leads SET party_id = NULL WHERE party_id = ANY(_tp);
  DELETE FROM public.consultant_profiles WHERE party_id = ANY(_tp);
  DELETE FROM public.party_links WHERE party_id = ANY(_tp);
  DELETE FROM public.party_addresses WHERE party_id = ANY(_tp);
  DELETE FROM public.contact_points WHERE party_id = ANY(_tp);
  DELETE FROM public.party_roles WHERE party_id = ANY(_tp);
  DELETE FROM public.parties WHERE id = ANY(_tp);

  DELETE FROM public.media_assets ma
   WHERE NOT EXISTS (SELECT 1 FROM public.product_media pm WHERE pm.media_id = ma.id);

  FOR _t IN SELECT unnest(ARRAY['products','product_variants','product_media','public_price_list','variant_costs',
      'product_slug_history','parties','party_roles','contact_points','party_addresses','party_links',
      'consultant_profiles','media_assets','profiles','suppliers','business_entities','leads'])
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', _t); END LOOP;
END $$;