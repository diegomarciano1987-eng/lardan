# Diagnóstico do acerto Lardan ↔ consultora

Data: 23/09/2026. **Rodada exclusivamente de leitura.** Nenhuma migração, tabela,
tela ou rotina foi criada; nenhum dado foi alterado; nada foi publicado; fiscal e
Asaas continuam desligados. Este documento descreve o que existe hoje e o que
falta decidir — não implementa nada.

---

## 1. Mapa do estado atual

### 1.1 Pedido / venda (vitrine da consultora)

| Estrutura | Finalidade atual | Origem dos dados | Identificadores | Situações |
| --- | --- | --- | --- | --- |
| `sales_orders` | Pedido recebido pela vitrine pública da consultora | Exclusivamente `showcase_order_create` (visitante da vitrine) | `id`, `code` único, `idempotency_key` única | `aguardando_atendimento`, `em_atendimento`, `aguardando_pagamento`, `concluido`, `cancelado`; além de `payment_status` e `delivery_status`, hoje apenas informativos |
| `sales_order_items` | Itens do pedido | Mesma rotina | `id`, `order_id`, `cycle_id`, `variant_id` | — |
| `sales_order_events` | Histórico do pedido | `showcase_order_create` e `order_set_status` | `id`, `order_id` | `pedido.recebido`, `pedido.situacao` |

Vínculos: `consultora_party_id` (pessoa da consultora, obrigatório),
`customer_party_id` (cliente final — **existe a coluna, mas a rotina de criação
não a preenche**: o cliente entra como nome/telefone/e-mail avulsos),
`variant_id` (variante exata) e `cycle_id` (ciclo da maleta de onde a peça foi
oferecida). **Não há vínculo com representante** no pedido.

Efeitos atuais:

- **Estoque:** criar pedido soma `kit_balances.qty_reserved` (reserva dentro da
  maleta, não no depósito); cancelar devolve a reserva. **Concluir não faz nada
  no estoque**: não baixa, não soma `qty_sold`, não libera a reserva.
- **Financeiro:** nenhum. Nenhuma rotina de pedido toca `financial_titles`,
  `financial_installments`, `financial_settlements` ou `financial_allocations`.
- **Fiscal:** nenhum. Nenhuma rotina de pedido toca `fiscal_documents`.
- **Histórico:** `sales_order_events` é append-only e guarda situação anterior,
  nova, autor e nota; o pedido em si é mutável nos campos de situação.
- **Desfazer:** o cancelamento reverte a reserva e é registrado; é o único
  efeito reversível, porque é o único efeito existente. Depois de `concluido` ou
  `cancelado` o pedido não muda mais (recusa explícita). **Não existe devolução**
  de venda, nem cancelamento parcial de item.

### 1.2 Peça vendida dentro da maleta

`kit_balances.qty_sold` existe e é **lido** (`kit_detail`, `kit_conciliacao`,
e descontado do disponível em `kit_retorno`), mas **nenhuma rotina o escreve**.
Hoje vale 0 em toda a base. `kit_movements` prevê o tipo `venda`, e nenhuma
rotina o cria. Ou seja: a venda existe como pedido da vitrine e **não existe**
como movimento da maleta.

### 1.3 Respostas diretas

1. **O que "concluir pedido" significa hoje?** Apenas mudar a situação para
   `concluido`, gravar `closed_at` e registrar o evento. Nada mais.
2. **Comprova venda ao cliente final?** Não. Não há pagamento, entrega, baixa de
   estoque, movimento de maleta nem documento associados.
3. **Existe venda fora da vitrine?** Não. `showcase_order_create` é o único
   criador de pedidos; `channel` aceita outro rótulo, mas a porta é a vitrine.
   Não existe PDV, venda manual nem importação de vendas.
4. **Registra variante exata e consultora responsável?** Sim: `variant_id`,
   `cycle_id` e `consultora_party_id` por item/pedido.
5. **Existe cancelamento ou devolução?** Cancelamento do pedido inteiro, sim;
   devolução de venda, não.
6. **Gera título, parcela, estoque ou documento fiscal?** Só reserva dentro da
   maleta. Nenhum título, parcela, liquidação ou documento fiscal.
7. **Dá para distinguir Lardan→consultora de consultora→cliente final?** Sim,
   estruturalmente: a relação Lardan→consultora vive em `kit_cycles` /
   `kit_movements` / `kit_balances`; a relação consultora→cliente vive em
   `sales_orders`. **A primeira nunca vira valor devido hoje** — não há acerto.

---

## 2. Conciliar venda com maleta: o que é possível hoje

Ligável com segurança, porque é registrado explicitamente na criação do pedido:

- **Ciclo da maleta** — `sales_order_items.cycle_id`.
- **Variante** — `sales_order_items.variant_id`.
- **Quantidade** — `sales_order_items.quantity`.
- **Consultora responsável** — `sales_orders.consultora_party_id`, conferida
  contra o dono da vitrine e contra o ciclo.
