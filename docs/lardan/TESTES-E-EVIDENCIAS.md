# LARDAN — Testes e Evidências

Distinção obrigatória: EXECUTADO | INSPECIONADO | NÃO TESTADO. Nada aqui é marcado como testado por leitura de código.

## CHECKPOINT VIGENTE — verdade única de permissões

Este bloco vale sobre qualquer tabela anterior deste arquivo. As seções abaixo
são histórico cronológico e não devem ser lidas como estado atual.

| Dado sensível | Quem tem acesso |
| --- | --- |
| Custo (produto e movimentação) | Master, Diretoria, Financeiro |
| Documento completo (CPF/CNPJ) | Master, Diretoria, Financeiro |
| Identidade individual na Rede | Master, Diretoria |
| Visão agregada nacional da Rede | Master, Diretoria, Marketing |
| Escopo próprio na Rede | Representante (carteira), Consultora (só a si) |
| Dados financeiros/PIX do cadastro | Master, Diretoria, Financeiro |
| Auditoria | Master, Diretoria |
| Publicação da vitrine | Master, Diretoria, Marketing |
| Importação industrial | Master, Diretoria, Estoque |

Estoque **não** vê custo (nem de produto, nem de movimentação). Consultora e
Representante não têm nenhuma dessas permissões administrativas.

O número completo do documento não é mais legível pela leitura direta das
tabelas `parties`, `suppliers` e `business_entities` por **nenhum** perfil: as
colunas `doc`, `doc_canon`, `doc_digits` e `tax_id` foram retiradas da concessão
de leitura; o valor completo só sai pelas funções de revelação auditada.



## Lote 0/1

| Caso | Método | Resultado |
| --- | --- | --- |
| Build do projeto | EXECUTADO (build automático da plataforma) | ver checkpoint em PROGRESSO.md |
| Assets no CDN (6 ponteiros .asset.json) | EXECUTADO (CLI lovable-assets) | 6 ponteiros criados; 4 imagens editoriais + diamante + logo completa |
| Favicon derivado do diamante original | EXECUTADO | public/favicon.png 64×64 gerado; favicon.ico padrão removido |
| Hero em 360/390/768/1280/1440 px | NÃO TESTADO | pendente Lote 5 |
| Navegação por teclado e foco visível | NÃO TESTADO | pendente Lote 5 |
| prefers-reduced-motion | INSPECIONADO (implementado via media query) | pendente verificação executada |
| 404 real em slug inexistente | NÃO TESTADO | pendente Lote 5 |
| Persistência de formulários | NÃO APLICÁVEL AINDA | backend no Lote 2 |
| Isolamento de dados/RLS | NÃO APLICÁVEL AINDA | backend no Lote 2 |
| Performance (LCP/INP/CLS) | NÃO MEDIDO | sem medição, nenhuma nota declarada |

Nenhuma screenshot, nota de Lighthouse, resultado de query ou teste E2E foi inventado.

## Lote 1 — Verificação em navegador (Playwright, 1280x1800 e 390x844)
- Home `/` renderiza os três estados do hero: diamante nítido (topo), wordmark LARDAN isolado (~50% do scroll do hero), editorial com tagline e CTA (~85%).
- Cenas de categoria Anéis e Colares renderizam com as imagens enviadas; editorial "Peças para os seus momentos" com a imagem conceitual.
- Menu mobile abre/fecha via botão, com itens de navegação acessíveis.
- Evidências: /tmp/browser/lardan/screenshots/1_hero_top.png, 3_wordmark.png, 4_editorial.png, 5_categories.png, 7_mobile_menu.png.

## Lote 1.1 — Revisão de direção (Playwright, 1280x900)
- Hero: diamante avança na câmera, gira e se dissolve em estouro de luz (sem véu rosé); wordmark LARDAN aparece sobre fundo limpo. EXECUTADO — /tmp/browser/lardan2/2_transicao.png, 3_wordmark.png.
- Segunda sessão: imagem sessao_2-2 revelada por lâminas verticais em cascata; textos "Semijoias / Única. Como cada história. / Semijoias para acompanhar os seus momentos. / Conhecer semijoias". EXECUTADO — 5_sessao2_texto.png.
- Categorias Anéis, Colares, Pulseiras e Brincos em tela cheia com imagem de fundo, sem card nem sombra. EXECUTADO — 6_aneis.png, 7_pulseiras.png.
- Menu sem cápsula/card: apenas linha fina sob o item ativo/hover. EXECUTADO (visível em todas as capturas).
- Console do navegador sem erros. EXECUTADO.

## Lote 2 — backend real (Playwright 1280x1800, http://localhost:8080)

- `/admin` sem sessão → redirecionado para `/acesso` (rota agora sob `_authenticated`, `ssr: false`).
- `/acesso` renderiza login por e-mail/senha e botão "Entrar com Google" (provedor Google configurado).
- `/seja-lardan?utm_source=teste&utm_campaign=lote2` → candidatura gravada, protocolo devolvido (`CAP-AAAAMMDD-XXXXXXXX`).
- `/contato` → mensagem gravada, protocolo devolvido (`CON-AAAAMMDD-XXXXXXXX`).
- Console sem erros.
- Registros de teste removidos do banco após a verificação.

