# Núcleo comercial Lardan Cloud — roadmap

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

## Bloco 2 — Telas de maleta (matriz) — PENDENTE
- [ ] /admin/maletas: lista, montagem por busca e código de barras, conferência,
      expedição, romaneio imprimível, QR Code
- [ ] Detalhe do ciclo: composição, cadeia de custódia, aceite, divergências, eventos

## Bloco 3 — Aplicativo da consultora — PENDENTE
- [ ] Área mobile-first separada da administração: Início, Minha maleta, Vender,
      Clientes, Meu negócio
- [ ] Tarefa "sua maleta chegou" com conferência e aceite (fotos de divergência)
- [ ] Indicadores reais: vendido, recebido, a receber, disponível, devido, acerto

## Bloco 4 — Vitrine individual — PENDENTE
- [ ] Slug único, caminhos reservados, precedência institucional, histórico de slug
- [ ] Fonte = kit_balances.qty_available da consultora, sem clonar catálogo
- [ ] Carrinho e pedido vinculados a uma consultora

## Bloco 5 — Motor de vendas — PENDENTE
- [ ] Pedido/pagamento/reserva/entrega como estados separados
- [ ] Reserva transacional concorrente + idempotência por chave
- [ ] Fotografia de preços e regra comercial vigente na venda

## Bloco 6 — Pagamentos (Asaas) — PENDENTE / DEPENDE DE CREDENCIAIS
- [ ] Cobrança idempotente, webhook autenticado, deduplicação, reconciliação
- [ ] Recebimento manual distinto de confirmação do provedor

## Bloco 7 — Acerto, devoluções, garantia — PENDENTE
- [ ] Tela de acerto (46 devolvidas / 4 mantidas), retorno físico com conferência
- [ ] Caso numérico do anexo (reconhecido x recebido x não reconhecido)

## Bloco 8 — Representante e comissões — PENDENTE
- [ ] Carteira, entregas pendentes, ciclos, agenda
- [ ] Faixas 9,5% / 12,5% / 13,5% / 14,5% / 16,5% versionadas e desligadas por padrão

## Decisões comerciais pendentes (bloqueiam dinheiro)
- Momento e base da obrigação financeira da consultora na entrega da maleta
- Margem/remuneração da consultora e prazo de acerto
- Denominador, período, elegibilidade e tratamento de estornos na comissão
- Padrinho/madrinha (10% citado no anexo) — não ativar sem definição
- Credenciais e conta Asaas de homologação
