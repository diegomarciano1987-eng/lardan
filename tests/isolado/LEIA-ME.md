# Ambiente isolado de validação

Banco Postgres local, criado do zero a cada execução, com dados exclusivamente
sintéticos. Nenhuma linha, segredo ou credencial da base compartilhada é usada
ou copiada. Nada aqui escreve na base compartilhada.

## Como reproduzir

```bash
bash tests/isolado/subir.sh   # sobe o banco e aplica as migrações
bun test tests/isolado        # roda as baterias
```

`subir.sh` cria o banco em `postgresql://postgres@127.0.0.1:55432/lardan_iso`
(dados em `/tmp/lardan-iso`), aplica `00-prelude.sql` e depois todas as
migrações de `supabase/migrations` na ordem.

Rodar `bun test tests/isolado` várias vezes seguidas é seguro: cada execução usa
chaves próprias. As baterias isoladas ficam fora do `vitest` justamente para não
serem confundidas com as que falam com a base compartilhada.

## O que o prelúdio reproduz

- papéis `anon`, `authenticated`, `service_role` e extensões `pgcrypto`/`pg_trgm`;
- esquemas `auth` e `storage` com `auth.users`, `auth.uid()`, `auth.role()`,
  `auth.jwt()`, `auth.email()`, `storage.buckets`/`objects` e suas políticas;
- as permissões padrão de execução de rotinas que a nuvem concede no schema
  público. Permissões de **tabela** não são concedidas por padrão: cada migração
  continua tendo de declarar as suas.

Nesta bancada, `auth.uid()` lê `lardan.test_uid`, que a bancada define por
conexão. É assim que cada chamada roda no papel de um perfil, como o navegador
faz.

## Duas migrações não são aplicadas

`pular.txt` lista as duas migrações que apenas semeiam conteúdo do catálogo
apontando para mídias da base compartilhada. Elas não criam nem alteram
estrutura, e nenhuma bateria depende delas.

## Baterias

- `maletas.test.ts` — integridade das movimentações: cenário 50 + 5 − 20, chave
  de repetição, simultaneidade, retorno declarado diferente do recebido,
  garantia bloqueada, perfis e atomicidade.
- `fiscal-asaas.test.ts` — fiscal e Asaas inertes e reaproveitamento do
  financeiro existente, inclusive importação repetida sem duplicar obrigações.
