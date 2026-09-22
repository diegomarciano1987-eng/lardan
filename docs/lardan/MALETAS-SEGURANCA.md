# Maletas — segurança, integridade e limites (rodada Pilar Consultoras)

## 1. Defeitos confirmados e corrigidos

| # | Defeito confirmado na versão analisada | Correção aplicada |
|---|---|---|
| 1 | `kit_board` e `kit_detail` tratavam `kit.view` como leitura global: consultora e representante enxergavam todas as maletas | Nova capacidade interna `kit.view.all` (master, diretoria, financeiro, estoque, montagem). `kit_board` e `kit_detail` filtram por `kit_cycle_in_scope`; consultora/representante só veem o que é seu |
| 2 | `my_party_id()` devolvia a pessoa mesmo com perfil desativado | Exige `profiles.is_active` e vínculo de pessoa; sem isso devolve NULL |
| 3 | Condições `IF NOT (capacidade OR pessoa = my_party_id())` não rejeitavam quando o lado direito era NULL | Todas as funções do módulo usam `IS NOT TRUE` e exigem sessão autenticada + pessoa vinculada quando não há visão global |
| 4 | Escrita direta liberada em `kits`, `kit_cycles`, `kit_compositions`, `kit_composition_items`, `kit_transfers` | Políticas de escrita removidas e gatilhos `zz_block_direct_write` (recusa `authenticated`/`anon`) e `zz_block_frozen_composition` (recusa alterar composição congelada, inclusive por serviço) |
| 5 | `kit_aceitar` aceitava soma **menor** que o enviado, deixando peças sem explicação | Exige que toda peça da composição apareça exatamente uma vez e que `aceito + divergente = enviado` |
| 6 | Divergência não distinguia peça faltante de peça com defeito | Coluna `divergence_kind` (`faltante`/`defeito`) obrigatória com motivo quando há divergência |
| 7 | Mesma chave de idempotência com conteúdo diferente era aceita | Hash do conteúdo gravado no aceite; mesma chave com outro conteúdo é recusada |
| 8 | `kit_cycle_create` escolhia um depósito em silêncio quando havia mais de um ativo | Depósito de origem obrigatório quando há mais de um depósito ativo; a tela pede a escolha |
| 9 | Seleção de pessoas carregava só os primeiros registros e filtrava no navegador | Busca vai ao servidor (`list_parties` com termo, limite e deslocamento); a tela mostra o total encontrado |
| 10 | Funções auxiliares executáveis por visitante | `EXECUTE` revogado de `anon`/`PUBLIC` em `kit_board`, `kit_detail`, `kit_aceitar`, `kit_cycle_create`, `kit_transfer_confirm`, `kit_transfer_forward`, `kit_item_publish`, `orders_list`, `order_detail`, `my_party_id`, `kit_cycle_in_scope`, `kit_scope_all` |

Identidade da maleta e histórico preservados: `kits` continua permanente, cada ciclo guarda responsável, custódia e eventos imutáveis; troca de consultora abre novo ciclo e não sobrescreve o período anterior.

## 2. Fluxo real hoje (estoque → maleta → consultora)

Ligado e comprovado:

1. Saldo em depósito (`stock_balances`) e contagem/entrada por `register_stock_movement`.
2. Montagem (`kit_item_upsert`) validando disponível no depósito de origem escolhido.
3. Conferência (`kit_conferir`): reserva o estoque e congela a composição.
4. Expedição (`kit_expedir`) direta ou via representante, movendo o físico para a localização da maleta.
5. Cadeia de custódia (`kit_transfer_confirm`, `kit_transfer_forward`) com recusa e motivo.
6. Aceite da consultora (`kit_aceitar`) com divergência classificada.
7. Vitrine individual e pedido da cliente (`showcase_public`, `showcase_order_create`, `orders_list`).

**Não conectado** (marcado como pendência, nada foi simulado):

- Venda da consultora para a cliente final fora da vitrine: não existe registro.
- Baixa de `qty_sold` por venda confirmada: o pedido da vitrine reserva, mas a conclusão comercial está fora desta rodada.
- Retorno de maleta com conferência por item: **não existe**.
- Acerto Lardan ↔ consultora e valores devidos: **não existe**.
- Transferência de peças mantidas para o ciclo seguinte: **não existe**.

