# LARDAN — Inventário de Ações (botões, links, filtros, formulários)

Contagem desta fase (Lote 0/1):
- Ações documentadas na matriz do site/admin: 34
- Implementadas (não testadas ainda): 15
- Testadas: 0
- Bloqueadas por asset/decisão: 2

## Implementadas no Lote 1

| ACTION-ID | Tipo | Local | Destino/efeito | Handler real? |
| --- | --- | --- | --- | --- |
| NAV-ALARDAN | link | menu topo | /a-lardan | sim |
| NAV-SEMIJOIAS | link | menu topo | /semijoias | sim |
| NAV-COLECAO | link | menu topo | /colecoes | sim |
| NAV-CANDIDATURA | link | menu topo | /seja-lardan | sim |
| NAV-CONTATO | link | menu topo | /contato | sim |
| NAV-MOBILE-TOGGLE | botão | cápsula mobile | abre/fecha menu com os mesmos 5 destinos | sim |
| HERO-SCROLL-D1..D4 | efeito de scroll | / | estados diamante → névoa → wordmark → editorial | sim |
| HERO-CTA-SEMIJOIAS | link | hero editorial | /semijoias | sim |
| CTA-CATEGORIA-ANEIS | link | cena de categoria | /semijoias/aneis | sim |
| CTA-CATEGORIA-COLARES | link | cena de categoria | /semijoias/colares | sim |
| ACESSO-DISCRETO | link | rodapé | /acesso | sim |
| SKIP-LINK | link | topo | pula para conteúdo principal | sim |

Nenhum botão de pagamento, carrinho, checkout ou operação de ERP está presente ou visível nesta fase.

## Ações explicitamente ausentes por decisão

- Comprar / Adicionar ao carrinho: ausentes enquanto não houver fluxo transacional aprovado (V/5.2).
- Pagar, Emitir nota, Baixar estoque, Liquidar, Sangria: não existem na UI atual (V/8).
