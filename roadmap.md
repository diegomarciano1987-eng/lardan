# Roadmap
## Limpeza HOMOLOG c — 23/10, 19:35 UTC
- [x] Origem: bateria de testes da base real rodada às 19:00–19:07 criou 48 cadastros, 18 maletas e depósitos de teste; nenhum movimento no DEP-01.
- [x] Arquivado (lote homolog-limpeza-20261023c, backup na auditoria): 18 maletas, 3 reservas, 48 cadastros, 3 logins/3 papéis, 4 produtos, 10 variações, 1 imagem, 4 depósitos; recontagem 0 fora do financeiro.
- [x] Bateria da base real bloqueada sem autorização explícita.
- [ ] 4 importações de teste concluídas continuam no histórico (sistema protege lote concluído); financeiro de teste preservado por pedido.
## Busca, anel e montagem — 23/10, 19:24 UTC
- [x] Busca inteligente: pessoas estourava o tempo (8 s) e mostrava "nada"; regras de acesso otimizadas (0152), 0,2–0,4 s; erro real agora aparece.
- [x] Anel com aro (base + 2 dígitos): colaboradora com montagem registra o tamanho; só "ver" não; teste isolado 3/3.
- [x] Montagem: card dividido (descrição | foto grande), botão "Ver em tela cheia".
- [x] Impressão em 1 clique direto para a impressora, sem janela/prévia, em todos os botões.
- [ ] Silêncio total da pergunta do navegador depende do Chrome da estação em --kiosk-printing com Argox padrão; impressão física não validada; não publicado.
## Carteira SmallData autorizada — 23/10, 18:41 UTC
- [x] Prévia oficial Master: exatamente 45 representantes e 3.617 vínculos de praça, zero perfis novos.
- [x] Aplicados somente campos vazios; lote cvs-20261023-154230-de45; nenhum representante ligado manualmente.
- [x] Log: 45 representante + 3.617 praça, nenhum valor preexistente alterado; praças vazias 3.958 → 339; nova prévia 0/0. Provas em docs/lardan/CARTEIRA-SMALLDATA-0137-APLICADA.md; sem desfazer ou publicar.
## Plano solicitado — 23/10, 18:22 UTC
- [x] Contraste explícito do botão compartilhado; cockpit e lista Produtos conferidos na sessão real de Ketllin.
- [x] Seletores de representante alimentados diretamente pelo vínculo, sem resultados compartilhados entre perfis; filtro e Nova remessa mostram Daniel. Não reproduzida troca de identidade em registro histórico.
- [x] Código existente kits.code em Code 128 no mesmo rolo; lookup protegido, sem sequência nova; QR antigo continua reconhecido.
- [x] Visão Geral pessoal carrega na sessão real; registro imutável de bipagens via 0149, autoria real, manual separado, sem inventar histórico; login continua abrindo Maletas.
- [x] Etiqueta por peça na montagem/conferência, com suspensão de foco enquanto diálogo aberto.
- [x] Bancada limpa: 440 testes isolados, oito testes etiquetas, sem falhas; provas em docs/lardan/MONTAGEM-PESSOAL-2026-10-23.md.
- [ ] Matriz visual montagem/conferência/documentos e bipagem → resumo com dados em tela: nenhuma maleta operacional acessível na carteira Daniel desta sessão; não criar operação fictícia na base compartilhada. Rotinas verificadas na bancada isolada, não substituem prova visual.
- [ ] Impressão física Argox e leitura: dependem da estação; interface não publicada.
## Sete correções autorizadas — 23/10, 17:44 UTC
- [x] 1 Botão destacado Imprimir etiquetas na lista de Produtos; folha real com 20 etiquetas.
- [x] 2 Colaboradora consulta somente Consultoras em Cadastros, com rotas protegidas.
- [x] 3 Estoque removido e bloqueado; motor oficial de montagem preservado, reservas privadas.
- [x] 4 Inteligência e histórico restritos ao representante vinculado, no banco; sessão real conferida.
- [x] 5 Remessas, praças e consultoras restritas; nove opções de praça na sessão de Ketllin, 126 remessas históricas de Daniel.
- [x] 6 Arquivamento reversível: 4 produtos e 32 cadastros HOMOLOG; 36 backups e auditoria.
- [ ] 6b Logins e registros financeiros/Asaas de testes: aguardam rotina oficial e confirmação das dependências externas; não purgar histórico.
- [x] 7 Rolo alça à direita: base 95 mm, suporte 100 mm, área esquerda 30 mm, 12 mm, uma coluna, intervalo 3 mm. Sete relatórios em Files e docs/lardan/SETE-CORRECOES-2026-10-23.md; 434 testes isolados + 7 etiquetas, zero falhas, build OK.
- [ ] Validar impressão física — depende da Argox e leitor na estação; não publicar sem pedido.
## Etiquetas Argox — 23/10
- [x] Impressão pelo navegador; formato inicial três pistas substituído pelo novo rolo de uma coluna em 23/10; códigos reais sem nova numeração e ajustes por estação.
- [x] Acesso na ficha/variantes, lista Produtos, saldos/detalhe Estoque, remessa, maleta e documentos pós-montagem.
- [x] Seis testes aprovados; conta autorizada abriu folha com brinco real barcode 17942; 20 ações na lista e 20 em estoque; sem erros de navegador.
- [ ] Impressão física e leitura na Argox local — dependem do computador/rolo da equipe; não publicado.
## Pacote 0136-2 — primeira montagem e login (23/10)
- [x] Revisar e aplicar as rotinas do pacote sem apagar dados; aplicada como 0137, diferença apenas no fim de arquivo.
- [x] Integrar login, porta Operação e classificação das peças; arquivos idênticos ao pacote e regras atualizadas.
- [x] Bancada recriada; 424 testes / 0 falhas; tela Master e erro de código inválido conferidos. Login válido de colaboradora real não exercitado para preservar contas.
- [x] Representantes e prévia autenticada: 45 representantes / 3.617 praças, sem aplicação; provas em docs/lardan/APLICACAO-0136-2-PROVAS.md.
- [x] Carteira aplicada conforme autorização enviada às 18:41 UTC; 45 representante e 3.617 praça. Vínculos manuais não autorizados e não executados.
## Custo no cockpit de produtos (23/10)
- [x] Lista de produtos: coluna Custo só para Master/Diretoria/Financeiro, via product_costs_read (nunca no select da lista).
- [x] Ficha: custo, margem, valor do bruto e preço sugerido só para quem tem catalog.cost.view; demais perfis veem aviso.
- [x] Suíte isolada 358/0 (4 novos em produto-custos-tela), tsgo limpo, build OK; lista real como Master mostrou Custo em 20/20 linhas; prints em /mnt/documents/custo-produtos/; não publicar.
- [ ] Achado pré-existente: products.cost_price_cents é legível por select direto (sem restrição de coluna) — informar Diego antes de qualquer correção.
## Pacote 0125 — venda pela cobrança (23/10)
- [x] Aplicar o SQL do pacote, preservar funções/mensagens e atualizar a regra do histórico; diferença única de um espaço de indentação registrada em docs/lardan/APLICACAO-0125-PROVAS.md.
- [x] Rodar toda a suíte isolada: 354/0; comprovar colunas, fontes e bloqueio das funções internas na base compartilhada; build OK.
- [ ] Diego importa o novo CSV pela tela; 0125 aplicada, aguardando a importação reservada a Diego.
- [ ] Depois da importação de Diego: conferir as fontes, os 34 meses e março/julho de 2026 na tela Master; não publicar.
## Pacote 0123 — acertos com remessa aberta (22/10)
- [x] Aplicar SQL exato pela ferramenta oficial e atualizar leitura do ranking, teste e documentação do pacote.
- [x] Recriar bancada e executar toda a suíte isolada: 335/0; base real: 22.977 acertos, 36/36 meses iguais; ranking Master com 30 linhas reais.
- [x] Entregar provas e limitações em docs/lardan/APLICACAO-0123-PROVAS.md e anexos; não publicar.
## Histórico JFlex — pacote recebido em 22/10
- [ ] Na carga operacional das maletas na rua, ativar consultoras vinculadas e atribuir a praça da remessa; aguarda arquivos de maletas e revisão do caminho de carga, separado do histórico somente leitura.
- [x] Conferir 0112 exata e conflitos; aplicada pela ferramenta oficial, sem alterar pacote.
- [x] Integrar importação Master, fichas, remessas, rede, início consultora, sugestão de montagem e referência fiscal usando a biblioteca fornecida — provas em docs/lardan/JFLEX-TELAS-2026-10-22.md.
- [x] Rodar testes isolados, conferir permissões e telas vazias; typecheck limpo, suíte isolada 298/298, nenhum CSV real importado, nada publicado.
- [ ] Diego importa os 10 CSV pela tela Histórico JFLEX (Configurações, só Master); CSVs ficam só na memória do navegador.

