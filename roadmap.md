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
