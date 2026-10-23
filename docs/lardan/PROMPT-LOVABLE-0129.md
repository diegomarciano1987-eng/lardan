# Para o Lovable — 0129: consultora antiga usa o número do SmallData como código do cadastro

Aplique exatamente como está. Não renomeie funções e não mude mensagens. Não publique nada sem a minha aprovação.

## O que é

Carla Vicente Ferreira é 8705 no SmallData e LC-003109 no Lardan. Quero que as consultoras antigas tenham o número do SmallData como código, e que as novas continuem com o código gerado pelo Lardan (LC-…).

## Por que não quebra nada

- Nada no sistema liga pelo código: títulos, cobranças, Asaas, maletas, login e histórico usam o id do cadastro. O Asaas casa fatura antiga por `party_codigos_legados`, que não muda.
- O código antigo (LC-…) fica em `party_codigo_historico`, e a busca de cadastros (`search_registry`, `list_parties`) continua achando a pessoa por ele.
- O número do SmallData não colide com LC-000000.
- Representante NÃO muda: o código dele é o endereço da página pública (`rep_publico`).
- Cadastro com mais de um código do SmallData fica para eu escolher.

## 1. Migração 0129_codigo_smalldata_no_cadastro.sql

Arquivo: drizzle/migrations (pode renumerar; o conteúdo é o mesmo). Não apaga nada, não remove coluna e pode rodar duas vezes.

Funções:
- `party_codigo_smalldata_adotar(_party, _codigo default null, _motivo default null)`: troca um cadastro. Só o Master. Fica auditado.
- `party_codigos_smalldata_adotar(_aplicar default false)`: todos de uma vez. Por padrão só mostra a prévia.

Teste: `tests/isolado/codigo-smalldata.test.ts` (novo); a 0128 vai junto.
Esperado: `bash tests/isolado/subir.sh && bun test tests/isolado` → 391 pass, 0 fail.

## 2. Carla (aplicar já)

```sql
-- confere a ligação dela com o SmallData
select l.sistema, l.codigo from public.party_codigos_legados l
  join public.parties p on p.id = l.party_id where p.code = 'LC-003109';
select codcli, ativo from public.legado_consultoras lc
  join public.parties p on p.id = lc.party_id where p.code = 'LC-003109';
```

Se aparecer o 8705, rode:

```sql
select public.party_codigo_smalldata_adotar((select id from public.parties where code = 'LC-003109'), '8705',
                                            'pedido do Diego: código do SmallData');
```

Se o 8705 NÃO aparecer ligado a ela, pare e me avise. Não ligue nada na mão.

Depois, confira: a ficha dela mostra 8705; a busca por "LC-003109" ainda acha a Carla; os títulos, as cobranças e as maletas dela continuam iguais (mesma contagem de antes).

## 3. Demais consultoras: só a prévia

```sql
select jsonb_pretty(public.party_codigos_smalldata_adotar(false));
```

Me devolva o resultado inteiro. NÃO rode com `true` até eu aprovar.

Acrescente ao AGENTS.md: "Party code (0129): legacy consultants use their SmallData number as parties.code via party_codigo_smalldata_adotar / party_codigos_smalldata_adotar (preview first); old code kept in party_codigo_historico and still searchable; representatives keep their code (public page); new parties keep LC-…; never link records by code."
