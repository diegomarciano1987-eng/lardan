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

## Lote 2 — backend real (Playwright 1280x1800, http://localhost:8080)

- `/admin` sem sessão → redirecionado para `/acesso` (rota agora sob `_authenticated`, `ssr: false`).
- `/acesso` renderiza login por e-mail/senha e botão "Entrar com Google" (provedor Google configurado).
- `/seja-lardan?utm_source=teste&utm_campaign=lote2` → candidatura gravada, protocolo devolvido (`CAP-AAAAMMDD-XXXXXXXX`).
- `/contato` → mensagem gravada, protocolo devolvido (`CON-AAAAMMDD-XXXXXXXX`).
- Console sem erros.
- Registros de teste removidos do banco após a verificação.

### Decisão técnica
`INSERT ... RETURNING` é bloqueado pela RLS para visitantes (sem política de SELECT, por
projeto). Os envios públicos passam a usar as funções `submit_lead` e
`submit_contact_request` (SECURITY DEFINER, validação de nome/contato/UF/consentimento,
truncamento de campos), que devolvem apenas o protocolo. Visitantes continuam sem
qualquer leitura das tabelas `leads` e `contact_requests`.

### Warnings do linter
`Public/Signed-In Users Can Execute SECURITY DEFINER Function` — esperados: são as duas
funções de envio público e as funções de verificação de permissão usadas pelas políticas
de RLS. Nenhuma delas expõe dados de terceiros.

## Fundos mobile + véu de leitura (392x719, Playwright, dpr 2)
- Hero, sessão 2 e categorias Anéis/Pulseiras/Brincos usam imagens verticais exclusivas no celular via `<picture>` + `media="(max-width: 767px)"`; Colares segue com a imagem padrão (sem versão mobile enviada).
- Textos no mobile: véu escuro suave (gradiente oklch 0.18) com backdrop blur de 6px e máscara de fade, ativado junto com o texto; cor do texto clara só no mobile (`max-md:text-background`).
- Desktop inalterado (véu marfim original). Console sem erros.

## Refino mobile (392x719): menu, véu e lados do texto
- Menu mobile: vidro fosco premium (bg-background/40 + backdrop-blur-2xl, borda fina, cantos arredondados, sombra suave).
- Véu escuro dos textos: blur 6px→3px, área útil 55%→38% e fade em 62% (não invade mais a imagem); opacidade 0.62→0.45.
- Lados invertidos nas categorias: Colares→esquerda, Pulseiras→direita, Brincos→esquerda (texto fora das peças). Anéis mantido à esquerda.
- Verificado com Playwright, console sem erros.
