# Roadmap
## Financeiro — nove pontos enviados em 16/10
- [x] 1 Edição de parcela — teste R$ 138,15 → R$ 138,13
- [x] 2 Conciliação preserva classificação do título — teste Aluguel; sem conciliação real nova
- [x] 3 Estorno editável e aluguel 2026-007482 corrigido para 09/10 — tela e movimento conferidos
- [x] 4 Baixa estornada sem botão Estornar — tela real e idempotência testadas
- [x] 5 Daniel unificado LC-003221 → LC-001617 — sete vínculos; alerta de duplicados conferido
- [x] 6 Busca limpa ao reabrir nova conta — conferida na tela
- [x] 7 Parcelamento reiniciado ao reabrir — conferido na tela
- [x] 8 Busca contábil sempre disponível — A receber, 3.1.1 conferido
- [x] 9 Guarda de atalhos implementada — interação da Mesa não exercitada nesta etapa

Provas: docs/lardan/AUDITORIA-FINANCEIRO-NOVE-PONTOS-2026-10-16.md; 243 testes isolados + 10 financeiros aprovados; compilação OK; sem publicar.

- [x] Aplicar patch como 0086 e registrar pdv_links_listar — 235 testes aprovados; consultas reais somente leitura; provas em docs/lardan/AUDITORIA-PATCH-2026-10-16.md; sem publicar
- [ ] Limitações do pacote (crédito posterior do cartão, auditoria de recusas, saldo na ficha do representante) — aguardam autorização para alterar o patch; conta de cartão vazia
- [x] Cancelar as sete maletas de teste autorizadas por Diego e conferir devolução ao estoque — 48 peças, 40 transferências, sete auditorias; tela conferida
- [x] Larissa: acesso total ao cadastro
- [x] Etapa 2: cobranças Asaas das parcelas do acordo + baixa que abate a dívida original
- [x] Etapa 3: cobrança em lote no Asaas (acordos e dívidas)
- [x] Etapa 3: unificação de cadastros (Ketllin, Diego, Cleverson, Sueli)
- [ ] Maria Vieira: 2 fichas de consultora — aguarda conferência do Diego
- [ ] Remover 10 tarifas Asaas lançadas em dobro (R$ 19,90) — aguarda aprovação
- [ ] Publicar o site

## Conferência Conta Azul (Diego, 16/10)
- [x] 1 Nova conta a pagar/receber (Nx, já pago, cartão por mês)
- [x] 2 Editar parcela (vencimento/valor) — cancelar título já existia
- [ ] 3 Importar extrato OFX Santander/Itaú/Sicoob/Caixa — próxima etapa
- [x] 4 Cheque compensou lança no banco com data
- [x] 5 Estorno com data escolhida
- [x] 6 Ajustes Itaú e Caixa removidos — [ ] Infinity Pay aguarda vendas/taxas de setembro certas
- [ ] 7 API Rede — precisa das credenciais da Rede
- [ ] 8 Diferenças de centavos dos cartões — conferir junto com Diego
