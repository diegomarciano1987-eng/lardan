# Para o Lovable — 0180: Histórico de vendas e Objetivo de venda (pacote 1 de 2)

Aplique **depois da 0179**, exatamente como está. Não renomeie funções e não publique sem a minha aprovação.

## Regras (aprovadas pelo Diego em 29/10/2026)
- Vendido do mês = acertos fechados no mês. Sistema anterior: `legado_acertos_consultora` (o mesmo valor e data do BI).
  Lardan: `kit_pre_baixas` fechada/encerrada/pendência. Kits da mesma remessa somam juntos; a mesma remessa nos dois
  sistemas conta uma vez (vale a Lardan). Maleta perdida não é venda.
- Comissão = a que ela recebeu (anterior: venda bruta − líquida dos acertos tipo 1 e 2; Lardan: comissão da pré-baixa).
  Sem cobrança registrada → calculada pelas faixas de hoje e marcada "estimada".
- **Objetivo de venda** = média dos meses com acerto dentro dos 3 meses fechados (acerto com venda zero conta R$ 0)
  × 1,15, **arredondado para cima na dezena de reais**, nunca abaixo da **meta mínima** (`pedido_config.proxima_maleta_minimo_cents`).
  Sem acerto nos 3 meses (nova ou parada) → só a meta mínima. Comissão ao cumprir = faixas de hoje.
- **Fixo por maleta**: gravado em `kit_cycles` quando a maleta é conferida (ou ao sair, se pulou a conferência).

## 1. Migração `drizzle/migrations/0180_historico_vendas_objetivo.sql`
- Funções internas (só service_role): `comissao_pelas_faixas`, `consultora_acertos_vendas`, `consultora_objetivo_calc`,
  `kit_cycle_objetivo`, `historico_vendas_de`.
- Leitura: `consultora_historico_vendas()` (só a própria consultora, pelo login) e
  `consultora_historico_vendas_equipe(_party)` (mesma permissão do cockpit financeiro).
- 3 colunas novas em `kit_cycles`: `objetivo_cents`, `objetivo_memoria`, `objetivo_em` + gatilho na mudança de status.
  Na instalação calcula o objetivo das maletas que já estão com as consultoras.
- `kit_pedido_dados` passa a trazer `objetivo` (patch textual, idempotente, falha se a função tiver mudado).
- Só acrescenta; todo UPDATE com WHERE. Depois de aplicar, **regenere `types.ts`**.

## 2. Telas
- **App da consultora:** novo menu **Histórico de vendas** (aba `vendas`) no menu lateral, no menu do celular e em "Mais".
  `src/components/consultora/HistoricoVendas.tsx` + `src/lib/historico-vendas.ts`: totais, card do objetivo (o mesmo do
  PDF), gráfico dos últimos 12 meses, meses por ano com as maletas de cada mês. Consultora nova vê a meta mínima.
- **PDF do pedido** (`src/lib/pedido-consignacao.ts`): card de 25 mm logo abaixo de "Este kit pode render pra você":
  nova/parada → "Meta mínima para a próxima maleta" (usa o texto já configurado); com histórico → 3 meses (vendido e
  comissão) + "Objetivo de venda" + comissão ao cumprir. **A faixa antiga do topo saiu** (decisão do Diego).
  Paginação recalculada; conferido sem sobreposição em kits de 10, 60 e 150 peças.
- `PedidoEPreco.tsx`: só os rótulos dos dois campos (texto e valor da meta mínima, que agora também é o piso do objetivo).

## 3. Testes
`tests/isolado/historico-vendas-objetivo.test.ts` (11): 3/2/1/0 meses, piso, arredondamento (897,35 → 900), venda zero,
parada, perdida, comissão real × estimada, remessa nos dois sistemas, objetivo fixo na maleta e igual no pedido,
privacidade, card do PDF. Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **555 pass, 0 fail**.

## 4. Depois de aplicar, me devolva
- `select public.consultora_objetivo_calc('<id de uma consultora antiga>', current_date);` (rodar como service_role/SQL)
- Um pedido impresso de uma consultora nova e de uma antiga.
