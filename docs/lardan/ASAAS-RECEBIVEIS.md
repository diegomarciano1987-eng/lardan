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

---

## Rodada de correção — auditoria do pacote 15 (23/09/2026)

Nada foi aplicado ao banco compartilhado, publicado ou conectado. Nenhuma
credencial, webhook, sandbox ou produção foi usada. Toda prova abaixo rodou no
banco isolado (`127.0.0.1:55432/lardan_iso`) e na segunda instância (porta 8090).

### Problemas confirmados no código e correção

| # | Problema confirmado | Correção (arquivo) |
|---|---|---|
| 1 | `asaas_evento_registrar` era SECURITY DEFINER executável por `authenticated`, sem sessão nem capacidade | Revogada e substituída por `asaas_evento_registrar(_payload,_origem,_actor)` só para o papel interno do servidor. `provedor` exige conta conectada; `simulacao` exige conta simulada e ator com `finance.reconcile` (`07`) |
| 2 | `asaas_cobranca_resultado` aceitava do navegador ID externo, endereço e situação | Removida junto com `asaas_cobranca_processando`. Só o executor interno grava, via `asaas_exec_reservar` / `asaas_exec_cliente` / `asaas_exec_resultado` / `asaas_exec_link`, conferindo conta, intenção, trabalhador, tentativa, transição, formato do ID e do endereço (`07`) |
| 3 | `conciliacao` não bloqueava nova intenção | Índice de intenção viva e `asaas_cobranca_preparar` incluem `conciliacao`; ID externo e vínculo ficam preservados (`05`, `07`) |
| 4 | Rejeição e resultado desconhecido se confundiam | `rejeitada` exige fase: `antes_do_provedor`, `cliente`, `provedor_recusou` ou `sem_registro_apos_consulta` (esta só depois de consultar). Qualquer falha depois do envio vira `desconhecida` (`07`, `cobranca.ts`) |
| 5 | Cliente criado fora do `try`; falhas inesperadas deixavam `processando` | Execução em fases (cliente → cobrança → link → gravação); cliente persistido na hora; posse temporária com expiração; posse vencida vira `desconhecida` auditada e só é retomada por CONSULTA; preparadas nunca iniciadas são retomadas (`asaas_exec_pendentes`, `retomarPendentes`) |
| 6 | Link das importadas não era guardado | `asaas_charges.invoice_url` com guarda: aproveita o payload quando válido, consulta pelo ID quando ausente (sem criar), valida por modo e ambiente no servidor (`07`, `obterLinkCobranca`) |
| 7 | Painel com limite fixo 50/200 | `asaas_receber_parcelas` (cursor estável vencimento+id, busca por pessoa/número/descrição, filtro de situação), `asaas_receber_fila`, `asaas_receber_ocorrencias` paginadas; tela com busca, seletor e "Carregar mais" |
| 8 | Simulação misturada com ambiente; simulador global | `modo_execucao` (simulado/conectado) separado de `ambiente_provedor` (sandbox/produção), com restrição no banco; configuração do servidor (`ASAAS_MODO`, `ASAAS_AMBIENTE`, `ASAAS_API_KEY`) ausente/ambígua/incoerente = indisponível; um simulador por conta, com estado gravável para sobreviver a reinício |
| 9 | HTTP só lançava bloqueio | `TransporteHttpAsaas` monta requisições reais (base por ambiente, cabeçalho `access_token`, `User-Agent`, corpo em reais, offset/limit ≤ 100, `hasMore`/`totalCount`), traduz respostas para centavos e classifica erros (400 recusa, 401/403 credencial, 429 limite, 5xx/queda em POST = desconhecido, em GET = consulta indisponível, 404 em consulta = ausente). `fetch` injetável; o padrão bloqueia antes da rede. Não presume unicidade de `externalReference` nem idempotência do provedor |

