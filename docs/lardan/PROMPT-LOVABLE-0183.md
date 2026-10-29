# Para o Lovable — 0183: Objetivo de venda pelos 3 melhores meses

Aplique **depois da 0182**, exatamente como está. Não publique sem a minha aprovação.

Decisão do Diego (29/10, 14h35): o objetivo de venda **não** usa mais os 3 últimos meses.
- Base = os **3 meses de maior venda de todo o histórico** da consultora (sistema anterior + Lardan, meses já fechados).
- Com 1 ou 2 meses de histórico, usa os que tiver. Sem nenhum acerto, só a meta mínima.
- Continua: média × 1,15, arredondada para cima na dezena de reais, nunca abaixo da meta mínima.

## 1. Migração `0183_objetivo_tres_maiores_meses.sql`
- Troca só `consultora_objetivo_calc` (mesma assinatura e mesmo formato de saída; ganha `criterio = 'melhores_meses'`;
  `meses` passa a trazer os meses usados, em ordem de data).
- Recalcula o objetivo gravado das maletas que estão com as consultoras (gravado hoje pela 0181). Idempotente; UPDATE com WHERE.

## 2. Textos
- PDF do pedido (`pedido-consignacao.ts`): "média dos seus 3 melhores meses + 15%".
- Histórico de vendas (`HistoricoVendas.tsx`) e painel (`EtiquetaIncentivo.tsx`): "Seus 3 melhores meses".

## 3. Testes
`tests/isolado/historico-vendas-objetivo.test.ts` reescrito para a regra nova (3 melhores de sempre, menos de 3 meses,
vários acertos no mesmo mês, mês aberto não entra, parada com histórico, piso, arredondamento, comissão estimada).
Esperado: **559 pass, 0 fail**.
