DROP POLICY IF EXISTS ref_settings_ler ON public.referral_settings;
DROP POLICY IF EXISTS ref_tiers_ler ON public.referral_tiers;

DROP POLICY IF EXISTS "leitura do modo" ON public.clicksign_settings;
CREATE POLICY "leitura do modo" ON public.clicksign_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'master') OR public.has_capability(auth.uid(),'kit.view') OR public.has_capability(auth.uid(),'kit.accept'));

DROP POLICY IF EXISTS grantable_ler ON public.access_grantable_roles;
CREATE POLICY grantable_ler ON public.access_grantable_roles FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'users.manage'));

DROP POLICY IF EXISTS role_capabilities_read ON public.role_capabilities;
CREATE POLICY role_capabilities_read ON public.role_capabilities FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'users.manage'));

DROP POLICY IF EXISTS seg_ler ON public.access_security_settings;
CREATE POLICY seg_ler ON public.access_security_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid()));

DROP POLICY IF EXISTS uf_centroides_read ON public.uf_centroides;
CREATE POLICY uf_centroides_read ON public.uf_centroides FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid()));

DROP POLICY IF EXISTS ibge_municipios_read ON public.ibge_municipios;
CREATE POLICY ibge_municipios_read ON public.ibge_municipios FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid()));

DROP POLICY IF EXISTS public_price_list_read ON public.public_price_list;
CREATE POLICY public_price_list_read ON public.public_price_list FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'catalog.view'));

DROP POLICY IF EXISTS product_slug_history_read ON public.product_slug_history;
CREATE POLICY product_slug_history_read ON public.product_slug_history FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'catalog.view'));

DROP POLICY IF EXISTS plating_types_read ON public.plating_types;
CREATE POLICY plating_types_read ON public.plating_types FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'catalog.view'));