Defeitos adicionais encontrados pelos novos testes e corrigidos:
- a restrição de modo aceitava conta "conectada" sem ambiente (CHECK com resultado NULL passa); agora exige `IS NOT NULL`;
- depois de uma rejeição, a nova solicitação colidia com a chave padrão; a chave passa a incluir o número de tentativas encerradas;
- na tela, o detalhe fechava quando a parcela saía do filtro após obter o link.

Documentação oficial consultada (23/09/2026): docs.asaas.com — criar cobrança,
listar cobranças, listar/criar clientes, autenticação e códigos HTTP. O host do
endereço de fatura do sandbox (`sandbox.asaas.com/i/…`) não aparece textualmente
na documentação consultada: fica como **a confirmar na homologação**.

### Testes executados

- `bash tests/isolado/subir.sh && bun test ./tests/isolado` → **126 aprovados, 0 falhas, 623 verificações** em 6 arquivos (164 migrações + 6 pendentes; `06` proposta ignorada).
- `bun test ./tests/asaas/transporte-http.test.ts` → **12 aprovados, 0 falhas, 45 verificações**, sem rede.
- Regressões novas: segurança do executor (navegador recusado em todas as rotinas internas; posse/tentativa; formato de ID; endereço estranho descartado; ator sem permissão ou inativo), conciliação bloqueando, falha no cliente sem duplicar, link que falha e é recuperado pelo ID, falha ao gravar resultado com retomada sem reenvio, erro inesperado = desconhecida, desconhecida sem registro só encerra após consulta, preparada retomada, reinício, modo incompatível, links importados, validação por ambiente, 205 parcelas em 4 páginas sem repetir, fila/ocorrências por cursor, isolamento entre contas, configuração inválida, entrada de eventos.

### Navegador (instância isolada 8090)

Roteiro `/tmp/browser/asaas2/fluxo.py` (incluído no pacote). Observado:
prévia 121 cobranças em 3 páginas (116 novas, 3 históricas, 1 cliente sem
vínculo, 1 possível duplicidade); Financeiro recusado ao aprovar; Diretoria
resolveu e aprovou, recusada ao efetivar; Financeiro efetivou (117 títulos
criados, 118 vínculos, 3 só espelho) e a repetição não fez nada; paginação
25 → 50 de 120; filtro "Cobrança sem link" no servidor; link de importada obtido
pelo identificador sem criar cobrança; duplo clique = uma cobrança; reaproveitamento;
página local de simulação; evento e evento repetido sem baixa; resposta perdida
bloqueando nova solicitação e recuperada por consulta; celular; consultora sem
acesso. Hosts contatados: somente locais e as fontes/analytics já usados pelo
layout — nenhum domínio do Asaas.

### Contagens finais explicadas (banco isolado)

- **121 cobranças consultadas** no simulador = 116 em aberto do cliente vinculado + 3 históricas recebidas + 1 de cliente sem vínculo + 1 com mesmo valor/vencimento de um título lançado à mão.
- **117 títulos criados** = 116 novas + 1 do cliente sem vínculo, depois de a Diretoria escolher a pessoa. A possível duplicidade foi ligada ao título manual existente (não criou outro); as 3 históricas ficaram só como espelho informativo.
- **3 títulos manuais** semeados (duplicidade, link, resposta perdida) → 120 títulos a receber.
- **123 cobranças finais** = 121 importadas + 2 geradas pela tela (link e resposta perdida recuperada). 112 têm link guardado (123 − 12 importadas sem link + 1 obtida pelo identificador).
- **0 liquidações**: nenhum evento, link ou importação criou baixa.

### Continua pendente

Regra contábil do recebimento (baixa, tarifa, juros/multa, estorno, chargeback), homologação em sandbox com credencial, endpoint de webhook com validação do token do provedor, confirmação do host do link no sandbox, aplicação dos pendentes ao banco compartilhado e publicação — nada disso foi feito nesta rodada.


---

