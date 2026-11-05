-- Busca de peças para trocas: referência da etiqueta, código de barras ou nome em partes (sem custo).
CREATE OR REPLACE FUNCTION public.qualidade_buscar_peca(_termo text, _limite integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t text := btrim(coalesce(_termo,'')); res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_capability(auth.uid(),'quality.view') OR public.has_role(auth.uid(),'consultora')) THEN RAISE EXCEPTION 'Acesso não liberado.'; END IF;
  IF length(t)<2 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x.exata DESC, x.nome),'[]'::jsonb) INTO res FROM (
    SELECT v.id, coalesce(nullif(v.reference_code,''),p.reference_code) AS referencia,
      p.name||CASE WHEN coalesce(v.label,'') NOT IN ('','Padrão') THEN ' · '||v.label ELSE '' END AS nome,
      v.size AS tamanho, coalesce(v.price_cents,p.price_cents) AS valor_cents, v.barcode,
      (upper(coalesce(nullif(v.reference_code,''),p.reference_code,''))=upper(t) OR v.barcode=t) AS exata
    FROM public.product_variants v JOIN public.products p ON p.id=v.product_id
    WHERE v.is_active AND NOT ('demo-video' = ANY(coalesce(p.tags,'{}'::text[])))
      AND (upper(coalesce(nullif(v.reference_code,''),p.reference_code,'')) LIKE upper(t)||'%' OR v.barcode=t
        OR NOT EXISTS(SELECT 1 FROM unnest(string_to_array(public.cidade_norm(t),' ')) w WHERE w<>'' AND public.cidade_norm(p.name||' '||coalesce(v.label,'')) NOT LIKE '%'||w||'%'))
    ORDER BY 7 DESC, 3 LIMIT least(greatest(coalesce(_limite,20),1),50)) x;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.qualidade_buscar_peca(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_buscar_peca(text,integer) TO authenticated, service_role;

-- Consultoras para lançamento manual: código atual/antigo/SmallData, nome em partes ou CPF.
CREATE OR REPLACE FUNCTION public.qualidade_buscar_consultora(_termo text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t text := btrim(coalesce(_termo,'')); res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(),'quality.view') THEN RAISE EXCEPTION 'Acesso não liberado.'; END IF;
  IF length(t)<2 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x.exato DESC, x.nome),'[]'::jsonb) INTO res FROM (
    SELECT p.id, p.code AS codigo, coalesce(p.display_name,p.legal_name) AS nome, public.cpf_mascarado(p.doc_digits) AS cpf, p.status::text AS status,
      (p.code=t) AS exato
    FROM public.parties p
    WHERE EXISTS(SELECT 1 FROM public.party_roles r WHERE r.party_id=p.id AND r.role IN ('consultora','revendedora','candidata','cliente'))
      AND public.consultora_termo_casa(p.id, coalesce(p.display_name,p.legal_name), p.code, p.doc_digits, t)
    ORDER BY (p.code=t) DESC, 3 LIMIT 20) x;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.qualidade_buscar_consultora(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_buscar_consultora(text) TO authenticated, service_role;