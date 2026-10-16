# Roadmap
## Financeiro — nove pontos enviados em 16/10
- [ ] 1 Corrigir edição de valor/vencimento de parcela (c.status)
- [ ] 2 Conciliação de título existente preserva categoria/centro do título
- [ ] 3 Editar data do estorno e corrigir aluguel 2026-007482 para 09/10
- [ ] 4 Ocultar Estornar quando já estornado e validar idempotência
- [ ] 5 Unificar Daniel LC-001617/LC-003221 e alertar duplicados no cadastro
- [ ] 6 Limpar busca de contraparte ao abrir nova conta
- [ ] 7 Reiniciar campos de parcelamento ao abrir nova conta
- [ ] 8 Busca por código/nome de conta contábil sempre disponível
- [ ] 9 Suspender atalhos da Mesa com campo/dropdown aberto

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
