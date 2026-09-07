# LARDAN Cloud — Limpeza controlada definitiva da homologação

Execução: 2026-09-07 19:00–19:07 UTC (duração da transação ≈ 6 min).
Rollback aprovado: `831a7919…4cb665`.
Ator: rotina de serviço interno (`service_role`), motivo registrado
"Encerramento controlado da homologacao aprovado no relatorio de pre-limpeza".
Chave de idempotência: `limpeza-controlada-2026-09-07`.

## 1. Migrações aplicadas

1. `homolog_purge_v2` + tabelas de controle `homolog_purge_runs` e `homolog_purge_scope`,
   com desvio de imutabilidade restrito ao identificador de rollback e aos IDs do escopo.
2. Índices de apoio em chaves de ligação (`import_rows.product_id/variant_id/movement_id`,
   `stock_movements.from_location_id/to_location_id/reservation_id`, `stock_reservations.*`,
   `products.supplier_id/business_entity_id`, `variant_costs.supplier_id`,
   `profiles/suppliers/business_entities/leads.party_id`, `import_jobs.file_id`).
   Sem eles a exclusão em massa varria tabelas inteiras e estourava o tempo.
3. Correção de ordem: as importações sintéticas passam a ser removidas **antes** do depósito
   sintético (`import_jobs.location_id` referenciava `IMPHOMOLOG-DEP`).
4. `guard_profile_update`: o serviço interno pode ativar/desativar contas; para pessoas
   logadas continua valendo "somente o Master, nunca a própria conta".

## 2. Simulação

`simulacao-2026-09-07` → `ok: true`, `divergencias: {}`. Plano idêntico ao relatório aprovado.

## 3. Execução — removidos por tabela

| Tabela / operação | Quantidade |
|---|---|
| products (`imphomolog-*`) | 10.101 |
| product_variants | 10.101 |
| variant_costs | 10.101 |
| stock_movements | 8.485 |
| stock_balances | 8.471 (29.644 unidades sintéticas) |
| public_price_list | 0 |
| product_media | 0 |
| categories | 3 |
| collections | 2 |
| suppliers | 2 |
| locations (`IMPHOMOLOG-DEP`) | 1 |
| import_rows desvinculadas | 20.202 |
| import_rows | 63.300 |
| import_jobs | 10 |
| import_files | 10 |
| parties removidas | 165 |
| parties anonimizadas | 27 |
| contas encerradas (`@lardan.test`) | 28 |
| media_assets órfãs | 3 |
| audit_logs | 0 (auditoria intacta e ampliada) |

## 4. Preservado (conferido depois)

- 20 produtos publicados, 5 por categoria; 38 variantes dos protegidos (39 no total, com `brinco01`).
- 40 fotos; 40 mídias ativas; preços públicos intactos.
- 4 categorias publicadas; 3 coleções; 1 fornecedor real; página inicial e cenas inalteradas.
- Depósito Principal `DEP-01` com **240 unidades**, reservado 0, disponível 240.
- 450.146 registros de auditoria; motivos de movimentação; permissões; usuário real ativo (1).
- 57 pessoas (32 reais + 25 registros históricos anonimizados/inativos).

## 5. `brinco01`

Arquivado, variantes inativas, preço público removido, saldo físico zero.
No momento da execução já não havia reserva ativa (0) nem saldo físico (0) — as 20 reservas
históricas permanecem intactas e legíveis pela auditoria. Não aparece no site, na vitrine
nem nos seletores operacionais.

## 6. Contraprovas

- **Site público** (janela anônima, 1280×1800 e 390×844): home abre, 4 cenas, 4 botões;
  `/semijoias/brincos`, `/semijoias/colares`, `/semijoias/aneis`, `/semijoias/pulseiras`
  com 5 peças cada; 20 páginas de produto abrem com 2 imagens cada; nenhuma resposta ≥ 400;
  zero erros de console.
  URLs: `/produto/` + `brinco-lume-dourado`, `brinco-aurora-perola`, `brinco-iris-cristal`,
  `brinco-serena-argola`, `brinco-celeste-gota`, `colar-essenza`, `colar-lumiere`,
  `colar-riviera-cristal`, `colar-elo-dourado`, `colar-ponto-de-luz`, `anel-solenne`,
  `anel-eclat`, `anel-lumiere`, `anel-riviera`, `anel-aura-dourada`, `pulseira-serena`,
  `pulseira-lumi`, `pulseira-riviera`, `bracelete-essenza`, `pulseira-elo-dourado`.
- **Estoque**: 240 unidades, `reserved` nunca negativo nem maior que o físico (0 violações),
  depósito e saldos sintéticos removidos, movimentos dos 20 intactos.
- **Segurança**: `bun run test:seg` → **67 de 67 aprovados** (visitante e Consultora não leem
  estoque; Estoque não vê nem envia custo; movimentação e reserva continuam imutáveis;
  concorrência e idempotência mantidas).
- **Autorização da rotina**: `has_function_privilege` de `anon` e `authenticated` sobre
  `homolog_purge_v2` = falso; a função ainda recusa qualquer chamada com `auth.uid()` presente.
- **Repetição**: nova chamada com a mesma chave devolve `repetido: true` e nenhum efeito novo.

## 7. Dados temporários

As 13 unidades consumidas pela bateria de segurança em `brinco-lume-dourado` foram devolvidas
por ajuste auditado (`ajuste_negativo`, chave `pos-limpeza-ajuste-2026-09-07`), restaurando as
240 unidades.

## 8. Limitações

- As contas de teste continuam existindo no cadastro de acesso, desativadas e anonimizadas,
  porque são referenciadas pela auditoria — excluí-las quebraria o histórico.
- O agendador de expiração de reservas continua desligado (limitação já conhecida).
- Avisos do analisador do banco permanecem em 114, todos preexistentes ao lote.
