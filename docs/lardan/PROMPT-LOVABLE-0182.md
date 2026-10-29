# Para o Lovable — 0182: etiqueta "Você pode ganhar" e painel de incentivo (pacote 2 de 2)

Aplique **depois da 0181**, exatamente como está. Não renomeie funções e não publique sem a minha aprovação.

Pedido do Diego (29/10): nada de card no meio do início. No topo, uma etiqueta premium com a comissão que ela pode
ganhar; tocando nela, abre o painel em tela cheia com tudo da maleta.

## 1. Migração `0182_painel_incentivo.sql`
`consultora_incentivo()` — só leitura, só a própria consultora (mesma checagem de `consultora_ganhos`). Devolve os ganhos
da maleta atual + `comissao_maleta_cents` (faixas de hoje sobre o valor da maleta inteira), `proxima_ganho_extra_cents`,
o `objetivo` gravado na maleta (0181), `objetivo_falta_cents` e `objetivo_batido`. Depois de aplicar, regenere `types.ts`.

## 2. Telas (app da consultora, celular e computador)
- **Sai do início:** a faixa "META DE VENDAS R$ 650,00" (`AvisoProximaMaleta.tsx` foi apagado) e o card
  "Vendas da maleta" (`<GanhosConsultora compacto />`). O botão Nova venda volta a ficar logo abaixo da Liga.
- **Entra no topo** (`EtiquetaIncentivo.tsx`, `BarraIncentivo`): barra fina, fixa ao rolar, só com maleta aceita.
  À esquerda "Objetivo R$ 920,00" (ou "Meta mínima R$ 650,00") com uma linha de progresso; à direita a **etiqueta
  verde** "Você pode ganhar R$ X" (comissão vendendo a maleta inteira), com um brilho suave que respeita
  "reduzir movimento".
- **Painel** (`PainelIncentivo`): abre da direita para a esquerda ocupando a tela inteira. Topo escuro com quanto ela
  ganha vendendo tudo; barra grande com os marcos (vendido, próxima faixa, objetivo, maleta inteira); "Já é seu",
  "Próximo degrau" (quanto ganha a mais), objetivo (ou "Objetivo batido!" com comemoração curta, uma vez por maleta),
  "Maleta inteira", últimos 3 meses, botões Histórico de vendas e Tabela de comissão, e **Nova venda** fixo no rodapé.
- `src/lib/incentivo.ts` (dados) e o CSS `.etiqueta-ganho` / `.incentivo-*` no fim de `styles.css`.
- Não mexi em `GanhosConsultora.tsx` (a tabela de comissão continua lá e é usada no painel).

## 3. Testes
`tests/isolado/painel-incentivo.test.ts` (3): comissão da maleta inteira (40% de R$ 1.500), objetivo gravado,
falta e próximo degrau, sem maleta, privacidade. Conferido na tela: barra fixa ao rolar, painel em tela cheia, Nova venda
navega e fecha, celular e computador, claro e escuro. Esperado: **558 pass, 0 fail**.

## 4. Depois de aplicar, me devolva
Print do início de uma consultora com maleta aceita (com a etiqueta) e do painel aberto.