## Fechamento final da preparação (23/09/2026)

### Problemas reproduzidos e correções

Foram reproduzidos: conta aceita da tela em cobrança/link; configuração global ambígua; fluxo comum de importação desligado da tela; cursor calculado após filtro local; ausência de coordenação distribuída do cliente; classificação terminal incorreta para credencial/limite/resultado incerto; painel e cache sem conta; rotinas legadas existentes entre pendentes; webhook incompleto.

Correções finais: conta derivada de intenção, cobrança ou lote; configuração por conta com segredo apenas por referência `ASAAS_SANDBOX_*`, UUID único do servidor e gate adicional `ASAAS_EGRESS_ENABLED=1`; estados canônicos e alteração controlada; importação comum server-side; cursor bruto persistido em `asaas_import_pages`; lease por conta+pessoa; recuperação por referência antes de recriar cliente; retries persistidos; link resolvido pelo identificador interno; painel/cache filtrados por conta; webhook permanece inativo; pendentes aplicados numa transação única pelo roteiro isolado. Produção permanece impossível de ativar.

### Provas finais efetivamente executadas

- Reconstrução do zero: 164 migrações e 7 pendentes dentro de um pacote transacional; a proposta fiscal `06` continuou ignorada.
- `bun test ./tests/isolado`: **130 testes, 638 verificações, 0 falhas**, seis arquivos.
- `bun test ./tests/asaas/transporte-http.test.ts`: **14 testes, 53 verificações, 0 falhas**, somente `fetch` falso ou bloqueado.
- `bunx tsgo --noEmit`: sem erro.
- Paginação: página bruta de 100 itens, zero mantidos após filtro e `hasMore=true` avançou para offset 100; retomada consumiu o item 101 sem repetir; 1.005 cobranças percorreram 11 páginas, sem omissão ou ciclo.
- Concorrência: duas instâncias cobrando duas parcelas da mesma pessoa produziram **um cliente externo e duas cobranças**, sem seleção arbitrária. Resposta perdida na criação do cliente foi retomada por consulta à referência, sem segunda criação.
- Segurança: `asaas_exec_*` está executável somente por `service_role` (e, para a auxiliar privada, apenas pelo proprietário); visitante/autenticado não recebeu execução; as três assinaturas legadas inseguras não existem. Interrupção simulada depois de criar/conceder uma rotina terminou em `ROLLBACK`; a rotina não permaneceu (`count=0`).
- Navegador isolado em 1280 px e 390 px: Financeiro e Diretoria abriram o painel; consultora e usuário desativado viram acesso recusado. Usuário sem pessoa abriu apenas a leitura financeira permitida pelo papel; nenhuma ação de importação/cobrança foi executada nesse perfil. Capturas e roteiro estão no pacote.
- Hosts observados pelo navegador: `127.0.0.1`, fontes Google/CDN e analytics já presentes no layout. **Zero requisições** para `api-sandbox.asaas.com`, `api.asaas.com`, `sandbox.asaas.com` ou `www.asaas.com`. O transporte padrão também falhou antes do acesso.

### Limites preservados e pendências reais

Nenhum evento gera liquidação, alocação ou razão. Link não cria obrigação, venda ou documento fiscal. Recebível manual aprovado independe de maleta; recebível futuro de acerto continua bloqueado até aprovação formal. Retorno, perda, garantia, defeito e quantidade a explicar não viram venda. O “aproximadamente um terço” permanece apenas informação operacional, sem percentual fiscal executável.

Para receber uma credencial de sandbox ainda faltam decisão/autorização operacional, cadastro do segredo no servidor, UUID da única conta conectada, confirmação do host de fatura, homologação com dados sintéticos e liberação deliberada do gate de saída. Webhook exige segredo próprio, endpoint público e homologação; o manipulador permanece bloqueado. Banco compartilhado, site publicado, fiscal, acerto, liquidações e razão não foram alterados.
