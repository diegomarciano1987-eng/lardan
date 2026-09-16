# Roadmap

## Em pausa — auditoria externa do ZIP (2026-09-07)

- Nenhuma alteração de código ou ativação de recurso até nova orientação.
- Pendências conhecidas registradas em `docs/lardan/PROGRESSO.md`.
- Módulo não classificado como aprovado para homologação.

## Concluído

- [x] Transição hero mais cinematográfica (clarão, eclipse, feixe, halo)
- [x] Entrada da segunda sessão da direita para a esquerda, sem corte horizontal
- [x] Alongar transição diamante → LARDAN para ~3 rolagens de tela

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
