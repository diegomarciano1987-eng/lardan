# LARDAN — PROGRESSO (ponto de retomada)

## CHECKPOINT VIGENTE (sobrepõe os checkpoints históricos abaixo)

- **Permissões sensíveis — verdade única**: custo (produto e movimentação), documento completo e dados financeiros/PIX só para **Master, Diretoria e Financeiro**; identidade individual da Rede só Master e Diretoria; visão agregada nacional também para Marketing; Representante vê a própria carteira e Consultora só a si; Estoque **não** vê custo; Consultora e Representante não têm permissão administrativa dessas listas.
- **Documento fechado na origem**: `parties.doc`, `parties.doc_canon`, `parties.doc_digits`, `suppliers.tax_id` e `business_entities.tax_id` saíram da concessão de leitura para `authenticated`/`anon`; o número completo só sai por revelação auditada.
- **Prova**: `bun run test:seg` — 45 cenários, 45 aprovados, com saída perfil × cenário. Detalhe em `docs/lardan/TESTES-E-EVIDENCIAS.md`.
- **Pendente**: exercício ponta a ponta de CEP/CNPJ com máscara nos registros, massa sintética de homologação, invariantes permanentes da vitrine, 404 público real, home obedecendo à Central e importação industrial.

## Checkpoint anterior (histórico)


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
- **Próxima ação segura**: L3.3 — cadastros-base no admin: produtos/variantes, categorias, coleções, fornecedores, locais e responsáveis, com upload de mídia, validação no servidor, auditoria e estados vazios reais.

## Comando de retomada

"Continue o Lardan a partir de docs/lardan/PROGRESSO.md e roadmap.md. Confira MASTER-SPEC.md e MATRIZ-RASTREABILIDADE.md. Preserve tudo que já funciona (site aprovado). Execute o próximo lote verificável, atualize testes e checkpoint e informe o próximo passo. Não expanda o escopo nem ative módulos futuros."

## L3.4-A concluído (2026-09-05)
- public_price_list: PK id + índices parciais; variant_id agora aceita nulo. Teste publicar/despublicar OK.
- resync_all_public_prices() executado (0 produtos publicados).
- role_capabilities é a matriz única; leads.view adicionada (master, diretoria, marketing, suporte).
- Painel passa a decidir menu, busca global e atalhos por capacidade (src/lib/capabilities.ts + moduleAllowed).

## L3.5 — Central de Cadastros Unificada (2026-09-05)
- Menu inferior: nova entrada **Cadastro** (ícone ContactRound) apontando para a rota canônica `/admin/cadastros`; o antigo item "Produtos" passou a ser módulo próprio em `/admin/cadastros/produtos`. Nenhum módulo foi removido.
- Base canônica aditiva aplicada: `parties`, `party_roles`, `contact_points`, `party_addresses`, `party_links`, `consultant_profiles`, com `party_id` em suppliers/business_entities/profiles/leads e backfill. Nenhuma migração anterior alterada, nenhum ID trocado, nenhuma fusão automática.
- RPCs: `search_registry`, `registry_counts`, `registry_duplicates`, `convert_lead_to_consultant` (transacional e idempotente).
- Capacidades novas: registry.view, registry.manage, registry.doc.view, registry.finance.view (Marketing e Estoque só view; Financeiro/Cobrança com finance.view; Master/Diretoria completo).
- Telas: Central (`/admin/cadastros`) com busca global, contadores reais e grupos Pessoas e rede / Empresas e parceiros / Catálogo / Estrutura operacional / Financeiro; listagem `/admin/cadastros/pessoas` (paginação, ordenação e filtros no servidor); ficha `/admin/cadastros/pessoas/$id` com 10 abas; `/admin/cadastros/duplicidades`.
- Candidaturas: `<Select>` do shadcn substituído por SmartSelect (regra premium) e botão "Converter em consultora" ligado à RPC.
- CPF/CNPJ 100% local em `src/lib/docs-br.ts`: máscara, normalização, validação matemática, sequências repetidas, duplicidade e mascaramento. Nunca afirma titularidade.
- Detalhes em docs/lardan/CENTRAL-DE-CADASTROS.md.
- Pendências honestas: revendedoras, representantes, clientes, prestadores, transportadoras, lojas, biblioteca de imagens, tabelas de preço, maletas, regiões, motivos de movimentação, códigos de barras e todo o bloco financeiro seguem com selo "Em implantação", sem botão que finja funcionar.

## P1-B — Contrato definitivo da vitrine (parcial)

