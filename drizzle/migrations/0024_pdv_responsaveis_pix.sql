CREATE OR REPLACE FUNCTION public.pdv_responsaveis_pix() RETURNS TABLE(user_id uuid, nome text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'master') OR public.has_role(auth.uid(),'diretoria') OR public.has_capability(auth.uid(),'finance.receivable.manage')) THEN
    RAISE EXCEPTION 'Sem permissão.'; END IF;
  RETURN QUERY SELECT p.id, coalesce(nullif(p.full_name,''), split_part(p.email,'@',1)), p.email
    FROM profiles p WHERE coalesce(p.is_active,true) AND public.has_capability(p.id,'finance.receivable.manage') ORDER BY 2;
END $$;
REVOKE ALL ON FUNCTION public.pdv_responsaveis_pix() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pdv_responsaveis_pix() TO authenticated, service_role;