Consequência direta: se saírem 50 peças e voltarem 30, o sistema **não** classifica as 20 restantes. Não há cobrança automática nem presunção de venda.

## 3. Fundação para integração fiscal futura

Não há integração fiscal. Nenhum fornecedor foi escolhido, nenhuma autorização é simulada e o romaneio de expedição **não** é nota fiscal. O que existe hoje é apenas a fundação sobre a qual uma integração futura poderá ser construída: identificador estável do ciclo, composição congelada na conferência, expedição datada com rota e custódia, eventos imutáveis.

Os estados de documento de remessa (`pendente`, `autorizado`, `rejeitado`, `cancelado`) são uma **intenção de projeto**, não estrutura existente: não há tabela, coluna, função ou tela que os represente. Remessa e venda são operações distintas e não devem compartilhar o mesmo documento.


## 4. Testes executados

Ambiente: banco do projeto, dados sintéticos com prefixo `HOMOLOG`, contas `@lardan.test` criadas e neutralizadas ao fim. Nenhum produto publicado, consultora real ou saldo de produção foi tocado.

- `tests/maletas/isolamento.test.ts` — 15 casos, todos passando.
- `tests/maletas/ciclo.test.ts` — 6 casos, todos passando.
- `tests/maletas/vitrine.test.ts` — 8 casos, todos passando.

Cobertura: consultora A × maleta de B (lista, detalhe e tabela); representante × carteira alheia; visitante, usuário sem vínculo, sem papel e desativado; papel removido durante a sessão; escrita direta em tabela; composição após conferência (inclusive por serviço); aceite integral, parcial sem classificação, negativo, acima do enviado, peça repetida, peça fora da composição, divergência sem tipo/motivo, repetido, mesma chave com conteúdo diferente; duas montagens concorrentes disputando as duas últimas unidades; expedição repetida; reconciliação `stock_balances` × `kit_balances`; depósito ambíguo; paginação e busca de pessoas além dos 30 primeiros.

Limitações honestas: carga testada é funcional e de concorrência pontual (2 operações simultâneas na mesma peça), **não** é teste de carga com milhares de operações simultâneas. Nada disso autoriza afirmar desempenho sob uso massivo.

Dívida de teste **pré-existente** (herdada de rodadas anteriores, sem relação com as mudanças de maletas) — **regularizada na rodada de fechamento**, ver seção 7.

## 5. Respostas objetivas

- **Hoje conseguimos montar e expedir uma maleta a partir de estoque válido?** Sim, comprovado ponta a ponta em ambiente de teste: entrada de saldo, montagem validada, conferência com reserva, expedição direta e via representante, custódia, aceite e vitrine.
- **O retorno já está conciliado com vendas registradas pela consultora?** Não. Retorno, acerto e venda fora da vitrine não existem no sistema.

## 6. Aplicação e validação

As migrações desta rodada já estão aplicadas no banco do projeto (preview e publicado compartilham a mesma base). Nenhuma migração anterior foi reescrita e nenhum dado real foi alterado, apagado ou ajustado.

Validar: abrir Maletas com um perfil interno (vê tudo) e com uma consultora (vê só as suas); abrir uma maleta alheia pelo endereço direto (deve recusar); tentar concluir um aceite deixando peças sem classificar (deve recusar).

**Estado:** código preparado e homologado em ambiente de teste com dados sintéticos; migrações aplicadas na base do projeto; para valer em `https://www.lardan.com.br` é preciso publicar.

---

## 7. Fechamento técnico da rodada

### 7.1 Correções adicionais aplicadas no banco

