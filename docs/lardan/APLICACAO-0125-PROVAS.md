# Aplicação da 0125 — 23/10/2026

## Resultado
- Aplicada pela ferramenta oficial: `drizzle/migrations/0125_0125_venda_pela_cobranca.sql`.
- Nenhuma função renomeada, nenhuma mensagem alterada, nenhuma coluna removida.
- Comparação com o SQL do ZIP: única diferença é um espaço de indentação antes de `WHERE _chaves` na linha 80; SQL funcionalmente idêntico. Não houve edição manual do arquivo gerado.
- Teste e documento do pacote copiados integralmente. CSV pessoal não foi lido, importado nem copiado para o repositório.
- Regra do histórico atualizada no AGENTS.md.
- Nenhuma publicação; nenhuma alteração nas cobranças Asaas, títulos ou cadastros de outras pendências.

## Provas da base compartilhada
Consulta posterior à aplicação confirmou:

| Verificação | Resultado |
|---|---:|
| Acertos `remessa_cliente` | 22.977 |
| Acertos `cobranca` | 0 |
| Maletas com `sem_cobranca` | 0 |
| Maletas com data original guardada | 0 |
| Soma atual de `valor_venda_cents`, todas as maletas | 1.600.773.801 centavos |
| Nova coluna `fonte`, default | `'cobranca'::text` |
| Nova coluna `sem_cobranca`, default | `false` |
| Nova coluna `fechamento_smalldata` | existe, nullable |
| `legado_bi_base_total(date,date,integer,integer,text)` | existe |
| Execução direta de `legado_bi_base_total` por anon | não permitida |
| Execução direta de `legado_bi_base_total` por authenticated | não permitida |

O CSV de cobranças ainda não foi importado, conforme instrução expressa de Diego. A inclusão de contas internas nos KPIs/anos já é regra da 0125; não depende do CSV. Não confundir essa mudança de totais do painel com a futura substituição de valores/datas de acerto.

## Testes
- Banco local recriado pelo script do projeto depois do registro oficial da 0125: 363 migrações, 4 arquivos pendentes aplicados na bancada.
- `bun test tests/isolado`: **354 pass, 0 fail, 1.749 asserções, 30 arquivos**, 31,91 segundos.
- Também houve primeira execução do SQL original em bancada: **354 pass, 0 fail**.
- Sinal automático mais recente disponível: **build OK**, 2026-10-23T13:36:21Z.
- Logs locais: `/tmp/lardan-0125/setup-final.log` e `/tmp/lardan-0125/tests-final.log`.

## Próxima etapa, somente depois da importação de Diego
1. Em Configurações → Histórico SmallData, importar o CSV novo como Master.
2. Conferir a contagem de fontes (esperado: 19.464 cobranças) e as marcas de maletas sem cobrança/data original guardada.
3. Executar a comparação integral de 34 meses contida no documento do pacote; parar na primeira diferença.
4. Conferir na tela Master março/2026 (R$ 288.534,59) e julho/2026 (R$ 261.196,69).

Esses resultados de pós-importação e o fluxo real em tela ainda não foram verificados: dependem da importação que Diego reservou para si. Não foram inseridos dados reais ou sintéticos na base compartilhada para simular o resultado.

## Limitação de reversão do pacote
A revisão detectou que a instrução de reversão no comentário do SQL não garante restaurar todos os valores anteriores: o importador atualiza linhas existentes, e apagar linhas `cobranca` não recupera automaticamente os valores antigos sobrescritos. Nenhuma reversão foi executada e o pacote foi preservado; qualquer futura reversão precisa de prévia própria e de valores anteriores preservados, não deve ser feita apenas seguindo esse comentário.