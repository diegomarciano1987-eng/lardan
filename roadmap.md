# LARDAN — Rodada técnica de lançamento (domínio oficial)

- [x] 1. SITE_URL → https://www.lardan.com.br (fonte única)
- [x] 2. robots.txt e llms.txt gerados por server route a partir de SITE_URL
- [x] 3. Canonical/og:url absolutos em todas as páginas públicas
- [x] 4. Metadados centralizados (pageMeta/canonical/abs/ogImageMeta)
- [x] 5. ogImageMeta com dimensões reais + og:image:alt / twitter:image:alt
- [x] 6. Organization.logo separado da imagem social
- [x] 7. SSR real de /semijoias (categorias + 1ª página)
- [x] 8. SSR real de /semijoias/$categoria (detalhe + 1ª página)
- [x] 9. CollectionPage + BreadcrumbList + ItemList server-side, URLs absolutas
- [x] 10. Product JSON-LD real em /produto/$slug
- [x] 11. OG image real do produto (abs(mediaUrl))
- [x] 12. Categoria vazia → noindex,follow e fora do sitemap
- [x] 13. /colecoes → noindex,follow e fora do sitemap (nenhuma coleção publicada)
- [x] 14. Sitemap index + paginação + lastmod real dos guias
- [x] 15. Fonte DataReportal no guia de renda extra
- [x] 16. error-page.ts em pt-BR
- [x] 17. First touch persiste gclid/fbclid/msclkid
- [x] 18. Tracking redundante removido do SejaLardanForm
- [x] 19. Hero da Home com <picture> WebP
- [x] 20. Imagem editorial "produto" → WebP 1600x900
- [x] 21. Vídeos do Seja Lardan com IntersectionObserver + prefers-reduced-motion
- [x] 22. theme-color / apple-touch-icon
- [x] 23. Build, testes (237), provas

## Pendências (dependem do cliente / jurídico)

- [ ] Política de privacidade: não existe texto oficial aprovado no projeto.
      Os formulários gravam privacy_version 2026-09-05.v1 e citam o aviso, mas
      não há página publicada. NÃO INVENTAR. Precisa do texto jurídico real
      cobrindo: dados cadastrais, candidatura, IP, user-agent, UTMs e
      identificadores de campanha, consentimento de marketing, finalidades,
      direitos do titular, canal de contato, retenção e compartilhamentos.
- [ ] Termos de uso: mesma situação, sem documento oficial.
- [ ] lastmod de produtos/categorias: a RPC pública não expõe updated_at.
      Preferimos omitir a data a inventá-la.
- [ ] Redirecionamento apex→www responde 302 (controle da plataforma de
      hospedagem, não do código). Canonical absoluto já aponta para www.