| Achado | Onde | Correção |
|---|---|---|
| Autorização indefinida em `order_set_status`: usuário sem pessoa vinculada passava pela verificação (`NOT (cap OR pessoa = NULL)` resulta em NULL) | pedidos | Exige sessão; `IS NOT TRUE` + rejeição explícita de pessoa nula. **Regra comercial do pedido inalterada** — só a autorização mudou |
| Mesmo defeito em `showcase_save`: sem pessoa vinculada era possível gravar a vitrine de outra consultora informando o identificador dela | vitrine | Mesma barreira. Demais regras (endereço mínimo, reservado, em uso, vitrine nova fora do ar) preservadas byte a byte |
| `expire_stock_reservations` era **inalcançável**: só o serviço podia executar, mas a verificação interna exigia usuário conectado | reservas | Aceita o caminho de serviço e continua recusando qualquer credencial de usuário, inclusive Master. Nenhuma automação/agendador foi ligado |
| Duplo clique **simultâneo** em `register_stock_movement` com a mesma chave podia devolver conflito de chave única em vez do mesmo lançamento | estoque | Trava por chave de idempotência antes da consulta; único efeito e mesma resposta nas duas chamadas |
| `EXECUTE` ainda aberto a `PUBLIC`/`anon` | maletas e vitrine | Revogado em `kit_board`, `kit_require_cycle`, `kit_block_direct_write`, `kit_block_frozen_composition`, `showcase_slug_reserved`, `expire_stock_reservations` |

Revisão de permissões do módulo (inclusive auxiliares e as duas funções fora do resumo anterior, `order_set_status` e `showcase_save`): todas as rotinas de maletas, pedidos e vitrine são `SECURITY DEFINER` com `EXECUTE` apenas para `authenticated`/`service_role`; nenhuma é alcançável por visitante. Os gatilhos de bloqueio não são mais chamáveis por ninguém — triggers não dependem de `EXECUTE` do usuário.

### 7.2 Barreira de escrita — comportamento verificado

- `zz_block_direct_write`: recusa `INSERT`/`UPDATE`/`DELETE` diretos de `authenticated` e `anon` em `kits`, `kit_cycles`, `kit_compositions`, `kit_composition_items` e `kit_transfers`. As funções oficiais continuam funcionando porque rodam como dono (`SECURITY DEFINER`).
- `zz_block_frozen_composition`: recusa alterar composição já conferida, **inclusive por serviço**, salvo o sinalizador explícito `lardan.kit_freeze_bypass='on'` usado apenas dentro da rotina oficial.
- Perfil desativado e usuário sem vínculo continuam bloqueados: `my_party_id()` devolve nulo e todas as rotinas rejeitam nulo explicitamente.
- Parâmetros, contexto de sessão e chamada direta não contornam: o escopo é decidido dentro da função por `kit_cycle_in_scope`, nunca por parâmetro vindo da tela.

Evidência: `tests/maletas/isolamento.test.ts` (15 casos) cobre escrita direta, composição congelada por serviço, perfil desativado, usuário sem vínculo e papel removido durante a sessão. Resultado: todos passando.

### 7.3 Compatibilidade com o site publicado

Preview e site publicado usam a **mesma base**, então as mudanças de função, política e gatilho já estão valendo no site publicado, com a interface antiga.

Já ativo no banco, independente de publicação:
- isolamento por pessoa e carteira em todas as consultas de maletas;
- recusa de escrita direta e de alteração de composição congelada;
- aceite só é concluído com todas as peças e com tipo/motivo na divergência;
- depósito de origem obrigatório quando há mais de um ativo;
- rotina de vencimento de reservas restrita ao serviço.

Depende da publicação da interface (até lá, a tela antiga mostra erro em vez de conduzir o usuário):
- tela de aceite antiga não coleta tipo/motivo por peça → o banco recusa e a consultora vê mensagem de erro;
- criação de maleta antiga não pede o depósito de origem → recusada quando há mais de um depósito ativo;
- listagem antiga não envia página/tamanho → funciona, porém com o recorte padrão do banco.

Nenhuma incompatibilidade foi resolvida afrouxando regra: a interface atual do repositório (`src/lib/maletas.ts`, `src/routes/_authenticated/consultora.tsx`, `src/routes/_authenticated/admin/maletas.tsx`, `src/components/premium/SmartSelect.tsx`) já envia todos os parâmetros novos. **Publicação coordenada:** publicar a interface assim que possível; até lá, orientar quem opera maletas a usar o ambiente de preview, que já roda a interface nova sobre a mesma base.

### 7.4 Suítes regularizadas

