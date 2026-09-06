# LARDAN — Roadmap da Etapa 1

Contrato de execução: LARDAN-ETAPA1-ANALISE-E-PROMPT-LOVABLE.md (seção 2). Site aprovado: preservar.

## Lotes
- [x] L3.1 Segurança crítica: claim_master endurecido, is_active no servidor, preço privado fora da API pública, RPC de papéis, auditoria automática, storage de mídias/imports
- [x] L3.2 Shell admin por módulos + gestão de usuários/papéis
- [ ] L3.3 Cadastros-base: produtos/variantes, categorias, coleções, fornecedores, locais, responsáveis (+upload de mídia)
- [~] L3.4 Motor de estoque: razão imutável, saldos em transação, tela de saldos/movimentações e registro de entrada, saída, transferência, ajuste e inventário (feito). Falta: kardex, reservas, maletas, etiquetas, painéis
- [ ] L3.5 Importador 20k: CSV/XLSX, assistente, 4 modos, staging persistente, lotes transacionais, retomada, homologação com fixture
- [ ] L3.6 Catálogo público real alimentado pelo admin (rotas de categoria/coleção/produto, busca, 404, CTAs pulseiras/brincos)
- [ ] L3.7 Financeiro: contas, categorias, títulos, parcelas, baixas parciais, estorno, conciliação manual, dashboards, vínculo com recebimento
- [ ] L3.8 Asaas preparado (flag off, contratos internos, inbox/outbox, sem conexão)
- [ ] L3.9 Regressão, evidências, docs e devolução

## Estado
- Lote atual: L3.2 concluído; L3.3 (cadastros-base) é o próximo.
- Pendências de decisão: e-mail(s) autorizado(s) para bootstrap do primeiro Master (security.bootstrap); bucket `media` criado privado (política do workspace bloqueou público) — imagens públicas do site precisarão de URL assinada ou da liberação de buckets públicos no workspace.

## Lote corretivo R0/R1 (prompt de 06/09/2026)
- [x] R0.1 Publicação canônica (publish_products/unpublish_products + trava no banco + ficha e ações em massa usando a operação única)
- [x] R0.2a get_party_full VOLATILE (registro de leitura sensível funcionando) e duplicidades sem CPF/CNPJ cru
- [ ] R0.2b tax_id de fornecedores/entidades mascarado por RPC; unit_cost_cents oculto sem capacidade de custo
- [ ] R0.3 elegibilidade pública única (404 real, mídia sem prazo estendido, URLs absolutas, teto de paginação, agendamento honesto)
- [ ] R0.4 home consumindo home_curation com fallback
- [ ] R1.1 identidade real do lote de importação (hashes/fingerprints, arquivo no bucket imports)
- [ ] R1.2 retomada real de importação
- [ ] R1.3 de-para completo (24 campos)
- [ ] R1.4 escala/segurança da importação
- [ ] R1.5 estoque: busca real, custo mascarado, promessas honestas
- [ ] R1.6 scripts/CI e bateria de testes
- [ ] Limpeza documental (PROGRESSO, ROADMAP-RASTREAVEL, Matriz, Evidências)
