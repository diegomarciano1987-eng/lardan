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
