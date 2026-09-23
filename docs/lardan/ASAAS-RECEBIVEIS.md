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

## Rodada de fechamento (23/09/2026) — navegador ligado ao ambiente isolado

Versão do código testado: commit base `64188fc` + alterações não publicadas listadas em "Arquivos alterados".

### Segunda instância isolada

`bash tests/isolado/subir.sh && bun tests/isolado/app/semear.ts && bash tests/isolado/app/subir-app.sh`

| Componente | Porta | Observação |
| --- | --- | --- |
| Postgres isolado (164 migrações + 5 pendentes) | 55432 | recriado do zero pelo código |
| PostgREST 14.1 | 54330 | papéis `anon`/`authenticated` reais, RLS ativa |
| Gateway local de autenticação (JWT HS256 sintético) | 54321 | usuários `demo.*@lardan.test` |
| Aplicação (Vite, `ASAAS_AMBIENTE=simulacao`, `LARDAN_DEMO_ISOLADO=1`) | 8090 | pré-visualização 8080 intocada |

Ações de demonstração (`src/lib/asaas/demo.functions.ts`) só respondem com as duas variáveis do servidor;
na pré-visualização e no site publicado recusam.

### Percurso exercitado pelo navegador (Playwright, 1280 px e 390 px)

| Passo | Perfil | Resultado observado |
| --- | --- | --- |
| Consulta pelo adaptador | Financeiro | 121 cobranças em 3 páginas (limit 50, hasMore) |
| Tentar aprovar | Financeiro | recusado: "Sem permissão para aprovar importação." |
| Resolver duplicidade e cliente sem vínculo (SmartSelect) | Diretoria | ambos "Resolvido" |
| Aprovar lote | Diretoria | "Lote aprovado (121 cobranças)." |
| Tentar efetivar | Diretoria | recusado: "Sem permissão para efetivar importação." |
| Efetivar | Financeiro | títulos criados; repetição: 0 criados, 0 vinculados |
| Banco após efetivar | — | 120 títulos distintos (3 manuais + 117), 123 cobranças únicas por conta+ID, **0 liquidações** |
| Abrir parcela manual, duplo clique em "Solicitar cobrança" | Financeiro | uma cobrança `sim_pay_demo_00122` |
| Solicitar de novo | Financeiro | "cobrança existente reaproveitada" |
| Abrir fatura | Financeiro | `/financeiro/simulacao/sim_pay_demo_00122` com "SIMULAÇÃO — NÃO É UMA COBRANÇA PAGÁVEL" |
| Evento simulado + repetido | Financeiro | registrado; repetido sem novo efeito; saldo da parcela R$ 250,00 → R$ 250,00 |
| Resposta perdida → consultar e recuperar | Financeiro | "Resultado desconhecido" → "criada" sem segunda criação |
| Perfil sem permissão | Consultora | "Acesso não liberado" |
| Celular 390 px | Diretoria | abas e ações quebram linha, sem rolagem lateral |

Hosts contatados pelo navegador: apenas 127.0.0.1 (app e gateway) mais fontes e Google Analytics já
carregados pelo layout. **Nenhum endereço Asaas.** Capturas: `evidencias/asaas-isolado/*.png` no ZIP.

### Defeitos encontrados pelo navegador e corrigidos

1. `asaas_receber_painel` falhava sempre (ORDER BY fora do agregado em "ocorrências"); os testes não chamavam o painel.
2. Efetivação exigia a capacidade de aprovar, mas cria títulos pela rotina canônica, que exige
   `finance.receivable.manage`: ninguém além do master conseguia efetivar. Agora: Diretoria aprova,
   Financeiro (import.run + receivable.manage) efetiva lote aprovado.
3. Duplo clique: a segunda chamada recebia a intenção repetida sem cliente e deixava a intenção presa em
   "processando". Agora só quem registrou executa; e falta de cliente após reserva grava "rejeitada".
4. A aprovação exigia a mesma aba de quem consultou; a tela agora retoma o lote aberto.
5. Painel limitado a 50 parcelas escondia títulos manuais após importar 117; passou a 200.

Bateria isolada após as correções: **108 aprovadas, 0 falhas, 313 verificações, 6 arquivos**.

## Matriz de efeitos financeiros

