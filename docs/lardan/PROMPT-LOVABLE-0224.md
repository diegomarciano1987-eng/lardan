# Para o Lovable — 0224: DANFE enxuto, maleta de abertura, app do representante e assinatura digital (ZapSign)

Aplique **depois da 0223**, exatamente como está. A migração pode rodar duas vezes e não apaga nada. **Não mexe na emissão real:** ela continua do jeito que está (desligada até o Master ligar).

## 1. Migração `drizzle/migrations/0224_abertura_danfe_zapsign.sql`

1. **Abertura:** ajusta `kit_pedido_dados` e `kit_consultora_doc` **a partir da versão em vigor no banco** (por `pg_get_functiondef` + `replace`, com trava se o trecho não for encontrado). Maleta com o representante e sem consultora passa a imprimir com `abertura = true` e os dados da consultora em branco. Maleta sem consultora e sem representante continua recusada.
2. **Fila da nota:** a trigger `zz_fiscal_fila_kit` passa a observar `status` **e** `consultora_party_id`. Quando o representante vincula a consultora numa maleta de abertura, a remessa entra na fila (só com a produção e o automático ligados).
3. **DANFE:** `fiscal_focus_pode_danfe(ref)` e `fiscal_focus_notas_maletas` liberados também para quem gerencia maletas (montagem), sem CPF nem endereço.
4. **ZapSign:**
   - tabelas `assinatura_modelos` (contrato e promissória em markdown com `{{campos}}`; o contrato vem como **RASCUNHO para revisão jurídica**) e `assinaturas_digitais`, com um pendente por documento;
   - rotinas `assinatura_pode`, `assinatura_dados`, `assinaturas_da_consultora`, `assinatura_modelos_ler` e `assinatura_modelo_salvar` (só Master);
   - rotinas só do servidor: `assinatura_pendente`, `assinatura_registrar`, `assinatura_retorno` e `assinatura_ler`.

## 2. Código

- `src/lib/danfe-compacto.ts` (novo): DANFE em **uma linha por peça**, gerado do XML autorizado, com código de barras CODE-128C da chave. A maleta de 65 peças sai em **2 páginas** (no layout da Focus eram 5).
- `src/components/admin/fiscal/imprimirDanfe.ts` (novo) e `focusDanfeXml` em `src/lib/focus/focus.functions.ts`: os botões "DANFE" da maleta e da tela de notas imprimem o DANFE enxuto. O PDF da Focus continua disponível no botão "PDF Focus" em Integrações.
- Abertura: `src/lib/pedido-consignacao.ts` e `src/components/admin/maletas/DocumentosMaleta.tsx` imprimem em branco os campos da consultora. Na tela da remessa (`maletas_.remessa.$id.tsx`), o botão Promissória passa a funcionar sem consultora. A nota explica: "Maleta de abertura: a nota sai quando o representante vincular a consultora".
- App do representante (`src/routes/_authenticated/representante.tsx`):
  - aba nova **Abertura** (`AberturaConsultora.tsx`): receber a maleta, vincular à consultora ou candidata da carteira e, na sequência, mandar o contrato e a promissória para assinar;
  - **no celular o menu mostra só Captação, Agenda, Convite e Abertura**, e abre na Captação. No computador continua tudo.
- Ficha da consultora no app do representante: seção **Assinatura digital** (`AssinaturaDigital.tsx`) com contrato, promissória de cada maleta, situação, link para copiar, reenvio e download do documento assinado.
- ZapSign: `src/lib/zapsign/api.server.ts`, `modelo.ts`, `zapsign.functions.ts` e a rota `src/routes/api/public/zapsign/webhook.ts`. O aviso **não é confiado**: o servidor confere o documento na API da ZapSign antes de gravar.
- Integrações: painel **"Assinatura digital (ZapSign)"** (`src/components/admin/assinatura/AssinaturaConfig.tsx`), com a situação, o endereço do aviso e a edição dos textos (só Master).
- `AGENTS.md` de maletas, focus e o novo `src/lib/zapsign/AGENTS.md`.

## 3. Segredos (Lovable › Secrets)

- `ZAPSIGN_API_TOKEN`: token da conta (ZapSign › Configurações › Integração › ZAPSIGN API). **Gere um token novo**, porque o antigo foi colado no chat.
- `ZAPSIGN_AMBIENTE`: `producao` (ou `sandbox` para testar sem valor legal).
- `ZAPSIGN_WEBHOOK_SECRET`: texto longo e aleatório. Depois cadastre na ZapSign o aviso: `https://www.lardan.com.br/api/public/zapsign/webhook?chave=<o mesmo segredo>`.

## 4. Testes

- Novo `tests/isolado/abertura-danfe-zapsign.test.ts` (9 cenários). O teste da 0214 foi ajustado: agora a montagem vê a nota da maleta, e a consultora continua sem ver.
- Em banco novo (`bash tests/isolado/subir.sh && bun test tests/isolado`): **619 pass**. As 2 falhas são arquivos de teste que não carregam por falta de `@supabase/supabase-js` e `lucide-react` na máquina onde rodei, sem relação com este pacote. Rode `bun run build` aí.

## 5. Depois de aplicar, me devolva

```sql
select tipo, revisado from public.assinatura_modelos;          -- contrato false, promissoria false
select count(*) from public.assinaturas_digitais;              -- 0
select position('abertura' in pg_get_functiondef('public.kit_pedido_dados(uuid)'::regprocedure)) > 0;   -- true
```

E prints de: (a) uma maleta "com o representante · sem consultora" imprimindo o Pedido; (b) o app do representante no celular com as 4 abas; (c) o painel ZapSign em Integrações.
