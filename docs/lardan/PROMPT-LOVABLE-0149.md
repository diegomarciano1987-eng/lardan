# Para o Lovable — 0149: financeiro do SmallData no cockpit da consultora

Aplique exatamente como está. Não renomeie funções e não mude mensagens. Não publique a interface sem a minha aprovação.

## Por que o cockpit vinha vazio

1. O cockpit lê só o financeiro do Lardan: títulos, baixas e o fiado da planilha.
2. Do SmallData só tinha entrado o valor da venda de cada acerto. Nunca foram importados:
   - como ela pagou cada acerto (dinheiro, depósito, cartão, cheque, boleto);
   - os fiados, abertos e quitados;
   - os pagamentos.
3. A planilha de fiados (`cob_fiado_importar`) achava a pessoa só pelo CPF. Linha sem CPF cadastrado ficou "pendente", sem título, e nunca foi reprocessada.
4. A unificação (`party_unificar`) deixa o lastro do fiado na cadastro duplicado. Por isso a aba "Fiado — lastro" da pessoa que ficou não mostrava essas linhas.

## 1. Migração `0149_financeiro_smalldata_cockpit.sql`

Fica em drizzle/migrations. Pode renumerar o arquivo; o conteúdo é o mesmo. A migração não apaga nada, não remove coluna e pode rodar duas vezes.

- Tabelas novas, sem dados pessoais (só código do cliente, datas e valores):
  - `legado_cobrancas`: T_GF_COBRANCA, ou seja, cada acerto e pagamento de fiado com as formas de pagamento;
  - `legado_fiados`: T_GF_FIADOS, as parcelas com situação aberto ou quitado;
  - `legado_pagamentos`: boletos, depósitos, cartão e cheques.
- A função `legado_importar` passa a aceitar os tipos `cobrancas`, `fiados` e `pagamentos`. Reenviar um arquivo não duplica nada.
- `consultora_financeiro_smalldata(party)` alimenta a aba nova do cockpit:
  - devolve resumo, acertos, fiados e pagamentos;
  - é só leitura;
  - mesma permissão do cockpit financeiro.
- `cob_fiado_smalldata_conciliar(aplicar)` liga a planilha de fiados ao fiado do SmallData. Primeiro mostra a prévia; só o Master aplica.
  - Linha **pendente** (sem CPF cadastrado): procura um fiado **em aberto** do SmallData com a mesma data de cobrança, vencimento, valor e parcela. Se o par for único e a consultora tiver cadastro, cria o título `fiado_historico` dela. A competência é hoje, como saldo de implantação, fora da DRE.
  - O lastro (`cob_fiado_linhas`) continua imutável. A pessoa achada e o título ficam em `legado_fiado_vinculo`.
  - A prévia também mostra os títulos abertos no Lardan que já estão quitados no SmallData. É preciso conferir esses antes de cobrar.
  - Para desfazer por lote: `cob_fiado_smalldata_desfazer(lote)`. Título que já tem baixa não é cancelado.
- Aba "Fiado — lastro" do cockpit: passa a incluir as linhas das cadastros unificadas na pessoa e as linhas resolvidas pela conciliação.

## 2. Interface

- `src/lib/historico-jflex-csv.ts`: a tela do histórico aceita os arquivos `cobrancas.csv`, `fiados.csv` e `pagamentos.csv`. Como o histórico já foi importado, dá para enviar só esses três.
- `src/lib/cobranca.ts`: novo tipo `FinanceiroSmallData` e nova função `financeiroSmallData()`.
- `src/components/admin/cobranca/FinanceiroSmallData.tsx` (novo) e `CockpitFinanceiroConsultora.tsx`:
  - linha "Histórico SmallData" no topo, com: vendeu, pagou, fiado gerado, fiado quitado, fiado em aberto e aberto sem título no Lardan;
  - aba nova **SmallData**, com acertos, fiados e pagamentos;
  - quando a consultora não tem nada no Lardan, o cockpit já abre na aba SmallData.

## 3. Testes

- `tests/isolado/financeiro-smalldata.test.ts` é novo e tem 7 testes.
- O esperado em `bash tests/isolado/subir.sh && bun test tests/isolado` é **441 pass, 0 fail**.
- Na bancada, com o histórico real sem dados pessoais:
  - 3.643 das 4.023 consultoras cadastradas têm financeiro;
  - o cockpit responde em 14 ms;
  - a prévia da conciliação responde em 11 ms.

## 4. Depois de aplicar

O Diego, como Master, envia na tela Histórico SmallData os três arquivos da pasta `LARDAN_HISTORICO_JFLEX`: `cobrancas.csv`, `fiados.csv` e `pagamentos.csv`. Você não envia esses arquivos.

Depois que ele enviar, me devolva estes resultados. Não aplique a conciliação.

```sql
-- 1) conferência da importação
select (select count(*) from public.legado_cobrancas) cobrancas,
       (select count(*) from public.legado_fiados) fiados,
       (select count(*) from public.legado_pagamentos) pagamentos,
       (select sum(valor_cents)/100.0 from public.legado_fiados where status = 'A') fiado_aberto_smalldata;
-- esperado: 22708 · 9799 · 20346 · 952740.xx

-- 2) quantas consultoras cadastradas passam a ter financeiro no cockpit
select count(*) cadastradas,
       count(*) filter (where exists (select 1 from public.legado_cobrancas c where c.codcli = lc.codcli)) com_financeiro
  from public.legado_consultoras lc where lc.party_id is not null;

-- 3) planilha de fiados hoje
select situacao, count(*), sum(valor_cents)/100.0 reais from public.cob_fiado_linhas group by 1;

-- 4) prévia da conciliação (com a sessão Master pelo cliente oficial; não grava nada)
select jsonb_pretty(public.cob_fiado_smalldata_conciliar(false));
```

Acrescente ao AGENTS.md a linha "SmallData finance (0149)" que está no AGENTS.md deste pacote.