## Unificações autorizadas — 22/10
- [x] Reconferir Larissa Persinato e Saylla por documento, nome e endereço; não unir homônimos nem alterar Daniel/guilherme.
- [x] Unificar Saylla LC-003392 → LC-007428 pela rotina oficial; títulos, parcelas, valores, vencimentos e auditoria relidos; ficha aberta e recarregada.
- [ ] Unificar Larissa LC-007427 → LC-003310 — bloqueio: duas fichas de consultora e bairros Centro/Setor 5; exige revisão específica das fichas e confirmação cadastral, sem contornar a proteção.
- [x] Entregar provas em docs/lardan/UNIFICACOES-2026-10-22.md; nenhum status de consultora alterado, nenhuma maleta modificada, sem publicar.
## Larissa — financeiro completo e alvará judicial (19/10)
- [x] Liberar as 28 permissões financeiras somente para Larissa Reginalda, com autorização, auditoria e sem Master; Configurações/Auditoria abertas na sessão real.
- [x] Registrar liberação de alvará pela aba Judicial com conta/data, baixa oficial, repetição e estorno protegidos; formulário real aberto sem confirmar valores.
- [x] Validar permissões e sincronismo: 8 testes novos + 17 de baixa/tarifa + 5 de acordos/lote; recebimento R$500 confirmado e relido em tela isolada; provas em docs/lardan/LARISSA-FINANCEIRO-ALVARA-2026-10-19.md. Sem publicar.
## Menu do painel Master (reordenação) — 17/10
- [x] Reordenar: Visão Geral, Financeiro, Produtos, Central de Avisos, Biblioteca, Candidaturas primeiro; Trocas/Garantias depois de Cobrança — src/lib/admin-modules.ts
- [x] Desktop com os seis prioritários e celular com cinco + Mais módulos — BottomDock
- [x] Zero rolagem horizontal no celular — dock compacto, tabela da Visão Geral com rolagem própria e cabeçalho ajustado; 1280 e 390 px conferidos
- [x] Typecheck limpo; nada publicado
## Revisão 0100 e Biblioteca — 17/10
- [x] Aplicar patch exato com registro oficial da 0100; pacote 11 apenas no repositório — quatro arquivos conferidos idênticos
- [x] Separar artes, campanhas, informativos e materiais na Biblioteca master e consultora — formulário Master e quatro categorias na conta autorizada, 390/1280 px
- [x] Validar suíte esperada 265/265 e conferir sinais automáticos de compilação — 265 originais + 4 da Biblioteca: 269 aprovados, 0 falhas, banco recriado; build OK
- [x] Entregar provas de leitura/publicação isolada de documentos, diferenças e limitações; não publicar — docs/lardan/REVISAO-0100-BIBLIOTECA.md
- [ ] Validar envio → publicação → abertura/download de documento real na Biblioteca — aguarda material aprovado, biblioteca real vazia; não inserir conteúdo fictício

