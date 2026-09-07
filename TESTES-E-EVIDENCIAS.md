# Testes e evidências — LARDAN Cloud

## Baterias automatizadas

| Comando | O que cobre | Resultado |
| --- | --- | --- |
| `bunx vitest run tests` | segurança, integrações brasileiras, cadastros, vitrine | 93/93 aprovados |
| `bun run test:importacao` | importação, 100 linhas, todos os cenários | aprovado |
| `bun run test:importacao:carga` | importação em escala | aprovado (tabela abaixo) |
| `bunx tsgo --noEmit` | tipagem do projeto inteiro | sem erros |

## Importação industrial — medições por escala

Execução real (não simulação), planilha determinística, blocos de 500 linhas na
recepção, 1.000 na validação e 250 no processamento.

| Escala | Arquivo | Leitura | Recepção | Validação | Processamento | Total | Criados | Atualizados | Recusadas | Conflitos | Entradas | Unidades |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 76 KB | 0,1s | 0,8s | 0,4s | 0,7s | 2,7s | 0 | 188 | 6 | 0 | 0 | 0 |
| 1.000 | 630 KB | 0,3s | 2,0s | 2,5s | 4,7s | 10,0s | 0 | 1.880 | 60 | 0 | 0 | 0 |
| 10.000 | 6,3 MB | 1,7s | 7,3s | 8,0s | 66,6s | 85,5s | 0 | 18.800 | 600 | 0 | 0 | 0 |
| 30.000 | 19,3 MB | 5,1s | 123,9s | 28,0s | 577,1s | 736,6s | 18.400 | 37.200 | 2.200 | 0 | 0 | 0 |

Leitura das colunas "Criados" e "Atualizados": esta rodada veio **depois** de
uma rodada anterior com os mesmos arquivos. Nas escalas de 100, 1.000 e 10.000
linhas nada foi criado de novo — tudo foi reconhecido e atualizado. É a prova
de idempotência: reenviar o mesmo arquivo não duplica produto, variação, custo
nem movimentação. Na escala de 30.000, só as 20.000 peças inéditas foram
criadas.

Recusas por escala seguem exatamente as posições plantadas na massa (nome
vazio, custo negativo, quantidade negativa): 6 em 100 linhas, 60 em 1.000,
600 em 10.000 e 2.200 em 30.000, sem nenhuma recusa inesperada.

## Estado da base após as provas

A massa foi removida e a base voltou ao estado real anterior: 1 peça, 1
variação, 1 fornecedor, nenhuma movimentação de estoque de teste, nenhum lote
nem arquivo de importação de homologação.

## Cenários verificados na importação

- arquivo reenviado é reconhecido pela impressão digital e não vira registro novo;
- transições de estado inválidas recusadas pelo banco;
- pausa encerra o bloco corrente, mantém as pendências e grava o ponto de parada;
- retomada processa apenas o que faltava, sem duplicar;
- cancelamento exige motivo e preserva o que já foi gravado;
- linha com erro não derruba as demais do bloco;
- códigos com zeros à esquerda preservados (`000000123` continua texto);
- valores `R$ 1.299,90` e `1.299,90` convertidos para centavos inteiros;
- custo gravado apenas por quem tem permissão de custo;
- publicação sempre pela operação canônica, com impedimentos registrados;
- planilha de recusadas sem fórmulas ativas (proteção contra CSV injection).
