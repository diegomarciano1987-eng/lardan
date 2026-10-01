-- 1) Vitrine: somente as funções oficiais escrevem
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.consultant_showcases FROM authenticated, anon, PUBLIC;
REVOKE ALL ON public.consultant_showcases FROM anon;
GRANT SELECT ON public.consultant_showcases TO authenticated;
GRANT ALL ON public.consultant_showcases TO service_role;
DROP POLICY IF EXISTS showcase_owner_manage ON public.consultant_showcases;
CREATE POLICY showcase_owner_read ON public.consultant_showcases FOR SELECT TO authenticated
  USING (party_id = public.my_party_id() OR public.has_capability(auth.uid(),'kit.manage') IS TRUE);

CREATE OR REPLACE FUNCTION public.showcase_row_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.slug IS NOT NULL AND public.showcase_slug_reserved(NEW.slug) THEN
    RAISE EXCEPTION 'Este endereço é reservado pelo site.';
  END IF;
  IF NEW.is_public AND NEW.design_published IS NULL THEN
    RAISE EXCEPTION 'Publique a vitrine antes de colocá-la no ar.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_showcase_row_guard ON public.consultant_showcases;
CREATE TRIGGER trg_showcase_row_guard BEFORE INSERT OR UPDATE ON public.consultant_showcases
  FOR EACH ROW EXECUTE FUNCTION public.showcase_row_guard();

-- 2) Chamadas antigas sem uso: fechadas para todos
REVOKE EXECUTE ON FUNCTION public.showcase_save(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.showcase_order_create(text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.showcase_design_clean(jsonb,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.showcase_design_clean_v2(jsonb,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.showcase_path_ok(text,uuid) FROM PUBLIC, anon;

-- 3) Vitrine pública: projeção sem caminhos de originais
CREATE OR REPLACE FUNCTION public.showcase_public(_slug text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE sh public.consultant_showcases; p public.parties; dz jsonb; itens jsonb;
BEGIN
  SELECT * INTO sh FROM public.consultant_showcases WHERE slug = lower(_slug) AND is_public AND design_published IS NOT NULL;
  IF sh.party_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.parties WHERE id = sh.party_id;
  dz := sh.design_published;
  SELECT coalesce(jsonb_agg(e), '[]') INTO itens FROM jsonb_array_elements(public.showcase_items_for(sh.party_id, dz)) e
   WHERE NOT (coalesce(dz#>'{organizacao,ocultas}','[]') ? (e->>'variant_id'));
  dz := dz #- '{imagens,avatar,original}' #- '{imagens,capa,original}' #- '{imagens,avatar,crop}';
  RETURN jsonb_build_object(
    'slug', sh.slug,
    'nome', coalesce(nullif(dz#>>'{perfil,nome}',''), p.social_name, p.display_name),
    'headline', coalesce(nullif(dz#>>'{perfil,frase}',''), sh.headline),
    'bio', coalesce(nullif(dz#>>'{perfil,bio}',''), sh.bio),
    'whatsapp', coalesce(nullif(dz#>>'{contato,whatsapp}',''), sh.whatsapp),
    'design', dz, 'itens', itens);
END $function$;

-- 4) Carteira de clientes: permissão comercial própria (não mais "gerir maletas")
INSERT INTO public.role_capabilities(role, capability) VALUES ('master','crm.view'),('diretoria','crm.view')
ON CONFLICT DO NOTHING;
DROP POLICY IF EXISTS "Operação consulta clientes" ON public.consultant_clients;
DROP POLICY IF EXISTS "Operação consulta atendimentos" ON public.consultant_client_contacts;
CREATE POLICY "Comercial autorizado consulta clientes" ON public.consultant_clients FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'crm.view') IS TRUE);
CREATE POLICY "Comercial autorizado consulta atendimentos" ON public.consultant_client_contacts FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'crm.view') IS TRUE);
REVOKE ALL ON public.consultant_clients, public.consultant_client_contacts FROM anon;