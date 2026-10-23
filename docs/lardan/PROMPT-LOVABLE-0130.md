# Para o Lovable — 0130: maleta perdida, pular acerto e maleta com o representante

Aplique exatamente como está. Não renomeie funções e não mude mensagens (algumas têm ":" no meio; use `mensagem()` de `src/lib/maletas-perdidas.ts`, não `traduzir`). Não publique a interface sem a minha aprovação.

## 1. Migração 0130_perdidas_pular_acerto_representante.sql

Arquivo: drizzle/migrations (pode renumerar; o conteúdo é o mesmo). Não apaga nada, não remove coluna e pode rodar duas vezes.

### Maleta perdida

- Tabela `maletas_perdidas`: uma linha por maleta perdida, do SmallData ou do Lardan.
- A maleta sai da rua e **não gera nota fiscal**. Vira **fiado** da consultora pelo varejo das peças que não voltaram:
  - título a receber `sistema_origem = 'maleta_perdida'`, conta FIADO-PERDA (fora da DRE, como o fiado histórico);
  - uma linha em `cob_fiado_linhas`, lote `maleta_perdida`, que aparece no cockpit dela.
- Um fiado por maleta: rodar de novo não duplica.
- **SmallData:** perdida é a maleta do tipo "perdida" ou na situação 11.
  - `maletas_perdidas_smalldata_processar(_aplicar)` roda sozinho a cada importação (situação, maletas) e quando uma consultora ganha cadastro.
  - Consultora sem cadastro fica pendente.
- **Lardan:** `kit_maleta_perdida(ciclo, motivo, data)` faz três coisas: tira do estoque o que está na maleta (saída "perda"), encerra o ciclo e gera o fiado.
- Aba nova da Cobrança: `cob_maletas_perdidas(busca, situacao)`.

### Pular acerto

- `kit_pular_acerto(ciclo, motivo, nova_data)`: o vencimento vai para o acerto da próxima remessa da mesma praça. Se não houver próxima remessa, usa a data informada.
- `legado_maleta_pular_acerto(remessa, codcli, motivo, nova_data)`: o mesmo para maleta do SmallData. O panorama e a ficha da consultora passam a usar o vencimento adiado.

### Maleta com o representante

- `remessa_abrir_maleta_representante(remessa)`: abre maleta sem consultora, que é expedida para o representante.
- Portal do representante:
  - `rep_portal_maletas`: maletas a receber, maletas com ele sem consultora e maletas já a caminho da consultora;
  - `rep_maleta_destinatarias`: consultoras e candidatas da carteira dele;
  - `rep_maleta_repassar`: passa a maleta. A candidata vira consultora da carteira dele, na praça da remessa. A maleta segue para ela pelo fluxo normal (confirmação de entrega, aceite e termo).

### Código do SmallData em lote

`party_codigos_smalldata_adotar` foi reescrita sem consulta por cadastro. A prévia da 0129, que estourava o tempo, agora leva menos de 1 segundo com 5 mil cadastros. Resultado e regras iguais.

## 2. Interface

- `src/lib/maletas-perdidas.ts` (novo).
- Cobrança: botão "Maletas perdidas" na troca de visão, com o componente `src/components/admin/cobranca/MaletasPerdidas.tsx` (novo).
- Página da maleta: painel "Maleta na rua", com "Pular acerto" e "Dar baixa como perdida". Componente `src/components/admin/maletas/AcoesMaletaRua.tsx` (novo).
- Ficha/cockpit da consultora, nas maletas do SmallData: "Pular acerto" por linha, com o componente `PularAcertoSmallData.tsx` (novo), e aviso de acerto pulado.
- Remessa:
  - botão "Maleta para o representante";
  - linha "Com o representante · sem consultora";
  - contagem no cartão de maletas.
- Portal do representante: aba nova "Maletas", com o componente `src/components/representante/MaletasRepresentante.tsx` (novo). A barra do celular passa a ter 5 abas.

## 3. Testes

`tests/isolado/maletas-perdidas.test.ts` (novo). Esperado: `bash tests/isolado/subir.sh && bun test tests/isolado` → 401 pass, 0 fail.

## 4. Depois de aplicar, nesta ordem, me devolvendo cada resultado

```sql
-- prévia das perdidas do SmallData
select jsonb_pretty(public.maletas_perdidas_smalldata_processar(false));
```

Aprovado por mim (fiado automático para todo o histórico). Rode em seguida:

```sql
select jsonb_pretty(public.maletas_perdidas_smalldata_processar(true));
select situacao, count(*), sum(valor_cents)/100.0 reais from public.maletas_perdidas group by 1;
```

Depois, a prévia do código do SmallData (só a prévia):

```sql
select jsonb_pretty(public.party_codigos_smalldata_adotar(false));
```

Acrescente ao AGENTS.md: "Lost maletas (0130): one row per lost maleta in maletas_perdidas (SmallData tipo perdida/status 11, or Lardan via kit_maleta_perdida); no NF; fiado = retail of pieces not returned, title sistema_origem maleta_perdida on FIADO-PERDA (outside DRE) + cob_fiado_linhas lote maleta_perdida, idempotent; skip-acerto via kit_pular_acerto / legado_maleta_pular_acerto (next acerto of the same praça); remessa maletas may go to the representante without consultora (remessa_abrir_maleta_representante) and he assigns a consultora or own candidata via rep_maleta_repassar."
