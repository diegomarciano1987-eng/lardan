# LARDAN — Financeiro: arquitetura

Documento vivo. Checkpoint: fundação canônica entregue e provada no banco;
conciliação, importação, DRE, Cobranças e preparação Asaas ainda pendentes.

## 1. Diagnóstico inicial (confirmado no banco em 15/09/2026)

`/admin/financeiro` era apenas um `ModulePlaceholder`. Não existia nenhuma
tabela, função ou capacidade financeira específica — apenas as capacidades
genéricas `finance.view`, `finance.operate` e `finance.approve`. Nada foi
copiado do Betoni: o modelo aqui nasce separado em título, parcela,
liquidação, alocação e razão.

## 2. Modelo canônico

| Conceito | Tabela |
| --- | --- |
| Conta, caixa, carteira, compensação | `financial_accounts` |
| Plano de contas hierárquico | `chart_of_accounts` |
| Centros de custo hierárquicos | `cost_centers` |
| Formas de pagamento | `payment_methods` |
| Título (a pagar / a receber) | `financial_titles` |
| Parcelas | `financial_installments` |
| Rateio da parcela | `financial_allocation_targets` |
| Trilha do título | `financial_title_events` |
| Baixa (pagamento/recebimento) | `financial_settlements` |
| Alocação da baixa em parcelas | `financial_allocations` |
| Juros, multa, desconto, tarifa | `financial_adjustments` |
| Transferência interna | `financial_transfers` |
| Razão das contas | `financial_account_movements` |
| Reconhecimento x contestação | `financial_acknowledgements` |
| Comprovantes | `financial_attachments` |

Decisão: **uma fundação única** de títulos com direção (`receivable` /
`payable`), em vez de duas árvores paralelas. Motivo: parcelas, baixas,
alocações, ajustes, aprovação e auditoria são idênticos nos dois lados;
duplicar o motor foi exatamente o erro observado na referência.

A contraparte é sempre `parties`. Não existe cópia de pessoa, fornecedor,
consultora ou empresa dentro do Financeiro.

## 3. Regras de dinheiro e história

- Todo valor é **centavo inteiro (`bigint`)**. Reais só na borda da tela.
- Emissão, competência e vencimento são `date`; eventos são `timestamptz`.
- Baixa nunca sobrescreve valor: cada pagamento é uma liquidação nova.
- Estorno cria lançamento compensatório ligado ao original; nada é apagado.
- Cancelamento exige motivo e é recusado quando existem baixas vigentes.
- Divergência de dívida fica visível como contestada; nunca vira desconto.

## 4. Operações autoritativas (o navegador não escreve nas tabelas)

`fin_title_create`, `fin_title_approve`, `fin_title_cancel`,
`fin_settlement_create`, `fin_settlement_reverse`, `fin_transfer_create`,
`fin_acknowledge`, `fin_account_create`, `fin_installment_refresh` (interna),
`fin_overview`, `fin_accounts_overview`, `fin_titles_list`, `fin_title_detail`.

Todas com `security definer`, `search_path` fixo, verificação de capacidade,
`revoke` de `public`/`anon` e `grant` apenas para autenticados. As tabelas
concedem **somente leitura** e ainda assim filtrada por capacidade via RLS.

Idempotência: `financial_settlements.idempotency_key` e
`financial_transfers.idempotency_key` são únicos; repetir a mesma chave
devolve o resultado anterior em vez de criar outra baixa.

Concorrência: as parcelas envolvidas são travadas (`FOR UPDATE`) antes de
qualquer alocação.

## 5. Capacidades

`finance.dashboard.view`, `finance.payable.view|manage`,
`finance.receivable.view|manage`, `finance.title.approve`,
`finance.settlement.create|reverse`, `finance.bank.view|manage`,
`finance.reconcile`, `finance.dre.view`, `finance.import.run|approve`,
`finance.export`, `finance.audit.view`, `finance.settings.manage`,
`collection.view|operate|negotiate|discount.approve`.

Distribuição inicial: Master tudo; Diretoria visão, aprovação, DRE, auditoria
e exportação; Financeiro operação completa de AP/AR, contas e conciliação;
Cobrança apenas recebíveis e casos de cobrança. Estoque, Marketing e Suporte
seguem sem nenhum acesso financeiro.

## 6. Provas executadas (15/09/2026, usuário Master real)

| Prova | Resultado |
| --- | --- |
| Soma das parcelas diferente do total | recusado com mensagem clara |
| Título a pagar com duas parcelas | criado e relido |
| Baixa parcial de R$ 40,00 em parcela de R$ 100,00 | parcela ficou "parcial" |
| Mesma chave de idempotência repetida | devolveu a mesma baixa, sem duplicar |
| Saldo da conta após a baixa | −R$ 40,00, vindo do razão |
| Estorno com motivo | parcela voltou a "não liquidado", saldo voltou a zero |
| Cancelamento com motivo | aceito, com histórico preservado |
| Massa de homologação | removida integralmente ao final |

Preservação conferida: 20 produtos publicados, 40 fotos, quatro categorias e
240 unidades do Depósito Principal permanecem intactos — o Financeiro não
toca em catálogo nem em estoque.

## 7. Ainda desligado / pendente

- Conciliação bancária (CSV/OFX) e CNAB.
- Importação de contas a pagar e a receber.
- DRE gerencial e fluxo de caixa com drill-down completo.
- Módulo Cobranças (`/admin/cobrancas`) com régua, promessas e negociações.
- Motor de comissões versionado.
- Preparação Asaas: **nenhuma tabela, nenhuma credencial e nenhuma chamada
  externa existem hoje**. A tela informa que a cobrança externa não está
  configurada e não oferece botão que finja funcionar.

## Conciliação bancária

Implementada como área da própria tela do Financeiro, reaproveitando o motor de
liquidação e o razão. Estrutura, RPCs, formatos aceitos, permissões e testes estão
documentados em `CONCILIACAO-BANCARIA.md`.