### Decisão técnica
`INSERT ... RETURNING` é bloqueado pela RLS para visitantes (sem política de SELECT, por
projeto). Os envios públicos passam a usar as funções `submit_lead` e
`submit_contact_request` (SECURITY DEFINER, validação de nome/contato/UF/consentimento,
truncamento de campos), que devolvem apenas o protocolo. Visitantes continuam sem
qualquer leitura das tabelas `leads` e `contact_requests`.

### Warnings do linter
`Public/Signed-In Users Can Execute SECURITY DEFINER Function` — esperados: são as duas
funções de envio público e as funções de verificação de permissão usadas pelas políticas
de RLS. Nenhuma delas expõe dados de terceiros.

## Fundos mobile + véu de leitura (392x719, Playwright, dpr 2)
- Hero, sessão 2 e categorias Anéis/Pulseiras/Brincos usam imagens verticais exclusivas no celular via `<picture>` + `media="(max-width: 767px)"`; Colares segue com a imagem padrão (sem versão mobile enviada).
- Textos no mobile: véu escuro suave (gradiente oklch 0.18) com backdrop blur de 6px e máscara de fade, ativado junto com o texto; cor do texto clara só no mobile (`max-md:text-background`).
- Desktop inalterado (véu marfim original). Console sem erros.

## Refino mobile (392x719): menu, véu e lados do texto
- Menu mobile: vidro fosco premium (bg-background/40 + backdrop-blur-2xl, borda fina, cantos arredondados, sombra suave).
- Véu escuro dos textos: blur 6px→3px, área útil 55%→38% e fade em 62% (não invade mais a imagem); opacidade 0.62→0.45.
- Lados invertidos nas categorias: Colares→esquerda, Pulseiras→direita, Brincos→esquerda (texto fora das peças). Anéis mantido à esquerda.
- Verificado com Playwright, console sem erros.

## L3.1 — Segurança crítica (migrações + linter)
- is_active valendo no servidor: has_role/has_any_role/is_staff exigem conta ativa; guard_profile_update impede autoalteração de is_active e autodesativação do Master.
- Bootstrap: claim_master_role com pg_advisory_xact_lock + allowlist security.bootstrap (privada); sem e-mail autorizado, retorna exceção. Masters existentes preservados (retorna false).
- Papéis: grant_role/revoke_role só Master, com auditoria; guard_last_master protege o último Master ativo; policy de escrita direta em user_roles removida.
- Preço privado: SELECT de anon revogado em products/product_variants; concessão por coluna (sem price_cents/cost); preços públicos servidos por public_price_list, sincronizada por trigger (publicar/despublicar/trocar preço reflete na hora).
- Auditoria: audit_row_change em user_roles, profiles, products, product_variants, categories, collections, pages, site_settings, media_assets; audit_logs imutável.
- API: funções internas (triggers, gen_protocol, set_updated_at, syncs) revogadas de PUBLIC/anon/authenticated. Superfície final: submit_lead + submit_contact_request (anon) e funções de perfil/papel (authenticated) — 15 warnings do linter esperados e justificados.
- Views SECURITY DEFINER removidas (erro do linter eliminado na 2ª migração).
- Storage: buckets media (privado, 10MB) e imports (privado, 50MB); policies por papel; tentativa de bucket público bloqueada pelo workspace (registrado em PROGRESSO.md).

## L3.2 — Shell admin por módulos (Playwright, 1280x900, sessão autenticada)
- /admin sem sessão redireciona para /acesso. OK.
- Visão geral: contagens reais (0/0/0/0, sem números fictícios) e cartões de módulo com estado (ATIVO / EM IMPLANTAÇÃO / DESATIVADO). OK.
- Usuários e papéis: lista real (Master diegomarciano1987@gmail.com), conceder/revogar papel, ativar/desativar. Antes do ajuste, a ficha (profile) não existia — corrigido com ensure_profile automático no beforeLoad autenticado. OK.
- Auditoria: consulta com filtros (Master/Diretoria). OK.
- Candidaturas e contatos: abas Candidaturas/Mensagens, estado vazio real. OK.
- Estoque/Importação/Financeiro/Integrações: apenas especificação, nenhuma ação ativa. OK.
- Console: sem erros de aplicação (apenas aviso React conhecido de state update fora do mount no fluxo de redirect).

## L3.3 — Design system Livro-Razão Visual (verificado)
- Playwright 1440x900 autenticado: `/admin` renderiza cabeçalho com marca, busca global, avatar com papel Master, grade 22/56/22, atalhos com estados honestos (Em construção / Em breve) e painéis "Sem dados" onde não há registro. Console sem erros.
- Busca global (Ctrl+K): consulta ao servidor, retorno honesto "Nenhum resultado autorizado" quando não há registro.
- Menu inferior flutuante: desktop com módulos por papel; mobile 390x844 com 5 itens + "Mais módulos".
- Rotas novas: `/admin/site` e `/admin/configuracoes`. Tipos verificados sem erro.

