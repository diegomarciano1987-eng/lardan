# Para o Lovable — 0215 + 0216: notas do acerto e EMISSÃO REAL (produção) da NF-e pela maleta

Aplique **as duas migrações, na ordem**: `0215_nfe_acerto_maleta.sql` e depois `0216_nfe_producao.sql`. Copie o código exatamente como está. **Nada liga sozinho:** depois de aplicar, tudo continua em homologação até o Master ligar a emissão real em Integrações.

## 1. Migrações

- **0215:** notas do acerto (devolução 1918/2918, venda 5114/6114, perda 5927/6949) ligadas à remessa autorizada da maleta. Detalhes em `PROMPT-LOVABLE-0215.md`.
- **0216:**
  - `fiscal_settings`: maleta piloto, liberar todas, automático, série de produção (`'3'`) e e-mail de cópia (`fiscal2@on4.com.br`).
  - `fiscal_focus_ambiente(cycle)`: produção só com a emissão real ligada pelo Master e para a maleta piloto (ou todas). Se a produção estiver ligada e a maleta não estiver liberada, a nota é **recusada**; nunca cai em teste sem avisar.
  - Rotinas da remessa e do acerto aceitam produção por essa regra e podem ser chamadas pelo servidor (fila automática).
  - O código da peça na nota passa a ser a **referência da etiqueta** (`peca_referencia_etiqueta`), depois o código de barras e depois o SKU. A descrição deixa de repetir nome e variante.
  - Endereço sem código IBGE: o sistema completa pelo município (`ibge_municipios`) e a cidade pelo CEP (`cep_cidades`).
  - **Trava de série:** se uma nota de produção for autorizada fora da série 3, a emissão real **desliga sozinha**, junto com o automático, e grava `fiscal.serie_divergente`.
  - Cópia ao escritório: `email_enviado_em` / `email_tentativas`, mais as rotinas `fiscal_focus_email_pendentes` e `fiscal_focus_email_marcar` (só servidor).
  - Fila automática `fiscal_fila`: uma trigger em `kit_cycles` põe a **remessa** na fila quando a maleta é conferida e o **acerto** quando é encerrada (só com remessa de produção). Só funciona com a produção e o automático ligados.
  - `fiscal_producao_estado()` e `fiscal_producao_definir(...)` para o painel. Só o Master liga, com a confirmação digitada `LIGAR PRODUCAO`.

## 2. Código

- `src/lib/focus/emissao.server.ts` (novo): núcleo da emissão da maleta. É usado pelo botão (sessão do Master) e pela fila (executor interno).
- `src/lib/focus/focus.functions.ts`: o botão usa o núcleo. Funções novas: `focusProducaoEstado`, `focusProducaoDefinir` (confere o `FOCUS_TOKEN_PRODUCAO`) e `focusEnviarEscritorio`. "Registrar aviso na Focus" também cadastra o aviso no ambiente de produção.
- `src/lib/focus/api.server.ts`: `enviarEmailNfe` (POST `/v2/nfe/{ref}/email`).
- `src/routes/api/public/fiscal/processar.ts` (novo): rota do cron.
- `src/components/admin/fiscal/ProducaoFiscal.tsx` (novo): painel "Emissão real da NF-e (produção)" em Integrações.
- `src/components/admin/fiscal/FocusHomologacao.tsx`: botão **"Enviar ao escritório"** em cada nota autorizada ou cancelada, e etiqueta "NOTA REAL".
- `src/components/admin/maletas/NotaFiscalMaleta.tsx`, `DocumentosMaleta.tsx` e `maletas_.remessa.$id.tsx`: com a produção ligada, os botões deixam de dizer "teste".
- `src/routes/_authenticated/admin/integracoes.tsx`: mostra o painel novo.
- `src/lib/focus/AGENTS.md`: regras registradas.
- `src/routeTree.gen.ts`: deixe o build gerar a rota nova `/api/public/fiscal/processar`.

## 3. Agendamento (obrigatório)

Agende **POST `/api/public/fiscal/processar` a cada minuto**, autenticado com o `LOVABLE_CRON_SECRET`, do mesmo jeito que já existe para `/api/public/central-leads/enviar`. Sem esse agendamento, a fila automática e a cópia ao escritório não andam. O botão da maleta funciona sem ele.

## 4. Testes

- Novos: `tests/isolado/nfe-acerto-maleta.test.ts` e `tests/isolado/nfe-producao.test.ts`. A asserção "só homologação" dos testes 0214/0215 virou "diferente do configurado", porque agora a produção existe, mas só quando o Master liga.
- Em banco novo (`bash tests/isolado/subir.sh && bun test tests/isolado`): **614 pass**. A única falha é o carregamento de `aceite-pedido-personalizado.test.ts` por falta de `@supabase/supabase-js` na máquina onde rodei, sem relação com este pacote. Rode `bun run build` aí.

## 5. Depois de aplicar, me devolva

```sql
select emission_active, environment, provider, serie_producao, email_copia_xml, producao_todas, producao_automatico from public.fiscal_settings;
-- esperado: false, homologacao, focus, 3, fiscal2@on4.com.br, false, false
select count(*) from public.fiscal_fila;   -- 0
```

E o print do painel **"Emissão real da NF-e (produção)"** em Integrações, aberto como Master, mostrando "Desligada — tudo em teste" e **sem** o aviso de token faltando.
