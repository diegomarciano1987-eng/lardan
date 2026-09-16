# LARDAN — Financeiro: arquitetura

Documento vivo. Checkpoint: fundação canônica entregue e provada no banco;
conciliação bancária entregue e operacional; importação financeira, DRE, Cobranças e
preparação Asaas seguem em implantação.

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

- CNAB (sem botão funcional).
- Importação financeira e DRE (áreas marcadas "em implantação" na própria tela).
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


## Departamento operacional (rodada F6)

Rotas canônicas, todas com URL própria, recarga direta, voltar/avançar e capacidade
verificada no servidor:

`/admin/financeiro` (visão geral), `/pagar`, `/receber`, `/fluxo-caixa`, `/contas`,
`/conciliacao`, `/plano-contas`, `/centros-custo`, `/aprovacoes`, `/auditoria`,
`/configuracoes` — ativas; `/importacoes` e `/dre` — em implantação, sem botão que
finja importar, calcular ou exportar.

Navegação compartilhada: `src/components/admin/financeiro/FinanceiroShell.tsx`
(cabeçalho, indicadores reais pelo razão, abas com área ativa destacada, filtro de
capacidade, estado "Em implantação", responsivo e navegável por teclado).

Regras endurecidas no banco:

- saldo inicial da conta grava movimento real e imutável (`saldo_inicial`); o saldo é
  sempre calculado pelo razão, sem contagem dupla com `saldo_inicial_cents`;
- títulos: rascunho → submetido → aprovado/ativo ou recusado (com motivo, volta a
  rascunho); cancelado não ressuscita; aprovar de novo é idempotente e não gera segundo
  evento; nascer "ativo" depende da regra `financeiro.aprovacao`;
- plano de contas e centros de custo por RPC, com busca e paginação no servidor, hierarquia
  sem ciclos, código único e inativação em vez de exclusão física;
- fluxo de caixa apurado no servidor: realizado pelo razão, previsto pelas parcelas.

Testes versionados: `tests/financeiro/departamento.test.ts` (`bun run test:financeiro`).

## Departamento operacional — rodada de organização

### Homologação segura
- A rotina antiga `fin_homolog_purge()` foi **removida**: ela selecionava contas por
  nome, desligava a imutabilidade do razão e apagava lançamentos. Nada de migração
  antiga foi editado; a correção é aditiva.
- Em seu lugar existe `fin_test_isolate_accounts(_ids uuid[], _marca text)`:
  - executável **somente** pelo serviço interno (`service_role`);
  - aceita apenas IDs criados pela própria execução, com nome iniciado pela marca
    `HOMOLOG...` e criados há menos de 24h;
  - **não apaga nada**: apenas desativa a conta, marca `is_homologacao = true` e
    grava auditoria. Razão, baixas e histórico permanecem intactos.
- `fin_accounts_overview()` oculta contas isoladas.

### Classificação de títulos
- `fin_classificacoes` entrega, com busca no servidor, as opções ativas de plano de
  contas, centros de custo, entidades, formas de pagamento e contas.
- `fin_validar_classificacao` recusa natureza incompatível com a direção do título e
  contas contábeis inativas ou que não aceitam lançamento.
- Classificar é opcional na criação; o título fica `pendente_classificacao`.
- `fin_title_classify` reclassifica com controle de concorrência (`esperado_updated_at`),
  motivo obrigatório quando já houve baixa, evento no histórico e registro em `audit_logs`.

### Fluxo de caixa
- Saldo de abertura é apresentado separado; nunca entra como entrada do período.
- Realizado vem dos movimentos do razão; previsto vem das parcelas em aberto.
- Transferências entre contas não inflam o consolidado.
- Ao filtrar por centro/entidade, movimentos sem classificação suficiente aparecem à
  parte, em vez de sumirem. `fin_cashflow_detail` abre qualquer valor.

### DRE gerencial
- `fin_dre` / `fin_dre_detalhe` em regime de competência ou caixa, por plano de contas,
  com filtros de centro e entidade, bloco de pendências de classificação e origem de
  cada linha. Sem tabela temporária (compatível com leitura).

### Navegação
- `FinanceiroShell` tem navegação contextual pelas 13 áreas, filtrada por capacidade,
  preservando as URLs e o período global.

### Provas desta rodada
- `bun run test:financeiro`: **18 testes, 18 aprovados** (departamento + classificação,
  fluxo em centavos e DRE), com massa criada e isolada pela própria execução.
- Typecheck: limpo. Lint: arquivos desta rodada sem erros (a base do repositório tem
  pendências de formatação anteriores, não tocadas aqui).
- Catálogo e estoque conferidos pelo teste de preservação.

### Pendências honestas (não declarar concluído)
- **Importação AP/AR**: a tela e os modelos existem, mas o processamento em lote no
  servidor, com arquivo privado, hash de origem e promoção canônica, ainda precisa ser
  implementado e provado. Hoje é apenas entrada assistida.
- Nenhuma conta bancária real ou fictícia foi criada; o Financeiro conectado segue vazio.
- Avisos do linter de segurança (176) são o padrão preexistente do projeto:
  funções SECURITY DEFINER expostas, 6 tabelas com RLS sem política e uma extensão no
  schema público. Continuam registrados para tratamento próprio.
