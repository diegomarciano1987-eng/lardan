CREATE OR REPLACE FUNCTION public.cob_acoes_atrasadas_resumo()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.cob_pode_ler(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  WITH l AS (SELECT * FROM public.cob_acoes_atrasadas_lista())
  SELECT jsonb_build_object(
    'pessoas', (SELECT count(*) FROM l),
    'da_regua', (SELECT coalesce(sum(da_regua),0) FROM l),
    'manuais', (SELECT coalesce(sum(manuais),0) FROM l),
    'so_regua', (SELECT count(*) FROM l WHERE manuais = 0),
    'linhas', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM l LIMIT 300) x), '[]'::jsonb))
  INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.cob_acoes_atrasadas_resumo() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_acoes_atrasadas_resumo() TO authenticated;