# Miniatura de foto em toda lista de produtos + remoção das fotos feitas por IA

## O que encontrei (provas no banco)
- 13.104 fotos reais enviadas hoje pelo seu programa (pasta de fotos do catálogo).
- 40 fotos feitas por IA (criadas em 07/09/2026), ligadas a **20 produtos de demonstração publicados no site** (Pulseira Riviera, Anel Solenne, Colar Lumière, Brinco Serena Argola etc.).
- Nenhum desses 20 produtos tem foto real nem referência. Depois que as fotos de IA saírem, eles ficam sem foto.
- A tela de Estoque já mostra miniatura (saldos, movimentações e reservas). As outras telas, não.

## Parte 1: remover as fotos de IA
- Tirar as 40 fotos de IA dos 20 produtos e apagar os arquivos.
- Antes de apagar, guardar uma cópia do registro de cada uma e anotar a remoção no histórico de auditoria.
- As 13.104 fotos reais não serão tocadas. Fotos do site que não são de produto (capa, categorias, consultoras, Daniel) ficam como estão.
- **Decisão sua:** esses 20 produtos de demonstração devem sair do site (despublicar) ou continuar no ar sem foto?

## Parte 2: miniatura em todas as listas
Um mesmo quadrinho de foto (cerca de 40 px, com um ícone discreto quando não houver foto) entra em:
1. Cadastros → Produtos (lista, visão geral e pendências)
2. Dar entrada ou saída e ajustar estoque (janela de movimentação e painel do item)
3. Bipagem para entrada ou transferência da loja
4. PDV: resultado da busca, carrinho e histórico de vendas
5. Maletas: montagem (leitor), itens da maleta, movimentações e acerto
6. Criar ou montar maleta (busca e escolha de peças)
7. Portal da Consultora: itens da maleta, pedidos e catálogo dela
8. Pedidos de venda e conferência (itens)
9. Busca do topo do sistema (resultados de produto)

Regras:
- As fotos são pedidas em grupo só para as linhas que aparecem na tela (no máximo 50 por página), e cada foto fica guardada na memória da tela por 1 hora. Assim as telas não ficam mais lentas.
- Produto sem foto continua sem foto. Nada é inventado.
- No celular da consultora, a miniatura respeita a tela pequena.

## Provas que vou entregar
- Contagem antes e depois no banco: 40 fotos de IA viram 0, e as 13.104 reais continuam 13.104.
- Uma captura de cada tela da lista acima mostrando as miniaturas.
- O carregamento com o site rodando no navegador: nenhum erro e no máximo um pedido de fotos por página.

## Detalhes técnicos
- Componente compartilhado `ProdutoMiniatura` e hook `useFotosProdutos(productIds)`, que busca a capa (position 0) via product_media/media_assets e gera URLs assinadas em lote. Reaproveita a lógica que já existe em estoque.tsx.
- RPCs de lista que não devolvem `media_path` ganham esse campo pela capa (migração aditiva).
- Remoção: backup em fin_expurgo_backup/audit_logs, depois remoção de product_media, media_assets e storage para `catalogo/lardan-*`.
