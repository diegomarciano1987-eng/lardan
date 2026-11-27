DO $$ DECLARE d text; n text; BEGIN
 d:=pg_get_functiondef('public.crm_metrics(date,date,text)'::regprocedure);
 n:=replace(d,$a$s.key IN ('aprovada','documentacao','onboarding')$a$,$b$s.key IN ('aprovada','onboarding')$b$);
 n:=replace(n,$a$s.key IN ('conversa','teste','avaliacao','primeiro','perfil')$a$,$b$s.key IN ('conversa','teste','avaliacao','documentacao','primeiro','perfil')$b$);
 IF n=d THEN RAISE EXCEPTION 'Ponto das métricas não encontrado'; END IF;
 EXECUTE n;
END $$;
CREATE OR REPLACE FUNCTION public.crm_mark_won(_lead uuid,_nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
 PERFORM public.crm_require('candidaturas.mark_won');
 PERFORM public.captacao_aprovar_interno(_lead,auth.uid(),_nota,false);
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_mark_won(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_mark_won(uuid,text) TO authenticated;