## Pacote prontidão fiscal — revisão 16/10, noite
- [x] Conferir aplicação exata do patch — seis arquivos idênticos ao ZIP, sem conflitos
- [x] Aplicar apenas a 0099 pela ferramenta oficial; pacote 11 mantido pendente
- [x] Adicionar leitura de prontidão em Integrações para quem vê financeiro — tela real Master conferida
- [x] Executar suíte isolada — 262 aprovados, 0 falhas, 1.356 asserções; sinal automático build OK
- [ ] Typecheck — união Papel corrigida pelo patch 0100; sem resultado separado disponível nos sinais automáticos
- [x] Conferir JSON como Master, buckets, metadados seguros do cron e ausência de fiscal_outbox/kit_acertos
- [ ] Verificar token literal/chave de serviço do cron — plataforma bloqueia leitura dos comandos, metadados não confirmam
- [x] Entregar provas e diferenças em LARDAN-prontidao-fiscal-resultados.md (Files); não publicado, emissão desligada

## App da consultora — PDF de melhorias (16/10)
- [x] Redesenhar os quatro cartões de Seu resumo conforme o print — ícones, contraste, números e respiro; capturas 390/1156/1280 px sem transbordamento; leitura autenticada bloqueada para Master, prova visual isolada com valores do print; sem alterar indicadores ou publicar.
- [x] Melhorar visual da lista de pedidos no celular e desktop — cartões, resumos, ações e detalhe reorganizados; capturas com dados autorizados, sem gravações; docs/lardan/DESIGN-PEDIDOS-CONSULTORA-2026-10-17.md
- [x] Conferir todos os itens do PDF contra o app e registrar evidências e dependências — docs/lardan/PROVAS-APP-CONSULTORA-2026-10-16.md
- [ ] Corrigir maleta ativa, pedidos/clientes, formulários e navegação da venda
- [ ] Facilitar venda: busca, filtros, fotos ampliadas, etiqueta, revisão e comprovante
- [ ] Melhorar vitrine, compartilhamento, clientes, lembretes e mensagens
- [ ] Mostrar ganhos, metas, acerto, indicações e conteúdo com dados reais — bloqueio: comissão/acerto aplicado, liga e conteúdo aprovados
- [x] Implementar abertura de troca/garantia ligada à venda, análise, fotos e histórico — 45 dias/two-year warranty; sete testes isolados de pós-venda/busca
- [ ] Efetivar troca, diferença de preço, crédito, devolução no acerto e indicadores — bloqueio: fluxo oficial de acerto/financeiro aprovado
- [ ] Implementar entregas, acessibilidade, letra grande e instalação
- [ ] Conferir pagamentos/parcelas com o motor oficial, sem duplicar baixas
- [x] Aplicar preço final ,90 às sugestões de nova precificação, subindo; preços atuais intactos
- [ ] Identificar dados de teste e apresentar limpeza auditada antes de executar
- [ ] Validar os fluxos autenticados em celular e computador — bloqueio: sessão atual não tem acesso consultora; manual e fila vazia conferidos, 250 testes isolados aprovados
- [ ] Diagnosticar duas falhas preexistentes do teste REST de sigilo de custos — sem vazamento confirmado; preferir reprodução isolada
- [ ] Publicar somente quando solicitado

