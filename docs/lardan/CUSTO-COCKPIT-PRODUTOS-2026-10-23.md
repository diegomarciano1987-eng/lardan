# Preço de custo no cockpit de produtos — 23/10/2026

## Pedido
Diego: 99% dos produtos têm preço de custo importado, mas o custo não aparecia no
cockpit de produtos — só o preço de venda.

## Diagnóstico (base compartilhada, somente leitura)
- 17.022 produtos; 16.986 com `cost_price_cents` preenchido (99,78%); 36 sem custo.
- A lista de produtos (`/admin/cadastros/produtos`, aba Lista) não trazia nem exibia o custo.
- A ficha já lia custos pela rotina autorizada `product_costs_read`, mas os campos de
  custo/margem/bruto apareciam vazios para perfis sem `catalog.cost.view`.
- Permissão `catalog.cost.view` no banco: apenas Master, Diretoria e Financeiro.
  Marketing, suporte, estoque, montagem e qualidade acessam a lista, mas não podem ver custo.

## O que mudou (somente telas; nenhuma migração, nenhum dado alterado)
1. `src/routes/_authenticated/admin/cadastros/produtos.tsx`
   - Nova coluna **Custo** na lista, visível só para quem tem `catalog.cost.view`.
   - Os custos chegam por `product_costs_read` (uma chamada por produto da página),
     nunca pelo select da lista — mesmo padrão de sigilo da ficha.
   - Produto sem custo mostra "—" (nunca zero inventado).
2. `src/components/admin/ProdutoFicha.tsx`
   - Campos **Preço de custo**, **Margem deste produto**, **Valor da peça no bruto** e o
     bloco de **preço sugerido** só aparecem para quem tem `catalog.cost.view`.
   - Demais perfis veem o aviso: "Custo, margem e preço sugerido ficam visíveis apenas
     para Master, Diretoria e Financeiro." Preço de venda e margem praticada continuam
     visíveis (não revelam custo).

## Provas
- Teste novo `tests/isolado/produto-custos-tela.test.ts` (4/4):
  1. `catalog.cost.view` existe só para Master, Diretoria e Financeiro;
  2. os três perfis leem o custo importado pela rotina autorizada;
  3. estoque, marketing e consultora são recusados;
  4. produto sem custo devolve vazio, não zero.
- Suíte isolada completa: **358 aprovados, 0 falhas, 1.764 asserções, 31 arquivos**.
- `tsgo --noEmit` limpo; sinal automático de compilação: **build OK** (13:53:54 UTC).
- Tela real como Master (Diego Marciano): lista com 20/20 linhas mostrando a coluna
  CUSTO preenchida (ex.: HOMOLOG Peça vitrine … 20,00; PUL DOU PRIME ELOS GOTAS … 1,00).
  Prints em `/mnt/documents/custo-produtos/`.

## Conferência dos dados importados
- 16.537 produtos com custo acima de R$ 1; 355 com exatamente R$ 1,00; 94 abaixo de
  R$ 1; 36 sem custo. Os R$ 1,00 vistos na primeira página são os registros mais
  antigos (ordem por criação) — não indicam falha na importação.

## Achado pré-existente (não alterado — aguarda decisão do Diego)
- A coluna `products.cost_price_cents` não tem restrição de coluna no banco: qualquer
  perfil com `catalog.view` (e até visitante, para produtos publicados) consegue ler o
  custo por consulta direta à API, fora das telas. As telas não expõem, mas a API sim.
  Corrigir exige revogar a coluna no banco (mudança de esquema) — só com aprovação.

## Não publicado
Nada foi publicado; a mudança vale no site só após publicação aprovada.
