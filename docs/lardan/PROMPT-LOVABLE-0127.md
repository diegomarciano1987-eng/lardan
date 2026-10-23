# Para o Lovable — 0127: situação das maletas do SmallData e "na rua" contado por consultora

Aplique exatamente como está. Não renomeie funções e não mude mensagens. Não publique a interface sem a minha aprovação. A 0127 é independente da 0126.

## Por que

Hoje o aviso de Remessas conta como "na rua" toda maleta do SmallData sem acerto: 944 maletas. Isso inclui maleta devolvida aguardando acerto, maleta ainda em montagem e maleta perdida. Além disso, o número principal é de maletas, mas há consultora com 4 ou 5 maletas.

O SmallData guarda a situação de cada consultora em cada remessa (T_REM_CLI_STATUS): 1 remessa aberta cliente, 2 remessa alterada, 3 remessa novo kit, 4 saída conferida, 5 a 9 retorno e acerto, 11 remessa perdida.

Com a situação, a extração de 22/10 dá **731 consultoras com maleta na rua (870 maletas)**. Há ainda 54 consultoras com maleta devolvida aguardando acerto.

## 1. Migração 0127_situacao_maletas_smalldata.sql

Arquivo: drizzle/migrations (pode renumerar; o conteúdo é o mesmo).

- Não apaga nada e não remove coluna. Pode rodar duas vezes.
- `legado_maleta_status`: a situação atual de cada consultora na remessa. Vem do arquivo novo `maletas_status.csv`, importado pela mesma tela do histórico.
- `legado_maleta_situacoes`: nome de cada código e se ele conta como "na rua". Hoje só o 4 conta.
  - O Master corrige nome e regra por `legado_maleta_situacao_definir(codigo, nome, na_rua)`, sem código novo.
  - A tela lista as situações por `legado_maleta_situacoes_lista()`.
- "Na rua" = sem fechamento E situação marcada como na rua. Sem o arquivo importado, continua como antes.
- `maletas_visibilidade` passa a devolver primeiro consultoras, depois maletas. Traz também `consultoras_varias_maletas`, `consultoras_atrasadas`, a quebra `por_situacao` e consultoras por remessa. As chaves antigas continuam.
- `consultora_maletas` mostra a situação de cada maleta do SmallData.
- `legado_importar` ganha o tipo `maletas_status`.

## 2. Interface

- `src/components/admin/maletas/MaletasNaRua.tsx`:
  - o aviso passa a dizer "N consultoras estão com maleta na rua só pelo SmallData (M maletas, X delas com mais de uma…)";
  - entra a tabela "por situação";
  - a tabela por remessa ganha a coluna Consultoras antes de Maletas.
- `src/components/admin/maletas/MaletasDaConsultora.tsx`: coluna "Situação".
- `src/lib/maletas-visibilidade.ts`: tipos novos.
- `src/lib/historico-jflex-csv.ts`: 12º arquivo, `maletas_status.csv` (remessa, codcli, status, data).

## 3. Testes

`tests/isolado/maletas-situacao.test.ts` (novo).
Esperado: `bash tests/isolado/subir.sh && bun test tests/isolado` → 386 pass, 0 fail, com a 0126 junto.

## 4. Depois de aplicar

O Diego importa `maletas_status.csv` em Configurações → Histórico SmallData, só esse arquivo. Depois disso, rode a consulta abaixo e me devolva o resultado:

```sql
select s.status, n.nome, n.na_rua, count(distinct m.codcli) consultoras, count(*) maletas
  from public.legado_maletas m
  left join public.legado_maleta_status s using (remessa, codcli)
  left join public.legado_maleta_situacoes n on n.codigo = s.status
  left join public.legado_consultoras lc on lc.codcli = m.codcli
 where m.tipo = 'remessa' and m.fechamento is null and not coalesce(lc.interna, false)
 group by 1, 2, 3 order by 3 desc, 1;
```

Esperado: a linha 4 "Saída conferida (na rua)" com cerca de 731 consultoras e 870 maletas.

Acrescente ao AGENTS.md: "SmallData maleta situation (0127): legado_maleta_status per remessa+codcli from maletas_status.csv; 'na rua' = no fechamento AND legado_maleta_situacoes.na_rua (Master edits names/rule via legado_maleta_situacao_definir); counts show consultoras first, maletas second."
