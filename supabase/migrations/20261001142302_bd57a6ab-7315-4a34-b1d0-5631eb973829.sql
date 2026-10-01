CREATE OR REPLACE FUNCTION public.showcase_design_clean_v2(_d jsonb, _party uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT jsonb_set(public.showcase_design_clean(_d, _party), '{compartilhar,imagem}',
    CASE WHEN public.showcase_path_ok(_d#>>'{compartilhar,imagem}', _party) THEN to_jsonb(_d#>>'{compartilhar,imagem}') ELSE 'null'::jsonb END)
$$;

DO $$ BEGIN
  -- redireciona os chamadores para a versão com imagem de apresentação
  EXECUTE replace(pg_get_functiondef('public.showcase_design_save(jsonb,integer)'::regprocedure), 'public.showcase_design_clean(_draft, eu)', 'public.showcase_design_clean_v2(_draft, eu)');
  EXECUTE replace(pg_get_functiondef('public.showcase_design_publish(integer)'::regprocedure), 'public.showcase_design_clean(sh.design_draft, eu)', 'public.showcase_design_clean_v2(sh.design_draft, eu)');
END $$;

CREATE OR REPLACE FUNCTION public.showcase_public_file_ok(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.consultant_showcases s
    WHERE s.is_public AND s.design_published IS NOT NULL
      AND split_part(_path,'/',1) = s.party_id::text
      AND _path IN (s.design_published#>>'{imagens,avatar,path}', s.design_published#>>'{imagens,avatar,path2x}',
                    s.design_published#>>'{imagens,capa,path}', s.design_published#>>'{imagens,capa,path_m}',
                    s.design_published#>>'{compartilhar,imagem}'))
$$;