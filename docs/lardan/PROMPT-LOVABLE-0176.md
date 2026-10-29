# Para o Lovable — 0176: revisão do pacote final (Liga, impressão direta)

Aplique exatamente como está. Não renomeie funções e não publique sem a minha aprovação.

## 1. Migração `0176_liga_niveis_delete_com_where.sql`
Mesmo problema que vocês corrigiram na 0174/0175: em produção o Supabase recusa DELETE sem WHERE.
`liga_niveis_salvar` (0160) fazia `DELETE FROM liga_niveis;` e o Master não conseguia salvar os níveis da Liga.
A migração só troca por `DELETE FROM liga_niveis WHERE true;` (patch textual, idempotente, falha se a função tiver mudado).

## 2. `src/lib/qz.functions.ts` — assinatura do QZ Tray
`assinarQz` assinava qualquer texto para qualquer pessoa logada (inclusive consultora e cliente). Com essa assinatura
uma página qualquer mandaria comandos para a Argox de uma estação Lardan sem o aviso do QZ.
Agora só assina para quem tem `can_manage_kits`, `can_manage_catalog` ou papel master/diretoria/estoque
(as telas que imprimem: maletas, remessas, estoque e produtos). Nada muda para essas pessoas.

## 3. Teste novo `tests/isolado/sem-update-sem-where.test.ts`
Lê todas as funções do schema public e falha se alguma tiver UPDATE ou DELETE sem WHERE (a bancada não tem o
safeupdate de produção, então o erro só aparecia lá). Exceção: `homolog_purge_v2` (manutenção pelo editor SQL).

## 3b. `tests/isolado/pedido-pix.test.ts`
O teste do Master usava `expect(...).rejects` com a consulta do Bun, que só executa quando aguardada: a suíte inteira travava nesse arquivo. Agora captura o erro com try/catch.

## 4. Esperado
`bash tests/isolado/subir.sh && bun test tests/isolado` → **515 pass, 0 fail**.

## 5. Depois de aplicar, me devolva
Com o Master, salvar os níveis da Liga em Configurações > Líder e Liga sem erro, e imprimir uma etiqueta pela Argox.
