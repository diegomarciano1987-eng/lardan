# LARDAN — PROGRESSO (ponto de retomada)

## Checkpoint atual

- **Lote**: 0 concluído; 1 em execução.
- **Último trabalho concluído**: especificação preservada em docs/lardan/, documentação de fontes, rotas, modelo de dados, integrações, decisões pendentes, matriz, inventário e testes. Assets enviados ao CDN e favicon derivado do diamante original.
- **Arquivos alterados**: docs/lardan/* (10 arquivos), src/assets/*.asset.json (6 ponteiros), public/favicon.png, src/styles.css, src/routes/__root.tsx, src/routes/index.tsx e demais rotas públicas base do Lote 1.
- **Migrações aplicadas**: nenhuma (backend ainda não habilitado).
- **Testes executados**: build da plataforma e criação de assets. Demais casos em TESTES-E-EVIDENCIAS.md.
- **Falhas**: nenhuma até o checkpoint.
- **Bloqueios**:
  1. Imagens `lardan-categoria-pulseiras` e `lardan-categoria-brincos` não enviadas — cenas correspondentes ficam fora da home até o envio.
  2. Backend (Lovable Cloud) não habilitado — autenticação real, CMS, persistência de leads e RLS dependem do Lote 2.
  3. Conteúdo institucional, catálogo real e dados empresariais pendentes (ver DECISOES-PENDENTES.md).
- **Próxima ação segura**: Lote 2 — habilitar backend, aplicar migrações mínimas com GRANTs e RLS, autenticação administrativa, papéis em tabela separada, storage de mídias e CMS editorial com rascunho/publicar/preview.

## Comando de retomada

"Continue o Lardan a partir de docs/lardan/PROGRESSO.md. Confira MASTER-SPEC.md e MATRIZ-RASTREABILIDADE.md. Preserve tudo que já funciona. Retome o primeiro requisito não validado do lote registrado, execute um lote verificável, atualize os testes e o checkpoint e informe o próximo passo. Não expanda o escopo nem ative módulos futuros."
