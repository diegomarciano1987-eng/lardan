-- 0298 (Diego, 12/11/2026): foto da peça tirada pela própria consultora, só na vitrine dela.
-- O catálogo oficial (products, product_variants, product_media) não é tocado; ninguém além da dona lê a tabela.
CREATE TABLE public.vitrine_fotos_proprias (
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  path text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, variant_id)
);
GRANT SELECT ON public.vitrine_fotos_proprias TO authenticated;
GRANT ALL ON public.vitrine_fotos_proprias TO service_role;
ALTER TABLE public.vitrine_fotos_proprias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vitrine_fotos_proprias FORCE ROW LEVEL SECURITY;
CREATE POLICY "Dona vê as próprias fotos de peça" ON public.vitrine_fotos_proprias
  FOR SELECT TO authenticated USING (party_id = (SELECT public.my_party_id()));
COMMENT ON TABLE public.vitrine_fotos_proprias IS 'Foto de peça feita pela consultora; aparece só na vitrine dela. Escrita só por vitrine_foto_propria_salvar/remover.';

CREATE OR REPLACE FUNCTION public.vitrine_foto_propria_salvar(_variant uuid, _path text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE eu uuid := public.my_party_id(); v_ant text;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Área exclusiva de consultoras.' USING errcode = '42501';
  END IF;
  IF coalesce(_path, '') !~ ('^' || eu::text || '/peca/[0-9a-f-]{36}\.(webp|jpg|jpeg)$') THEN
    RAISE EXCEPTION 'Arquivo de foto inválido.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'vitrine-originais' AND o.name = _path) THEN
    RAISE EXCEPTION 'A foto ainda não terminou de enviar. Tente de novo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kit_balances b JOIN public.kit_cycles c ON c.id = b.cycle_id
                  WHERE c.consultora_party_id = eu AND b.variant_id = _variant AND c.status NOT IN ('rascunho','montagem','cancelada'))
     AND NOT EXISTS (SELECT 1 FROM public.kit_compositions k JOIN public.kit_composition_items ki ON ki.composition_id = k.id
                       JOIN public.kit_cycles c ON c.id = k.cycle_id
                      WHERE c.consultora_party_id = eu AND ki.variant_id = _variant AND c.status NOT IN ('rascunho','montagem','cancelada')) THEN
    RAISE EXCEPTION 'Esta peça não está em nenhuma maleta sua.';
  END IF;
  SELECT path INTO v_ant FROM public.vitrine_fotos_proprias WHERE party_id = eu AND variant_id = _variant FOR UPDATE;
  IF v_ant IS NULL AND (SELECT count(*) FROM public.vitrine_fotos_proprias WHERE party_id = eu) >= 600 THEN
    RAISE EXCEPTION 'Limite de 600 fotos próprias atingido. Exclua fotos de peças que já saíram.';
  END IF;
  INSERT INTO public.vitrine_fotos_proprias (party_id, variant_id, path) VALUES (eu, _variant, _path)
  ON CONFLICT (party_id, variant_id) DO UPDATE SET path = excluded.path, atualizado_em = now();
  RETURN jsonb_build_object('ok', true, 'path', _path, 'anterior', v_ant);
END $$;

CREATE OR REPLACE FUNCTION public.vitrine_foto_propria_remover(_variant uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE eu uuid := public.my_party_id(); v_ant text;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Área exclusiva de consultoras.' USING errcode = '42501';
  END IF;
  DELETE FROM public.vitrine_fotos_proprias WHERE party_id = eu AND variant_id = _variant RETURNING path INTO v_ant;
  RETURN jsonb_build_object('ok', true, 'anterior', v_ant);
END $$;
REVOKE ALL ON FUNCTION public.vitrine_foto_propria_salvar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vitrine_foto_propria_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vitrine_foto_propria_salvar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vitrine_foto_propria_remover(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.showcase_public_file_ok(_path text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.consultant_showcases s
    WHERE s.is_public AND s.design_published IS NOT NULL
      AND split_part(_path,'/',1) = s.party_id::text
      AND (_path IN (s.design_published#>>'{imagens,avatar,path}', s.design_published#>>'{imagens,avatar,path2x}',
                    s.design_published#>>'{imagens,capa,path}', s.design_published#>>'{imagens,capa,path_m}',
                    s.design_published#>>'{compartilhar,imagem}')
           OR EXISTS (SELECT 1 FROM public.vitrine_fotos_proprias f WHERE f.party_id = s.party_id AND f.path = _path)))
$function$;

CREATE OR REPLACE FUNCTION public.showcase_items_for(_party uuid, _design jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY ord, x->>'produto'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'cycle_id', coalesce(min(b.cycle_id::text) FILTER (WHERE vendavel), min(b.cycle_id::text))::uuid,
      'variant_id', v.id, 'produto', pr.name, 'slug', pr.slug, 'variante', v.label,
      'tamanho', v.size, 'cor', v.color, 'categoria', cat.name,
      'referencia', public.peca_referencia_etiqueta(v.reference_code, pr.reference_code),
      'disponivel', coalesce(sum(livre) FILTER (WHERE vendavel), 0)::int,
      'em_breve', NOT bool_or(vendavel),
      'preco_cents', public.kit_preco_da_consultora(_party, v.id),
      'media_id', coalesce(
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id
             AND pm.media_id::text = _design#>>ARRAY['organizacao','fotos',v.id::text]),
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1)),
      'midias', (SELECT coalesce(jsonb_agg(pm.media_id ORDER BY pm.position), '[]') FROM public.product_media pm WHERE pm.product_id = pr.id),
      'foto_propria', (SELECT f.path FROM public.vitrine_fotos_proprias f WHERE f.party_id = _party AND f.variant_id = v.id),
      'ilustracao', (SELECT '/api/public/vitrine-ilus/' || si.party_id || '/' || si.variant_id
          FROM public.showcase_illustrations si
         WHERE si.party_id = _party AND si.variant_id = v.id
           AND NOT EXISTS (SELECT 1 FROM public.product_media pm2 WHERE pm2.product_id = pr.id))
    ) AS x,
    coalesce((SELECT o FROM jsonb_array_elements_text(coalesce(_design#>'{organizacao,ordem}','[]')) WITH ORDINALITY q(e,o) WHERE e = v.id::text), 100000) AS ord
    FROM (
      SELECT b.*, (c.status IN ('recebida','operacao') AND b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id) > 0) AS vendavel,
             b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id) AS livre,
             (c.status IN ('expedida','transito','recebida') AND b.qty_accepted = 0 AND b.qty_allocated > 0
              AND NOT EXISTS (SELECT 1 FROM public.kit_acceptances a WHERE a.cycle_id = c.id)) AS divulgacao
        FROM public.kit_balances b JOIN public.kit_cycles c ON c.id = b.cycle_id
       WHERE c.consultora_party_id = _party AND c.status IN ('expedida','transito','recebida','operacao') AND b.is_published
    ) b
    JOIN public.product_variants v ON v.id = b.variant_id
    JOIN public.products pr ON pr.id = v.product_id
    LEFT JOIN public.categories cat ON cat.id = pr.category_id
    WHERE (b.vendavel OR b.divulgacao) AND v.is_active
      AND pr.status <> 'arquivado'
      AND coalesce(public.kit_preco_da_consultora(_party, v.id), 0) > 0
    GROUP BY v.id, pr.id, cat.name
  ) s
$function$;
