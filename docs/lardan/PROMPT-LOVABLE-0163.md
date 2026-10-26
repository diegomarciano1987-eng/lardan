# Para o Lovable — 0163: ajustes da revisão dos pacotes 0158–0162

Aplique **depois da 0162**, exatamente como está. Não renomeie funções e não publique sem a minha aprovação. A migração não remove coluna e pode rodar duas vezes.

## 1. Migração `0163_ajustes_revisao_apps.sql`

1. **Pagamento não conclui o pedido:**
   - o gatilho `pedido_pagamento_sincronizar` e `consultora_pedido_pago_dinheiro` passam a marcar só "pago";
   - a conclusão continua exigindo o registro da venda, como já manda `order_set_status`;
   - "aguardando pagamento" pago volta para "em atendimento";
   - pedidos que a 0160 concluiu sozinha voltam para "em atendimento", com o evento `pedido.correcao_0163`.
2. **Início da consultora:** pedido já pago deixa de aparecer como pendência de pagamento (patch em `consultant_home`).
3. **Acerto:**
   - `pre_baixa_conferir` recalcula o que as clientes pagaram à Lardan. O pagamento feito depois do fechamento vira crédito à consultora, nunca cobrança em dobro;
   - o motivo da pendência passa a dizer todas as causas;
   - `pre_baixa_pago` trata a pré-baixa com valor ≤ 0 como paga, para ela não ficar presa em "aguardando pagamento".
4. **Correções:**
   - `consultora_meu_financeiro` mostra os 60 acertos mais recentes (antes a ordem era errada);
   - em `minha_equipe`, "ativa" passa a ser calculado por indicada;
   - em `liga_ciclos`, a maleta do SmallData sem cobrança não conta mais.
5. **Dinheiro com link do Asaas aberto:** `rep_dinheiro_receber` devolve `aviso_asaas` e abre uma tarefa da cobrança para cancelar o link, para a cliente não pagar duas vezes.
6. **Índices novos:**
   - `financial_titles` por devedor;
   - `fiscal_documents` por destinatária, devedora e maleta;
   - `sales_order_items` por maleta.

## 2. Interface

- **`AcertoApp.tsx`:** mostra "Clientes já pagaram à Lardan" e "A Lardan te deve" quando o valor fica negativo.
- **`LigaEAcerto.tsx` e `MeuFinanceiro.tsx`:** valor negativo aparece como "A Lardan te deve".
- **`PagamentoLardan.tsx`:** o texto passa a dizer "pedido fica pago" em vez de "pago e concluído".
- **`AcoesRepresentante.tsx`:** mostra o aviso do link do Asaas no recibo; o funil ganha o rótulo da origem "madrinha".
- **`representante.ts` e `pre-baixa.ts`:** tipos atualizados.

## 3. Testes

- `app-consultora.test.ts` foi atualizado e tem 2 testes novos.
- `app-representante.test.ts` tem 1 teste novo.
- Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **497 pass, 0 fail**.

## 4. Depois de aplicar, me devolva

```sql
select count(*) from public.sales_order_events where kind = 'pedido.correcao_0163';   -- pedidos corrigidos
select count(*) from public.sales_orders where status = 'concluido';
select mfa_obrigatorio from public.access_security_settings;
select public.asaas_ator_pode(ator_user_id, 'finance.settlement.create') from public.consultora_cobranca_config;
```

Acrescente ao `src/components/admin/maletas/AGENTS.md` a linha "Review fixes (0163)" deste pacote.
