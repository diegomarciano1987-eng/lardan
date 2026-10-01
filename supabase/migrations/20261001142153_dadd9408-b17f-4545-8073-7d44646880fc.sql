CREATE POLICY "vitrine_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vitrine-originais' AND (storage.foldername(name))[1] = public.my_party_id()::text);
CREATE POLICY "vitrine_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vitrine-originais' AND (storage.foldername(name))[1] = public.my_party_id()::text
              AND public.has_role(auth.uid(), 'consultora')
              AND lower(storage.extension(name)) IN ('webp','jpg','jpeg','png'));
CREATE POLICY "vitrine_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'vitrine-originais' AND (storage.foldername(name))[1] = public.my_party_id()::text);

CREATE OR REPLACE FUNCTION public.showcase_path_ok(_p text, _party uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(_p,'') ~ ('^' || _party::text || '/(pub|orig)/[0-9a-f-]{36}(-[0-9]{3,4})?\.(webp|jpg|jpeg|png)$')
$$;

CREATE OR REPLACE FUNCTION public.showcase_design_clean(_d jsonb, _party uuid)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  d jsonb := coalesce(_d, '{}'::jsonb);
  r jsonb; t jsonb := '{}'::jsonb; sel jsonb := '[]'::jsonb; s jsonb; i int := 0;
  secs jsonb; fotos jsonb := '{}'::jsonb; k text; v text;
BEGIN
  r := jsonb_build_object(
    'slug', lower(regexp_replace(coalesce(d->>'slug',''), '[^a-zA-Z0-9-]', '', 'g')),
    'perfil', jsonb_build_object(
      'nome', left(btrim(coalesce(d#>>'{perfil,nome}','')), 60),
      'frase', left(btrim(coalesce(d#>>'{perfil,frase}','')), 90),
      'bio', left(btrim(coalesce(d#>>'{perfil,bio}','')), 400),
      'cidade', left(btrim(coalesce(d#>>'{perfil,cidade}','')), 60),
      'regiao', left(btrim(coalesce(d#>>'{perfil,regiao}','')), 80),
      'horarios', left(btrim(coalesce(d#>>'{perfil,horarios}','')), 120),
      'mensagem', left(btrim(coalesce(d#>>'{perfil,mensagem}','')), 240)),
    'contato', jsonb_build_object(
      'whatsapp', left(regexp_replace(coalesce(d#>>'{contato,whatsapp}',''),'[^0-9]','','g'), 15),
      'instagram', left(regexp_replace(coalesce(d#>>'{contato,instagram}',''),'[^a-zA-Z0-9._]','','g'), 30),
      'facebook', left(regexp_replace(coalesce(d#>>'{contato,facebook}',''),'[^a-zA-Z0-9.]','','g'), 50),
      'tiktok', left(regexp_replace(coalesce(d#>>'{contato,tiktok}',''),'[^a-zA-Z0-9._]','','g'), 30)),
    'compartilhar', jsonb_build_object(
      'titulo', left(btrim(coalesce(d#>>'{compartilhar,titulo}','')), 70),
      'descricao', left(btrim(coalesce(d#>>'{compartilhar,descricao}','')), 160)),
    'aparencia', jsonb_build_object(
      'tema', CASE WHEN d#>>'{aparencia,tema}' IN ('classica','editorial','minimalista') THEN d#>>'{aparencia,tema}' ELSE 'classica' END,
      'paleta', CASE WHEN d#>>'{aparencia,paleta}' IN ('perola','rose','champanhe','noite') THEN d#>>'{aparencia,paleta}' ELSE 'perola' END,
      'fonte', CASE WHEN d#>>'{aparencia,fonte}' IN ('marca','moderna','delicada') THEN d#>>'{aparencia,fonte}' ELSE 'marca' END,
      'cartao', CASE WHEN d#>>'{aparencia,cartao}' IN ('suave','moldura','limpo') THEN d#>>'{aparencia,cartao}' ELSE 'suave' END,
      'grade', CASE WHEN d#>>'{aparencia,grade}' IN ('2','3','lista') THEN d#>>'{aparencia,grade}' ELSE '3' END));

  IF public.showcase_path_ok(d#>>'{imagens,avatar,path}', _party) THEN
    t := t || jsonb_build_object('avatar', jsonb_build_object(
      'path', d#>>'{imagens,avatar,path}',
      'path2x', CASE WHEN public.showcase_path_ok(d#>>'{imagens,avatar,path2x}', _party) THEN d#>>'{imagens,avatar,path2x}' END,
      'original', CASE WHEN public.showcase_path_ok(d#>>'{imagens,avatar,original}', _party) THEN d#>>'{imagens,avatar,original}' END,
      'crop', CASE WHEN jsonb_typeof(d#>'{imagens,avatar,crop}')='object' THEN jsonb_build_object(
          'x', (d#>>'{imagens,avatar,crop,x}')::numeric, 'y', (d#>>'{imagens,avatar,crop,y}')::numeric,
          'zoom', (d#>>'{imagens,avatar,crop,zoom}')::numeric, 'rot', (d#>>'{imagens,avatar,crop,rot}')::numeric) END));
  END IF;
  IF d#>>'{imagens,capa,preset}' IN ('vidro','sessao','aneis','colares','pulseiras','brincos') THEN
    t := t || jsonb_build_object('capa', jsonb_build_object('preset', d#>>'{imagens,capa,preset}'));
  ELSIF public.showcase_path_ok(d#>>'{imagens,capa,path}', _party) THEN
    t := t || jsonb_build_object('capa', jsonb_build_object('path', d#>>'{imagens,capa,path}',
      'path_m', CASE WHEN public.showcase_path_ok(d#>>'{imagens,capa,path_m}', _party) THEN d#>>'{imagens,capa,path_m}' END,
      'original', CASE WHEN public.showcase_path_ok(d#>>'{imagens,capa,original}', _party) THEN d#>>'{imagens,capa,original}' END));
  END IF;
  IF t ? 'capa' THEN
    t := jsonb_set(t, '{capa,foco_desktop}', jsonb_build_object(
      'x', least(greatest(coalesce((d#>>'{imagens,capa,foco_desktop,x}')::numeric,50),0),100),
      'y', least(greatest(coalesce((d#>>'{imagens,capa,foco_desktop,y}')::numeric,50),0),100)));
    t := jsonb_set(t, '{capa,foco_mobile}', jsonb_build_object(
      'x', least(greatest(coalesce((d#>>'{imagens,capa,foco_mobile,x}')::numeric,50),0),100),
      'y', least(greatest(coalesce((d#>>'{imagens,capa,foco_mobile,y}')::numeric,50),0),100)));
  END IF;
  r := r || jsonb_build_object('imagens', t);

  FOR s IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d#>'{organizacao,selecoes}')='array' THEN d#>'{organizacao,selecoes}' ELSE '[]' END) x LOOP
    i := i + 1; EXIT WHEN i > 4;
    sel := sel || jsonb_build_array(jsonb_build_object(
      'titulo', left(btrim(coalesce(nullif(s->>'titulo',''),'Seleção')), 40),
      'itens', (SELECT coalesce(jsonb_agg(e ORDER BY o), '[]') FROM (SELECT DISTINCT ON (e) e, o FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(s->'itens')='array' THEN s->'itens' ELSE '[]' END) WITH ORDINALITY q(e,o)
                 WHERE e ~ '^[0-9a-f-]{36}$' ORDER BY e, o) z)));
  END LOOP;
  SELECT coalesce(jsonb_agg(e ORDER BY o), '["destaques","selecoes","catalogo"]'::jsonb) INTO secs
    FROM (SELECT DISTINCT ON (e) e, o FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d#>'{organizacao,secoes}')='array' THEN d#>'{organizacao,secoes}' ELSE '["destaques","selecoes","catalogo"]' END) WITH ORDINALITY q(e,o)
           WHERE e IN ('destaques','selecoes','catalogo') ORDER BY e, o) z;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(CASE WHEN jsonb_typeof(d#>'{organizacao,fotos}')='object' THEN d#>'{organizacao,fotos}' ELSE '{}' END) LOOP
    IF k ~ '^[0-9a-f-]{36}$' AND v ~ '^[0-9a-f-]{36}$' THEN fotos := fotos || jsonb_build_object(k, v); END IF;
  END LOOP;
  r := r || jsonb_build_object('organizacao', jsonb_build_object(
    'destaques', (SELECT coalesce(jsonb_agg(e ORDER BY o), '[]') FROM (SELECT DISTINCT ON (e) e, o FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d#>'{organizacao,destaques}')='array' THEN d#>'{organizacao,destaques}' ELSE '[]' END) WITH ORDINALITY q(e,o) WHERE e ~ '^[0-9a-f-]{36}$' ORDER BY e, o) z WHERE o <= 12),
    'ordem', (SELECT coalesce(jsonb_agg(e ORDER BY o), '[]') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d#>'{organizacao,ordem}')='array' THEN d#>'{organizacao,ordem}' ELSE '[]' END) WITH ORDINALITY q(e,o) WHERE e ~ '^[0-9a-f-]{36}$' AND o <= 500),
    'ocultas', (SELECT coalesce(jsonb_agg(DISTINCT e), '[]') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d#>'{organizacao,ocultas}')='array' THEN d#>'{organizacao,ocultas}' ELSE '[]' END) e WHERE e ~ '^[0-9a-f-]{36}$'),
    'selecoes', sel, 'secoes', secs, 'fotos', fotos));
  RETURN r;
END $$;

-- usado pela rota pública de imagens: só arquivos da versão publicada e no ar
CREATE OR REPLACE FUNCTION public.showcase_public_file_ok(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.consultant_showcases s
    WHERE s.is_public AND s.design_published IS NOT NULL
      AND split_part(_path,'/',1) = s.party_id::text
      AND _path IN (s.design_published#>>'{imagens,avatar,path}', s.design_published#>>'{imagens,avatar,path2x}',
                    s.design_published#>>'{imagens,capa,path}', s.design_published#>>'{imagens,capa,path_m}'))
$$;
REVOKE EXECUTE ON FUNCTION public.showcase_public_file_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_public_file_ok(text) TO service_role;