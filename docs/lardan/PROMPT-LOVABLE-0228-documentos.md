# Prompt para o Lovable — 0228 documentos assinados no cadastro

Cole no Lovable junto com os arquivos do pacote:

> Aplique a migration `drizzle/migrations/0228_documentos_assinados_cockpit.sql` exatamente como está, sem renumerar o conteúdo (se o número 0228 já existir, use o próximo livre e mantenha o SQL igual). Substitua os arquivos do pacote pelos enviados: `src/lib/zapsign/documentos.server.ts` (novo), `src/lib/zapsign/zapsign.functions.ts`, `src/lib/zapsign/api.server.ts`, `src/lib/zapsign/AGENTS.md`, `src/routes/api/public/zapsign/webhook.ts`, `src/components/admin/cadastros/DocumentosAssinados.tsx` (novo), `src/routes/_authenticated/admin/cadastros/pessoas_.$id.tsx`, `src/components/admin/assinatura/AssinaturaConfig.tsx` e `tests/isolado/documentos-assinados.test.ts` (novo). Não mude regras, nomes de função nem permissões. Não crie nem altere secrets: continuam os mesmos (ZAPSIGN_API_TOKEN, ZAPSIGN_AMBIENTE, ZAPSIGN_WEBHOOK_SECRET). Depois publique.

## O que muda
- Cadastro da pessoa ganha a aba **Documentos assinados**: contrato, promissória, termo da maleta e qualquer documento criado direto no painel da ZapSign, com botão "Abrir assinado".
- Cópia do PDF assinado guardada no Lardan (bucket privado `assinaturas`), porque o link da ZapSign expira em 60 minutos.
- Integrações › ZapSign ganha **Importar documentos da ZapSign**: puxa o histórico do painel e liga cada documento ao cadastro de quem assinou (CPF, depois telefone único, depois e-mail único). Os que não baterem aparecem numa lista para conferir.
- Webhook: documento novo criado no painel passa a entrar sozinho no cadastro.

## Quem vê
Master e quem tem cadastros ou financeiro, e o representante da consultora. A própria consultora não vê pela tela do admin.

## Testes
Banco isolado: 622 testes passando (3 novos). As 2 falhas restantes são só dependências que não existem no ambiente de teste local (supabase-js e lucide-react) e já falhavam antes.
