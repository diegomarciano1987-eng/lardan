# Prompt para o Lovable — 0235 (financeiro batendo) e 0236 (maleta pelos Correios)

Cole no Lovable junto com os arquivos do pacote:

> Aplique as migrations `drizzle/migrations/0235_financeiro_conferencia_asaas.sql` e `drizzle/migrations/0236_correios_maleta_envio.sql` exatamente como estão, nessa ordem (se os números já existirem, use os próximos livres sem mudar o SQL). Substitua/crie os arquivos do pacote: `src/lib/correios/api.server.ts`, `src/lib/correios/correios.functions.ts`, `src/lib/correios/AGENTS.md`, `src/components/admin/maletas/CorreiosMaleta.tsx` (novo), `src/components/admin/correios/CorreiosPainel.tsx` (novo), `src/components/admin/financeiro/ConferenciaSaldoAsaas.tsx` (novo), `src/routes/_authenticated/admin/maletas_.$id.tsx`, `src/routes/_authenticated/admin/integracoes.tsx`, `src/routes/_authenticated/admin/financeiro/asaas.tsx`, `src/routes/_authenticated/admin/financeiro/fluxo-caixa.tsx`, `src/routes/api/public/asaas/sync-matinal.ts`, `tests/isolado/financeiro-conferencia-asaas.test.ts` (novo) e `tests/isolado/correios-maleta.test.ts` (novo). Não mude regras, nomes de função nem permissões. Secrets: nenhum novo; os dos Correios continuam os mesmos (CORREIOS_AMBIENTE = producao). Depois publique.

## 0235 — financeiro
- Fluxo de caixa: o previsto passa a somar as cobranças do Asaas ainda sem título, como a Visão geral.
- Visão geral: "Saldo em contas" passa a contar conta inativa com saldo, como o fluxo.
- Mesa Asaas: busca por código `pay_...` é exata (antes casava CPF por dígitos do código) e recebimento cujo extrato já foi conciliado não aparece mais na mesa.
- Nova "Conferência do saldo Asaas" em Financeiro › Asaas: saldo real (extrato) × Lardan, diferença, e a lista do que explica a diferença (recebido sem lançamento, baixa de cobrança "recebida em dinheiro", lançado duas vezes) e a diferença mês a mês.
- Desfaz o vínculo de 2 cobranças ligadas por engano em 05/11 (títulos já cancelados).

## 0236 — maleta pelos Correios
- Tela da maleta ganha o quadro "Correios": "Enviar pelos Correios" (maleta conferida) gera a pré-postagem PAC com valor declarado = custo das peças e a etiqueta em PDF; "Atualizar rastreio"; "Liberar volta" (maleta encerrada) gera o código da reversa; "Mandar código no WhatsApp" abre o WhatsApp com o texto e começa a contar os 5 dias.
- Débito vencido da consultora bloqueia a ida; só o Master libera, informando o motivo.
- Entregue pelo rastreio → os 30 dias de venda contam da entrega.
- A rotina da manhã atualiza o rastreio de todas as maletas em trânsito.
- Integrações ganha "Maletas nos Correios": voltas atrasadas (para a cobrança), envios e indicadores.

## Testes
Banco isolado: 647 passando, incluindo os 11 novos (4 do financeiro e 7 dos Correios). As 2 falhas não vêm deste pacote: uma é a função `cob_judicial_planilha_importar` (0229) com um endereço "https://" no texto, o que o teste "Fiscal inerte" proíbe; a outra é o teste `cancelar-sete-maletas`, que conta as maletas canceladas no banco inteiro e quebra quando outros testes cancelam maletas.
