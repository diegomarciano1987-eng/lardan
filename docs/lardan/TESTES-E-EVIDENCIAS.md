# LARDAN — Testes e Evidências

Distinção obrigatória: EXECUTADO | INSPECIONADO | NÃO TESTADO. Nada aqui é marcado como testado por leitura de código.

## Lote 0/1

| Caso | Método | Resultado |
| --- | --- | --- |
| Build do projeto | EXECUTADO (build automático da plataforma) | ver checkpoint em PROGRESSO.md |
| Assets no CDN (6 ponteiros .asset.json) | EXECUTADO (CLI lovable-assets) | 6 ponteiros criados; 4 imagens editoriais + diamante + logo completa |
| Favicon derivado do diamante original | EXECUTADO | public/favicon.png 64×64 gerado; favicon.ico padrão removido |
| Hero em 360/390/768/1280/1440 px | NÃO TESTADO | pendente Lote 5 |
| Navegação por teclado e foco visível | NÃO TESTADO | pendente Lote 5 |
| prefers-reduced-motion | INSPECIONADO (implementado via media query) | pendente verificação executada |
| 404 real em slug inexistente | NÃO TESTADO | pendente Lote 5 |
| Persistência de formulários | NÃO APLICÁVEL AINDA | backend no Lote 2 |
| Isolamento de dados/RLS | NÃO APLICÁVEL AINDA | backend no Lote 2 |
| Performance (LCP/INP/CLS) | NÃO MEDIDO | sem medição, nenhuma nota declarada |

Nenhuma screenshot, nota de Lighthouse, resultado de query ou teste E2E foi inventado.

## Lote 1 — Verificação em navegador (Playwright, 1280x1800 e 390x844)
- Home `/` renderiza os três estados do hero: diamante nítido (topo), wordmark LARDAN isolado (~50% do scroll do hero), editorial com tagline e CTA (~85%).
- Cenas de categoria Anéis e Colares renderizam com as imagens enviadas; editorial "Peças para os seus momentos" com a imagem conceitual.
- Menu mobile abre/fecha via botão, com itens de navegação acessíveis.
- Evidências: /tmp/browser/lardan/screenshots/1_hero_top.png, 3_wordmark.png, 4_editorial.png, 5_categories.png, 7_mobile_menu.png.

## Lote 1.1 — Revisão de direção (Playwright, 1280x900)
- Hero: diamante avança na câmera, gira e se dissolve em estouro de luz (sem véu rosé); wordmark LARDAN aparece sobre fundo limpo. EXECUTADO — /tmp/browser/lardan2/2_transicao.png, 3_wordmark.png.
- Segunda sessão: imagem sessao_2-2 revelada por lâminas verticais em cascata; textos "Semijoias / Única. Como cada história. / Semijoias para acompanhar os seus momentos. / Conhecer semijoias". EXECUTADO — 5_sessao2_texto.png.
- Categorias Anéis, Colares, Pulseiras e Brincos em tela cheia com imagem de fundo, sem card nem sombra. EXECUTADO — 6_aneis.png, 7_pulseiras.png.
- Menu sem cápsula/card: apenas linha fina sob o item ativo/hover. EXECUTADO (visível em todas as capturas).
- Console do navegador sem erros. EXECUTADO.
