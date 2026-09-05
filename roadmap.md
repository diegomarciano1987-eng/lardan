# LARDAN — Roadmap da Etapa 1

Contrato de execução: LARDAN-ETAPA1-ANALISE-E-PROMPT-LOVABLE.md (seção 2). Site aprovado: preservar.

## Lotes
- [x] L3.1 Segurança crítica: claim_master endurecido, is_active no servidor, preço privado fora da API pública, RPC de papéis, auditoria automática, storage de mídias/imports
- [ ] L3.2 Shell admin por módulos + gestão de usuários/papéis
- [ ] L3.3 Cadastros-base: produtos/variantes, categorias, coleções, fornecedores, locais, responsáveis (+upload de mídia)
- [ ] L3.4 Motor de estoque: razão imutável, saldos em transação, recebimento, kardex, transferência, reserva, inventário, bloqueios, maletas, etiquetas, painéis
- [ ] L3.5 Importador 20k: CSV/XLSX, assistente, 4 modos, staging persistente, lotes transacionais, retomada, homologação com fixture
- [ ] L3.6 Catálogo público real alimentado pelo admin (rotas de categoria/coleção/produto, busca, 404, CTAs pulseiras/brincos)
- [ ] L3.7 Financeiro: contas, categorias, títulos, parcelas, baixas parciais, estorno, conciliação manual, dashboards, vínculo com recebimento
- [ ] L3.8 Asaas preparado (flag off, contratos internos, inbox/outbox, sem conexão)
- [ ] L3.9 Regressão, evidências, docs e devolução

## Estado
- Lote atual: L3.1 concluído; L3.2 em execução.
- Pendências de decisão: e-mail(s) autorizado(s) para bootstrap do primeiro Master (security.bootstrap); bucket `media` criado privado (política do workspace bloqueou público) — imagens públicas do site precisarão de URL assinada ou da liberação de buckets públicos no workspace.
