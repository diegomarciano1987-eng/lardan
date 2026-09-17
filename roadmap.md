# Roadmap

## Em pausa — auditoria externa do ZIP (2026-09-07)

- Nenhuma alteração de código ou ativação de recurso até nova orientação.
- Pendências conhecidas registradas em `docs/lardan/PROGRESSO.md`.
- Módulo não classificado como aprovado para homologação.

## Concluído

- [x] Transição hero mais cinematográfica (clarão, eclipse, feixe, halo)
- [x] Entrada da segunda sessão da direita para a esquerda, sem corte horizontal
- [x] Alongar transição diamante → LARDAN para ~3 rolagens de tela

## Consultas e validações brasileiras (iniciado 2026-09-17)

- [x] Inventariar todos os campos de CEP, CPF/CNPJ, telefone, e-mail, PIX, municípios e localização
- [x] Ligar os campos de cadastro aplicáveis às consultas/validações canônicas, com preenchimento automático e retorno visível
- [x] Corrigir provedores, fallback, cache, permissões e tratamento de indisponibilidade
- [x] Provar CEP, CPF, CNPJ e IBGE com 60 testes automatizados, consultas reais e interface pública/carrinho
- [x] Registrar limite legal: CPF possui validação matemática local, sem consulta pública gratuita de titularidade ou situação

## Financeiro (iniciado 2026-09-15)

- [x] Gate 0/1 — fundação: contas, plano de contas, centros de custo, títulos,
      parcelas, baixas, alocações, ajustes, transferências, razão, reconhecimento
      de dívida, capacidades e RLS (`docs/lardan/FINANCEIRO-ARQUITETURA.md`)
- [x] Gate 2 — contas a pagar e a receber na tela: criação com parcelas, ficha
      do título, baixa parcial, estorno, cancelamento, contas e caixas
- [x] Provas reais no banco: idempotência, parcial, estorno, saldo pelo razão
- [ ] Gate 3 — conciliação por arquivo (CSV/OFX)
- [ ] Gate 4 — importação financeira de contas a pagar e a receber
- [ ] Gate 5 — fluxo de caixa detalhado e DRE gerencial
- [ ] Gate 6 — Cobranças (`/admin/cobrancas`)
- [ ] Gate 7 — preparação de cobrança externa (desligada)
- [ ] Gate 8 — homologação final e matriz de permissões provada por perfil

## Central de Cadastros — correção e evolução (2026-09-15)

- [x] A1 — grupo "Pessoas e rede" reordenado; cartões Consultoras, Representantes,
      Colaboradores, Clientes e Lojas abrem a base canônica já filtrada (?papel=...),
      e o filtro sobrevive ao recarregar
- [x] A2 — papel "Loja" criado; vínculos de "Revendedora" migrados sem apagar o
      registro antigo; "Revendedora" some dos seletores (fica só como legado)
- [x] C1 — subcategorias: hierarquia de dois níveis com proteção contra ciclo,
      tela de categorias com nível e caminho, contadores separados
- [x] B1 — "Novo produto" abre a ficha completa em /admin/cadastros/produtos/novo; abrir não grava nada
- [x] B2 — produto-base + variantes (banho, aro) com tipos de banho controlados
- [x] B3 — código interno LAR-XXX-000000, SKU e nome de variante automáticos, slug com histórico
- [x] B4 — custos por vigência em variant_costs (bruto, banho, verniz, final) com justificativa da diferença
- [x] B5 — checklist de publicação no servidor agrupado, legado publicado preservado
- [x] B6 — edição de produto restrita ao Master (product.manage / product.publish)
- [ ] B19 — importação de produtos ainda não reconhece as novas colunas (banho, verniz, custos, subcategoria)
- [ ] Padrões do cadastro de produto (cuidados, garantia, modelos de SEO) — aguardando os textos oficiais do Daniel
- [x] C2 — subcategoria obrigatória na publicação quando a categoria tiver filhas
- [ ] D — candidaturas: questionários configuráveis, cadastro completo pelo
      representante, documentos em armazenamento privado, madrinha, contrato e
      promissória versionados, painel de análise sem decisão automática
- [ ] E — rótulos dos 11 perfis e prova da matriz de acesso por perfil
- [x] F1 — fundação financeira selada: impressão digital de idempotência, razão e baixas
      imutáveis, estorno de transferência atômico, matriz de perfis provada no banco
- [x] F2 — conciliação bancária CSV e OFX em /admin/financeiro (aba Conciliação):
      tabelas, RPCs, bucket privado, sugestões, 1:1, 1:N, N:1, parcial e desfazer por estorno
- [x] F3 — contraprova contratual (26.469 / 16.955 / 11.783 / 5.172 / 5.000 / 172 / 9.514)
      executada e massa removida, auditoria preservada
- [ ] F4 — conciliação por arquivo CNAB (não implementada; sem botão funcional)
- [ ] F5 — falhas anteriores: register_stock_movement devolve 409 quando dois cliques
      simultâneos usam a mesma chave (aberta)
- [x] F6 — Financeiro como departamento operacional: 13 rotas canônicas sob
      /admin/financeiro, navegação compartilhada (FinanceiroShell), saldo inicial como
      movimento real do razão, aprovações endurecidas, plano de contas e centros de custo,
      fluxo de caixa pelo razão, conciliação com seleção N:1 pela tela, auditoria e
      configurações; módulo marcado como ativo
- [x] F7 — publish_products liberado para Diretoria e Marketing; documento completo
      (CPF/CNPJ) deixou de ser legível direto em parties, suppliers e business_entities
- [x] B20 — preço de custo no card Preço da ficha (obrigatório para salvar e para publicar,
      bloqueio no servidor via product_publish_blockers) e coluna "Preço de custo"
      obrigatória na importação (planilha antiga aceita "Valor de custo" como equivalente)
- [x] B21 — margem padrão (markup) em Configurações, alterável só pelo Master, com margem
      individual por produto, preço sugerido e margem praticada na ficha
- [ ] B22 — os 22 produtos já cadastrados estão sem preço de custo informado; Daniel precisa
      preencher produto a produto (ou enviar planilha) antes de republicá-los