## L3.5 — Central de Cadastros (Playwright 1280x1800, sessão Master)
- `/admin/cadastros`: cabeçalho, busca global, 4 indicadores reais e 5 grupos renderizados; cartões sem rota exibem "Em implantação". Console sem erros.
- `/admin/cadastros/pessoas`: listagem paginada pelo servidor com o registro real LC-000001 (Diego Marciano), documento mascarado, filtros premium (SmartSelect) de tipo, papel e situação.
- `/admin/cadastros/pessoas/$id`: ficha aberta pela linha da tabela; 10 abas; completude 60% com lista honesta do que falta (Documento, Endereço); papéis Colaborador e Usuária do sistema já vinculados pelo backfill.
- `registry_counts` respondeu 200 com números reais (1 pessoa, 1 produto, 1 usuário, 1 incompleto).
- Typecheck `bunx tsgo --noEmit` limpo.
- Não testado ainda: conversão candidata→consultora ponta a ponta (não há candidatura real na base) e perfis não-Master (só existe o Master).

## P0 — Fechamento de segurança (migrações aplicadas + provas)

Método de cada linha declarado. Nada marcado como testado por leitura de código.

| Item | Método | Resultado |
| --- | --- | --- |
| Migração P0 (documento, custo, escopo de rede, logs de integração) | EXECUTADO | Aplicada com sucesso após corrigir o nome da coluna de retorno de `network_geo_municipios` (a tentativa anterior falhou inteira e nada tinha sido gravado) |
| `SELECT` direto em `parties` e `stock_movements` pela API | EXECUTADO (pg_catalog) | Revogado para `anon` e `authenticated`; leitura só por RPC |
| Custo em `variant_costs` | EXECUTADO (pg_policies) | Leitura condicionada a `can_view_costs` |
| Funções administrativas abertas a visitante | EXECUTADO (linter + aclexplode) | 21 → 7; as 7 restantes são as legítimas (candidatura, contato e catálogo publicado) |
| Papéis com acesso a custo / documento / identidade da rede | SUPERADO — ver CHECKPOINT VIGENTE no topo | A leitura desta rodada ainda incluía Estoque em custo; corrigido depois (Estoque perdeu `stock.cost.view` e `catalog.cost.view`) |
| Máscara de CPF/CNPJ/CEP em `integration_lookups` | INSPECIONADO (trigger criado na migração) | Não exercitado ponta a ponta nesta sessão |
| Telas `/admin/estoque` e `/admin/cadastros/pessoas` | NÃO TESTADO NO NAVEGADOR | Sem sessão disponível no ambiente de verificação (`signed_out`); typecheck limpo, mas a tela não foi exercitada |
| Regressão completa da seção 10 do documento enviado | NÃO TESTADO | Depende de sessão autenticada |

## Bateria automática de permissões (tests/security)

Comando: `bun run test:seg` (vitest). Cria contas sintéticas `homolog.*@lardan.test`
via API de administração, atribui um papel a cada uma, executa as provas contra o
banco real e apaga as contas ao final. Nenhum usuário real é usado.

Resultado da última execução: 8 de 8 aprovadas.

| Prova | Resultado |
| --- | --- |
| Visitante não lê parties/stock_movements/variant_costs/profiles pela Data API | passou (sem dado) |
| Visitante não executa stock_movements_list, list_parties, publish_products, my_roles | passou (bloqueado) |
| Visitante lê catálogo publicado (public_categories) | passou |
| Papel Estoque: custo unitário ausente na resposta (chave removida, não nula) | passou |
| Master e Financeiro: custo unitário presente | passou |
| Consultora: estoque bloqueado (42501) | passou |
| Consultora: documento não sai aberto e revelação é negada | passou |
| Master com perfil desativado: zero capacidades | passou |

### Correções provadas nesta rodada

- `stock.cost.view` removida do papel **Estoque** (custo agora só Master, Diretoria, Financeiro).
- `stock_movements_list` estava **quebrada em produção** (`CREATE TABLE AS is not allowed in a
  non-volatile function`): a aba Movimentações nunca carregava. Reescrita sem tabela temporária.
- Verificação de permissão da Inteligência da Rede era feita com o cliente de serviço, e
  `has_capability` exige `auth.uid()` — retornava sempre falso e barrava até o Master.
  Passou a usar o cliente do próprio usuário.

### Homologação de tela (Playwright, sessão real do Master)

- `/admin/rede`: carrega, sem erro de permissão, indicadores em zero (base sem dados).
- `/admin/estoque` aba Movimentações: carrega sem erro.
- Console sem erros nas duas telas.

### Funções acessíveis a visitante (7, todas legítimas)

`public_catalog_browse`, `public_catalog_list`, `public_categories`, `public_category`,
`public_product`, `submit_contact_request`, `submit_lead`.
