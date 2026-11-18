-- 0337: situação do termo de confissão (ZapSign) por acordo, para a aba "Histórica até 2025" e a gaveta do acordo.
-- Só leitura, mesma trava de cobrança (cob_pode). Não cria, não cancela nem altera documento.
CREATE OR REPLACE FUNCTION public.cob_termos_confissao(_sims uuid[])
RETURNS TABLE(simulacao_id uuid, status text, sign_url text, criado_em timestamptz, assinado_em timestamptz, enviado_whatsapp boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança' USING errcode = '42501'; END IF;
  IF _sims IS NULL OR cardinality(_sims) = 0 THEN RETURN; END IF;
  IF cardinality(_sims) > 2000 THEN RAISE EXCEPTION 'No máximo 2000 acordos por consulta.'; END IF;
  RETURN QUERY
  SELECT DISTINCT ON (a.simulacao_id) a.simulacao_id, a.status,
         CASE WHEN a.status = 'pendente' THEN a.sign_url END,
         a.criado_em, a.assinado_em, coalesce(a.enviado_whatsapp, false)
    FROM assinaturas_digitais a
   WHERE a.tipo = 'confissao' AND a.simulacao_id = ANY(_sims)
   ORDER BY a.simulacao_id,
            CASE a.status WHEN 'assinado' THEN 0 WHEN 'pendente' THEN 1 ELSE 2 END,
            a.criado_em DESC;
END $function$;
REVOKE ALL ON FUNCTION public.cob_termos_confissao(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_termos_confissao(uuid[]) TO authenticated, service_role;