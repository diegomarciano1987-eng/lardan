CREATE OR REPLACE FUNCTION public.showcase_design_get()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE eu uuid := public.my_party_id(); sh public.consultant_showcases; p public.parties;
  zap text; cid text; uf text;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL THEN RAISE EXCEPTION 'Faça login como consultora.' USING errcode='42501'; END IF;
  IF NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Área exclusiva de consultoras.' USING errcode='42501'; END IF;
  SELECT * INTO sh FROM public.consultant_showcases WHERE party_id = eu;
  SELECT * INTO p FROM public.parties WHERE id = eu;
  SELECT value INTO zap FROM public.contact_points WHERE party_id = eu AND kind IN ('whatsapp','telefone')
    ORDER BY (kind='whatsapp') DESC, is_primary DESC NULLS LAST LIMIT 1;
  SELECT city, a.uf INTO cid, uf FROM public.party_addresses a WHERE party_id = eu ORDER BY is_primary DESC NULLS LAST LIMIT 1;
  RETURN jsonb_build_object(
    'party_id', eu,
    'nome_cadastro', coalesce(p.social_name, p.display_name),
    'cadastro', jsonb_build_object('nome', coalesce(p.social_name, p.display_name, ''), 'whatsapp', coalesce(zap,''),
                                   'cidade', coalesce(cid,''), 'uf', coalesce(uf,'')),
    'slug', sh.slug, 'no_ar', coalesce(sh.is_public, false),
    'rascunho', CASE WHEN sh.party_id IS NULL OR sh.design_draft = '{}'::jsonb
       THEN jsonb_build_object('slug', coalesce(sh.slug,''), 'perfil', jsonb_build_object('frase', coalesce(sh.headline,''), 'bio', coalesce(sh.bio,'')),
                               'contato', jsonb_build_object('whatsapp', coalesce(sh.whatsapp,'')))
       ELSE sh.design_draft END,
    'publicado', sh.design_published, 'publicado_em', sh.design_published_at,
    'revisao', coalesce(sh.design_revision, 0),
    'itens', public.showcase_items_for(eu, coalesce(sh.design_draft,'{}')),
    'versoes', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', version_no, 'em', created_at) ORDER BY version_no DESC), '[]')
                  FROM (SELECT * FROM public.showcase_design_versions WHERE party_id = eu ORDER BY version_no DESC LIMIT 20) v));
END $function$;