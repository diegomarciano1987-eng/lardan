# Para o Lovable — 0158: acerto pelo app (pré-baixa)

Aplique **depois da 0157**, exatamente como está. Não renomeie funções e não mude mensagens. Não publique a interface sem a minha aprovação. A regra "kit novo só com pré-baixa" fica **desligada**: eu ligo quando o app estiver no ar.

## 1. Migração `0158_pre_baixa_acerto_app.sql`

Fica em drizzle/migrations. Pode renumerar o arquivo; o conteúdo é o mesmo. A migração não apaga nada, não remove coluna e pode rodar duas vezes.

- Tabelas `kit_pre_baixas` e `kit_pre_baixa_itens` (uma pré-baixa por maleta) e `kit_pre_baixa_liberacoes`.
- **Consultora:**
  - `pre_baixa_abrir`, `pre_baixa_ler` e `pre_baixa_vender`: ela marca quantas vendeu de cada peça;
  - as vendas pagas ou concluídas pelo app já vêm marcadas e não dá para marcar menos.
- **Fechar a pré-baixa** (`pre_baixa_fechar`):
  - total vendido pelo preço gravado na remessa;
  - comissão pela faixa calculada sobre a remessa inteira da consultora;
  - valor a pagar = vendido − comissão;
  - nasce o título a receber da consultora (`sistema_origem = 'pre_baixa'`), pelo ator da cobrança Lardan.
- **Pix com o valor exato:** server function `preBaixaFecharPix` (`src/lib/pre-baixa.functions.ts`) e `pre_baixa_asaas_preparar`, que é só do servidor. Pix pago → "aguardando conferência".
- **Conferência** (`pre_baixa_conferir`, primeiro a prévia, depois a aplicação). É feita pela equipe de maletas lendo o código de cada peça que voltou.
  - Esperado devolvido = enviado − vendido declarado.
  - Peça faltando é cobrada como vendida, pelo preço da remessa. Peça declarada vendida que voltou é estornada.
  - As peças voltam ao estoque pelo retorno oficial (`kit_retorno` + `kit_retorno_confirmar`). O que não voltou fica como vendido e a maleta é encerrada.
  - Bateu: acerto encerrado. Não bateu: "pendência", com título da diferença (ou crédito a devolver anotado). Resolve-se em `pre_baixa_pendencia_resolver`, com motivo.
- **Etiqueta nova:** a peça que voltou com preço antigo aparece para imprimir a etiqueta nova (`pre_baixa_etiqueta_atualizada`).
- **Kit novo só com pré-baixa fechada:** gatilho em `kit_cycles`, que só vale com `pedido_config.exigir_pre_baixa` ligado.
  - Quem liga é o Master, em `pre_baixa_exigir_definir`.
  - O Master pode liberar uma vez, com motivo, em `pre_baixa_liberar_kit`.
- **Painel e indicadores:** `pre_baixa_painel` e `pre_baixa_indicadores`, com % de acertos sem divergência, tempo médio entre pré-baixa e encerramento e % de pré-baixas no prazo.

## 2. Interface

- **App da consultora → Minha maleta:** `src/components/consultora/AcertoApp.tsx` (novo).
  - mostra "vendeu X de Y peças" e os dias que faltam;
  - as peças vêm com − / +;
  - vendido, comissão, valor a pagar e quanto falta para a próxima faixa;
  - "Fechar a pré-baixa" com confirmação, depois Pix (QR + copia e cola) e a situação.
- **Admin → página da maleta:** `ConferenciaPreBaixa.tsx` (novo), com a leitura do código, o resultado, encerrar ou registrar pendência, e as etiquetas novas.
- **Admin → Maletas:** painel `AcertosPainel.tsx` (novo), com filtros por situação e os indicadores.
- **Admin → página da remessa:** quando a consultora não fechou a pré-baixa anterior, o Master vê "Liberar e abrir", com motivo.
- **Configurações:** chave "Kit novo só com pré-baixa fechada", só para o Master.
- Arquivos: `src/lib/pre-baixa.ts` e `src/lib/pre-baixa.functions.ts` (novos).

## 3. Testes

- `tests/isolado/pre-baixa.test.ts` é novo e tem 6 testes:
  - venda do app pré-marcada;
  - cálculo: 3 × 100 + 50 = 350,00 → faixa de 25% → paga 262,50;
  - bloqueio do kit novo e liberação do Master;
  - título exato;
  - Pix pago → aguardando conferência;
  - peça faltando gera pendência de 37,50, estoque devolvido, vendidas gravadas e maleta encerrada;
  - "bateu" encerra;
  - indicadores.
- Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **466 pass, 0 fail**.

## 4. Depois de aplicar, me devolva

```sql
select exigir_pre_baixa from public.pedido_config;   -- deve ser false
select jsonb_pretty(public.pre_baixa_indicadores());
```

Acrescente ao AGENTS.md a linha "Settlement in the app / pre-baixa (0158)" que está no AGENTS.md deste pacote.
