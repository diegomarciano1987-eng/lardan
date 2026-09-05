# LARDAN — Modelo de Dados

## Entidades do site (AGORA — Lote 2)

organization; users/profiles; user_roles (papéis em tabela separada, função has_role security definer); public_consultant_profiles; media_assets; pages/page_versions; site_settings; categories; collections; products/product_variants/product_media; leads/lead_events; contact_requests; audit_logs.

Convenções: IDs estáveis (uuid), timestamps (created_at/updated_at), constraints de unicidade (slug por escopo), arquivamento preferível a exclusão, GRANTs explícitos por papel e RLS em toda tabela pública/privada.

### Separação público × privado (V/5.2)

Campos públicos de produto: nome, slug, categoria, coleção, descrição, material/banho verificados, variações, medidas, peso se disponível, imagens com alt, cuidados, garantia, preço quando autorizado.
NUNCA públicos: custos, margens, fornecedores internos, documentos, regras de comissão. Projeção pública explícita; ocultar coluna na tela não basta.

### Formulários (V/5.3)

- CAP-FORM (leads/candidatura): nome, WhatsApp, rua, número (com opção "sem número"), cidade, UF, CEP; perfil: objetivo financeiro, disponibilidade, experiência, carteira, motivação. Mínimos separados de complementares.
- CONT-FORM (contact_requests): nome, canal de retorno, assunto, mensagem.
- CONS-FORM: cidade/UF e contato para localizar atendimento.
- Todos: origem, URL de entrada, campanha/UTM, protocolo, versão do aviso de privacidade, consentimento de marketing separado/opcional/não pré-marcado.

## Entidades posteriores (documentadas, sem migração prematura) — V/9

- Estoque: branch/store, stock_location, supplier, purchase, goods_receipt, lot, tracked_item, inventory_movement, reservation.
- Maletas: suitcase, suitcase_cycle, suitcase_item, custody_assignment, digital_acceptance, shipment.
- Rede: consultant, representative, region, customer, customer_channel_relationship, interaction, appointment.
- Vendas/Financeiro: order, order_item, fulfillment, payment, payment_allocation, receivable, payable, settlement, cost_center, bank_account, reconciliation, commission_rule/version, commission_entry.
- Cobrança: collection_case, collection_action, promise_to_pay, negotiation, approval_request.
- Qualidade: return_request, warranty_case, quality_inspection, repair_order.
- Gamificação: goal, ranking_snapshot, level_rule, campaign, award, badge, referral/mentor_assignment.
- Recrutamento/Academy: candidate_profile, recruiting_stage_event, contract_reference, onboarding, course, lesson, quiz, enrollment, progress, certificate.
- PDV: cash_register, cash_session, cash_movement, store_transfer, pickup_order, loyalty_account/event.
- Integrações: integration_account, webhook_event, outbox_event, processing_attempt.

## Invariantes (V/9)

1. Produto/SKU/variação ≠ peça física; localização, responsável e estado são dimensões distintas ("em maleta e com consultora" deve ser representável).
2. Estoque central, lojas e rede usam a mesma estrutura de localizações/custódia; sem bancos paralelos por canal.
3. Cliente pode ter relações com múltiplos canais; deduplicação por identificadores confiáveis com revisão de conflitos.
4. Origem de venda, consultora, representante e loja registráveis; relação comercial não concede leitura irrestrita de dados pessoais.
5. Venda, entrega, recebimento financeiro e disponibilidade física têm estados separados.
6. Dinheiro em centavos inteiros ou decimal adequado; nunca floats. Pagamento parcial alocado a títulos; não sobrescrever dívida histórica.
7. Eventos externos podem repetir: idempotência, verificação de autenticidade, reconciliação, processamento transacional.
8. Movimentações sensíveis com histórico e estorno; sem edição destrutiva do passado.
9. Regras parametrizadas com versão, vigência, responsável e aprovação; alterar comissão não recalcula o passado sem procedimento explícito.
10. Concorrência: impedir estoque negativo, dupla reserva, dupla baixa e dupla liquidação via locks/constraints/transações.

### Caso de teste financeiro obrigatório (A/12)

Devido 26.469; reconhecido 16.955; recebido 11.783; diferença reconhecida 5.172; novo recebimento 5.000 → residual reconhecido 172. A diferença devido−reconhecido (9.514) não desaparece: mantida separada sob justificativa/decisão.