| Suíte | Falha | Regra vigente | Origem |
|---|---|---|---|
| `tests/crm/candidaturas.test.ts` | envio sem nome, sobrenome e CPF → recusado | `submit_candidatura` exige os três desde a rodada do CPF | anterior às maletas |
| idem | UTM do Google esperava `google` | o classificador distingue `google_organico`, `google_ads` e `google` | anterior às maletas |
| `tests/vitrine/contratos.test.ts` | fornecedor sintético com nome fixo colidia com resíduo de bateria anterior, derrubando a ficha e todas as invariantes | nome de fornecedor é exclusivo | resíduo de teste, anterior às maletas |
| `tests/security/reservas.test.ts` | esperava que o Master executasse o vencimento | rotina é exclusiva do serviço desde a rodada de reservas | anterior às maletas |
| `tests/security/estoque.test.ts` | passava; agora também cobre o duplo clique simultâneo | — | — |

Nenhum cenário foi apagado, ignorado ou enfraquecido — os testes de candidaturas e reservas ficaram **mais** exigentes (CPF inválido, sobrenome ausente, três variações de UTM, recusa a visitante e a Master, execução pelo caminho de serviço).

Comando e resultado (sem segredos):

```
bunx vitest run
  Test Files  16 passed (16)
       Tests  253 passed (253)
bunx tsgo --noEmit   → sem erros
```

Nenhum teste ignorado (`skip`/`todo`); nenhuma falha restante.

### 7.5 Ambiente e preservação dos dados

Não existe base de homologação separada neste projeto: preview e publicado compartilham a mesma base. **Limitação declarada:** as baterias de escrita rodaram na base compartilhada, com dados sintéticos.

O que pode ser afirmado com honestidade:
- os testes criam registros próprios e removem **pelos identificadores criados na própria execução** — a limpeza por prefixo de nome e por domínio de e-mail foi retirada do `tests/security/harness.ts` nesta rodada;
- estoque usa peça já existente e devolve as unidades por lançamentos inversos, sem apagar movimentação (a movimentação é imutável por gatilho);
- nenhum produto publicado, consultora real, pedido real ou candidatura real foi alterado.

O que **não** pode ser afirmado: não houve comparação formal antes/depois dos dados reais na rodada anterior, porque essa comparação não foi registrada. Qualquer afirmação nesse sentido em versões anteriores deste relatório deve ser lida como não comprovada.

### 7.6 Plano de recuperação seguro

Regra: **nunca reabrir permissão para restabelecer operação.** Se algo quebrar:

1. **Diagnosticar pelo erro real** (recusa de permissão, recusa de regra ou defeito de tela). Recusa de permissão em operação legítima é defeito de escopo, não motivo para afrouxar.
2. **Preferir correção adicional**: nova migração que amplia o escopo legítimo de forma explícita (capacidade nominal, pessoa vinculada), nunca removendo a verificação.
3. **Se a correção não for imediata, suspender a operação afetada** (ocultar a ação na tela ou recusar com mensagem clara) em vez de liberar acesso amplo.
4. **Reversão só do que é reversível sem tocar dados:** funções, políticas, permissões de execução e gatilhos — nova migração restaurando a versão anterior, com o defeito de segurança documentado e prazo para refazer.
5. **Exige tratamento de dados (não reverter sozinho):** aceites já gravados com tipo de divergência, reservas já liberadas por vencimento, saldos de `kit_balances`. Aqui a ação é listar as inconsistências e tratar caso a caso; nenhuma rotina automática corrige quantidade ou apaga registro.

Verificação após qualquer recuperação: consultora enxerga só as próprias maletas; maleta alheia por endereço direto é recusada; escrita direta em tabela de maletas é recusada; aceite sem classificar peça é recusado; `stock_balances` × `kit_balances` reconciliam para um ciclo conferido; `bunx vitest run` inteiro verde.

### 7.7 Pendências reais

- Retorno de maleta por item, conciliação com vendas, acerto Lardan ↔ consultora e conclusão comercial do pedido: **não existem** (fora do escopo por decisão).
- Agendador do vencimento de reservas: a rotina existe e é executável pelo serviço, mas **não há agendamento automático**.
- Integração fiscal: apenas fundação (seção 3).
- Base de homologação separada: não existe; enquanto não existir, toda bateria de escrita roda na base compartilhada com dados sintéticos.
- Publicação da interface: pendente e necessária para a compatibilidade descrita em 7.3.

