# Para o Lovable — 0161: notas fiscais e fechamentos no cockpit da consultora

Aplique **depois da 0160**, exatamente como está. Não renomeie funções e não publique sem a minha aprovação.

## 1. Migração `0161_cockpit_notas_fechamentos.sql`

Fica em drizzle/migrations. Pode renumerar o arquivo; o conteúdo é o mesmo. É uma única função de leitura: não cria, não altera e não apaga dados.

`consultora_notas_e_fechamentos(_party)` tem a mesma permissão do financeiro SmallData do cockpit (`cob_pode` ou `registry.finance.view`) e devolve duas listas.

- **notas:** toda nota fiscal lançada contra a pessoa, inclusive as canceladas.
  - **SmallData:** `legado_notas` pelos códigos de cliente dela (remessa, devolução, venda e perda).
  - **Lardan:** `fiscal_documents` em que ela é a destinatária ou a devedora, ou em que a maleta é dela.
- **fechamentos:** todo fechamento de maleta.
  - **SmallData:** `legado_maletas` (enviada, fechamento, peças e valores enviados, devolvidos e vendidos, divergência, sem cobrança, números das NFs), com o acerto da mesma remessa de `legado_cobrancas` (venda bruta, comissão, líquido, pago, fiado novo).
  - **Lardan:** cada maleta dela, com a pré-baixa ou o acerto oficial e as NF-e.

## 2. Interface

- Em `CockpitFinanceiroConsultora.tsx` entram as abas **Fechamentos** e **Notas fiscais**. Esse cockpit aparece na ficha da pessoa e na Central de Cobrança.
- Quando ela não tem débito em aberto, o cockpit abre direto em Fechamentos.
- `src/lib/cobranca.ts`: `notasEFechamentos` e os tipos.

## 3. Testes

- `tests/isolado/cockpit-notas-fechamentos.test.ts` é novo e tem 3 testes:
  - todas as NFs, SmallData + Lardan, inclusive a cancelada;
  - fechamentos com acerto e notas;
  - só a equipe vê.
- Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **490 pass, 0 fail**.

## 4. Depois de aplicar, me devolva

Rode logado como alguém da cobrança, para uma consultora antiga que tenha histórico no SmallData:

```sql
select jsonb_array_length(x->'notas') as notas, jsonb_array_length(x->'fechamentos') as fechamentos
  from (select public.consultora_notas_e_fechamentos('<id da consultora>') x) s;
```

Acrescente ao `drizzle/AGENTS.md` a linha "Cockpit NFs and fechamentos (0161)" que está no AGENTS deste pacote.
