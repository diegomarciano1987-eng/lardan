# Para o Lovable — 0159: app da consultora (19 itens)

Aplique **depois da 0158**, exatamente como está. Não renomeie funções e não mude mensagens. Não publique a interface sem a minha aprovação.

## 1. Migração `0159_app_consultora.sql`

Fica em drizzle/migrations. Pode renumerar o arquivo; o conteúdo é o mesmo. A migração não apaga dados, não remove coluna e pode rodar duas vezes. A única troca de regra é em `sales_orders.pay_method`, que passa a aceitar também `'dinheiro'`.

- **Pagamento da cliente dá baixa sozinho:** gatilho `pedido_pagamento_sincronizar` em `financial_allocations`. Quando a parcela do pedido é liquidada (Pix/cartão pelo Asaas), o pedido vira pago e concluído. Se houver estorno, vira "estornado".
- **Cliente pagou em dinheiro:** `consultora_pedido_pago_dinheiro`. Só a dona do pedido usa, e não vale para pedido que já tem cobrança da Lardan.
- **Acerto desconta o que a cliente já pagou à Lardan:**
  - nova coluna `kit_pre_baixas.recebido_lardan_cents` e função `pre_baixa_recebido_lardan`;
  - a conta passa a ser valor a pagar = vendido − comissão − recebido pela Lardan;
  - patch textual em `pre_baixa_calculo`, `pre_baixa_fechar`, `pre_baixa_conferir` e `pre_baixa_ler`.
- **Meus ganhos:** `consultora_vendido_ciclo` usa o que ela marcou na pré-baixa (patch em `consultora_ganhos`).
- **Meu financeiro:** `consultora_meu_financeiro` traz o próximo acerto (data, valor e situação), os débitos em aberto com link, o histórico de acertos (Lardan + SmallData) e o Pix da Lardan.
  - A 2ª via sai de `consultora_debito_cobranca`, com a server function `consultoraSegundaVia`.
  - `consultora_debito_asaas_preparar` é só do servidor.
- **Início com pendências reais** (`consultant_home` redefinida):
  - pedidos em atendimento;
  - o acerto, com vendeu X de Y e o valor;
  - débitos vencidos e em aberto;
  - aniversário das clientes hoje e amanhã;
  - clientes há mais de 45 dias sem comprar.
- **Indicação:**
  - "Quem te indicou?" fica em `leads.indicado_por_texto` e liga à madrinha quando é o código dela;
  - a indicada herda o representante (e a praça) da madrinha quando estiver vazio;
  - a madrinha aparece na ficha e é corrigida em `consultora_madrinha_ler` e `consultora_madrinha_definir`;
  - a situação de cada indicada vem de `indicada_situacao`: candidata, aprovada, 1ª maleta, ativa ou não seguiu.
- **Caminho para líder:**
  - tabelas `lider_config` (3 indicadas ativas, R$ 650 no ciclo, comissão 0% desligada) e `lideres`;
  - `meu_caminho_lider` e `lider_solicitar` para a consultora;
  - `lider_decidir`, `lider_admin` e `lider_config_salvar` só para o Master;
  - `minha_equipe` só para líder aprovada, mostrando só o primeiro nome e a inicial.
- **Liga Lardan:**
  - tabela `liga_niveis`: Bronze 0, Prata 2, Ouro 4 e Diamante 8 ciclos de R$ 650 ou mais em 12 meses, contando Lardan + SmallData;
  - `minha_liga` e `liga_niveis_ler`;
  - `liga_niveis_salvar` só para o Master.
- **Ajuda:** os artigos que falavam em "Jornada" e "Clientes" passam a dizer "Minhas clientes".

## 2. Interface

- **App da consultora → Início, nesta ordem:**
  1. lembrete de pagamento;
  2. Liga;
  3. Meus ganhos;
  4. Acerto;
  5. Nova venda;
  6. atalhos Nova cliente / Academy / Minha vitrine;
  7. O que fazer agora (pendências reais, nunca "Tudo em dia" com pedido aberto);
  8. Indique e seja líder;
  9. novidades;
  10. resumo.
  - O botão "Nova interessada" virou "Nova cliente".
  - Arquivos: `AppConsultora.tsx`, `LigaEAcerto.tsx` (novo), `Lider.tsx` (novo).
- **Meu financeiro:** nova aba `MeuFinanceiro.tsx`, também no menu "Mais".
- **Pagamento do pedido:** em `PagamentoLardan.tsx`, nova opção "Cliente pagou em dinheiro".
- **Indicações:** `Indicacoes.tsx` mostra a situação de cada indicada, o Caminho para líder e a aba Minha equipe.
- **Site → Seja Lardan:** em `SejaLardanForm.tsx` e `candidaturas.functions.ts`, novo campo "Quem te indicou?", preenchido e travado quando ela chega pelo link.
- **Admin → ficha da consultora:** `MadrinhaConsultora.tsx` (novo), dentro de `VinculoConsultora.tsx`.
- **Admin → Configurações:** `LiderELiga.tsx` (novo), com:
  - os critérios de líder;
  - os pedidos para aprovar, recusar ou suspender;
  - a comissão da líder, desligada;
  - os níveis da Liga.
- **Tutorial:** o passeio da consultora foi atualizado (chave v3, aparece de novo uma vez).

## 3. Testes

- `tests/isolado/app-consultora.test.ts` é novo e tem 11 testes:
  - baixa automática do Pix;
  - pagamento em dinheiro;
  - desconto no acerto: 150,00 vendidos − 20% − 100,00 já pagos = 20,00;
  - Início;
  - Meu financeiro e 2ª via só do que é dela;
  - ganhos;
  - "Quem te indicou?" com código e com texto livre;
  - madrinha;
  - situação da indicada;
  - fluxo de líder;
  - Liga.
- Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **477 pass, 0 fail**.

## 4. Depois de aplicar, me devolva

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'sales_orders_pay_method_check';
select * from public.lider_config;
select * from public.liga_niveis order by ordem;
select count(*) from public.leads where indicado_por_texto is not null;
```

Acrescente ao AGENTS.md a linha "Consultant app (0159)" que está no AGENTS.md deste pacote.
