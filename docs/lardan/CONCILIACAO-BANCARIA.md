# LARDAN Cloud — Conciliação Bancária

Área: `/admin/financeiro` → aba **Conciliação**. Não existe módulo financeiro paralelo:
a conciliação usa o mesmo motor de liquidação (`fin_settlement_create`) e o mesmo razão
(`financial_account_movements`) da fundação financeira.

## 1. Estrutura no banco

| Tabela | Papel |
| --- | --- |
| `financial_statement_files` | arquivo enviado: caminho no armazenamento privado, nome original, formato, tamanho, `sha256` calculado no servidor |
| `financial_statement_imports` | uma importação por arquivo/conta, com contadores e autor |
| `financial_statement_lines` | linha original preservada (`raw`, `raw_text`), conta, data, `valor_cents`, entrada/saída, histórico, documento, identificador bancário, hash, status, nº da linha, motivo de erro, autor e horário |
| `financial_match_suggestions` | sugestões calculadas, com pontuação e motivos |
| `financial_reconciliations` | conciliação confirmada (ativa / estornada) |
| `financial_reconciliation_allocations` | vínculo linha ↔ parcela ↔ valor |
| `financial_reconciliation_events` | auditoria imutável (trigger `fin_block_mutation`) |

Enums: `fin_statement_line_status` (`pendente`, `invalida`, `repetida`, `parcial`,
`conciliada`, `ignorada`, `divergente`) e `fin_statement_format` (`csv`, `ofx`).

Nenhuma tabela `financial_*` tem GRANT direto: todo acesso passa pelas RPCs
`SECURITY DEFINER`, com `EXECUTE` apenas para `authenticated`.

Arquivos ficam no bucket **privado** `extratos-bancarios` (20 MB), com RLS em
`storage.objects`: leitura exige `finance.statement.view`, envio exige
`finance.statement.import`.

## 2. RPCs

- `fin_statement_file_register(_payload)` — registra arquivo pelo `sha256`; arquivo repetido devolve `repetido = true` e reaproveita a importação, sem duplicar.
- `fin_statement_lines_stage(_import, _lines)` — grava as linhas originais, marca inválidas com motivo e repetidas pelo hash dentro da mesma conta.
- `fin_statement_suggest(_line)` — pontuação: valor exato 50; proximidade do vencimento 20/12/6/2; documento 25; contraparte 20. Sugestão **nunca** concilia sozinha.
- `fin_reconcile(_payload)` — transação única: trava as parcelas, exige soma das alocações igual à soma das linhas, lança tarifa/juros/desconto como `financial_adjustments` e chama `fin_settlement_create` com chave idempotente prefixada `conc:`.
- `fin_reconcile_undo(_reconciliation, _motivo)` — exige motivo, estorna a baixa por lançamento compensatório, devolve parcela e saldo, mantém linha e liquidação originais.
- `fin_statement_line_flag(_line, _status, _motivo)` — ignorar / divergente com motivo obrigatório; linha conciliada é protegida.
- `fin_statement_lines_list(_filtros)` e `fin_statement_overview(_filtros)` — busca, filtros, paginação e totais **no servidor**.

## 3. Leitura dos arquivos

Feita no servidor (`src/lib/conciliacao.functions.ts`), nunca no navegador:

- CSV: separador `;` ou `,` detectado; colunas reconhecidas por nome (data, valor, crédito, débito, histórico, documento, identificador); campos tratados como texto, preservando zeros à esquerda.
- OFX: blocos `STMTTRN` (`DTPOSTED`, `TRNAMT`, `TRNTYPE`, `FITID`, `MEMO`, `CHECKNUM`).
- Valores convertidos direto para centavos por manipulação de dígitos — nunca ponto flutuante.
- Datas aceitas apenas em `dd/mm/aaaa`, `aaaa-mm-dd` ou `aaaammdd`; ambíguas são recusadas com motivo.
- CNAB permanece **futuro**: não existe botão funcional.

## 4. Casos suportados

1:1, 1:N, N:1, parcial, tarifa, juros, desconto, excedente explícito, linha ignorada,
linha divergente e linha sem correspondência.

## 5. Permissões

`finance.statement.view`, `finance.statement.import`, `finance.reconcile`,
`finance.reconcile.undo`, `finance.statement.flag`, `finance.statement.audit`.

Master, Diretoria e Financeiro conforme a matriz. Cobrança não acessa extratos.
Estoque, Marketing, Suporte, Consultora, Representante, visitante e `anon` não acessam
nada — provado contra o banco, não apenas escondendo botões.

## 6. Testes (20/20, transação desfeita)

CSV válido; OFX válido; arquivo repetido sem duplicação; chave com conteúdo divergente
recusada; linha inválida com motivo; zeros à esquerda preservados; reais → centavos;
entrada/saída; sugestão não confirma; 1:1; dois cliques; colisão de chave; 1:N; parcial;
N:1; soma divergente recusada; marcação sem motivo recusada; ignorar/divergente com
motivo; saldo pelo razão; desfazer sem motivo recusado; desfazer por estorno devolvendo
parcela e saldo; duplo desfazer recusado; linha conciliada protegida; auditoria com 9
eventos e resumo conferido.
