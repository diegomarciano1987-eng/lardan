# Consultora — vidro etapa 2 — 25/10/2026

## Escopo
- Somente a conta piloto Diego Silva, identificada pela sessão autenticada.
- Todas as dez abas da consultora, no celular primeiro e também no desktop.
- Posições, consultas, permissões, dados e regras operacionais preservados.
- A vitrine pública e os documentos de impressão não foram redesenhados.

## Alterações
- Tokens semânticos de vidro, texto claro, rosé, campos escuros e superfícies translúcidas.
- Cabeçalho e navegação inferior móveis com vidro fosco; menu lateral móvel rolável.
- Escopo temporário no corpo da página para menus, diálogos e seletores que abrem fora da tela principal. Removido ao sair da área da consultora.
- Rolagem nativa fina com trilha transparente, eliminando a faixa branca exibida na referência. Rolagem por toque, roda e teclado preservada.

## Provas
- Navegação por controles reais em 390×844, 360×800 e 1590×889.
- Início, Clientes, Pedidos, Maleta, Vitrine, Histórico, Indicações, Biblioteca e Nova venda: piloto ativo em todas as larguras. Mais conferido nas duas larguras móveis.
- Nenhum transbordamento horizontal nas telas verificadas; nenhum erro de execução do navegador.
- Início leu dados reais: 3 clientes, 2 pedidos abertos e 4 pedidos no mês.
- Pedidos leu pedidos existentes; Nova venda exibiu as clientes reais. Nenhuma venda, alteração de cliente ou publicação de vitrine foi executada.
- Maleta, histórico e Biblioteca exibem estados vazios reais desta conta; fluxos com maleta operacional e conteúdo publicado não puderam ser exercitados sem dados disponíveis.
- Barra do menu desktop: `scrollbar-width: thin`, trilha transparente; captura conferida sem faixa branca.
- Saída para Equipe removeu o escopo visual nas três larguras.
- Capturas e registro de navegação em `/tmp/browser/glass-etapa2`.
- 14 testes aprovados: isolamento do piloto, regras da consultora e comissão por remessa. Sinal automático de compilação: build OK.
- Não publicado.