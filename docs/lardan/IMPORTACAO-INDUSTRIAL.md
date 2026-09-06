# Importação industrial de produtos e estoque

Fluxo em quatro passos, com tudo gravado no banco: **arquivo → de-para → conferência →
gravação em lotes**. Nada é processado só na memória do navegador.

## Passo a passo na tela (Estoque › Importar planilha)

1. **Arquivo** — Excel (.xlsx, .xls) ou CSV. A leitura é feita como texto: SKU,
   código de barras e código legado **não perdem zeros à esquerda** e nunca viram
   notação científica.
2. **De-para** — o sistema sugere a correspondência entre as colunas da planilha e os
   24 campos do catálogo; tudo pode ser corrigido à mão em listas com busca.
   Aqui também se define:
   - o que a planilha faz: *só cadastrar* ou *cadastrar e dar entrada no estoque*;
   - modo *simular* (confere tudo e não grava nada) ou *gravar de verdade*;
   - para entrada: local, data da operação, motivo e documento/referência (obrigatórios).
3. **Conferência** — mostra linhas lidas, prontas, com aviso e recusadas, com o motivo
   linha a linha e download de uma planilha só com as recusadas, pronta para corrigir e
   reenviar.
4. **Gravação** — em lotes de 150 linhas, com barra de progresso e botão *Interromper*.
   Uma linha com problema é marcada como erro e **não derruba as demais**.

## Regras de identificação

- Correspondência nesta ordem: **SKU → código legado → código de barras**.
- Uma linha **sem nenhum código** é recusada. O sistema nunca identifica um produto
  apenas pelo nome.
- Quando os códigos da mesma linha apontam para **peças diferentes**, a linha vira
  *conflito* e fica bloqueada para revisão manual — nada é fundido automaticamente.
- Categoria, coleção e fornecedor são localizados por nome e criados como rascunho
  quando não existem.

## Idempotência

- Cada lote tem uma **chave única** no banco (`import_jobs.job_key`).
- Cada entrada de estoque usa a chave `lote:linha:entrada`, aproveitando a proteção já
  existente em `register_stock_movement`.
- Reenviar a mesma planilha **atualiza** as peças e **não** lança estoque de novo.
  Verificado: o segundo envio do mesmo arquivo resultou em `0 produtos criados,
  2 atualizados, 0 variações novas`.

## Dinheiro e números

`parse_decimal_any` entende `1.299,90`, `1,299.90`, `R$ 29,90`, `29.90` e `1234`.
Tudo é gravado em centavos inteiros.

## Variante padrão

O gatilho `ensure_default_variant` cria uma variante padrão ao cadastrar o produto.
A importação **aproveita** essa variante vazia em vez de inserir uma duplicada, e a
vitrine deixa de exibi-la quando a peça já tem variantes reais.

## Estrutura no banco

| Objeto | Papel |
|---|---|
| `import_templates` | modelos de de-para reutilizáveis |
| `import_jobs` | um lote: arquivo, modo, local, data, motivo, documento, situação e contadores |
| `import_rows` | staging: número da linha, conteúdo original, interpretado, situação, mensagens, ids gerados |
| `import_job_open` | abre o lote; a mesma chave devolve o mesmo lote |
| `import_rows_stage` | grava as linhas em blocos de 400 |
| `import_job_validate` | interpreta e valida em blocos de 500 |
| `import_job_process` | grava em blocos de 150, isolando o erro por linha |
| `import_job_cancel` | cancela e marca as linhas restantes como ignoradas |

Acesso restrito a quem tem a permissão `imports.run`; o histórico é visível para a
equipe interna. Nenhuma dessas funções é acessível sem login.

## Teste executado (navegador, sessão real)

Planilha com 3 linhas, valores `R$ 29,90` e `1.299,90`, códigos com zeros à esquerda:

- linha sem código → recusada com o motivo correto;
- 2 produtos criados, 1 variante por produto (sem duplicar a padrão);
- preços gravados como 2990 e 129990 centavos; custos 2990 e 3150;
- código de barras preservado como texto (`7891000000011`);
- segundo envio: 0 criados, 2 atualizados — sem duplicação.

Os registros de teste foram removidos após a verificação.
