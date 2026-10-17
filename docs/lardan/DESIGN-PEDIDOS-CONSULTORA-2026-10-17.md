# Pedidos da consultora — melhoria visual

- Cartões reorganizados com identidade da cliente, número do pedido, situação, idade, valor em destaque, quantidade e data.
- Ação principal separada das ações secundárias; cancelamento permanece em menu com confirmação.
- Resumos por situação mostram quantidade e total; duas colunas no desktop amplo e uma no celular.
- Detalhe de peças com hierarquia de nome, variante, quantidade e total.
- Nenhuma regra de pagamento, classificação, prazo ou mutação foi alterada; nenhum pedido criado, cancelado ou atualizado.

## Conferência
Quatro testes de regras aprovados; compilação OK.
Capturas: `/tmp/browser/pedidos-design/desktop.png`, `pedidos-390.png`, `pedidos-1156.png`, `mobile-pagamento.png`, `mobile-menu.png`.
390×844 e 1156×702 sem transbordamento horizontal; zero erros de execução na captura final. Troca de aba e abertura/fechamento do menu conferidas sem ações de gravação.

## Limite da prova
A sessão Master não abre o portal da consultora. Para conferir somente o visual, o componente real foi montado temporariamente no navegador, com 13 pedidos retornados pela leitura autorizada `orders_list` dessa sessão. Não foram alterados acesso, permissões, código de autenticação ou dados. A captura comprova o componente e as dimensões, não o fluxo completo autenticado no portal da consultora. As tentativas de preparação da captura falharam por diferença entre instâncias carregadas dos módulos; o script final usa as mesmas instâncias da prévia e terminou sem erros.

Não publicado.