# Para o Lovable — 0157: pedido de consignação novo, preço gravado na remessa e preço novo

Aplique exatamente como está. Não renomeie funções e não mude mensagens. Não publique a interface sem a minha aprovação. **Não aplique o preço novo**: ele só roda depois que eu aprovar o relatório.

## 1. Migração `0157_pedido_consignacao_preco.sql`

Fica em drizzle/migrations. Pode renumerar o arquivo; o conteúdo é o mesmo. A migração não apaga nada, não remove coluna e pode rodar duas vezes.

- `pedido_config` guarda os dados fixos da folha: endereço, contato de pedidos, Pix, garantia nova, texto da montagem, rodapé e **prazo do correio (7 dias até o Daniel definir)**.
  - Só o Master altera, por `pedido_config_salvar`.
- `remessas.tipo_envio` pode ser `pessoal` ou `correio`.
  - `remessa_tipo_envio_definir` muda o tipo e `remessa_envio_ler` lê.
  - "Postar a maleta até" = data do acerto − prazo do correio. Só aparece no correio.
- `kit_pedido_dados(ciclo)` traz tudo que a folha imprime:
  - peças agrupadas por tipo (`pedido_grupo_peca`), com o **preço gravado** na maleta;
  - kit nº e código do cliente (5 dígitos);
  - quem montou (quem mais bipou a maleta);
  - telefone do representante;
  - faixas de comissão.
- **Preço gravado na maleta:** `kit_preco(ciclo, variante)`. Passam a usar o preço gravado na remessa, e não mais o preço do catálogo do dia:
  - app da consultora (`consultant_pieces`, `consultora_pecas_buscar`);
  - pedido da cliente (`consultant_order_create`);
  - vitrine (`showcase_items_for`, `showcase_order_create`);
  - maleta perdida (`kit_maleta_perdida`).
- **Preço novo**, sempre arredondando para cima: até R$ 99,99 termina em ,90; de R$ 100 em diante termina em 4,90 ou 9,90.
  - `preco_regra_lardan` faz o cálculo.
  - `preco_reajuste_previa()` e `preco_reajuste_resumo()` geram o relatório antigo × novo, só para leitura.
  - `preco_reajuste_aplicar('APLICAR NOVO PRECO')` aplica. Só o Master, depois da minha aprovação. Kit que já está na rua continua no preço gravado; kit ainda em montagem passa para o preço novo.
  - `preco_reajuste_desfazer(lote)` desfaz.
- Faixas de comissão: se a tabela estiver vazia, entram as da folha (20% até R$ 199,99 · 25% · 30% · 35% · 40% a partir de R$ 1.200). Se já tiver faixas, nada muda.

## 2. Interface

- `src/lib/pedido-consignacao.ts` é novo. Monta a folha A4 do modelo:
  - página 1 completa; páginas seguintes com cabeçalho de 1 linha; última página com TOTAL, garantia, montagem e Pix;
  - "Página X de Y", data/hora e usuário no rodapé;
  - fontes Cormorant Garamond e Jost;
  - sem assinatura e sem vendeu/devolveu.
- `DocumentosMaleta.tsx`: os botões "Pedido de consignação" e "Romaneio" imprimem a folha nova pelo banco. O texto antigo da remessa sai.
- Nova remessa (`maletas.tsx`): campo "Como a maleta vai" (pessoalmente ou correio).
- Página da remessa: controle de envio (`EnvioRemessa.tsx`, novo), que mostra a data de postagem quando é correio.
- Configurações (`components/admin/config/PedidoEPreco.tsx`, novo):
  - "Preço novo": resumo, relatório antigo × novo, botão para baixar o CSV e aplicar/desfazer, só para o Master;
  - "Pedido de consignação — dados da folha".

## 3. Testes

- `tests/isolado/pedido-consignacao.test.ts` é novo e tem 8 testes:
  - regra de preço;
  - ganho de R$ 2.280,60 no kit de R$ 5.701,50 do modelo;
  - paginação: as 55 peças do modelo cabem em 2 páginas, como no PNG;
  - postar até só no correio;
  - preço gravado na maleta da rua × preço novo na maleta em montagem;
  - desfazer;
  - permissões.
- Ajustei também `tests/isolado/montagem-metas.test.ts` para a regra da sua 0155 (média das vendidas × 1,3). Ele já falhava antes deste pacote.
- Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **460 pass, 0 fail**.

## 4. Depois de aplicar, me devolva

```sql
select jsonb_pretty(public.preco_reajuste_resumo());
select * from public.consultora_comissao_faixas order by min_vendido_cents;
```

E diga ao Diego que o relatório completo, peça a peça, está em **Configurações → Preço novo → Baixar planilha (CSV)**. Ele manda o CSV para o Daniel aprovar.

Acrescente ao AGENTS.md a linha "Consignment order sheet + price (0157)" que está no AGENTS.md deste pacote.
