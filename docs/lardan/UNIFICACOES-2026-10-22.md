# Unificações autorizadas — 22/10/2026

## Resultado comprovado

**Uma unificação executada; um caso bloqueado por segurança.**

### Saylla Jamile Monteiro Tristão

- Cadastro preservado: **LC-007428**, ativo, com papéis colaborador e cliente ativos.
- Cadastro histórico **LC-003392** permanece inativo, identificado como unificado; não foi apagado.
- Os dois cadastros tinham nome completo e CPF iguais, com apenas dois registros desse CPF. O cadastro histórico tinha endereço em Terra Bonita, Ibiporã/PR; o principal não tinha endereço, portanto não havia divergência de endereço. Não há data de nascimento nos dois para comparação.
- Prévia autenticada executada antes da alteração e repetida imediatamente antes da confirmação, com conferência das quantidades esperadas.
- Transferidos: ficha de consultora, endereço, código legado, tarefa de cobrança, dois títulos financeiros e o vínculo de pagador de um deles.
- Papel histórico consultora **inativo** preservado no principal, sem reativação automática; não há maleta registrada para esses cadastros.
- Lastro original de fiado preservado no cadastro histórico, com identificador registrado no histórico da unificação; o título financeiro passou ao principal.

### Prova financeira antes/depois

| Título | Valor | Situação preservada | Vencimento preservado | Resultado |
| --- | ---: | --- | --- | --- |
| 2026-025128 | R$ 76,18 | A receber, liquidado | 09/10/2026 | Já no principal; permaneceu igual |
| 2026-024666 | R$ 16,00 | A receber, não liquidado | 15/06/2026 | Transferido ao principal, inclusive pagador |
| 2026-022668 | R$ 2.029,55 | A pagar, cancelado | 01/10/2026 | Transferido, mantendo cancelamento |

IDs dos títulos e parcelas, valores, vencimentos e estados de conciliação foram relidos no banco após a execução e permaneceram iguais. Não foi criada baixa nem cobrança Asaas. Não foi possível consultar saldo pela função financeira com a ferramenta de leitura restrita; nenhuma afirmação de saldo calculado é feita nesta prova.

### Auditoria

- Execução oficial: `party_unificar`, autenticada como Diego Marciano, com motivo e autorização registrada.
- Registro: `2f8eea7a-d438-4cc0-8591-e09b4b02cb09`.
- Data/hora: **22/10/2026, 17:26:04 de São Paulo**.
- Evento `party.unificada` confirmado, com autor, IDs movidos, papel original removido e estado anterior do cadastro histórico.
- A ficha da Saylla foi aberta e recarregada no navegador autenticado depois da alteração; o nome foi relido na tela.
- A rotina é transacional; erro interrompe a operação. Há histórico para revisão, mas não foi identificado botão/RPC de reversão automática. Não foi feito teste de reversão nesta execução.

## Larissa Persinato — não executada

Os cadastros LC-003310 e LC-007427 têm nome e CPF iguais, mas **ambos possuem ficha de consultora**. Os endereços estão em Ibiporã/PR com bairros distintos: Centro e Setor 5. LC-007427 também possui login e papéis ativos de consultora, colaborador e vendedora interna.

A prévia retornou: **“Os dois cadastros têm ficha de consultora: revisar à mão.”** Nenhuma alteração foi feita nesses cadastros. É necessária revisão específica das duas fichas e confirmação do cadastro/endereço correto; não se deve desativar uma ficha ou excluir vínculos para contornar a trava.

## Limites e caminho

- Daniel/guilherme, homônimos e fornecedores sem CPF não foram alterados.
- Nenhuma maleta, estoque, recebimento ou configuração Asaas foi alterada.
- Caminho de consulta: **Cadastros → Pessoas e empresas → buscar Saylla → abrir LC-007428**; histórico antigo LC-003392 permanece para rastreabilidade.
- Esta alteração de dados já está no banco compartilhado e não depende de publicação de tela. Não houve publicação neste trabalho.
- Nenhum código de negócio foi alterado, portanto não foi criada ou executada uma nova suíte de testes; as provas são a prévia, execução real autorizada, auditoria, comparação dos registros e leitura em tela.