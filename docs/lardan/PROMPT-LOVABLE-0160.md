# Para o Lovable — 0160: app do representante (11 itens)

Aplique **depois da 0159**, exatamente como está. Não renomeie funções e não mude mensagens. Não publique a interface sem a minha aprovação.

## 1. Migração `0160_app_representante.sql`

Fica em drizzle/migrations. Pode renumerar o arquivo; o conteúdo é o mesmo. A migração não remove coluna e pode rodar duas vezes. Telefone repetido só é apagado quando o Master aplica a limpeza, e com cópia guardada.

1. **Cobrança:** `rep_cobrancas_lista` tem:
   - ordem "mais recentes" ou "maior dívida";
   - faixas de atraso: vencidas, 1–30, 31–60, 61–90, +90, hoje, a vencer e todas, com contagem em cada uma;
   - em cada linha, o último contato e a promessa vigente.
2. **Cobrar = contato + promessa no mesmo histórico da Central de Cobrança:**
   - `rep_cob_registrar`, `rep_cob_promessa` (até o saldo das parcelas, data entre hoje e 60 dias) e `rep_cob_historico`;
   - grava em `cob_interacoes`, `cob_promessas`, `cob_casos` e `cob_tarefas`.
3. **Reativação só com dívida zero ou com a aprovação do Master:**
   - `rep_reativar_checado` substitui a reativação automática do cheque e da cobrança (patch textual em `rep_cheque_registrar` e `rep_asaas_preparar`);
   - `rep_consultora_reativar_pedir` reativa na hora quando não há dívida; quando há, cria o pedido em `rep_reativacao_pedidos`;
   - `rep_reativacoes_pendentes` lista os pedidos e `rep_reativacao_decidir` decide, só o Master.
4. **Cobrança nova sempre ligada a uma parcela e nunca acima do saldo:**
   - `rep_cobranca_avulsa` passa a recusar;
   - `rep_cobranca_parcial` aceita até o saldo − as parciais em aberto, grava em `rep_cobrancas_parciais` e, com o valor cheio, cobra a própria parcela.
5. **O representante só vê a carteira dele:** `rep_portal_busca_todas` fica só para o espelho da Lardan (master, diretoria, financeiro, cobrança).
6. **Dinheiro em mãos:**
   - `rep_dinheiro_receber` dá baixa pela rotina oficial (`fin_settlement_create`) na conta **"Retido Representante"**, que é criada se não existir (uma por empresa);
   - grava o recibo numerado em `rep_recibos`; `rep_recibos_lista` lista os recibos;
   - não passa do saldo e não duplica (chave).
7. **Acerto em campo:**
   - `pre_baixa_pode` também aceita o representante da carteira;
   - `rep_acerto_campo_devolucao` lê as peças que voltaram e marca como vendido o que é enviado − devolvido (nunca abaixo do que foi pago no app);
   - novas colunas `kit_pre_baixas.origem` = 'campo', `campo_por` e `campo_em`, e `kit_pre_baixa_itens.qtd_devolvida_campo`;
   - depois disso, `pre_baixa_fechar` e o pagamento (link ou dinheiro). A conferência na Lardan continua em `pre_baixa_conferir`.
8. **Maletas da carteira:** `rep_maletas_carteira` mostra a data do acerto, os dias e a maleta vencida, com a situação do acerto e o saldo a cobrar.
9. **Agenda de visitas:**
   - tabela `rep_visitas`, com `rep_visita_agendar`, `rep_visita_registrar` e `rep_agenda`;
   - a visita registrada entra no histórico de cobrança da consultora.
10. **Funil de captação:**
    - nova coluna `rep_crm_etapas.sistema`, para as colunas "Aprovada pela Lardan", "Primeira maleta" e "Não aprovada", que são criadas para todos os representantes;
    - `rep_crm`, `rep_crm_mover` e `rep_crm_etapa_nova` foram redefinidas;
    - a candidata cai sozinha na coluna da situação dela na Lardan e não dá para arrastar para essas colunas.
11. **Telefones repetidos:**
    - a ficha do representante mostra cada número uma vez (patch em `rep_consultora_ficha_rep`);
    - a limpeza do cadastro é feita em três passos: `contatos_duplicados_previa`, depois o Master aplica com `contatos_duplicados_aplicar('REMOVER REPETIDOS')`, com cópia em `contact_points_duplicados_log`, e dá para desfazer com `contatos_duplicados_desfazer(lote)`.

## 2. Interface

- **`src/routes/_authenticated/representante.tsx`:**
  - aba Cobrança com ordem, faixas de atraso, atraso em dias, dívida total, último contato e promessa;
  - aba Consultoras só com a carteira (saiu "Buscar em todas do sistema");
  - nova aba **Agenda**;
  - a aba Maletas ganhou "Maletas da carteira".
- **`AcoesRepresentante.tsx`:**
  - "Cobrar" agora é sempre da parcela, até o saldo, com três opções: link (Pix/boleto/cartão), **Recebi em dinheiro** (recibo para imprimir ou mandar no WhatsApp) e cheque;
  - novo **Contato** (ligação/WhatsApp/negociação/anotação + promessa + histórico);
  - o funil trava as colunas da Lardan.
- **`FichaConsultora.tsx`:**
  - saiu a cobrança de valor solto;
  - "Registrar contato / promessa";
  - a reativação vira pedido quando há dívida;
  - telefones formatados e sem repetição.
- **Novos:**
  - `CampoRepresentante.tsx`: maletas da carteira, acerto em campo com leitor, agenda e recibos;
  - `src/lib/recibo-representante.ts`: recibo com valor por extenso e duas vias.
- **Admin → Central de Cobrança:** `ReativacoesPendentes.tsx` (novo), no topo; só o Master aprova ou recusa.
- **Admin → Configurações:** `TelefonesRepetidos.tsx` (novo), com prévia, aplicar e desfazer.
- **`src/lib/representante.ts`:** as funções novas e `foneBR`.

## 3. Testes

- `tests/isolado/app-representante.test.ts` é novo e tem 10 testes, um ou mais para cada item acima.
- Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **487 pass, 0 fail**.

## 4. Depois de aplicar, me devolva

```sql
-- o usuário técnico da cobrança precisa poder dar baixa (para o "Recebi em dinheiro")
select public.asaas_ator_pode(ator_user_id, 'finance.settlement.create') from public.consultora_cobranca_config;
select nome, business_entity_id from public.financial_accounts where nome like 'Retido Representante%';
select rep_party_id, nome, sistema, ordem from public.rep_crm_etapas where sistema is not null order by rep_party_id, ordem limit 12;
select count(*) as pessoas, sum(remover_qtd) as telefones from public.contatos_duplicados_previa();  -- rode logado como Master
```

Se a primeira consulta der `false`, **não mexa em permissão**: me avise. A liberação é minha.

Acrescente ao AGENTS.md a linha "Representative app (0160)" e a nota nova de `src/components/representante/AGENTS.md`.
