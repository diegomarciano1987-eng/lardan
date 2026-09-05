# LARDAN — PROGRESSO (ponto de retomada)

## Checkpoint atual

- **Lote**: Etapa 1 — L3.1 (segurança crítica) e L3.2 (shell admin por módulos) concluídos; L3.3 (cadastros-base) é o próximo.
- **Último trabalho concluído**: L3.2 — área administrativa reorganizada em módulos com estado explícito: Visão geral (contagens reais), Candidaturas e contatos (leitura com protocolo), Cadastros (em implantação), Estoque/Importação/Financeiro/Integrações (desativados, só especificação visível, nenhuma ação ativa), Usuários e papéis (lista real, conceder/revogar via grant_role/revoke_role, ativar/desativar — tudo auditado), Auditoria (consulta com filtros, somente Master/Diretoria). Perfil do usuário criado automaticamente no primeiro acesso (ensure_profile no beforeLoad autenticado). Master atual: diegomarciano1987@gmail.com (bootstrap já consumido).
- **Arquivos alterados**: src/lib/admin-modules.ts, src/components/admin/AdminShell.tsx, src/routes/_authenticated/route.tsx (ensure_profile), src/routes/_authenticated/admin/* (route, index, usuarios, auditoria, leads, cadastros, estoque, importacao, financeiro, integracoes; antigo admin.tsx removido), roadmap.md, docs/lardan/PROGRESSO.md, docs/lardan/TESTES-E-EVIDENCIAS.md.
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
