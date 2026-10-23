# Para o Lovable — 0124 (CPF único pela tela) + varredura de ponta a ponta

Aplique exatamente como está. Não renomeie funções, não mude o texto das mensagens.

## 1. Migração `0124_cpf_unico_na_tela.sql`

Arquivo: `drizzle/migrations/0124_cpf_unico_na_tela.sql` (pode renumerar se precisar, o conteúdo é o mesmo).

O que faz:
- Cria `parties_doc_em_uso(text, uuid)` e a trava `parties_doc_unico()` com o gatilho `zy_parties_doc_unico` em `parties`.
- Quando alguém grava **direto pela tela** (papel `authenticated`) um cadastro ativo com CPF/CNPJ que já existe em outro cadastro ativo, o banco recusa com: *"Este documento já está cadastrado (código). Abra a ficha existente."*
- As rotinas do banco (importações, PDV, Asaas, histórico SmallData, cobrança da consultora) **não** passam pela trava.
- Não apaga nada e não altera coluna. Cadastros repetidos que já existem continuam como estão.
- Pode rodar duas vezes sem erro.

Na tela, nada muda: o erro já aparece no aviso (toast) de "Novo cadastro" e da ficha.

## 2. Testes (bancada isolada)

- `tests/isolado/ponta-a-ponta.test.ts` (novo) percorre cadastro → praça → remessa → maleta → montagem → expedição → aceite → vitrine → cliente → pedido → cobrança Lardan → cockpit de cobrança → portal do representante → dados fiscais Focus.
- `tests/isolado/00-prelude.sql` muda só na bancada: `auth.uid()` passa a respeitar a troca de usuário feita dentro da rotina (`pdv_como`), igual à nuvem. Isso não vai para o banco.

Resultado esperado: `bash tests/isolado/subir.sh && bun test tests/isolado` com **350 pass, 0 fail**.

## 3. Prova depois de aplicar

Rode no SQL e me devolva o resultado:

```sql
select tgname from pg_trigger where tgrelid = 'public.parties'::regclass and tgname = 'zy_parties_doc_unico';
select has_function_privilege('anon', 'public.parties_doc_em_uso(text,uuid)', 'EXECUTE') as anon_executa;  -- deve ser false
-- quantos CPFs/CNPJs já estão repetidos hoje (só contagem, sem nomes)
select count(*) as documentos_repetidos
  from (select doc_digits from public.parties where is_active and doc_digits is not null
        group by doc_digits having count(*) > 1) x;
```

Não publique a interface sem a minha aprovação.
