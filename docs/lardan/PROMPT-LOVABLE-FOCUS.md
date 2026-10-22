FOCUS NFE (HOMOLOGAÇÃO) + NOME "SMALLDATA" — APLICAR O PACOTE

Anexei "lardan-focus-nfe.patch" (um commit sobre o pacote do BI que você já recebeu) e o projeto completo "lardan-focus-nfe.zip".
Suíte isolada: 326 de 326, em banco recriado do zero.

REGRAS
- Aplique a migração 0118 como está. Não refatore nem renomeie. Se algo não encaixar, me mostre o conflito antes de decidir.
- Gere o journal e o snapshot da 0118 com a ferramenta oficial. Regenere os tipos do Supabase e a árvore de rotas (rota nova /api/public/focus/webhook).
- O código novo já vem pronto. NÃO reescreva. Se o typecheck acusar erro, corrija só a tipagem, sem mudar comportamento nem textos, e me mostre o que mudou.
- Nesta versão só existe emissão em HOMOLOGAÇÃO (notas de teste, sem valor fiscal). Não crie caminho para produção.
- Token, segredo e senha NUNCA no código, no log ou na conversa: só no cofre de segredos.
- Não publique sem minha aprovação.

O QUE O PATCH TRAZ
1. drizzle/migrations/0118_focus_nfe.sql
   - Troca "JFLEX" por "SmallData" em toda mensagem que aparece para o usuário: erro de numeração de remessa, importação, notas de cadastro e roteiro fiscal.
   - fiscal_focus_envios e fiscal_focus_eventos: sem acesso direto, só o servidor grava.
   - fiscal_focus_pode(acao): ver = master, diretoria ou financeiro; emitir e cancelar = Master.
   - fiscal_focus_emitente(): emissor de fiscal_settings.
   - fiscal_focus_dados(party, itens): dados da consultora e das peças, com lista de pendências do cadastro.
   - fiscal_focus_envio_registrar e fiscal_focus_retorno: só servidor. O retorno é idempotente e nunca volta uma nota autorizada ou cancelada para "processando".
   - fiscal_focus_envio e fiscal_focus_envios_lista: a lista não traz CPF nem endereço.
2. src/lib/focus/nfe.ts: monta a NF-e pelo roteiro que o SmallData usava.
   - remessa 5917/6917; devolução como entrada 1918/2918, finalidade 4, referenciando a remessa; venda 5114/6114; perda 5927/6949.
   - CSOSN 102, PIS/COFINS 07, NCM 71171900, unidade UND, valor = 1/3 do varejo.
3. src/lib/focus/api.server.ts (cliente da Focus) e src/lib/focus/focus.functions.ts (ações da tela).
4. src/routes/api/public/focus/webhook.ts: aviso da Focus, autenticado pelo cabeçalho X-Lardan-Focus.
5. src/components/admin/fiscal/FocusHomologacao.tsx: cartão em Integrações.
   - Mostra a configuração e permite registrar o aviso.
   - Emite remessa de teste (consultora e peças reais) e, a partir dela, devolução, venda e perda de teste.
   - Cancela, consulta e abre DANFE e XML.
6. tests/isolado/focus-nfe.test.ts (10 testes) e o teste de numeração atualizado para "SmallData".
7. docs/lardan/FOCUS-PASSO-A-PASSO.md e docs/lardan/NOTA-FISCAL-O-QUE-FALTA.md atualizado.

SEGREDOS (eu vou colar os valores no campo seguro; não peça por texto)
- FOCUS_TOKEN_HOMOLOGACAO
- FOCUS_EGRESS_ENABLED = true
- FOCUS_CNPJ_EMITENTE = 43319208000180
- FOCUS_UF_EMITENTE = PR
- FOCUS_WEBHOOK_SECRET: gere uma senha aleatória de 48 caracteres
- FOCUS_WEBHOOK_URL = https://<domínio publicado>/api/public/focus/webhook

DEPOIS DE APLICAR
1. Rode build e typecheck e me mostre o resultado.
2. Rode bash tests/isolado/subir.sh && bun test tests/isolado. Esperado: 326 aprovados, 0 falhas.
3. Abra os campos seguros dos segredos acima para eu preencher.
4. Abra Integrações com sessão de Master e me mande o print do cartão "Focus NFe — notas de teste em homologação".
5. Eu emito a primeira remessa de teste. Se a SEFAZ rejeitar, NÃO mude o roteiro (CFOP, CSOSN, natureza, 1/3): me mostre a mensagem completa.
