# Pacote 0259-2: prévia por CPF (0260)

Data: 06/11/2026.

Somente `legado_transferencia_previa` substituída. A aplicação oficial continua consumindo a mesma prévia. Nenhuma transferência real nem publicação executada.

## Testes

Bancada local vazia, recriada com `tests/isolado/subir.sh`, sem dados da operação.
`bun test tests/isolado/legado-transferencia.test.ts`: 9 passaram, 0 falharam, 43 asserções.
Cobertura: acesso, prevenção de impersonação, prévia sem ciclos criados, CPF correspondente com vínculo de outra pessoa preservado, CPF divergente bloqueia aplicação, peça sem cadastro bloqueia, falta exige confirmação, montagem oficial, idempotência, desfazer, expedição e visibilidade no portal do representante.

## Prévia real como Diego

| SmallData | Destino | Representante | Maletas | Peças | Linhas | Sem cadastro | Aros a criar | Pode aplicar | Já transferidas |
|---|---|---|---:|---:|---:|---:|---:|---|---:|
| 924 | 926 | Marcelo Marlos de Oliveira | 10 | 350 | 350 | 0 | 43 | Não | 0 |
| 925 | 925 | Guilherme Augusto Pelegrini da Silva | 10 | 350 | 347 | 0 | 30 | Não | 0 |

Ambas retornam o problema “CPF diferente”. Leitura independente confirma `doc_digits IS NULL` no cadastro atual dos dois representantes; os registros SmallData têm CPF com 11 dígitos. Nenhum CPF alterado ou exposto neste relatório.

Vínculos preservados: 3009 → c00e9fad-5805-4edf-bcfe-5c56030dfdc8; 3010 → 44758ee7-516d-4448-99a6-2f63b3320f1a.

Valores atuais do catálogo: 924 R$ 26.994,30; 925 R$ 28.718,00. Valores históricos: 924 R$ 31.477,88; 925 R$ 31.541,16. Não houve ajuste de preços. Aros pendentes e faltas de estoque permanecem apresentados pela prévia.

Próximo passo depende de conferência humana dos CPFs e autorização de Diego; manter transferência e publicação paradas.

Compilação observada: build OK em 06/11/2026 às 21:42:46 UTC.