## Financeiro — nove pontos enviados em 16/10
- [x] 1 Edição de parcela — teste R$ 138,15 → R$ 138,13
- [x] 2 Conciliação preserva classificação do título — teste Aluguel; sem conciliação real nova
- [x] 3 Estorno editável e aluguel 2026-007482 corrigido para 09/10 — tela e movimento conferidos
- [x] 4 Baixa estornada sem botão Estornar — tela real e idempotência testadas
- [x] 5 Daniel unificado LC-003221 → LC-001617 — sete vínculos; alerta de duplicados conferido
- [x] 6 Busca limpa ao reabrir nova conta — conferida na tela
- [x] 7 Parcelamento reiniciado ao reabrir — conferido na tela
- [x] 8 Busca contábil sempre disponível — A receber, 3.1.1 conferido
- [x] 9 Guarda de atalhos validada na Mesa real — inputs e seletor aberto preservam modo/linha; busca, classificação e fechamento conferidos sem confirmar conciliação; docs/lardan/VALIDACAO-MESA-TELA-2026-10-16.md

Provas: docs/lardan/AUDITORIA-FINANCEIRO-NOVE-PONTOS-2026-10-16.md; 243 testes isolados + 10 financeiros aprovados; compilação OK; sem publicar.

- [x] Aplicar patch como 0086 e registrar pdv_links_listar — 235 testes aprovados; consultas reais somente leitura; provas em docs/lardan/AUDITORIA-PATCH-2026-10-16.md; sem publicar
- [ ] Limitações do pacote (crédito posterior do cartão, auditoria de recusas, saldo na ficha do representante) — aguardam autorização para alterar o patch; conta de cartão vazia
- [x] Cancelar as sete maletas de teste autorizadas por Diego e conferir devolução ao estoque — 48 peças, 40 transferências, sete auditorias; tela conferida
- [x] Larissa: acesso total ao cadastro
- [x] Etapa 2: cobranças Asaas das parcelas do acordo + baixa que abate a dívida original
- [x] Etapa 3: cobrança em lote no Asaas (acordos e dívidas)
- [x] Etapa 3: unificação de cadastros (Ketllin, Diego, Cleverson, Sueli)
- [ ] Maria Vieira: 2 fichas de consultora — aguarda conferência do Diego
- [ ] Remover 10 tarifas Asaas lançadas em dobro (R$ 19,90) — aguarda aprovação
- [ ] Publicar o site

