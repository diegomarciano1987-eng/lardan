DROP FUNCTION IF EXISTS public.qualidade_trocas_juntaveis(uuid);
CREATE FUNCTION public.qualidade_trocas_juntaveis(_troca uuid)
RETURNS TABLE (id uuid, protocolo text, status text, peca text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE t qualidade_trocas;
BEGIN
  IF NOT (public.has_capability(auth.uid(),'quality.manage') OR public.correios_eh_servidor()) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  SELECT * INTO t FROM qualidade_trocas q WHERE q.id = _troca;
  IF t.id IS NULL OR t.consultora_party_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT q.id, q.protocolo::text, q.status::text,
         trim(coalesce(q.rep_referencia, q.dev_referencia, '') || ' · ' || coalesce(q.rep_nome, q.dev_nome, ''))::text,
         q.created_at
  FROM qualidade_trocas q
  WHERE q.consultora_party_id = t.consultora_party_id AND q.id <> _troca
    AND q.status::text IN ('aberta','em_analise','aguardando_envio','resolvida')
    AND q.created_at > now() - interval '90 days'
    AND NOT EXISTS (SELECT 1 FROM qualidade_correios_envios e WHERE e.troca_id = q.id AND e.direcao = 'ida' AND e.status NOT IN ('erro','cancelada'))
  ORDER BY q.created_at DESC LIMIT 20;
END $$;
REVOKE EXECUTE ON FUNCTION public.qualidade_trocas_juntaveis(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_trocas_juntaveis(uuid) TO authenticated, service_role;