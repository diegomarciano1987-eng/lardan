# Recebíveis e link de cobrança Asaas — preparação (simulada)

Rodada de preparação operacional. **Nada foi conectado, publicado ou aplicado ao banco compartilhado.**

## O que existe

| Camada | Arquivo | Estado |
| --- | --- | --- |
| Endurecimento | `db/pendentes/03-asaas-endurecido.sql` | preparado, aplicado só no isolado |
| Recebíveis, cobrança, eventos | `db/pendentes/05-asaas-receber.sql` | preparado, aplicado só no isolado |
| Contrato do adaptador | `src/lib/asaas/contrato.ts` | ativo |
| Simulador determinístico | `src/lib/asaas/simulador.ts` | ativo |
| Transporte HTTP | `src/lib/asaas/transporte-http.server.ts` | **bloqueado antes de sair para a rede** |
| Serviços | `src/lib/asaas/{importacao,cobranca,eventos,banco}.ts` | ativos em simulação |
| Telas | `src/components/admin/financeiro/AsaasReceber.tsx`, `src/routes/_authenticated/admin/financeiro/asaas.tsx`, `src/routes/_authenticated/financeiro/simulacao.$id.tsx` | preparatórias |

## Duas origens de recebível

- **A) Já existe no Asaas** — `asaas_import_abrir` → `asaas_import_pagina` (limit/offset/hasMore, retomável) →
  `asaas_import_previa` (classifica: histórico informativo, saldo devedor inicial, pagamento já refletido na
  abertura, novo recebimento) → `asaas_import_resolver` → `asaas_import_aprovar` (autor, aprovador e horário
  gravados pelo servidor) → `asaas_import_efetivar` (usa `fin_title_create` e `asaas_charge_vincular`; nunca dá baixa).
- **B) Já existe na Lardan** — `asaas_cobranca_preparar` sobre uma parcela com saldo positivo obtido por
  `fin_installment_saldo` no servidor → `asaas_cobranca_processando` (reserva curta) → `asaas_cobranca_resultado`
  (criada / rejeitada / desconhecida / conciliação). Uma cobrança por parcela; cobrança válida existente é
  reaproveitada em vez de duplicada.

Maleta, acerto ou nota fiscal **não** são exigidos para recebível manual ou histórico. Recebíveis novos
derivados de acerto de maleta continuam bloqueados: a regra comercial não existe.

## Correções desta rodada

- Removido o `WHEN others THEN NULL` que silenciava a falha de tornar `asaas_events.account_id` obrigatório.
- Campos controlados (vínculo, estado de conciliação, resultado externo, autor/horário) só mudam por rotina
  oficial; escrita direta de `authenticated`/`anon` revogada em todas as tabelas `asaas_*`.
- `asaas_charge_vincular`: repetição exige título **e parcela** iguais; parcela diferente é conflito que exige
  alteração explícita, motivo e auditoria; após alocação financeira a troca é proibida (vai para conciliação).
- Aprovação de importação exige capacidade, sessão e lote válido; preencher `approved_by` não aprova.
- Coerência exigida entre empresa dona da conta, empresa do título, devedor e cliente externo — nulo não passa.

## Provas

Comando: `bash tests/isolado/subir.sh && bun test tests/isolado`
Resultado desta rodada: **108 aprovadas, 0 falhas, 313 verificações, 6 arquivos**.
O número anterior de 79 provas correspondia à rodada fiscal/acerto; as 29 novas cobrem importação paginada
(>100 cobranças), interrupção e retomada, importação repetida três vezes, mesmo ID externo em contas
distintas, título manual sem duplicação, parcela paga sem nova cobrança, link vinculado à parcela certa,
reaproveitamento de link, duplo clique e concorrência, mesma chave com conteúdo diferente, resposta perdida
com consulta posterior, mudança de saldo durante o processamento, aprovação forjada pelo navegador, escrita
direta recusada, usuário sem permissão, eventos repetidos/atrasados e bloqueio de chamada externa.

## Limites conhecidos

- A pré-visualização do navegador aponta para o banco em uso, onde `db/pendentes/` **não** foi aplicado: a tela
  de recebíveis Asaas mostra "Preparação ainda não aplicada a este ambiente". O percurso completo foi exercido
  pelos serviços reais da aplicação contra o banco isolado, não pelo navegador ligado a ele — apontar o
  servidor de desenvolvimento ao isolado exigiria reiniciá-lo, o que está vedado.
- Simulação sempre identificada: identificadores `sim_*`, endereço local `/financeiro/simulacao/<id>`, aviso
  "SIMULAÇÃO — NÃO É UMA COBRANÇA PAGÁVEL", cópia de link real indisponível, nenhum envio ao cliente.
- Fatura individual (`invoiceUrl` de uma cobrança) ≠ Link de Pagamento (`/paymentLinks`, outro fluxo de criação
  de cliente/cobrança). Esta rodada usa apenas a fatura individual.

## Pendente

- Conectar sandbox (credencial só no servidor, `secret_ref`), homologação com o Asaas, cadastro do webhook.
- Regra contábil do recebimento: tarifa, disponibilidade de fundos, recebimento fora do Asaas, estorno e
  chargeback ficam pendentes de decisão em vez de virar baixa inventada.
- Regra comercial do acerto de maleta, incluindo o "um terço".
