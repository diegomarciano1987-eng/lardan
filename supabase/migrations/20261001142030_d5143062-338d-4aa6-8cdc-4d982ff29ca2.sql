ALTER TABLE public.consultant_showcases
  ADD COLUMN IF NOT EXISTS design_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS design_published jsonb,
  ADD COLUMN IF NOT EXISTS design_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS design_published_at timestamptz;

CREATE TABLE IF NOT EXISTS public.showcase_design_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  design jsonb NOT NULL,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, version_no)
);
GRANT SELECT ON public.showcase_design_versions TO authenticated;
GRANT ALL ON public.showcase_design_versions TO service_role;
ALTER TABLE public.showcase_design_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dona lê suas versões" ON public.showcase_design_versions
  FOR SELECT TO authenticated USING (party_id = public.my_party_id());

CREATE OR REPLACE FUNCTION public.showcase_design_clean(_d jsonb, _party uuid)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  d jsonb := coalesce(_d, '{}'::jsonb);
  pref text := '/storage/v1/object/public/vitrine-publica/' || _party::text || '/';
  r jsonb := '{}'::jsonb; t jsonb; sel jsonb := '[]'::jsonb; s jsonb; i int := 0;
  secs jsonb := '[]'::jsonb; fotos jsonb := '{}'::jsonb; k text; v text;
  FUNCTION_DUMMY int;
