# LARDAN — Rodada técnica de lançamento (domínio oficial)

- [x] Atualizar a segunda seção da Home e criar o painel compartilhado Ecossistema Lardan.

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
- [x] 24. llms.txt substituído pelo documento oficial aprovado (domínio derivado
      de SITE_URL, sem URLs manuais)

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
- [x] Ecossistema Lardan — card "Sua vitrine digital": título agora é
      "Você terá uma página própria para vender seus produtos." (texto
      aprovado do cliente, 18/09/2026). Os demais cards permanecem como estão.
- [x] Ecossistema Lardan — duas frentes novas no painel: "Suas finanças
      pessoais" (controle das finanças pessoais da consultora) e
      "Universidade corporativa" (formação de vendas da Lardan Academy),
      além de faixa de fechamento com "Quero me candidatar"
      (18/09/2026). Painel passou de 4 para 6 blocos.

- [x] Ecossistema Lardan — card "Sua vitrine digital" com a cópia oficial: "Você terá uma página própria na internet para vender suas semijoias." + "Uma webpage gratuita focada em vendas que vai lhe ajudar a vender." (fonte única em src/lib/seja-lardan-conteudo.ts; vale no pop-up e na seção #ferramentas)

- [x] Rodada de segurança das maletas: isolamento por pessoa, bloqueio de escrita direta, aceite exato, concorrência e busca no servidor (docs/lardan/MALETAS-SEGURANCA.md)
- [x] Fechamento técnico: autorização de `order_set_status` e `showcase_save`, rotina de vencimento de reservas alcançável só pelo serviço, idempotência sob duplo clique simultâneo, permissões de execução revisadas, suítes regularizadas (253/253) e plano de recuperação (seção 7 do mesmo relatório)
- [ ] Publicar a interface para alinhar o site publicado às novas regras do banco (aceite detalhado e depósito de origem)
- [ ] Integração financeira com o Asaas (próxima etapa)
- [ ] Retorno de maleta, acerto Lardan x consultora e conclusão comercial do pedido
- [ ] Agendador do vencimento de reservas (rotina pronta, sem agendamento)


- [x] Etapa 1 — histórico de movimentações da maleta: acréscimo, retorno por destino,
      confirmação pela Matriz, histórico imutável e conferência por produto
      (docs/lardan/MALETAS-MOVIMENTACOES.md; 15 testes do cenário 50+5-20, suíte 268/268)
- [ ] Etapa 1b — telas de acréscimo, retorno, histórico e conferência (rotinas prontas no banco)
- [ ] Etapa 2 — conferência e preparação de acerto (depende da regra comercial, ainda não definida)
- [ ] Etapa 3 — importação e sincronização Asaas (sandbox primeiro)
- [ ] Etapa 4 — camada fiscal preparada e inativa

- [x] Integridade das movimentações: repetição segura (autorização antes da resposta e
      chave que cobre a operação inteira), conferência real do retorno (declarado ×
      recebido × aprovado × divergente), garantia/defeito em local bloqueado fora do
      estoque disponível, acréscimo por representante com autorização específica
      (seção 5 de docs/lardan/MALETAS-MOVIMENTACOES.md)
- [x] Etapa 1b — telas de conferência por peça, histórico, acréscimo, confirmação de
      recebimento, declaração de retorno e conferência da Matriz (na pré-visualização;
      valem no site publicado só após publicação)
- [x] Etapa 4 (preparação) — preços versionados, camada fiscal e base do Asaas criadas e
      desligadas (docs/lardan/FISCAL-E-ASAAS-PREPARACAO.md)
- [x] Testes desta rodada executados no banco local isolado (ver VALIDACAO-ISOLADA.md)
- [x] Fechamento da interface e preparação de publicação: conceitos separados na conferência,
      estouro no celular corrigido, chave de repetição estável nos formulários, comparação
      código × isolado × compartilhado sem diferenças, recusa de chamada manipulada
      comprovada no navegador (docs/lardan/PUBLICACAO-MALETAS.md) — publicação não feita

- [ ] Regra do "um terço": pendente de esclarecimento comercial/fiscal; registrada sem efeito
- [ ] Adaptador Asaas com simulações locais (próxima etapa)

- [x] Validação em ambiente isolado (banco local, dados sintéticos): 41 testes aprovados — integridade das movimentações (28) e inertância fiscal/Asaas com reaproveitamento do financeiro (13). Falha encontrada e corrigida: liberação de peças bloqueadas era recusada a quem tinha a permissão. Evidências em docs/lardan/VALIDACAO-ISOLADA.md; reprodução em tests/isolado/LEIA-ME.md.

## Fechamento final da preparação Asaas — 23/09/2026
- [ ] Tornar migrações pendentes atômicas e remover qualquer janela com rotinas inseguras.
- [ ] Unificar estado da conta e resolver conta, ambiente e segredo exclusivamente no servidor.
- [ ] Corrigir importação comum, lote por conta e cursor bruto do provedor.
- [ ] Coordenar criação de cliente por conta+pessoa entre processos.
- [ ] Completar classificação de falhas, retomadas e links por conta correta.
- [ ] Preparar manipulador de webhook inativo e testável.
- [ ] Validar banco isolado, tipos e navegador em todos os perfis exigidos.
- [ ] Atualizar documentação e gerar pacote final com manifesto e evidências reais.
- [ ] Sonho da candidata no formulário Seja LARDAN + ficha (teste)
- [ ] Botão tela cheia no Leitor de entrada e na Entrada de maleta
- [ ] Busca de consultoras na Entrada de maleta alcançar as 5 mil
