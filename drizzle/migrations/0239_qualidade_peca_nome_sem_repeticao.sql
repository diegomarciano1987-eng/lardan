CREATE OR REPLACE FUNCTION public.qualidade_peca(_variant uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('referencia',coalesce(nullif(v.reference_code,''),p.reference_code),
    'nome',p.name||CASE WHEN coalesce(v.label,'') IN ('','Padrão') OR position(upper(v.label) IN upper(p.name))>0 OR position(upper(p.name) IN upper(v.label))>0 THEN '' ELSE ' · '||v.label END,
    'tamanho',v.size,'valor_cents',coalesce(v.price_cents,p.price_cents))
  FROM public.product_variants v JOIN public.products p ON p.id=v.product_id WHERE v.id=_variant $$;

CREATE OR REPLACE FUNCTION public.qualidade_buscar_peca(_termo text, _limite integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t text := btrim(coalesce(_termo,'')); res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_capability(auth.uid(),'quality.view') OR public.has_role(auth.uid(),'consultora')) THEN RAISE EXCEPTION 'Acesso não liberado.'; END IF;
  IF length(t)<2 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x.exata DESC, x.nome),'[]'::jsonb) INTO res FROM (
    SELECT v.id, coalesce(nullif(v.reference_code,''),p.reference_code) AS referencia,
      public.qualidade_peca(v.id)->>'nome' AS nome,
      v.size AS tamanho, coalesce(v.price_cents,p.price_cents) AS valor_cents, v.barcode,
      (upper(coalesce(nullif(v.reference_code,''),p.reference_code,''))=upper(t) OR v.barcode=t) AS exata
    FROM public.product_variants v JOIN public.products p ON p.id=v.product_id
    WHERE v.is_active AND NOT ('demo-video' = ANY(coalesce(p.tags,'{}'::text[])))
      AND (upper(coalesce(nullif(v.reference_code,''),p.reference_code,'')) LIKE upper(t)||'%' OR v.barcode=t
        OR NOT EXISTS(SELECT 1 FROM unnest(string_to_array(public.cidade_norm(t),' ')) w WHERE w<>'' AND public.cidade_norm(p.name||' '||coalesce(v.label,'')) NOT LIKE '%'||w||'%'))
    ORDER BY 7 DESC, 3 LIMIT least(greatest(coalesce(_limite,20),1),50)) x;
  RETURN res;
END $$;