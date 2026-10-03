REVOKE SELECT ON public.pdv_login_codigos FROM authenticated;
GRANT SELECT (id, unidade_id, membro_id, tentativas, expira_em, usado_em, created_at) ON public.pdv_login_codigos TO authenticated;