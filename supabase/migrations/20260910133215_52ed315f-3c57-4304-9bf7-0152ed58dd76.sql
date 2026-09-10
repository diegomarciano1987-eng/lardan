-- Concede leitura às tabelas cujo acesso de leitura estava faltando para usuários logados.
GRANT SELECT ON public.parties TO authenticated;
GRANT SELECT ON public.business_entities TO authenticated;
GRANT SELECT ON public.suppliers TO authenticated;
GRANT SELECT ON public.consultant_profiles TO authenticated;
GRANT SELECT ON public.external_data_applications TO authenticated;

GRANT ALL ON public.parties TO service_role;
GRANT ALL ON public.business_entities TO service_role;
GRANT ALL ON public.suppliers TO service_role;
GRANT ALL ON public.consultant_profiles TO service_role;
GRANT ALL ON public.external_data_applications TO service_role;

-- Visitantes não autenticados não devem alcançar dados cadastrais sensíveis.
REVOKE ALL ON public.parties FROM anon;
REVOKE ALL ON public.consultant_profiles FROM anon;
REVOKE ALL ON public.business_entities FROM anon;
REVOKE ALL ON public.suppliers FROM anon;
REVOKE ALL ON public.external_data_applications FROM anon;
REVOKE ALL ON public.party_addresses FROM anon;
REVOKE ALL ON public.contact_points FROM anon;
REVOKE ALL ON public.party_roles FROM anon;