## Conferência Conta Azul (Diego, 16/10)
- [x] 1 Nova conta a pagar/receber (Nx, já pago, cartão por mês)
- [x] 2 Editar parcela (vencimento/valor) — cancelar título já existia
- [ ] 3 Importar extrato OFX Santander/Itaú/Sicoob/Caixa — próxima etapa
- [x] 4 Cheque compensou lança no banco com data
- [x] 5 Estorno com data escolhida
- [x] 6 Ajustes Itaú e Caixa removidos — [ ] Infinity Pay aguarda vendas/taxas de setembro certas
- [ ] 7 API Rede — precisa das credenciais da Rede
- [ ] 8 Diferenças de centavos dos cartões — conferir junto com Diego

## App consultora — PDF Daniel (17/10)
- [x] Etapa 1: categorias por botões (2.3), forma de pagamento combinada na revisão (2.10); aviso único já resolvido (1.4)
- [x] Etapa 2: filtro/busca em Minha maleta (8.1), detalhes da entrega e rastreio (8.4)
- [x] 8.3 foto da avaria ao receber a maleta
- [x] Etapa 3: Quanto eu ganho, meta, acerto (4.6, 6.1–6.3) + Configurações de comissão em Indicação e comissão — faixas a preencher pela LARDAN
- [x] Etapa 4: aniversariantes/30 dias (5.2), combina com ela (5.5), link nominal (6.7 já existia)
- [x] 6.5 artes da semana na Biblioteca (painel /admin/biblioteca)
- [x] Etapa 5: conta teste projetos.diegosilva limpa (backup lote limpeza-conta-teste-projetos-diegosilva-2026-10-17)
- [ ] 4 pedidos com Pix no Asaas (PED-000057/59/61/63) — cancelar cobranças antes de apagar; aguarda decisão

## Pendências 0124 (CPF repetido)
- [ ] Cancelar títulos 2026-024988 e 2026-025013 (fin_title_cancel, motivo "teste do app da consultora com CPF do representante — não é cliente real") SÓ depois que o espelho Asaas mostrar as 2 cobranças como DELETED. Bloqueio: Diego cancelar no painel do Asaas.
- [ ] Título 2026-025406 (R$ 200, Larissa LC-007427): aguardando decisão manter/cancelar.
- [ ] Caminho B: rotina oficial de cancelar cobrança no Asaas (para depois).

## 0126 — banho e reclassificação
- [x] Migração 0126, telas e teste aplicados como enviados (383/0)
- [x] Prévia de produto_reclassificar(false) entregue
- [x] produto_reclassificar(true) aplicado — lote reclass-20261023-112619
- [ ] Publicar interface — aguarda aprovação

## 0127 — situação das maletas
- [x] Migração, telas e teste aplicados como enviados (386/0)
- [ ] Diego importa maletas_status.csv; depois rodar consulta da seção 4
- [ ] Publicar interface — aguarda aprovação
