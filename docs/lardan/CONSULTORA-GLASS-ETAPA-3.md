# Consultora — vidro etapa 3

## Escopo
- Somente o piloto autenticado Diego Silva, priorizando celular; nenhuma alteração de consulta, permissão, valor, gravação ou posição de ação.
- Cartões do Início: fundo consistente para texto, reflexos discretos e arestas nas quatro cores existentes.
- Ações principais: vidro rosé fumê com reflexos, borda iluminada e texto claro, substituindo fundos rosé chapados. Abrange Nova venda, Nova cliente, Salvar na Jornada e famílias existentes de ações principais/secundárias, inclusive portais no escopo temporário.
- Barra fixa do formulário recebe vidro e elimina a faixa sólida escura. Foco visível, movimento reduzido e preferência de contraste ampliado preservados.

## Evidências
- Playwright com sessão real Diego Silva: 390×844, 360×800, 1590×889 e 1280×1800.
- Início leu os dados existentes: 3 clientes, 2 pedidos abertos, 4 pedidos no mês e 0 peças disponíveis.
- Meus pedidos abriu pedidos reais; retorno ao Início funcionou; Nova venda → Nova cliente abriu o formulário; Salvar na Jornada foi inspecionado sem enviar ou cadastrar ninguém.
- Botão Nova cliente apresentou duas camadas de reflexo, fundo translúcido e blur de 18px; textos claros e bordas conferidos nas capturas mobile/desktop.
- Preferência de contraste ampliado substituiu o fundo dos indicadores por superfície opaca.
- Sem transbordamento horizontal nem erros de execução em quatro larguras. Ao sair para /equipe, o escopo do corpo foi removido.
- 14 testes aprovados: glass-escopo, regras e comissao-maletas. Sinal automático build OK após as alterações.
- Capturas e scripts em /tmp/browser/glass-etapa3; resultados em buttons-results.txt e tests-final.txt.

## Limitações
- Ganhos e peças de maleta não apareceram nesta conta; não foram fabricados dados nem operações para inspecionar estados indisponíveis.
- Legibilidade conferida visualmente; não foi executada certificação integral WCAG de todos os estados e telas.
- Sem publicação; o site oficial permanece inalterado.