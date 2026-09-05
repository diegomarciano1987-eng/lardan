INSERT INTO public.role_capabilities (role, capability)
VALUES ('master','leads.view'),('diretoria','leads.view'),('marketing','leads.view'),('suporte','leads.view')
ON CONFLICT DO NOTHING;