- Home governada pela Central: `/` lê `home_curation` (`site_settings`, público) e monta as cenas na ordem curada; bloco oculto some, bloco vazio ou leitura com falha cai no fallback editorial aprovado; cena cuja categoria não está publicada perde o botão e exibe "Em breve no catálogo".
- Endereços públicos honestos: categoria inexistente/rascunho/arquivada e produto fora do ar respondem 404 real; `/aneis`, `/colares`, `/pulseiras`, `/brincos` respondem 301 para `/semijoias/<slug>`; slug antigo de categoria redireciona 301 pelo histórico.
- Filtros de categoria não poluem mais o endereço (fim do 307 de normalização em `/semijoias/<slug>`).
- Correção de banco: `taxonomy_publish_blockers` montava o array de pendências de forma inválida e derrubava `publish_taxonomy` com erro de tipo; agora lista as pendências e a publicação recusa com motivo.
- CEP/CNPJ com provedor real conferidos servidor-a-servidor: ViaCEP `01310-100` (miss 577 ms, depois cache) e BrasilAPI CNPJ `00.000.000/0001-91` (miss 205 ms, depois cache). `integration_lookups` registrou miss e hit separados, com referência mascarada.

### Fornecedores e Entidades homologados no navegador (2026-09-06)
- Cinco perfis exercitados com sessão real (Master, Marketing, Estoque, Financeiro, Suporte) nas telas `/admin/cadastros/fornecedores` e `/admin/cadastros/entidades`.
- Cadastro por CNPJ com consulta pública, gravação pelo servidor (`partner_save` passou a receber `_id` explícito), edição e reabertura conferidas; nenhuma duplicidade gerada.
- Documento: Master e Financeiro revelam (cada revelação gravada como `doc.reveal` na auditoria); Estoque vê apenas mascarado, sem botão de revelação.
- Correção: Marketing e Suporte (sem `partners.view`) recebiam "Sem registros", estado desonesto. Agora a tela declara falta de permissão e não consulta o servidor.
- Correção: a ficha do produto liberava "Custo atual" por papel (incluindo Estoque). Passou a obedecer à matriz única, capacidade `catalog.cost.view`; Estoque não vê mais custo em nenhum ponto da ficha.
- Correção de banco: `ensure_profile_party` criava uma ficha de pessoa órfã a cada carregamento autenticado; corrigida e as fichas órfãs removidas (nenhum perfil, candidatura ou consultora afetada).
- Dados sintéticos removidos ao fim (fornecedor, entidade, fichas e contas de teste); auditoria preservada.
- Verificação: 93 testes verdes, tipagem limpa, build de produção concluído. `bun run lint` segue vermelho por formatação Prettier pré-existente em todo o repositório (3.743 apontamentos, nenhum introduzido por este lote).

## Pausa para auditoria externa do ZIP (2026-09-07)

- Nenhum recurso novo ligado para empresa alguma até aprovação.
- Nenhum backfill, massa de homologação ou automação disparada neste momento.
- Módulo em questão **não classificado como aprovado para homologação** — aguardando validação do código.

### Pendências conhecidas registradas

1. **Comportamento real do banco ainda não provado** — precisa de execução de cenários reais e conferência dos efeitos.
2. **Montador deve ser escolhido por lista de colaboradores ativos da mesma empresa, com perfil/capacidade adequada** — nunca por UUID digitado.
3. **Vendedor precisa ter leitura do pós-venda exclusivamente dos clientes da própria carteira**, sem acesso a custos, qualidade interna, comissão ou dados sensíveis.
4. **Termo em PDF versionado e verificável ainda não foi entregue**.
5. **Conversão de assistência fora da garantia para o fluxo Comercial existente ainda não foi entregue**.
6. **Integração com Estoque, Requisições e Compras precisa ser comprovada sem criar pedido de compra pelo Pós-venda**.
7. **Tokens públicos, assinatura, satisfação, fotos privadas, comissão, agenda e isolamento multiempresa ainda precisam de prova comportamental**.

## Vitrine visível (correção urgente)

