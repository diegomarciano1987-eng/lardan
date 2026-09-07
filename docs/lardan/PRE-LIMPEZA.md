# LARDAN Cloud — Pré-limpeza controlada do banco (simulação)

Data da inspeção: 2026-09-07 (UTC). **Nenhum registro foi alterado, excluído, arquivado ou despublicado.**
Rodada exclusivamente de leitura + simulação + plano de rollback.

## 1. Retrato atual do banco

| Tabela | Total | Preservado | Comprovadamente sintético | Origem desconhecida | Proposto p/ exclusão | Critério | Dependências | Risco |
|---|---|---|---|---|---|---|---|---|
| products | 10.122 | 20 | 10.101 | 1 (`brinco01`) | 10.101 | slug `imphomolog-%` + vínculo com import_jobs | variants, media, ppl, saldos, movimentos, custos, import_rows | Médio (volume) |
| product_variants | 10.140 | 38 | 10.101 | 1 | 10.101 | pai sintético | saldos, movimentos, custos, reservas, import_rows | Médio |
| product_media | 40 | 40 | 0 | 0 | 0 | massa sintética não tem foto | media_assets | Nenhum |
| media_assets | 43 | 40 | 3 (`Anel de homologação foto 1..3`) | 0 | 3 | órfãs + alt de homologação | nenhuma | Baixo |
| public_price_list | 58 | 58 | 0 | 0 | 0 | só existe para os 20 | products/variants | Nenhum |
| variant_costs | 10.101+ | 0 | 10.101 | 0 | 10.101 | variantes sintéticas | — | Baixo |
| categories | 7 | 4 (`brincos`,`colares`,`aneis`,`pulseiras`) | 3 (`imphomolog-*`) | 0 | 3 | slug `imphomolog-%` | 10.101 produtos sintéticos | Baixo |
| collections | 5 | 3 (vazias, reais) | 2 (`imphomolog-*`) | 0 | 2 | slug `imphomolog-%` | 10.101 produtos sintéticos | Baixo |
| suppliers | 3 | 1 (real) | 2 (`IMPHOMOLOG Fornecedor Alfa/Beta`) | 0 | 2 | nome `IMPHOMOLOG%` | 10.101 produtos | Baixo |
| business_entities | 0 | 0 | 0 | 0 | 0 | — | — | Nenhum |
| locations | 2 | 1 (`DEP-01`) | 1 (`IMPHOMOLOG-DEP`) | 0 | 1 | code `IMPHOMOLOG%` | 8.470 saldos, 8.473 movimentos | Médio |
| stock_balances | 8.510 | 40 (DEP-01) | 8.470 (IMPHOMOLOG-DEP) | 0 | 8.470 | local/variante sintéticos | — | Médio |
| stock_movements | 8.532 | 59 (DEP-01) | 8.473 | 0 | 8.473 | local/variante sintéticos | reservation_id (4), import_rows | **Alto** (razão imutável) |
| stock_reservations | 20 | 20 (histórico de homologação) | 0 | 0 | 0 | nenhuma sobre massa sintética | movements, variants, locations | **Alto** |
| parties | 222 | 32 reais | 190 (`HOMOLOG %`) | 0 | 190 | display_name `HOMOLOG%` | perfis, papéis, endereços, contatos | Médio |
| profiles | 29 | 1 (Diego Marciano) | 28 (`@lardan.test`) | 0 | 28 | e-mail `@lardan.test` | auth.users, user_roles, auditoria | **Alto** (auth) |
| import_files | 10 | 0 | 10 | 0 | 10 | arquivos de teste | jobs | Baixo |
| import_jobs | 10 | 0 | 10 | 0 | 10 | derivados dos arquivos acima | rows | Baixo |
| import_rows | 63.300 | 0 | 63.300 | 0 | 63.300 | filhos dos jobs | ponteiros p/ produtos/variantes/movimentos (20.202 linhas) | Médio |
| audit_logs | 419.427 | tudo | — | — | 0 | auditoria nunca se apaga | — | Nenhum |
| stock_reasons / user_roles / site_settings / migrações | — | tudo | 0 | 0 | 0 | configuração real | — | Nenhum |

