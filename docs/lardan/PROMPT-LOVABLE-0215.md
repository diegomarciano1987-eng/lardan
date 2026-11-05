# Para o Lovable — 0215: notas do ACERTO da maleta (devolução, venda e perda), em HOMOLOGAÇÃO

Aplique **depois da 0214**, exatamente como está. A migração não apaga nada e **não liga a emissão real**: continua só homologação. Não crie caminho para produção.

## O que muda para quem usa

- Na tela da remessa, quando a maleta está **encerrada** (acerto conferido ou maleta perdida) e tem a **nota de remessa autorizada**, aparece o botão **"Notas do acerto (teste)"**. Emitir: só Master.
- O botão emite, ligadas à remessa da maleta:
  - **Devolução** (entrada 1918/2918) das peças que voltaram, com a referência a cada item da nota de remessa.
  - **Venda** (5114/6114, simples faturamento) das peças vendidas, citando a remessa nas informações complementares, como pediu o contador.
  - **Perda** (5927/6949) das peças que não voltaram nem foram vendidas.
- Cada peça sai com o **mesmo valor unitário** da nota de remessa. Nenhuma operação passa da quantidade remetida. Se sobrar peça sem destino (por exemplo, em garantia), a tela avisa quantas ficaram sem nota.
- Cada nota autorizada aparece como botão do DANFE ("Devolução nº X", "Venda nº Y", "Perda nº Z"). Nota recusada mostra o motivo, e clicar de novo emite só o que falta.

## 1. Migração `drizzle/migrations/0215_nfe_acerto_maleta.sql`

- `fiscal_focus_envios.itens_variantes`: variante de cada item da nota de remessa. A devolução acha o item certo sem depender do código atual da peça.
- `fiscal_focus_envio_maleta_registrar`: ganha o parâmetro `_variantes`, que é opcional. A função antiga é trocada.
- Índice único: uma nota viva por maleta, ambiente e operação.
- `fiscal_focus_acerto_dados(_cycle)`: só Master. Exige maleta encerrada e remessa autorizada. Lê `kit_balances` (`qty_returned`, `qty_sold`, `qty_lost`).
- `fiscal_focus_envio_acerto_registrar(...)`: só servidor e só homologação. A origem tem de ser a remessa autorizada da **mesma** maleta.
- `fiscal_focus_notas_maletas`: passa a devolver também as notas do acerto (campo `acerto`).

## 2. Código

- `src/lib/focus/focus.functions.ts`: nova função `focusEmitirAcertoMaleta({ cycleId })`. A remessa passa a mandar `_variantes`.
- `src/components/admin/maletas/NotaFiscalMaleta.tsx`: botão "Notas do acerto (teste)", DANFEs do acerto e consulta automática das notas que estão na SEFAZ.
- `src/lib/focus/AGENTS.md`: regra registrada.

## 3. Testes

- Novo `tests/isolado/nfe-acerto-maleta.test.ts`.
- Em banco novo (`bash tests/isolado/subir.sh && bun test tests/isolado`): **609 pass**. A única falha é o carregamento de `aceite-pedido-personalizado.test.ts` por falta de `@supabase/supabase-js` na máquina onde rodei, sem relação com este pacote. Rode `bun run build` aí.

## 4. Depois de aplicar, me devolva

```sql
select proname from pg_proc where proname in ('fiscal_focus_acerto_dados','fiscal_focus_envio_acerto_registrar');   -- 2 linhas
select provider, environment, emission_active from public.fiscal_settings;                                         -- focus, homologacao, false
```
