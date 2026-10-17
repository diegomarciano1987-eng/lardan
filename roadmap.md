# Roadmap
## App da consultora — PDF de melhorias (16/10)
- [x] Redesenhar os quatro cartões de Seu resumo conforme o print — ícones, contraste, números e respiro; capturas 390/1156/1280 px sem transbordamento; leitura autenticada bloqueada para Master, prova visual isolada com valores do print; sem alterar indicadores ou publicar.
- [x] Melhorar visual da lista de pedidos no celular e desktop — cartões, resumos, ações e detalhe reorganizados; capturas com dados autorizados, sem gravações; docs/lardan/DESIGN-PEDIDOS-CONSULTORA-2026-10-17.md
- [x] Conferir todos os itens do PDF contra o app e registrar evidências e dependências — docs/lardan/PROVAS-APP-CONSULTORA-2026-10-16.md
- [ ] Corrigir maleta ativa, pedidos/clientes, formulários e navegação da venda
- [ ] Facilitar venda: busca, filtros, fotos ampliadas, etiqueta, revisão e comprovante
- [ ] Melhorar vitrine, compartilhamento, clientes, lembretes e mensagens
- [ ] Mostrar ganhos, metas, acerto, indicações e conteúdo com dados reais — bloqueio: comissão/acerto aplicado, liga e conteúdo aprovados
- [x] Implementar abertura de troca/garantia ligada à venda, análise, fotos e histórico — 45 dias/two-year warranty; sete testes isolados de pós-venda/busca
- [ ] Efetivar troca, diferença de preço, crédito, devolução no acerto e indicadores — bloqueio: fluxo oficial de acerto/financeiro aprovado
- [ ] Implementar entregas, acessibilidade, letra grande e instalação
- [ ] Conferir pagamentos/parcelas com o motor oficial, sem duplicar baixas
- [x] Aplicar preço final ,90 às sugestões de nova precificação, subindo; preços atuais intactos
- [ ] Identificar dados de teste e apresentar limpeza auditada antes de executar
- [ ] Validar os fluxos autenticados em celular e computador — bloqueio: sessão atual não tem acesso consultora; manual e fila vazia conferidos, 250 testes isolados aprovados
- [ ] Diagnosticar duas falhas preexistentes do teste REST de sigilo de custos — sem vazamento confirmado; preferir reprodução isolada
- [ ] Publicar somente quando solicitado

## Financeiro — nove pontos enviados em 16/10
- [x] 1 Edição de parcela — teste R$ 138,15 → R$ 138,13
- [x] 2 Conciliação preserva classificação do título — teste Aluguel; sem conciliação real nova
- [x] 3 Estorno editável e aluguel 2026-007482 corrigido para 09/10 — tela e movimento conferidos
- [x] 4 Baixa estornada sem botão Estornar — tela real e idempotência testadas
- [x] 5 Daniel unificado LC-003221 → LC-001617 — sete vínculos; alerta de duplicados conferido
- [x] 6 Busca limpa ao reabrir nova conta — conferida na tela
- [x] 7 Parcelamento reiniciado ao reabrir — conferido na tela
- [x] 8 Busca contábil sempre disponível — A receber, 3.1.1 conferido
- [x] 9 Guarda de atalhos validada na Mesa real — inputs e seletor aberto preservam modo/linha; busca, classificação e fechamento conferidos sem confirmar conciliação; docs/lardan/VALIDACAO-MESA-TELA-2026-10-16.md

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

## App consultora — PDF Daniel (17/10)
- [x] Etapa 1: categorias por botões (2.3), forma de pagamento combinada na revisão (2.10); aviso único já resolvido (1.4)
- [x] Etapa 2: filtro/busca em Minha maleta (8.1), detalhes da entrega e rastreio (8.4)
- [x] 8.3 foto da avaria ao receber a maleta
- [x] Etapa 3: Quanto eu ganho, meta, acerto (4.6, 6.1–6.3) + Configurações de comissão em Indicação e comissão — faixas a preencher pela LARDAN
- [x] Etapa 4: aniversariantes/30 dias (5.2), combina com ela (5.5), link nominal (6.7 já existia)
- [x] 6.5 artes da semana na Biblioteca (painel /admin/biblioteca)
- [ ] Etapa 5: limpeza dos testes (1.6) — aguarda autorização
