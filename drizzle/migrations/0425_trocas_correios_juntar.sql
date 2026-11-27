ALTER TABLE public.qualidade_correios_envios ADD COLUMN IF NOT EXISTS agrupado_com uuid;
CREATE INDEX IF NOT EXISTS qualidade_correios_envios_agrupado_idx ON public.qualidade_correios_envios (agrupado_com);
COMMENT ON COLUMN public.qualidade_correios_envios.agrupado_com IS 'Envio principal quando várias trocas vão no mesmo pacote (mesmo código).';

CREATE OR REPLACE FUNCTION public.qualidade_trocas_juntaveis(_troca uuid)
RETURNS TABLE (id uuid, codigo text, status text, peca text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE t qualidade_trocas;
BEGIN
  IF NOT (public.has_capability(auth.uid(),'quality.manage') OR public.correios_eh_servidor()) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  SELECT * INTO t FROM qualidade_trocas q WHERE q.id = _troca;
  IF t.id IS NULL OR t.consultora_party_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT q.id, q.codigo::text, q.status::text,
         coalesce(to_jsonb(q)->>'rep_referencia', to_jsonb(q)->>'dev_referencia', '')::text,
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