- Central da Vitrine reorganizada: **Visão geral · Produtos · Categorias · Página inicial** (`src/routes/_authenticated/admin/site.tsx`, `src/components/admin/ShowcaseOverview.tsx`).
- Categoria: cada linha mostra endereço público, quantidade de produtos, pendências e os botões **Editar / Publicar no site / Ver no site / Retirar do ar** (`src/components/admin/ShowcaseTaxonomy.tsx`).
- Produto: publicação individual por linha e por card (**Publicar / Corrigir pendências / Ver no site / Retirar do ar**), sem depender de ação em massa.
- Categorias Brincos e Colares publicadas pelo botão do painel (`publish_taxonomy`); 10 peças reais (5 brincos, 5 colares) com duas imagens cada, preço público, estoque de 12 unidades no Depósito Principal (entrada canônica idempotente `vitrine:<slug>`), publicadas pelo botão por peça (`publish_products`).
- Conferido em janela anônima: `/semijoias/brincos` e `/semijoias/colares` com 5 peças cada, ficha do produto com imagens, e os quatro CTAs da home funcionando em desktop e celular.

## Estoque operacional — lote 1 (07/09/2026)

- Custo corrigido nas duas camadas: o campo não existe no formulário sem
  `stock.cost.view` e a função de registro descarta custo enviado sem a
  capacidade, registrando o descarte em auditoria; custo negativo é recusado.
- Saldos com foto real da peça (URL assinada em lote, uma chamada por página) e
  ficha lateral do item.
- Busca de saldos e de movimentações resolvida no servidor, com espera na
  digitação e cancelamento da consulta anterior.
- Reservas não são simuladas: coluna vazia com aviso "Reservas em implantação".
- Histórico com motivo por extenso, autor, referência e saldo antes → depois
  separado por origem e destino nas transferências.
- Nova movimentação com fluxo por tipo, limpeza de campos ao trocar o tipo,
  justificativa obrigatória em ajuste/perda/avaria, referência obrigatória em
  recebimento e resumo de confirmação antes de gravar.
- Pendências: motor de reservas, inventário completo, recebimentos, maletas e
  rastreamento físico continuam não entregues.

## Motor de reservas de estoque (07/09/2026)

- Migração aditiva: tabela `stock_reservations` (protocolo, peça, local,
  quantidade, situação, origem, referência, pessoa, validade, autor, motivo de
  cancelamento, movimento gerado, chave de repetição), enum
  `stock_reservation_status`, coluna `stock_movements.reservation_id`,
  restrição `stock_balances_reserved_nonneg` e seis capacidades de reserva.
- Disponível passou a ser calculado no servidor: físico menos reservado ativo.
  A coluna Disponível aparece nos saldos e na ficha lateral; o aviso "Reservas
  em implantação" foi removido de toda a tela.
- Operações oficiais: criar, confirmar (vira saída física única), liberar,
  cancelar com motivo e expirar. Todas idempotentes e auditadas; escrita direta
  em saldos e reservas continua impossível pela API.
- Saída, transferência, ajuste e contagem recusam consumir unidade reservada.
- Nova área Reservas em `/admin/estoque` com busca no servidor, filtros,
  paginação e ações por linha; formulário de nova reserva mostra físico,
  reservado e disponível antes de gravar.
- Bateria `tests/security/reservas.test.ts`: 12 provas contra o banco real, todas
  aprovadas. `tests/security/estoque.test.ts` continua 10/10.
- Pendências: agendador periódico da expiração, escopo próprio do Representante,
  maleta, venda, inventário por sessão e recebimentos.

## Pré-limpeza controlada do banco (07/09/2026)
Rodada somente de inspeção. Nada foi excluído, arquivado, despublicado ou alterado.
Relatório completo em `docs/lardan/PRE-LIMPEZA.md`; exportações de rollback em `/mnt/documents/lardan-prelimpeza/`.
Conclusão principal: as rotinas `homolog_purge*` são inadequadas porque ignoram `stock_reservations`,
`stock_balances.reserved` e `stock_movements.reservation_id`. Especificação de `homolog_purge_v2` registrada.


## Limpeza controlada definitiva — 2026-09-07

Executada com sucesso. Detalhes completos em `docs/lardan/LIMPEZA-CONTROLADA.md`.
Resumo: 10.101 produtos sintéticos, 8.485 movimentos, 8.471 saldos, 63.300 linhas de
importação, 3 categorias, 2 coleções, 2 fornecedores, 1 depósito e 3 mídias órfãs removidos;
165 pessoas removidas e 27 anonimizadas; 28 contas de teste encerradas. Preservados os 20
produtos publicados, 38 variantes, 40 fotos, 4 categorias publicadas, 240 unidades no
Depósito Principal e a auditoria integral. `brinco01` arquivado como registro histórico.
Contraprovas: site público conferido em janela anônima (computador e celular) e
`bun run test:seg` com 67 de 67 cenários aprovados.
