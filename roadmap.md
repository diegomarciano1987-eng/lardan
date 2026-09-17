# Núcleo comercial Lardan Cloud — roadmap

## Site — Seja Lardan cinematográfico
- [ ] Aplicar a nova foto da família na seção Nossa origem
- [ ] Usar o vídeo enviado como fundo discreto da seção “Não é apenas sobre vender semijoias”
- [ ] Aplicar entradas cinematográficas aos títulos da página, respeitando redução de movimento
- [ ] Validar desktop, mobile, reprodução do vídeo, legibilidade e ausência de estouro horizontal

Referência: ANEXO A Lardan Cloud. Regra permanente: não mexer em catálogo,
produtos, imagens e vitrine institucional já publicados.

## Bloco 1 — Maletas: domínio, logística e aceite — ENTREGUE (17/09)
- [x] Tabelas: kits, kit_cycles, kit_compositions(+items), kit_transfers,
      kit_acceptances(+items), kit_balances, kit_events (histórico imutável)
- [x] Permissões kit.view/manage/ship/receive/accept/settle + RLS por escopo
      (matriz, consultora dona, representante da carteira)
- [x] RPCs: kit_cycle_create, kit_item_upsert, kit_conferir (reserva estoque),
      kit_expedir (transferência real para o local da maleta), kit_transfer_confirm,
      kit_transfer_forward, kit_aceitar (integral/parcial/idempotente)
- [x] tests/maletas/ciclo.test.ts — 6 cenários, todos passando

## Bloco 2 — Telas de maleta (matriz) — ENTREGUE (17/09)
- [x] /admin/maletas: lista com filtro por situação, leitura de QR, nova maleta
- [x] /admin/maletas/:id: montagem por busca de variante, composição, conferência,
      expedição direta ou por representante, entregas, aceite assistido,
      divergências, saldos, eventos, romaneio imprimível e QR Code
- [x] QR aponta para rota protegida (não expõe composição, pessoas ou valores)

## Bloco 3 — Área da consultora — ENTREGUE (17/09)
- [x] /consultora mobile-first: Minha maleta, Minha vitrine, Pedidos, Entregas
- [x] Confirmar recebimento, aceite integral ou parcial com divergência e motivo
- [x] Publicar/ocultar peça na vitrine; sem número financeiro fictício

## Bloco 4 — Vitrine individual — ENTREGUE (17/09)
- [x] /:slug público, slug único, lista de caminhos reservados, precedência das
      rotas institucionais, vitrine fora do ar retorna 404
- [x] Fonte = kit_balances da consultora (aceito, publicado, disponível), catálogo
      central reaproveitado, sem cópia de produtos
- [x] Apresentação, filtros, sacola, pedido e compartilhamento; nada privado exposto

## Bloco 5 — Motor de pedidos — PARCIAL (17/09)
- [x] Pedido persistente com código, consultora, cliente, canal, itens, preço
      validado no servidor, origem na maleta/ciclo, eventos e chave de idempotência
- [x] Reserva transacional na criação (validade 48 h) e devolução no cancelamento
- [x] Estados separados de pedido, pagamento e entrega; nada é apresentado como pago
- [ ] Venda assistida pela consultora e revalidação formal da oferta no fechamento

## Bloco 6 — Pagamentos (Asaas) — PENDENTE / DEPENDE DE CREDENCIAIS
- [ ] Cobrança idempotente, webhook autenticado, deduplicação, reconciliação
- [ ] Recebimento manual distinto de confirmação do provedor

## Bloco 7 — Acerto, devoluções, garantia — PENDENTE
- [ ] Tela de acerto (46 devolvidas / 4 mantidas), retorno físico com conferência
- [ ] Caso numérico do anexo (reconhecido x recebido x não reconhecido)

## Bloco 8 — Representante e comissões — PENDENTE
- [ ] Carteira, entregas pendentes, ciclos, agenda
- [ ] Faixas 9,5% / 12,5% / 13,5% / 14,5% / 16,5% versionadas e desligadas por padrão

## Percurso comprovado nesta etapa (homologação)
Montagem, conferência, expedição direta e por representante, confirmação de
entrega, encaminhamento, aceite integral e parcial com divergência, publicação
automática na vitrine, pedido da cliente pelo celular, queda da disponibilidade,
acesso negado a outra consultora, repetição sem duplicidade e disputa da última
unidade. 14 testes automatizados verdes (tests/maletas) e demonstração pelo
navegador. Os dados sintéticos foram removidos: catálogo segue com 20 produtos
publicados. Ressalva: os testes rodaram no mesmo banco do ambiente, com massa
identificada por HOMOLOG e limpeza ao final; ainda não há banco isolado.

## Decisões comerciais pendentes (bloqueiam dinheiro)

| Decisão | Alternativas | Consequência operacional | Depende dela |
| --- | --- | --- | --- |
| Quando nasce a obrigação da consultora | No aceite da maleta / na venda / no acerto | Define se a entrega vira dívida | Acerto, extrato da consultora, cobrança |
| Sobre qual valor | Varejo / valor devido à Lardan / custo | Muda o saldo devedor | Acerto, comissão, DRE |
| Remuneração da consultora | Margem na venda / percentual / tabela por faixa | Muda preço e repasse | Preço da vitrine, acerto |
| Prazo do acerto | Fixo em dias / por ciclo / data combinada | Define atraso e bloqueio | Alertas, bloqueio de nova maleta |
| Base da comissão do representante | Vendido / recebido / acertado, por período | Muda o valor pago | Comissões, financeiro |
| Estorno de comissão | Abate no período seguinte / cancela / mantém | Define devolução e garantia | Comissões, devoluções |
| Recebedor do pagamento | Lardan / consultora / split | Define o fluxo do dinheiro | Asaas, conciliação |
| Credenciais Asaas | Homologação / produção | Sem elas não há cobrança real | Bloco 6 |

- Momento e base da obrigação financeira da consultora na entrega da maleta
- Margem/remuneração da consultora e prazo de acerto
- Denominador, período, elegibilidade e tratamento de estornos na comissão
- Padrinho/madrinha (10% citado no anexo) — não ativar sem definição
- Credenciais e conta Asaas de homologação
