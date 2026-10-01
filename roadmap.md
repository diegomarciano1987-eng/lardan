# Roadmap — Asaas operação definitiva

- [x] Diagnóstico da produção (conta, estado, segredos, webhook, dados)
- [x] Liberar produção nas rotinas que só aceitavam teste (preparar cobrança, contas, link da fatura)
- [x] Verificação de saúde somente leitura (saldo, último webhook, importação, extrato)
- [x] Extrato Asaas (financialTransactions) com dedupe e vínculo que quita via conciliação
- [ ] Vincular títulos a receber à empresa Lardan — aguardando autorização (10.798 títulos sem empresa)
- [ ] Webhook: configurar URL/token no painel Asaas — aguardando usuário (0 eventos recebidos)
- [ ] Concluir importação de clientes/cobranças (lote pausado, 2.365 itens em prévia)
- [ ] Central Asaas em abas (visão geral, clientes, cobranças, recebimentos, ocorrências)
- [ ] Cobrança por cartão (checkout hospedado) e parcelamento oficial
- [ ] Tela "Pagar Lardan" da consultora
- [ ] Webhook: gravação durável + processamento separado, saúde e alertas
- [ ] Política de recebimento em revisão assistida; automação só após aprovação da Diretoria
- [ ] Anti dupla baixa: webhook × extrato Asaas × OFX
- [ ] Endurecer OFX/CSV (encoding, BANKID/ACCTID, saldos, FITID)
- [ ] Testes obrigatórios da seção 11
- [ ] Fase B: primeira cobrança controlada (consultora escolhida pela Diretoria)

- [x] Contas e caixas: ficha por conta (dados bancários, agência, endereço), movimentações, auditoria, transferência entre contas

## Fase A — continuação (spec 25/09)
- [x] Conferência dos 10.800 títulos, 919 clientes, 1.446 cobranças, 5.025 movimentações, diferença R$ 400 Santander (só leitura)
- [ ] Aplicar vínculo em lote dos 918 clientes com CPF exato de consultora (aguarda autorização)
- [ ] Central Asaas em 7 abas
- [ ] Baixa assistida "Revisar e conciliar" + testes isolados
- [ ] Transferências como composição no cockpit + testes de contas
- [ ] Testes OFX/CSV + validação BANKID/ACCTID/CURDEF
- [ ] Seleção da primeira cobrança real (botão travado até autorização)

## Usuários e acessos
- [x] Auditar papéis, áreas e bloqueio de inativos
- [ ] Remover contas HOMOLOG da base real
- [x] Criar edição conjunta de múltiplos acessos
- [ ] Validar visualmente e testar persistência, bloqueio e auditoria

## Avaliações do Google
- [x] Substituir Duda Goes por Cristina Santos em todas as exibições

## Selos de segurança
- [x] Redesenhar os selos de todos os rodapés com faixa institucional escura e versão compatível para e-mails

## Área comercial das consultoras (plano aprovado 01/10)
- [x] Etapa 1a: aceite só após recebimento; confirmação tardia não reabre; repasse exige custódia; "concluído" bloqueado; pedido anônimo da vitrine revogado
- [x] Vitrine: sacola vira lista de interesse via WhatsApp (sem reserva), número sem 55 duplicado
- [ ] Conta de teste da consultora (aguarda Diego confirmar e-mail projetos.diegosilva@hotmail.com)
- [ ] Etapa 1b: regra única de elegibilidade/preço; testes isolados de regressão
- [ ] Etapa 2: convite e primeiro acesso
- [ ] Etapa 3: vitrine em perfil completo (capa, retrato, filtros, busca)
- [ ] Etapa 4: CRM de clientes, pedidos e vendas
- [ ] Etapa 5: pagamentos, devolução e garantia (aguarda decisões: prazo de reserva, limite de desconto, recebedor, texto de garantia)

## Estúdio da Minha Vitrine
- [x] Rascunho/publicação/histórico, perfil, contato, foto e capa, temas, organização, compartilhamento, página pública
- [ ] Testes de regressão isolados (imagens extremas, duas abas, conexão interrompida) — ambiente isolado
- [x] Rodada celular da consultora (parte 1): navegação inferior, toque 48px, conferência sem campos minúsculos, Central de Ajuda + passeio + editor
- [ ] Rodada celular parte 2: cadastro de clientes, pedido/venda/pagamento e financeiro da consultora (telas ainda não existem; dependem das decisões da Etapa 5)
- [ ] Teste em aparelhos Android/iPhone reais e leitor de tela

## Segurança + Jornada + A receber (parecer 01/10)
- [x] Bloco 1: vitrine só pelas ações oficiais; funções antigas fechadas; página pública sem caminhos de originais; cache de imagens 60s; clientes fora do alcance de estoque/montagem (permissão crm.view)
- [ ] Bloco 1: verificar no site oficial após publicar (cache CDN, 404 de vitrine fora do ar)
- [x] Bloco 2: Jornada (etapas, Instagram, Pausadas/Encerradas, quadro + seções, histórico, 4 artigos de ajuda)
- [ ] Jornada: nomes das etapas editáveis pela equipe Lardan
- [ ] Bloco 3: A receber de clientes + notificações internas (botão de venda a prazo travado até decisão da política)
- [ ] Ajuda: artigos de Jornada e A receber

## Financeiro (substituir Conta Azul) — itens 1–27
- [x] P0.1 Saldo: dupla contagem do saldo inicial corrigida (diferença R$ 28.500,86 explicada)
- [x] P0.6 parcial: futuros só no previsto (Visão geral, Contas, Fluxo)
- [~] P0.2 DRE: caixa sem dupla contagem e estorno com sinal; 5 indicadores separados — falta ponte com números do PDF
- [ ] Natureza de AJUSTE DE IMPLANTAÇÃO e RETIDO REPRESENTANTE no caixa disponível — decisão do Daniel
- [ ] Extratos bancários não importados (só Asaas) — comparação por banco bloqueada
- [ ] P0.3–P0.8 despesas fixas, despesas fixas, teto 1.000, transferências, futuros, Asaas, parcelas
- [ ] P1 (9–18), P2 (19–23), P3 (24–27) — item 9 depende da política comercial do acerto

## P0 financeiro — rodada itens 8/3/5 (01/10)
- [x] Item 8: lista por parcela (vencimento, saldo, competência próprios; total do contrato como referência)
- [x] Item 3: competência por parcela; aluguel casa comercial distribuído (12 eventos auditados)
- [ ] Item 3: demais contratos de despesa — aguardando decisão individual do Daniel
- [x] Item 5: transferência uma vez; implantação separada; lista por operação com as duas movimentações
- [~] Item 7: Asaas medido (250 eventos na fila, 0 cobranças espelhadas); R$ 3.388,77 sem origem — precisa do saldo Asaas em 30/09
- [ ] Item 9: simulação do acerto (sem recebíveis)
- [ ] Item 1: extratos OFX por conta em 30/09 (bloqueado: arquivos)
