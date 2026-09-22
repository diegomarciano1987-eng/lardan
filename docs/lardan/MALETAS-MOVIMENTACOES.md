# Maletas — histórico de movimentações e conferência (etapa 1)

Situação: **ativo no banco**. As telas ainda não expõem estas operações
(pendência declarada no fim deste documento).

## 1. O que passou a existir

### Registro permanente de cada movimentação
- `kit_movements` — uma linha por movimentação do ciclo, com tipo
  (`remessa_inicial`, `acrescimo`, `transferencia`, `retorno`, `mantida`,
  `garantia`, `perda`, `venda`, `divergencia`), situação
  (`pendente`, `confirmado`, `cancelado`), origem e destino (pessoa e
  depósito), autor, data, chave de idempotência e resumo do conteúdo.
- `kit_movement_items` — as peças de cada movimentação, com quantidade,
  destino (`retorno`, `garantia`, `perda`, `mantida`) e justificativa.
- Escrita direta bloqueada por gatilho; leitura restrita ao escopo do ciclo
  (`kit_cycle_in_scope`). Só as rotinas oficiais gravam.

A composição expedida (`kit_compositions` / `kit_composition_items`)
**não é alterada** por nenhuma dessas rotinas. Remessa inicial, acréscimos e
retornos ficam guardados separadamente.

### Rotinas oficiais
| Rotina | Quem pode | Efeito |
| --- | --- | --- |
| `kit_acrescimo` | quem administra maletas | dá baixa no depósito de origem, marca as peças como a caminho, exige motivo de idempotência próprio |
| `kit_acrescimo_confirmar` | quem está com a maleta (ou administra) | confirma o recebimento: as peças deixam de estar a caminho e entram como aceitas sob responsabilidade |
| `kit_retorno` | quem está com a maleta (ou administra) | registra destino peça a peça; retorno/garantia ficam em trânsito, "mantida" continua sob responsabilidade, perda exige motivo |
| `kit_retorno_confirmar` | somente quem administra (Matriz) | confere a chegada, transfere o físico para o depósito escolhido e baixa as perdas declaradas |
| `kit_historico` | escopo do ciclo | linha do tempo completa, sem sobrescrita |
| `kit_conciliacao` | escopo do ciclo | confronto por produto |

`kit_expedir` e `kit_transfer_forward` passaram a registrar a remessa inicial
e as transferências no mesmo histórico, sem alterar o que já faziam.

### Conferência por produto
Para cada peça: `enviado + acrescido` contra
`retornado + em trânsito + garantia + perda + mantida + vendido`.
A sobra aparece como **a explicar** — nunca como venda e nunca como dívida.
Cada unidade é contada em uma única categoria (verificado em teste).
`vendas_disponiveis` vem `false`: o módulo de vendas da consultora ainda não
alimenta a conciliação, e nenhuma venda histórica foi inventada.

## 2. Testes executados

`tests/maletas/movimentacoes.test.ts` — cenário obrigatório 50 + 5 − 20,
**15 casos, todos aprovados**:

1. expedição registra a remessa inicial e baixa 50 no depósito
2. recebimento confirmado, aceite das 50, conferência mostra 50 sob responsabilidade
3. acréscimo baixa na origem e as peças ficam a caminho até a confirmação
4. repetir o acréscimo com a mesma chave não duplica peças
5. mesma chave com conteúdo diferente é recusada
6. confirmado o recebimento, o total que saiu passa a 55
7. consultora não envia acréscimo para si mesma; outra consultora não confirma o alheio
8. retorno fica em trânsito e só baixa no depósito depois da conferência na Matriz
9. consultora não confirma o próprio retorno na Matriz
10. não é possível devolver mais do que está sob responsabilidade
11. perda exige motivo; a baixa física ocorre na confirmação da Matriz; peça mantida não vira retorno
12. as unidades restantes aparecem como a explicar, sem virar venda nem dívida
13. cada peça é contada em uma única categoria
14. histórico preserva remessa, acréscimo e retorno separados; composição expedida intacta (50)
15. outra consultora não enxerga o histórico nem a conferência desta maleta

Suíte completa do projeto: **268 testes, 268 aprovados**, nenhum ignorado.
Verificação de tipos limpa.

Limitação já declarada em rodadas anteriores e ainda válida: não existe base
de homologação separada. Os testes usam dados sintéticos na base compartilhada
e limpam apenas os identificadores criados pela própria execução. Nenhum dado
real foi tocado.

## 3. Regras preservadas

- A peça só sai da origem com baixa registrada; nada aparece no destino sem
  contrapartida, na mesma transação.
- Nenhuma movimentação atravessa maletas ou pessoas fora do escopo autorizado.
- Retorno só considera peças efetivamente aceitas pela consultora.
- Saldo da maleta não pode ficar negativo (restrição do banco).
- Repetição com a mesma chave devolve o mesmo resultado; conteúdo diferente
  na mesma chave é recusado.

## 4. O que depende de decisão ou de outra etapa

- **Regra do acerto**: não definida. Nenhuma obrigação financeira é gerada a
  partir da conferência, e as peças a explicar não viram dívida.
- **Vendas da consultora**: o fluxo ainda não fornece dados para a
  conciliação; a pendência aparece explicitamente no resultado.
- **Asaas**: próxima etapa (importação e sincronização).
- **Fiscal**: nada emitido nem simulado; camada apenas prevista.
- **Telas**: construídas na pré-visualização (conferência por peça, histórico,
  acréscimo, confirmação de recebimento, declaração de retorno e conferência da
  Matriz), na ficha da maleta e no aplicativo da consultora. **Só passam a
  valer no site publicado depois da publicação.**

## 5. Rodada de integridade (aplicada no banco)

- `kit_retorno` agora confere autorização **antes** de responder a uma chave
  repetida, e a chave passou a considerar a operação inteira (tipo, maleta,
  origem, destino, pessoas e itens). Mesma chave com conteúdo diferente é
  recusada; repetições simultâneas produzem um único efeito.
- `kit_retorno_confirmar` faz conferência real: declarado, recebido, aprovado e
  divergente por peça. Declarar 20 e receber 18 não coloca 20 no depósito; as 2
  continuam a explicar, sem virar venda nem dívida.
- Peças em garantia ou com defeito vão para o local **BLOQ-QUALIDADE**, fora do
  estoque disponível. A liberação exige `stock.unblock` e fica registrada.
- Acréscimo por representante não usa mais permissão global: exige
  `kit.acrescimo`, ser o representante daquela maleta e responder pelo depósito
  de origem. O recebimento distingue consultora, representante e Matriz.
