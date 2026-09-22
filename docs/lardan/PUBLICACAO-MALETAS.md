# Maletas — fechamento da interface e preparação de publicação

Data: 22/09/2026. **Nada foi publicado nesta rodada.** Fiscal e Asaas seguem
desligados: nenhum documento sai de "preparação" e nenhuma cobrança vira
lançamento.

## 1. Persistência da correção da Qualidade

A correção está versionada em
`supabase/migrations/20260922205605_cf7730e6-deed-4f8f-91c5-64ce66801f24.sql`
(liberação de peça bloqueada reconhecida como operação interna de estoque, sem
afrouxar chamadas diretas). O banco local isolado foi **recriado do zero a
partir do código** (163 migrações) e reproduz a correção — ou seja, a versão do
banco é reproduzível integralmente pelas migrações do projeto.

## 2. Comparação código × banco local × banco compartilhado

Somente estrutura e definições; nenhum dado comercial ou pessoal foi lido.

| Comparação | Itens | Resultado |
| --- | --- | --- |
| Definição das 44 rotinas de maleta/estoque (`pg_get_functiondef`, md5) | 44 | idênticas |
| Índices, gatilhos, restrições, colunas, políticas e capacidades das tabelas de maleta, estoque, fiscal, Asaas e preços | 309 linhas | digest idêntico (`8ead5846…`) |

Reproduzir: `psql <iso> -f /tmp/cmp.sql` e a mesma consulta no compartilhado
(os scripts estão descritos em `tests/isolado/LEIA-ME.md`).

Nenhuma diferença foi encontrada; nenhuma migração corretiva foi necessária por
essa comparação.

## 3. Migração desta rodada (aditiva e idempotente)

`20260922211230_*.sql` — `kit_conciliacao` passa a devolver **remessa inicial**,
**acréscimo em trânsito** e **acréscimo recebido** separados (antes vinham
somados em "saiu"). É `CREATE OR REPLACE`, só leitura, não altera saldo,
permissão nem regra. Aplicada ao compartilhado e ao isolado.

## 4. Conceitos exibidos

A conferência por peça mostra, separadamente: remessa inicial · remessa em
trânsito · recebidas pela consultora · acréscimo em trânsito · acréscimo
recebido · retorno declarado · retorno aprovado · divergência · garantia/defeito
· mantidas · perdas · **vendas comprovadas** · ainda sob responsabilidade.

- "Vendas comprovadas" só conta venda vinculada ao item da maleta. Hoje é
  sempre 0 e a tela avisa que as vendas da consultora ainda não alimentam a
  conferência.
- A diferença física nunca aparece como venda, dívida ou divergência: ela é
  "ainda sob responsabilidade", com aviso explícito.
- Ciclo sem saldos registrados mostra aviso próprio ("não significa
  divergência") em vez de zeros mudos.

## 5. Evidências de navegador (pré-visualização)

| Verificação | Resultado |
| --- | --- |
| Lista de maletas e ficha abrem sem erro de aplicação | ok (os únicos erros de console são 500 do CDN externo de fontes, alheio ao módulo) |
| Painel de conferência com os 13 conceitos separados | ok (captura `conferencia-desktop.png`) |
| Ciclo sem saldos → aviso honesto | ok |
| Celular 390 px sem estouro horizontal | corrigido (era 529 px; agora 392 px) |
| Escrita direta em `kit_movements` pelo navegador | recusada: *violates row-level security policy* |
| Alteração direta de `kit_balances` pelo navegador | recusada: *permission denied* |
| `kit_retorno` em ciclo alheio, fora da interface | recusada: *Ciclo de maleta não encontrado* |
| Todas as operações da tela passam por rotinas oficiais | ok — há uma única porta (`supabase.rpc`) em `src/lib/maletas.ts`; nenhuma tela escreve em tabela |

### Erros encontrados e corrigidos nesta rodada

1. **Estouro horizontal no celular** na ficha da maleta (colunas do grid sem
   `min-w-0`).
2. **Chave de repetição recriada a cada envio** nos formulários de acréscimo e
   de declaração de retorno: um reenvio após erro de rede geraria dois
   movimentos. Agora a chave vive até a operação concluir, então duplo clique e
   reenvio devolvem o mesmo movimento.
3. **Zeros sem explicação** em ciclo sem saldos.
4. Conceitos somados em "saíram" (item 3 acima).

### Limitações declaradas

- Não há base de homologação. Os fluxos de **escrita** (acréscimo, recebimento,
  retorno, conferência 20/18, garantia, liberação) foram exercitados no banco
  local isolado — 41 testes verdes, incluindo 50 + 5 − 20 com 35 sob
  responsabilidade — e **não** foram repetidos no navegador, porque isso
  escreveria na base compartilhada.
- Perfis: o navegador roda com a sessão disponível (Matriz). Não existem
  usuários sintéticos de representante, consultora e Qualidade na base
  compartilhada, e não se usa conta real de terceiros. As restrições desses
  perfis estão provadas no isolado (testes 19 a 25) e, no navegador, provadas
  pelo lado que importa: o banco recusa a chamada manipulada.
- As suítes que escrevem na base compartilhada continuam fora de escopo e não
  foram mantidas nesta rodada.

## 6. Arquivos que serão publicados

Frontend (nenhum arquivo público/institucional foi tocado):

- `src/components/admin/maletas/Movimentacoes.tsx`
- `src/lib/maletas.ts`
- `src/lib/capabilities.ts`
- `src/routes/_authenticated/admin/maletas_.$id.tsx`
- `src/routes/_authenticated/consultora.tsx`

Banco (já ativo, independe de publicação): migrações de 22/09 listadas acima.

Documentação e testes (não vão ao ar): `docs/lardan/*`, `tests/isolado/*`,
`roadmap.md`.

## 7. Plano de recuperação

1. A interface antiga continua compatível: as rotinas alteradas mantiveram
   assinatura e apenas **acrescentaram** campos de leitura. Se a nova interface
   apresentar problema, republicar a versão anterior resolve sem tocar no banco.
2. Nunca reabrir permissão para contornar erro. Se uma tela travar uma operação
   legítima, a correção é aditiva (nova migração) ou suspensão temporária do
   botão.
3. Movimento errado se corrige por novo movimento; nada de apagar histórico.
4. Peça bloqueada só sai por `stock_liberar_bloqueio`, com motivo e registro.
5. Inconsistência apurada vira tratamento manual documentado, nunca ajuste
   direto de saldo.

## 8. Checklist humano após uma futura publicação

1. Abrir uma maleta em operação: os 13 números aparecem e batem com o histórico.
2. Acrescentar peças: baixa no depósito de origem, peças em "acréscimo em
   trânsito".
3. Confirmar o recebimento com quem está com a maleta: passa para "acréscimo
   recebido".
4. Declarar retorno de algumas peças: nada entra no depósito ainda.
5. Conferir na Matriz declarando quantidade recebida menor: só o recebido entra
   e o restante fica "a explicar".
6. Marcar uma peça como garantia: some do estoque disponível.
7. Pedir à Qualidade para liberar com motivo: volta ao depósito com registro.
8. Repetir um envio (duplo clique): mensagem de "já estava registrado", sem
   número dobrado.
9. Abrir a mesma ficha no celular: sem rolagem lateral.
10. Confirmar que nenhuma tela oferece emissão fiscal ou cobrança.