- **Data** — `created_at` do pedido e `closed_at`/`cancelled_at`.
- **Cancelamento** — `status`, `cancelled_at`, `cancel_reason` e eventos.

**Não ligável hoje:**

- **Remessa inicial × acréscimo.** O pedido aponta o ciclo, não o movimento.
  Quando a mesma variante entrou na maleta em duas remessas, não há como provar
  de qual lote saiu a peça vendida.
- **Peça física individual.** O controle é por quantidade de variante, não por
  item serializado.
- **Comprovação da venda.** Concluir pedido não comprova recebimento nem entrega.

**Dados que faltariam para provar que a peça vendida veio daquela remessa:**
referência do item do pedido ao movimento de entrada (`kit_movement_items`) com
consumo por lote; um movimento de venda confirmado no ciclo (`kind = 'venda'`)
alimentando `qty_sold` sem duplicar; evidência de entrega/pagamento ao cliente; e
critério de consumo definido pelo negócio (ordem de entrada ou escolha explícita).

Nenhuma associação deve ser feita por nome do produto, preço, proximidade de
datas ou produto genérico.

**Diferença física continua não significando venda.** A conferência mostra as
peças sem destino como "ainda sob responsabilidade"; 50 + 5 − 20 = 35 sob
responsabilidade, não 35 vendas nem 35 de dívida.

---

## 3. Financeiro existente (a reaproveitar, sem paralelo)

Cadeia atual: `financial_titles` → `financial_installments` →
`financial_settlements` → `financial_allocations` (+ `financial_adjustments`,
`financial_title_events`, `financial_account_movements` como razão).

Rotinas oficiais que devem ser reutilizadas:

- Criação e ciclo do título: `fin_title_create`, `fin_title_submit`,
  `fin_title_approve`, `fin_title_reject`, `fin_title_cancel`,
  `fin_title_classify`, `fin_title_detail`, `fin_titles_list`.
- Parcelas: criadas dentro de `fin_title_create` (soma das parcelas tem de bater
  com o total) e atualizadas por `fin_installment_refresh`.
- Pagamento: `fin_settlement_create` e `fin_settlement_reverse`; alocação
  parcela a parcela em `financial_allocations`.
- Conciliação bancária: `fin_reconcile` / `fin_reconcile_undo`.
- Reconhecimento/contestação pela contraparte: `fin_acknowledge`.

Pontos já existentes que servem ao acerto:

- **Duplicidade:** índice único `financial_titles (sistema_origem, id_externo)`
  quando ambos existem, e `financial_settlements.idempotency_key` única. Um
  acerto deveria nascer com `sistema_origem = 'acerto_maleta'` e `id_externo` =
  identificador do acerto, o que torna a repetição impossível por construção.
- **Origem "acerto de maleta":** as colunas `origem`, `origem_id`,
  `sistema_origem` e `id_externo` já existem em `financial_titles` — nenhuma
  tabela nova é necessária para identificar a origem.
- **Devedor separado:** `party_id` (contraparte) e `pagador_party_id` (quem paga)
  são colunas distintas.
- **Estorno sem apagar:** `financial_settlements` tem `reversed_of`,
  `is_reversal` e `reversal_reason`; ajustes vivem em `financial_adjustments`; o
  título tem cancelamento com motivo e histórico em `financial_title_events`.
  Nada é apagado.
- **Asaas:** `asaas_charges` já tem `external_id` único por conta e ligação
  opcional a título/parcela, com gatilho que impede vincular sem uma das duas
  pontas. Uma cobrança importada deveria **anexar-se ao título existente do
  acerto** (por `id_externo`/`origem_id`) e, quando não houver vínculo provado,
  permanecer `pendente` de conciliação — nunca criar um segundo título.

Nada disso está ligado a maletas hoje: os 53 títulos que citam "maleta" são
contas a pagar importadas de planilha (fornecedor), não acerto de consultora.

---

## 4. Identidades da operação (não confundir)

| Papel | Onde está hoje | Observação |
| --- | --- | --- |
| Proprietário da mercadoria | Lardan (implícito; estoque em `locations`) | Consignação: a peça continua da Lardan até a venda |
| Responsável físico pela maleta | `kit_cycles.custodian_party_id` | Muda ao longo do ciclo |
| Representante | `kit_cycles.representante_party_id` | Transporta/atende; pode acrescentar peças |
| Consultora vinculada | `kit_cycles.consultora_party_id` | Também dona da vitrine |
| Cliente final | `sales_orders.customer_name` e afins; `customer_party_id` **não preenchido** | Hoje não é pessoa do cadastro |
| Comprador/devedor perante a Lardan | **não existe** | Depende de decisão de negócio |
| Destinatário fiscal | `fiscal_documents` (estrutura pronta, inerte) | Pendência registrada em `fiscal_pendencias` |
| Responsável pelo pagamento | `financial_titles.pagador_party_id` | Pode diferir da contraparte |

Não se deve presumir que representante, destinatário fiscal, consultora e devedor
sejam a mesma pessoa.

---