## 2. Os 20 produtos preservados (todos publicados, em destaque)

`brinco-lume-dourado`, `brinco-aurora-perola`, `brinco-iris-cristal`, `brinco-serena-argola`,
`brinco-celeste-gota`, `colar-essenza`, `colar-lumiere`, `colar-riviera-cristal`, `colar-elo-dourado`,
`colar-ponto-de-luz`, `anel-solenne`, `anel-eclat`, `anel-lumiere`, `anel-riviera`, `anel-aura-dourada`,
`pulseira-serena`, `pulseira-lumi`, `pulseira-riviera`, `bracelete-essenza`, `pulseira-elo-dourado`.

- 38 variantes (anéis e pulseiras com 3 tamanhos; brincos, colares, bracelete com 1).
- 40 fotos (2 por produto), todas em `media_assets` ativas.
- 58 linhas de preço público, sem lacunas.
- Saldo físico: 240 unidades em `DEP-01`, reservado 0, disponível 240.
- 38 movimentos de entrada, 0 reservas vinculadas.
- Categorias: 5 por categoria em `brincos`, `colares`, `aneis`, `pulseiras` — as quatro publicadas.

## 3. Produtos fora da lista

| Faixa | Qtd | Situação | Origem | Fotos | Saldo | Recomendação |
|---|---|---|---|---|---|---|
| `imphomolog-*` | 10.101 | rascunho | importação industrial (jobs 100/1.000/10.000/30.000) | 0 | 29.638 un. em IMPHOMOLOG-DEP | **Remover** |
| `brinco01` (`787ac5e6-2250-4325-909d-e15dadbecba9`) | 1 | rascunho, categoria `brincos`, 1 variante, 0 fotos, saldo 6, 20 reservas de homologação | criação manual de 05/09 | 0 | 6 | **Arquivar** (origem desconhecida + é o objeto do histórico de reservas) |

Detalhamento linha a linha exportado em `produtos-fora-da-lista.csv`.

## 4. Linha de base pública (janela anônima, verificada nesta rodada)

- Home: 4 CTAs — `VER ANÉIS → /semijoias/aneis`, `VER COLARES → /semijoias/colares`, `VER PULSEIRAS → /semijoias/pulseiras`, `VER BRINCOS → /semijoias/brincos`.
- Ordem das cenas e imagens desktop/mobile vêm do código (`src/routes/index.tsx`, assets estáticos). A curadoria em `site_settings` está vazia → fallback editorial aprovado. **A limpeza do banco não muda a home**, desde que as 4 categorias sigam publicadas.
- Cada categoria pública lista exatamente 5 produtos; total 20 páginas de produto respondendo 200, 2 imagens cada, preço visível (R$ 129,90 a R$ 249,90), estoque não exposto ao público.
- Registro completo: `baseline-site.json`.

## 5. Reservas — as rotinas antigas são inadequadas

`homolog_purge`, `homolog_purge_stock`, `homolog_purge_catalogo` e `homolog_purge_movimentos` foram lidas
integralmente. **Nenhuma delas menciona `stock_reservations`.** Consequências comprovadas pelo modelo:

- `stock_reservations.variant_id → product_variants ON DELETE RESTRICT` e `location_id → locations ON DELETE RESTRICT`: qualquer purga que alcance uma variante ou local com reserva **falha no meio da transação**.
- `stock_reservations.movement_id → stock_movements` sem cascade: apagar movimentos de reservas confirmadas (4 hoje) **quebra a rotina**.
- `stock_movements.reservation_id` não é limpo em lugar nenhum.
- `stock_balances.reserved` não é recalculado após qualquer exclusão → risco de `reservado > físico`.
- A auditoria de reservas (40 registros) não é considerada.
- `homolog_purge_movimentos` desativa o gatilho de imutabilidade da razão de estoque — inaceitável fora de uma rotina nova, auditada e restrita ao marcador da massa.

