# Para o Lovable — 0126: banho no material bruto, custo pelo banho e reclassificação do catálogo

Aplique exatamente como está. Não renomeie funções e não mude mensagens. Não publique a interface sem a minha aprovação. A reclassificação só roda com `true` depois que eu aprovar a prévia.

## 1. O que entra

### Banco: `drizzle/migrations/0126_banho_e_categoria.sql`

Pode renumerar; o conteúdo é o mesmo. Não apaga nada, não remove coluna e pode rodar duas vezes.

- Colunas novas em `products`:
  - `banho_tipo`: dourado, ródio branco, prata banhada, prata 925 ou aço inox;
  - `banho_camada`: dourado 1, 2, 3, 5 ou 7; prata banhada 30 ou 70;
  - `banho_valor_grama_cents`: é custo, então não entra na leitura direta; só por `product_costs_read`;
  - `custo_pelo_banho`;
  - `banho_origem`: cadastro ou descricao.
- Preço de custo = peso bruto (g) × valor do banho por grama + valor da peça no bruto.
  - Vale só para cadastro novo, para produto ainda sem custo e para o que já é calculado assim.
  - Produto que já tem preço de custo NÃO muda.
  - A conta é feita no banco, pelo gatilho `trg_products_custo_pelo_banho`.
- `product_banho_salvar(...)`: grava tipo e camada; o valor do banho só é gravado para quem vê custos. Fica auditado.
- `product_costs_read` passa a devolver também `banho_valor_grama_cents` e `custo_pelo_banho`.
- `produto_classificar_nome(nome)`: lê a descrição e sugere banho e categoria. Não grava nada.
  - Banho: DOU/DOURADO → dourado; PR/PRATA → prata banhada; PR925/925 → prata 925; RODIO → ródio branco; AÇO/INOX → aço inox. Só a palavra AÇO inteira conta: LAÇO e TRAÇOS ficam fora.
  - Categoria: BR/BRINCO/ARGOLA → Brinco; GR/COLAR/GARGANTILHA → Colar; AN/ANEL → Anel; PUL/PU/PULSEIRA → Pulseira; TN → Tornozeleira; BC → Bracelete; PG → Pingente; CJ → Conjunto; PC → Piercing; BQ → Berloque.
- `produto_reclassificar(_aplicar, _corrigir_divergentes)`:
  - por padrão só faz a prévia;
  - com `_aplicar = true`, preenche o banho e a categoria só onde estão vazios;
  - não toca no banho escolhido no cadastro;
  - categoria diferente da sugerida só muda com `_corrigir_divergentes = true`;
  - categoria que faltar é criada como rascunho, fora do site até eu publicar;
  - cada mudança fica registrada em `produto_reclassificacao`, com lote.
- `produto_reclassificacao_desfazer(lote)` desfaz um lote inteiro.

### Interface

- `src/components/admin/ProdutoFicha.tsx`: no card "Material bruto" entram "Tipo do banho", "Camada do banho" (opções conforme o banho) e "Valor do banho por grama (R$)", este só para quem vê custos, com a conta mostrada embaixo. No card "Preço", quando a conta vale, o preço de custo aparece calculado e travado.
- `src/lib/produto.ts`: `BANHOS`, `custoPeloBanho`, `salvarBanho`, `rotuloBanho`.
- `src/routes/_authenticated/admin/cadastros/produtos.tsx`: coluna "Banho" na lista.

### Testes

`tests/isolado/produto-banho.test.ts` (novo). Esperado: `bash tests/isolado/subir.sh && bun test tests/isolado` → 383 pass, 0 fail.

### AGENTS.md

Acrescente a regra: "Product banho (0126): banho_tipo/banho_camada on products (dourado 1/2/3/5/7, prata_banhada 30/70); banho_valor_grama_cents is cost (read only via product_costs_read); cost = raw_weight_grams × banho_valor_grama_cents + raw_piece_cost_cents only when custo_pelo_banho or the product has no cost yet — existing costs never change; catalog reclassification only via produto_reclassificar (preview first, Master approval, fills empty fields only, logged in produto_reclassificacao, undo by lote)."

## 2. Prévia (só leitura). Rode e me devolva o resultado inteiro

```sql
select jsonb_pretty(public.produto_reclassificar(false));
```

Não rode com `true` ainda.

## 3. Depois da minha aprovação

```sql
select jsonb_pretty(public.produto_reclassificar(true));            -- só o que está vazio
-- se eu pedir para corrigir também as categorias divergentes:
-- select jsonb_pretty(public.produto_reclassificar(true, true));
```

Me devolva o lote e os números. Para desfazer: `select public.produto_reclassificacao_desfazer('<lote>');`

## 4. Conferência na tela (como Master)

- Abra "Novo produto". Preencha peso bruto 2,5, valor da peça no bruto 10,00, tipo do banho Dourado, camada 3 e valor do banho 3,00. O preço de custo tem que aparecer calculado: R$ 17,50. Salve o rascunho e confira que o custo ficou R$ 17,50.
- Abra um produto antigo que já tem preço de custo, escolha um banho e salve. O preço de custo tem que continuar o mesmo.
- Na lista de produtos, a coluna "Banho" aparece.