## 5. Modelo recomendado (proposta, não implementada)

Um **acerto** seria um documento próprio por ciclo (ou por período do ciclo),
que agrega o que foi vendido, devolvido, mantido, perdido, em garantia e em
divergência, e só então vira valor.

Estados propostos e evidência exigida para entrar em cada um:

| Estado | Evidência para entrar | Quem pode |
| --- | --- | --- |
| rascunho | ciclo existente com movimentações | Matriz, representante, consultora |
| aguardando comprovação | acerto transmitido por quem está com a maleta | quem detém a custódia |
| com divergência | conferência física ou confronto apontando diferença sem destino | Matriz |
| conferido | conferência física registrada (declarado × recebido × aprovado × divergente) | Matriz / Qualidade nas peças bloqueadas |
| aprovado | decisão comercial da Matriz sobre valores e tratamento das diferenças | perfil de aprovação (diretoria/financeiro) |
| contabilizado | título criado por `fin_title_create` com `sistema_origem='acerto_maleta'` | financeiro |
| parcialmente pago | liquidação alocada menor que o total | financeiro |
| liquidado | soma das alocações igual ao total | financeiro |
| ajustado / estornado | ajuste ou estorno registrado com motivo, sem apagar histórico | financeiro com aprovação |

Separações obrigatórias — nenhuma acontece em cadeia automática:

- **conferência física** ≠ **aprovação do acerto**;
- **aprovação** ≠ **geração do título**;
- **título** ≠ **emissão fiscal**;
- **título** ≠ **cobrança no Asaas**.

Maleta que volta com menos peças **não** gera venda, dívida, documento nem
cobrança por si só.

---

## 6. Lacunas e riscos de duplicidade

- `qty_sold` e o movimento `venda` existem sem produtor: qualquer implementação
  precisa de uma única porta, ou o mesmo item pode ser contado duas vezes (na
  reserva do pedido e no movimento de venda).
- Pedido concluído **não libera a reserva**: reservas antigas seguram
  disponibilidade da maleta indefinidamente.
- Cliente final não é pessoa do cadastro; conciliar pagamento por nome
  duplicaria identidade.
- Um acerto sem `sistema_origem`/`id_externo` poderia gerar dois títulos para o
  mesmo ciclo; com eles, o índice único impede.
- Importação Asaas sem vínculo provado pode criar segunda obrigação; a regra tem
  de ser "anexa ao título existente ou fica pendente".
- Cancelamento de venda depois do acerto não tem tratamento previsto.

---

## 7. Decisões de negócio pendentes (não responder por suposição)

1. Numa peça de R$ 9,00 ao consumidor, **quanto a consultora deve à Lardan**?
2. Os R$ 3,00 citados pelo Daniel são **preço comercial real** Lardan→consultora
   ou **apenas valor do documento fiscal**?
3. A diferença entre os valores é **margem da consultora, comissão, desconto** ou
   outra operação?
4. Quem é o **comprador** na venda Lardan→consultora: a consultora, o
   representante ou uma entidade intermediária?
5. **Quando nasce a dívida**: na venda ao consumidor, na transmissão do acerto,
   na conferência ou na aprovação da Matriz?
6. **Perda, garantia, peça mantida e divergência geram cobrança?** Em qual valor
   e após qual aprovação?
7. Como tratar **venda cancelada depois do acerto**?
8. Como tratar **pagamento parcial e ajustes posteriores**?
9. **UF, regime tributário, inscrição estadual e enquadramento** da operação.

A proporção de "um terço" continua registrada como pendente em
`pricing_policies`, sem percentual e sem efeito. Ela **não** vira regra aqui.

---

## 8. O que seria afetado numa futura implementação

Banco (somente por migração nova e aditiva, em outra rodada):

- Novas estruturas de acerto (cabeçalho, itens, eventos) e a ligação entre item
  vendido e movimento de entrada da maleta.
- Rotinas reaproveitadas: `fin_title_create`, `fin_title_submit/approve/cancel`,
  `fin_settlement_create`, `fin_settlement_reverse`, `fin_installment_refresh`,
  `fin_reconcile`, `fin_acknowledge`.
- Rotinas que precisariam de ajuste: `order_set_status` (liberar reserva e
  produzir a venda na maleta por uma única porta), `kit_conciliacao` e
  `kit_historico` (exibir venda comprovada), `kit_retorno`/`kit_retorno_confirmar`
  (interação com peças já vendidas).
- Capacidades novas de aprovação do acerto em `role_capabilities`.

Frontend:

- `src/lib/maletas.ts` (única porta de RPC das maletas e pedidos),
- `src/lib/financeiro.ts` (títulos, parcelas, liquidações),
- `src/components/admin/maletas/Movimentacoes.tsx`,
- `src/routes/_authenticated/admin/maletas_.$id.tsx`,
- `src/routes/_authenticated/consultora.tsx`,
- telas do financeiro em `src/routes/_authenticated/admin/financeiro/`.

Nada disso foi alterado nesta rodada.
