# LARDAN — PROGRESSO (ponto de retomada)

## Checkpoint atual

- **Lote**: Etapa 1 — L3.1 (segurança crítica) concluído; L3.2 (shell admin por módulos + gestão de usuários/papéis) é o próximo.
- **Último trabalho concluído**: L3.1 — verificação de papel passa a exigir conta ativa no servidor; usuário comum não altera o próprio `is_active`; bootstrap do primeiro Master endurecido (trava de concorrência + lista de e-mails autorizados em configuração privada `security.bootstrap`); papéis concedidos/revogados só via `grant_role`/`revoke_role` (Master, com auditoria); último Master ativo protegido; preço/custo fora da API pública (concessão por coluna + `public_price_list` sincronizada por trigger); auditoria automática em 9 tabelas sensíveis; funções internas revogadas da API; buckets `media` (privado, 10MB) e `imports` (privado, 50MB) com políticas por papel.
- **Arquivos alterados**: roadmap.md, docs/lardan/PROGRESSO.md, docs/lardan/TESTES-E-EVIDENCIAS.md. Migrações aplicadas via ferramenta (3 neste lote).
- **Migrações aplicadas (Etapa 1)**:
  1. Segurança crítica (has_role/has_any_role/is_staff com is_active; guard_profile_update; security.bootstrap; claim_master_role endurecido; guard_last_master; grant_role/revoke_role; revogação de SELECT anon em products/product_variants; views públicas → substituídas; audit_row_change + triggers em user_roles, profiles, products, product_variants, categories, collections, pages, site_settings, media_assets).
  2. Substituição das views por `public_price_list` + sync por trigger + concessão de SELECT por coluna para anon (preço/custo inalcançáveis).
  3. Revogação de funções internas da API (set_updated_at, gen_protocol, guards, syncs); superfície pública final: submit_lead, submit_contact_request (anon) e funções de papel/perfil (authenticated).
  4. Políticas de storage: media (leitura staff; escrita master/diretoria/marketing), imports (master/diretoria/estoque; delete só master).
- **Testes executados**: linter de segurança após cada migração — erros de view eliminados; restam 15 avisos esperados e documentados (funções SECURITY DEFINER que são a superfície intencional da API, todas com escopo auth.uid()).
- **Falhas**: bucket público `media` bloqueado pela política do workspace; criado privado.
- **Bloqueios**:
  1. E-mail(s) autorizado(s) ao primeiro Master precisam ser gravados em `security.bootstrap` antes de alguém assumir — aguardando definição do usuário.
  2. Imagens do site público vindas do bucket `media` exigirão URL assinada ou liberação de buckets públicos (Settings → Privacy & Security do workspace).
  3. Conteúdo institucional, catálogo real e dados empresariais pendentes (DECISOES-PENDENTES.md).
- **Próxima ação segura**: L3.2 — shell administrativo por módulos (Visão geral, Cadastros, Estoque, Importação, Financeiro, Integrações, Sistema) com estado explícito (ativo/desativado/em implantação), gestão de usuários e papéis, filtros na auditoria. Módulos sem dados: "nenhum registro", nunca número fictício.

## Comando de retomada

"Continue o Lardan a partir de docs/lardan/PROGRESSO.md e roadmap.md. Confira MASTER-SPEC.md e MATRIZ-RASTREABILIDADE.md. Preserve tudo que já funciona (site aprovado). Execute o próximo lote verificável, atualize testes e checkpoint e informe o próximo passo. Não expanda o escopo nem ative módulos futuros."
