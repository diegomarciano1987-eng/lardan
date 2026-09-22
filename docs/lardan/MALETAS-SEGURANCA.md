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

## 6. Aplicação, validação e recuperação

As migrações desta rodada já estão aplicadas no banco do projeto (preview e publicado compartilham a mesma base). Nenhuma migração anterior foi reescrita e nenhum dado real foi alterado, apagado ou ajustado.

Validar: abrir Maletas com um perfil interno (vê tudo) e com uma consultora (vê só as suas); abrir uma maleta alheia pelo endereço direto (deve recusar); tentar concluir um aceite deixando peças sem classificar (deve recusar).

Recuperar: as mudanças são de função, política e gatilho. Reverter significa uma nova migração restaurando a versão anterior das funções — os dados operacionais não dependem dela. Inconsistências antigas, se aparecerem, devem ser listadas e tratadas manualmente; nenhuma rotina automática corrige quantidade ou apaga registro.

**Estado:** código preparado e homologado em ambiente de teste com dados sintéticos; migrações aplicadas na base do projeto; para valer em `https://www.lardan.com.br` é preciso publicar.
