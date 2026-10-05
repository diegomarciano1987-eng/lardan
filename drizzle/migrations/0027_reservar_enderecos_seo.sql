CREATE OR REPLACE FUNCTION public.showcase_slug_reserved(_slug text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(_slug) = ANY (ARRAY[
    'admin','api','acesso','carrinho','contato','colecoes','colares','brincos','aneis',
    'pulseiras','semijoias','produto','seja-lardan','a-lardan','consultora','consultoras','vitrine',
    'sitemap.xml','robots.txt','llms.txt','assets','static','login','sair','painel','app',
    'equipe','minha-conta','ajuda','convite','redefinir-senha','d','lovable','representante',
    'financeiro','como-comecar-a-vender-semijoias','como-vender-semijoias-pelo-whatsapp',
    'renda-extra-com-vendas','semijoias-consignadas-para-revenda','sitemap-pages.xml',
    'sitemap-products','lardan','lardan-oficial','oficial','suporte','sac','loja','indica','indicacao',
    'privacidade','perguntas-sobre-revenda-de-semijoias','como-cuidar-de-semijoias',
    'semijoia-folheado-ou-bijuteria'])
  OR EXISTS (SELECT 1 FROM public.categories WHERE slug = lower(_slug))
  OR EXISTS (SELECT 1 FROM public.collections WHERE slug = lower(_slug))
  OR EXISTS (SELECT 1 FROM public.pages WHERE slug = lower(_slug))
  OR EXISTS (SELECT 1 FROM public.showcase_slug_history h
             WHERE h.slug = lower(_slug) AND h.party_id IS DISTINCT FROM public.my_party_id())
$$;
REVOKE EXECUTE ON FUNCTION public.showcase_slug_reserved(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.showcase_slug_reserved(text) TO authenticated;