BEGIN
  -- textos
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
      'grade', CASE WHEN d#>>'{aparencia,grade}' IN ('2','3','lista') THEN d#>>'{aparencia,grade}' ELSE '3' END)
  );

  -- imagens: apenas da pasta pública da própria consultora; capas oficiais por nome
  t := '{}'::jsonb;
  IF position(pref in coalesce(d#>>'{imagens,avatar,url}','')) > 0 AND d#>>'{imagens,avatar,url}' ~ '^https://' THEN
    t := t || jsonb_build_object('avatar', jsonb_build_object(
      'url', d#>>'{imagens,avatar,url}',
      'url2x', CASE WHEN position(pref in coalesce(d#>>'{imagens,avatar,url2x}',''))>0 THEN d#>>'{imagens,avatar,url2x}' END,
      'original', CASE WHEN coalesce(d#>>'{imagens,avatar,original}','') LIKE _party::text || '/%' THEN d#>>'{imagens,avatar,original}' END,
      'crop', CASE WHEN jsonb_typeof(d#>'{imagens,avatar,crop}')='object' THEN d#>'{imagens,avatar,crop}' END));
  END IF;
  IF d#>>'{imagens,capa,preset}' IN ('vidro','sessao','aneis','colares','pulseiras','brincos') THEN
    t := t || jsonb_build_object('capa', jsonb_build_object('preset', d#>>'{imagens,capa,preset}'));
  ELSIF position(pref in coalesce(d#>>'{imagens,capa,url}','')) > 0 AND d#>>'{imagens,capa,url}' ~ '^https://' THEN
    t := t || jsonb_build_object('capa', jsonb_build_object('url', d#>>'{imagens,capa,url}',
      'original', CASE WHEN coalesce(d#>>'{imagens,capa,original}','') LIKE _party::text || '/%' THEN d#>>'{imagens,capa,original}' END));
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

  -- organização: só ids no formato uuid; o catálogo real filtra na exibição
  FOR s IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d#>'{organizacao,selecoes}')='array' THEN d#>'{organizacao,selecoes}' ELSE '[]' END) x LOOP
    i := i + 1; EXIT WHEN i > 4;
    sel := sel || jsonb_build_array(jsonb_build_object(
      'titulo', left(btrim(coalesce(s->>'titulo','Seleção')), 40),
      'itens', (SELECT coalesce(jsonb_agg(DISTINCT e), '[]') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(s->'itens')='array' THEN s->'itens' ELSE '[]' END) e
                 WHERE e ~ '^[0-9a-f-]{36}$')));
  END LOOP;
  SELECT coalesce(jsonb_agg(e ORDER BY o), '["destaques","selecoes","catalogo"]'::jsonb) INTO secs
    FROM (SELECT DISTINCT ON (e) e, o FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d#>'{organizacao,secoes}')='array' THEN d#>'{organizacao,secoes}' ELSE '[]' END) WITH ORDINALITY q(e,o)
           WHERE e IN ('destaques','selecoes','catalogo') ORDER BY e, o) z;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(CASE WHEN jsonb_typeof(d#>'{organizacao,fotos}')='object' THEN d#>'{organizacao,fotos}' ELSE '{}' END) LOOP
    IF k ~ '^[0-9a-f-]{36}$' AND v ~ '^[0-9a-f-]{36}$' THEN fotos := fotos || jsonb_build_object(k, v); END IF;
  END LOOP;
  r := r || jsonb_build_object('organizacao', jsonb_build_object(
    'destaques', (SELECT coalesce(jsonb_agg(e), '[]') FROM (SELECT DISTINCT e FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d#>'{organizacao,destaques}')='array' THEN d#>'{organizacao,destaques}' ELSE '[]' END) e WHERE e ~ '^[0-9a-f-]{36}$' LIMIT 12) z),
    'ordem', (SELECT coalesce(jsonb_agg(e ORDER BY o), '[]') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d#>'{organizacao,ordem}')='array' THEN d#>'{organizacao,ordem}' ELSE '[]' END) WITH ORDINALITY q(e,o) WHERE e ~ '^[0-9a-f-]{36}$' AND o <= 500),
    'ocultas', (SELECT coalesce(jsonb_agg(DISTINCT e), '[]') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d#>'{organizacao,ocultas}')='array' THEN d#>'{organizacao,ocultas}' ELSE '[]' END) e WHERE e ~ '^[0-9a-f-]{36}$'),
    'selecoes', sel, 'secoes', secs, 'fotos', fotos));
  RETURN r;
END $$;

-- peças elegíveis de uma consultora, uma linha por variante (soma das maletas)
CREATE OR REPLACE FUNCTION public.showcase_items_for(_party uuid, _design jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY ord, x->>'produto'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'cycle_id', min(b.cycle_id::text)::uuid,
      'variant_id', v.id, 'produto', pr.name, 'slug', pr.slug, 'variante', v.label,
      'tamanho', v.size, 'cor', v.color, 'categoria', cat.name,
      'disponivel', sum(b.qty_available)::int,
      'preco_cents', public.kit_reference_price(v.id),
      'media_id', coalesce(
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id
             AND pm.media_id::text = _design#>>ARRAY['organizacao','fotos',v.id::text]),
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1)),
      'midias', (SELECT coalesce(jsonb_agg(pm.media_id ORDER BY pm.position), '[]') FROM public.product_media pm WHERE pm.product_id = pr.id)
    ) AS x,
    coalesce((SELECT o FROM jsonb_array_elements_text(coalesce(_design#>'{organizacao,ordem}','[]')) WITH ORDINALITY q(e,o) WHERE e = v.id::text), 100000) AS ord
    FROM public.kit_balances b
    JOIN public.kit_cycles c ON c.id = b.cycle_id
    JOIN public.product_variants v ON v.id = b.variant_id
    JOIN public.products pr ON pr.id = v.product_id
    LEFT JOIN public.categories cat ON cat.id = pr.category_id
    WHERE c.consultora_party_id = _party AND c.status IN ('recebida','operacao')
      AND b.is_published AND b.qty_available > 0 AND v.is_active AND pr.status = 'publicado'
      AND coalesce(public.kit_reference_price(v.id), 0) > 0
    GROUP BY v.id, pr.id, cat.name
  ) s
$$;
REVOKE EXECUTE ON FUNCTION public.showcase_items_for(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.showcase_public(_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sh public.consultant_showcases; p public.parties; dz jsonb; itens jsonb;
BEGIN
  SELECT * INTO sh FROM public.consultant_showcases WHERE slug = lower(_slug) AND is_public;
  IF sh.party_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.parties WHERE id = sh.party_id;
  dz := coalesce(sh.design_published, '{}'::jsonb);
  SELECT coalesce(jsonb_agg(e), '[]') INTO itens FROM jsonb_array_elements(public.showcase_items_for(sh.party_id, dz)) e
   WHERE NOT (coalesce(dz#>'{organizacao,ocultas}','[]') ? (e->>'variant_id'));
  RETURN jsonb_build_object(
    'slug', sh.slug,
    'nome', coalesce(nullif(dz#>>'{perfil,nome}',''), p.social_name, p.display_name),
    'headline', coalesce(nullif(dz#>>'{perfil,frase}',''), sh.headline),
    'bio', coalesce(nullif(dz#>>'{perfil,bio}',''), sh.bio),
    'whatsapp', coalesce(nullif(dz#>>'{contato,whatsapp}',''), sh.whatsapp),
    'design', dz, 'itens', itens);
END $$;

CREATE OR REPLACE FUNCTION public.showcase_design_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id(); sh public.consultant_showcases; p public.parties;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL THEN RAISE EXCEPTION 'Faça login como consultora.' USING errcode='42501'; END IF;
  IF NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Área exclusiva de consultoras.' USING errcode='42501'; END IF;
  SELECT * INTO sh FROM public.consultant_showcases WHERE party_id = eu;
  SELECT * INTO p FROM public.parties WHERE id = eu;
  RETURN jsonb_build_object(
    'party_id', eu,
    'nome_cadastro', coalesce(p.social_name, p.display_name),
    'slug', sh.slug, 'no_ar', coalesce(sh.is_public, false),
    'rascunho', CASE WHEN sh.party_id IS NULL OR sh.design_draft = '{}'::jsonb
       THEN jsonb_build_object('slug', coalesce(sh.slug,''), 'perfil', jsonb_build_object('frase', coalesce(sh.headline,''), 'bio', coalesce(sh.bio,'')),
                               'contato', jsonb_build_object('whatsapp', coalesce(sh.whatsapp,'')))
       ELSE sh.design_draft END,
    'publicado', sh.design_published, 'publicado_em', sh.design_published_at,
    'revisao', coalesce(sh.design_revision, 0),
    'itens', public.showcase_items_for(eu, coalesce(sh.design_draft,'{}')),
    'versoes', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', version_no, 'em', created_at) ORDER BY version_no DESC), '[]')
                  FROM (SELECT * FROM public.showcase_design_versions WHERE party_id = eu ORDER BY version_no DESC LIMIT 20) v));
END $$;

CREATE OR REPLACE FUNCTION public.showcase_design_save(_draft jsonb, _revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id(); sh public.consultant_showcases; limpo jsonb;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Área exclusiva de consultoras.' USING errcode='42501';
  END IF;
  limpo := public.showcase_design_clean(_draft, eu);
  SELECT * INTO sh FROM public.consultant_showcases WHERE party_id = eu FOR UPDATE;
  IF sh.party_id IS NULL THEN
    INSERT INTO public.consultant_showcases (party_id, slug, is_public, design_draft, design_revision)
    VALUES (eu, 'v-' || substr(replace(eu::text,'-',''),1,10), false, limpo, 1);
    RETURN jsonb_build_object('revisao', 1, 'rascunho', limpo);
  END IF;
  IF _revision IS DISTINCT FROM sh.design_revision THEN
    RAISE EXCEPTION 'Sua vitrine foi alterada em outra aba ou aparelho. Recarregue para continuar.' USING errcode='40001';
  END IF;
  UPDATE public.consultant_showcases SET design_draft = limpo, design_revision = sh.design_revision + 1, updated_at = now()
   WHERE party_id = eu;
  RETURN jsonb_build_object('revisao', sh.design_revision + 1, 'rascunho', limpo);
END $$;

CREATE OR REPLACE FUNCTION public.showcase_design_publish(_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id(); sh public.consultant_showcases; s text; n int; d jsonb;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Área exclusiva de consultoras.' USING errcode='42501';
  END IF;
  SELECT * INTO sh FROM public.consultant_showcases WHERE party_id = eu FOR UPDATE;
  IF sh.party_id IS NULL THEN RAISE EXCEPTION 'Configure sua vitrine antes de publicar.'; END IF;
  IF _revision IS DISTINCT FROM sh.design_revision THEN
    RAISE EXCEPTION 'Sua vitrine foi alterada em outra aba ou aparelho. Recarregue para continuar.' USING errcode='40001';
  END IF;
  d := public.showcase_design_clean(sh.design_draft, eu);
  s := d->>'slug';
  IF length(s) < 3 THEN RAISE EXCEPTION 'Escolha um endereço com pelo menos 3 letras.'; END IF;
  IF public.showcase_slug_reserved(s) THEN RAISE EXCEPTION 'Este endereço é reservado pelo site.'; END IF;
  IF EXISTS (SELECT 1 FROM public.consultant_showcases WHERE slug = s AND party_id <> eu) THEN
    RAISE EXCEPTION 'Este endereço já está em uso por outra consultora.';
  END IF;
  IF length(d#>>'{contato,whatsapp}') < 10 THEN RAISE EXCEPTION 'Informe seu WhatsApp com DDD antes de publicar.'; END IF;
  IF sh.design_published IS NOT DISTINCT FROM d AND sh.slug = s THEN
    RETURN jsonb_build_object('repetido', true, 'slug', s);
  END IF;
  SELECT coalesce(max(version_no),0)+1 INTO n FROM public.showcase_design_versions WHERE party_id = eu;
  INSERT INTO public.showcase_design_versions (party_id, version_no, design, published_by) VALUES (eu, n, d, auth.uid());
  UPDATE public.consultant_showcases SET
    slug = s, design_published = d, design_published_at = now(), is_public = true,
    headline = nullif(d#>>'{perfil,frase}',''), bio = nullif(d#>>'{perfil,bio}',''),
    whatsapp = d#>>'{contato,whatsapp}', updated_at = now()
   WHERE party_id = eu;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'vitrine.publicada', 'consultant_showcases', eu, jsonb_build_object('versao', n, 'slug', s));
  RETURN jsonb_build_object('versao', n, 'slug', s);
END $$;

CREATE OR REPLACE FUNCTION public.showcase_design_discard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id(); sh public.consultant_showcases;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Área exclusiva de consultoras.' USING errcode='42501';
  END IF;
  SELECT * INTO sh FROM public.consultant_showcases WHERE party_id = eu FOR UPDATE;
  IF sh.design_published IS NULL THEN RAISE EXCEPTION 'Ainda não há versão publicada para voltar.'; END IF;
  UPDATE public.consultant_showcases SET design_draft = sh.design_published, design_revision = sh.design_revision + 1
   WHERE party_id = eu;
  RETURN jsonb_build_object('revisao', sh.design_revision + 1);
END $$;

CREATE OR REPLACE FUNCTION public.showcase_design_restore(_version uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id(); v public.showcase_design_versions; rev int;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Área exclusiva de consultoras.' USING errcode='42501';
  END IF;
  SELECT * INTO v FROM public.showcase_design_versions WHERE id = _version AND party_id = eu;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Versão não encontrada.'; END IF;
  UPDATE public.consultant_showcases SET design_draft = v.design, design_revision = design_revision + 1
   WHERE party_id = eu RETURNING design_revision INTO rev;
  RETURN jsonb_build_object('revisao', rev);
END $$;

CREATE OR REPLACE FUNCTION public.showcase_set_online(_no_ar boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id(); sh public.consultant_showcases;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Área exclusiva de consultoras.' USING errcode='42501';
  END IF;
  SELECT * INTO sh FROM public.consultant_showcases WHERE party_id = eu FOR UPDATE;
  IF _no_ar AND sh.design_published IS NULL THEN RAISE EXCEPTION 'Publique sua vitrine primeiro.'; END IF;
  UPDATE public.consultant_showcases SET is_public = _no_ar WHERE party_id = eu;
  RETURN jsonb_build_object('no_ar', _no_ar);
END $$;

REVOKE EXECUTE ON FUNCTION public.showcase_design_get(), public.showcase_design_save(jsonb,integer),
  public.showcase_design_publish(integer), public.showcase_design_discard(), public.showcase_design_restore(uuid),
  public.showcase_set_online(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.showcase_design_get(), public.showcase_design_save(jsonb,integer),
  public.showcase_design_publish(integer), public.showcase_design_discard(), public.showcase_design_restore(uuid),
  public.showcase_set_online(boolean) TO authenticated;