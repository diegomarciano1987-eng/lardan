# Estoque e Reservas

Documento canônico do saldo de estoque e do motor de reservas.
Última atualização: 07/09/2026.

## 1. Fórmula do saldo

```text
disponível = saldo físico − reservado por reservas ativas
```

- **Saldo físico**: `stock_balances.quantity` por variante e local. Só muda por
  `register_stock_movement`.
- **Reservado**: `stock_balances.reserved`, soma das reservas com situação
  `ativa` e validade no futuro. Só muda pelas funções de reserva. Nunca fica
  negativo (`stock_balances_reserved_nonneg`) e nunca ultrapassa o físico.
- **Disponível**: calculado no servidor (`stock_available`) e devolvido por
  `stock_balances_list` e `stock_item_detail`. Não é armazenado.

Não existe caminho de escrita direta: nem a interface, nem a API REST alteram
`quantity` ou `reserved`. As tabelas não têm GRANT de escrita para
`authenticated`; toda operação passa por função `SECURITY DEFINER`.

## 2. Estados da reserva

| Situação | Compromete disponível | Como se chega |
| --- | --- | --- |
| `ativa` | sim | `create_stock_reservation` |
| `confirmada` | não | `confirm_stock_reservation` (vira saída física) |
| `liberada` | não | `release_stock_reservation` sem motivo |
| `cancelada` | não | `release_stock_reservation` com motivo obrigatório |
| `vencida` | não | validade ultrapassada + expiração |

A reserva nunca é apagada: um gatilho (`stock_reservations_no_delete`) recusa
DELETE, e o histórico permanece para consulta em qualquer situação.

## 3. Operações oficiais

| Função | Capacidade | Regras |
| --- | --- | --- |
| `create_stock_reservation` | `stock.reservation.create` | Trava variante+local (`FOR UPDATE`), expira vencidas, calcula o disponível dentro da transação, recusa acima do disponível, exige validade futura, gera protocolo `RSV-AAMMDD-#####`, chave de repetição, auditoria |
| `confirm_stock_reservation` | `stock.reservation.confirm` | Só reserva ativa; gera **uma** saída física vinculada (`stock_movements.reservation_id`); repetição devolve a mesma reserva e o mesmo movimento (`repetida: true`), sem novo efeito |
| `release_stock_reservation` | `stock.reservation.cancel` | Libera ou cancela; cancelamento exige motivo; devolve o disponível sem mexer no físico; repetição não tem efeito |
| `expire_stock_reservations` | `stock.reservation.expire` | Marca vencidas e devolve o reservado; repetição é segura |
| `stock_reservations_list` / `stock_reservation_detail` | `stock.reservation.view` | Busca, filtros e paginação no servidor; nunca devolvem custo |

## 4. Como a expiração é executada

A expiração **não depende do navegador aberto**. Ela roda em três momentos:

1. Dentro de `register_stock_movement`, antes de calcular qualquer delta.
2. Dentro de `create_stock_reservation` e `confirm_stock_reservation`, antes de
   decidir o disponível.
3. Sob demanda, por `expire_stock_reservations()`, que pode ser chamada por um
   agendador.

Efeito prático: nenhuma decisão de estoque usa reserva vencida, mesmo que
ninguém tenha rodado a varredura. **Pendência conhecida:** ainda não existe
agendador periódico ligado (pg_cron ou chamada externa), então uma reserva
vencida pode continuar aparecendo como "reservado" na listagem até que alguma
operação toque aquela variante e local, ou até que a varredura seja chamada.

## 5. Integração com saídas

- Saída comum, transferência, ajuste e contagem recusam qualquer operação que
  deixe o físico abaixo do reservado, com mensagem humana informando quantas
  unidades estão comprometidas.
- Só a confirmação da própria reserva consome a quantidade reservada.
- Toda movimentação continua imutável e guarda saldo antes → depois por lado.

## 6. Permissões por perfil

| Perfil | view | create | confirm | cancel | expire | audit |
| --- | --- | --- | --- | --- | --- | --- |
| Master | sim | sim | sim | sim | sim | sim |
| Diretoria | sim | sim | sim | sim | sim | sim |
| Estoque | sim | sim | sim | sim | não | não |
| Financeiro | sim | não | não | não | não | não |
| Marketing, Suporte, Consultora | não | não | não | não | não | não |
| Representante | pendente (escopo próprio, fluxo não entregue) | | | | | |
| Visitante | não | não | não | não | não | não |

Nenhuma resposta de reserva carrega custo. Estoque, Marketing, Suporte,
Representante e Consultora nunca recebem valor de custo por essas funções.

## 7. Tela

`/admin/estoque` tem três áreas:

- **Saldos** — foto, peça, local, físico, reservado e disponível. Clique abre a
  ficha lateral com fotos, identificação, saldo por local, reservas ativas,
  próxima a vencer e última movimentação.
- **Movimentações** — histórico completo e imutável.
- **Reservas** — busca no servidor, filtros de situação, local, origem e
  validade, paginação, e as ações Confirmar saída, Liberar, Cancelar e Ver
  histórico. "Nova reserva" fica no topo da página.

Mensagens ao usuário: "Existem apenas N unidades disponíveis neste local.",
"Esta reserva já foi confirmada.", "Esta reserva venceu e não compromete mais o
estoque.", "Informe o motivo do cancelamento."

## 8. Fora de escopo nesta rodada

Maleta, venda, pagamento de 40%, emissão fiscal, compras, recebimento de NF-e,
rastreamento físico individual, inventário por sessão e importação industrial.