| Cenário | Espelho Asaas | Cria/vincula título-parcela | Liquidação e alocação | Razão | Pendente de decisão |
| --- | --- | --- | --- | --- | --- |
| Importar cobrança em aberto (novo recebimento) | sim | cria, após aprovação | não | não | — |
| Importar cobrança com título manual equivalente | sim | vincula com evidência | não | não | — |
| Importar histórico já pago antes da abertura | sim | não (só espelho) | não | não | — |
| Importar saldo devedor inicial | sim | cria pelo saldo | não | não | valor de abertura |
| Gerar link de parcela existente | intenção + cobrança | já existia | não | não | — |
| PAYMENT_CONFIRMED / RECEIVED integral | sim | — | **não** | **não** | conta de destino, data de disponibilidade |
| Recebimento parcial | sim | — | não | não | se o Asaas admite parcial por cobrança |
| Juros, multa, desconto | sim | — | não | não | ajuste: conta e natureza |
| Tarifa (fee) | sim | — | não | não | conta de despesa e momento |
| RECEIVED_IN_CASH (fora do Asaas) | sim | — | não | não | qual caixa recebeu; não creditar conta Asaas |
| Reembolso parcial/integral | sim | — | não | não | estorno de liquidação e tarifa |
| Chargeback | sim | — | não | não | reabrir parcela? bloqueio de fundos? |

Hoje **nenhum** evento gera liquidação, alocação ou lançamento no razão: todos ficam em "Ocorrências e
conciliação" (`na_fila`). Saldos demonstrados: parcela R$ 250,00 antes e depois do evento; conta financeira
R$ 0,00 antes e depois. **Nada é declarado liquidado nem conciliado financeiramente.**

Perguntas exatas a resolver (contador/diretoria):
1. Em qual conta financeira entra o valor líquido do Asaas, e na data do pagamento ou da disponibilidade?
2. A tarifa vira despesa própria (qual conta) ou redução da receita?
3. Juros/multa recebidos e descontos concedidos: quais contas?
4. Recebimento em dinheiro informado no Asaas: qual caixa, e quem confirma?
5. Reembolso e chargeback: reabrir a parcela ou criar título de devolução?

Essas pendências **não** impedem preparar cobrança de título manual já aprovado (exercitado acima).

## Limites conhecidos

- O banco em uso não recebeu `db/pendentes/`; ali a tela mostra "Preparação ainda não aplicada a este ambiente".
- Autenticação local é um gateway mínimo (senha + JWT) suficiente para a aplicação; não reproduz e-mail,
  OAuth nem renovação de sessão do serviço real.
- `tests/isolado/app/semear.ts` tolera o erro "Somente título submetido pode ser aprovado" porque o título
  sintético já nasce ativo; não mascara outra falha.
- O relatório exibido após a segunda efetivação mostra só a repetição (zeros); a contagem da primeira foi
  conferida no banco.
- Simulação sempre identificada: identificadores `sim_*`, endereço local `/financeiro/simulacao/<id>`, aviso
  "SIMULAÇÃO — NÃO É UMA COBRANÇA PAGÁVEL", cópia de link real indisponível, nenhum envio ao cliente.
- Fatura individual (`invoiceUrl` de uma cobrança) ≠ Link de Pagamento (`/paymentLinks`, outro fluxo de criação
  de cliente/cobrança). Esta rodada usa apenas a fatura individual.

## O que falta para o sandbox (roteiro futuro)

1. Cadastrar credencial do sandbox como segredo do servidor (`ASAAS_API_KEY`) e `ASAAS_AMBIENTE=sandbox`.
2. Liberar o transporte HTTP (hoje bloqueado antes da rede) após homologação do contrato de campos.
3. Criar a rota pública do webhook com token de autenticação e cadastrá-la no painel do Asaas.
4. Repetir esta mesma bateria contra o sandbox, sem dados reais.

Fatura individual (`invoiceUrl` de cobrança vinculada a cliente) ≠ Link de Pagamento (`/paymentLinks`,
cria cliente e cobrança pelo próprio link): esta preparação usa apenas a fatura individual.

## Pendente

- Conectar sandbox (credencial só no servidor, `secret_ref`), homologação com o Asaas, cadastro do webhook.
- Regra contábil do recebimento: tarifa, disponibilidade de fundos, recebimento fora do Asaas, estorno e
  chargeback ficam pendentes de decisão em vez de virar baixa inventada.
- Regra comercial do acerto de maleta, incluindo o "um terço".