**Especificação da rotina nova (`homolog_purge_v2`, não implementada nesta rodada):**

1. Exigir marcador com ≥ 6 caracteres e capacidade de Master; registrar início em auditoria.
2. Recusar a execução se qualquer reserva **ativa** existir sobre variantes/locais do escopo.
3. Ordem transacional: `import_rows` (desvincular) → reservas do escopo (liberar/anular com motivo, nunca `DELETE` cego) → `stock_movements` → `stock_balances` → `variant_costs` → `public_price_list` → `product_media` → `product_variants` → `products` → `collections` → `categories` → `locations` → `suppliers` → `business_entities` → `parties` sintéticas → `import_jobs`/`import_files`.
4. Após cada bloco, recalcular `stock_balances.reserved` a partir das reservas ativas restantes e afirmar `reserved <= quantity`.
5. Proibir qualquer `DELETE` que atinja produto cujo slug esteja na lista inviolável (guarda explícita na função).
6. Retornar contadores por tabela + hash do escopo; gravar tudo em `audit_logs`.
7. Validações pós-limpeza obrigatórias: 20 produtos publicados, 38 variantes, 40 fotos, 240 unidades em DEP-01, 4 categorias publicadas, 4 CTAs da home, 20 páginas públicas 200.

## 6. Plano de rollback (preparado, não executado)

- Exportações CSV com IDs e relacionamentos em `/mnt/documents/lardan-prelimpeza/`:
  `produtos-fora-da-lista.csv`, `categorias.csv`, `colecoes.csv`, `fornecedores.csv`, `locais.csv`,
  `pessoas-sinteticas.csv`, `contas-teste.csv`, `import-files.csv`, `import-jobs.csv`, `midias-orfas.csv`,
  `baseline-site.json`.
- Identificador do conjunto (hash agregado dos CSV): `831a7919…4cb665`.
- Contagens esperadas depois da limpeza: products 21 (20 + `brinco01` arquivado), product_variants 39,
  media_assets 40, categories 4, collections 3, suppliers 1, locations 1, stock_balances 40,
  stock_movements 59, stock_reservations 20, parties 32, profiles 1, import_files/jobs/rows 0.
- Restauração: reimportar os CSV em tabelas de staging e reinserir por ordem inversa; auditoria e
  migrações não são tocadas, portanto o esquema não precisa de rollback.

## 7. Riscos

- **Página inicial: risco nulo** — cenas, CTAs e imagens são estáticas no código; basta manter as 4 categorias publicadas.
- **Estoque: risco médio** — a exclusão toca 8.473 movimentos, que hoje são imutáveis por gatilho; exige rotina nova com desativação controlada e auditada.
- **Reservas: risco alto com as rotinas antigas** — falhariam por chave estrangeira ou deixariam `reserved` inconsistente.
- **Contas: risco alto** — remover 28 perfis `@lardan.test` implica mexer em `auth.users`, fora do alcance das rotinas atuais; deve ser um passo separado e explícito.


## Limpeza controlada definitiva — 2026-09-07

Executada com sucesso. Detalhes completos em `docs/lardan/LIMPEZA-CONTROLADA.md`.
Resumo: 10.101 produtos sintéticos, 8.485 movimentos, 8.471 saldos, 63.300 linhas de
importação, 3 categorias, 2 coleções, 2 fornecedores, 1 depósito e 3 mídias órfãs removidos;
165 pessoas removidas e 27 anonimizadas; 28 contas de teste encerradas. Preservados os 20
produtos publicados, 38 variantes, 40 fotos, 4 categorias publicadas, 240 unidades no
Depósito Principal e a auditoria integral. `brinco01` arquivado como registro histórico.
Contraprovas: site público conferido em janela anônima (computador e celular) e
`bun run test:seg` com 67 de 67 cenários aprovados.
