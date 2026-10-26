# Para o Lovable — 0164: correções vistas nas telas publicadas

Aplique **depois da 0163**, exatamente como está. Não renomeie funções. A migração pode rodar duas vezes e não remove coluna.

## 1. Migração `0164_cockpit_producao_e_maletas_smalldata.sql`

1. **`consultora_notas_e_fechamentos`**
   - Em produção ela dava o erro `column fd.cancelled_at does not exist` e as abas Fechamentos e Notas fiscais do cockpit ficavam em "…".
   - A causa: `fiscal_documents` de produção não tem `cancelled_at` nem `simulado`, e `kit_acertos` não existe (fazem parte da cadeia fiscal em `db/pendentes`).
   - A função foi reescrita usando só as colunas que existem em produção.
2. **`rep_maletas_carteira`**
   - Agora inclui as maletas do SmallData que estão na rua (sem fechamento e com situação "na rua", a mesma regra da 0127), com data de acerto e alerta de vencida.
   - Antes, a lista do representante ficava vazia porque hoje as maletas em campo são do SmallData.
3. **`preco_reajuste_previa`:** a peça sem SKU e sem código interno passa a aparecer pelo código de barras.

## 2. Interface

- **`CampoRepresentante.tsx` e `representante.ts`:**
  - a maleta do SmallData aparece com "acerto pelo SmallData" e sem o botão de acerto em campo;
  - o tipo ganhou `id` e `fonte`.
- **`representante.tsx`:** o rótulo curto da aba Consultoras virou "Carteira", porque o nome cortava no celular.
- **`LiderELiga.tsx`:** os níveis da Liga ganharam cabeçalho (nome, maletas no ano, venda mínima).
- **`PedidoEPreco.tsx`:** o relatório de preço não repete o nome da peça quando a variante tem o mesmo nome.

## 3. Testes

- `tests/isolado/app-representante.test.ts` tem 1 teste novo: maleta do SmallData na rua na carteira.
- Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **498 pass, 0 fail**.

## 4. Depois de aplicar, me devolva

Rode logado como Master:

```sql
select jsonb_array_length(x->'notas') notas, jsonb_array_length(x->'fechamentos') fechamentos
  from (select public.consultora_notas_e_fechamentos('169d248b-5659-4cbe-a185-3b60f6cff1de') x) s;
select jsonb_array_length(public.rep_maletas_carteira('cb395a2e-8c08-4123-89d6-7dcb838ea373'));
```
