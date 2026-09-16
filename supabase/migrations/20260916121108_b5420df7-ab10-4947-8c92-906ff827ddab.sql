
INSERT INTO public.role_capabilities (role, capability)
VALUES ('diretoria','product.publish'), ('marketing','product.publish'),
       ('diretoria','product.manage'), ('marketing','product.manage')
ON CONFLICT DO NOTHING;

-- parties: leitura sem as colunas de documento completo
REVOKE SELECT ON public.parties FROM authenticated;
GRANT SELECT (id, kind, code, display_name, legal_name, social_name, doc_verified_at, rg, rg_issuer,
  birth_date, profession, marital_status, avatar_url, notes, status, is_active, created_by, updated_by,
  created_at, updated_at, doc_masked, doc_source, doc_checked_at) ON public.parties TO authenticated;

REVOKE SELECT ON public.suppliers FROM authenticated;
GRANT SELECT (id, name, trade_name, contact_name, email, phone, city, uf, notes, is_active,
  created_by, created_at, updated_at, party_id) ON public.suppliers TO authenticated;

REVOKE SELECT ON public.business_entities FROM authenticated;
GRANT SELECT (id, legal_name, trade_name, state_registration, city, uf, notes, is_active,
  created_by, created_at, updated_at, party_id) ON public.business_entities TO authenticated;
