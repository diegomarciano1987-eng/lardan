-- Prelúdio do ambiente ISOLADO de validação do LARDAN.
--
-- Reproduz, num Postgres local e vazio, apenas as peças da nuvem das quais as
-- migrações dependem: papéis de acesso, o esquema de autenticação e o esquema
-- de arquivos. NADA aqui é copiado da base compartilhada: nenhum dado, nenhuma
-- credencial, nenhum segredo. Só estrutura.
--
-- auth.uid() devolve o usuário simulado da sessão (lardan.test_uid), que é como
-- as baterias trocam de perfil sem precisar de servidor de autenticação.

-- ---------------------------------------------------------------- papéis
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

-- ------------------------------------------------------------- extensões
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ------------------------------------------------------- esquemas da nuvem
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz not null default now()
);

-- Usuário da sessão. Na nuvem vem do token; aqui vem de uma variável de
-- sessão, o que permite simular Matriz, representante, consultora, visitante
-- e conta desativada sem inventar credenciais.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('lardan.test_uid', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$ select coalesce(nullif(current_setting('lardan.test_role', true), ''), current_user) $$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create or replace function auth.email()
returns text
language sql
stable
as $$ select email from auth.users where id = auth.uid() $$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- --------------------------------------------------------------- arquivos
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.objects to anon;
grant all on storage.objects to service_role;
grant select on storage.buckets to anon, authenticated;
grant all on storage.buckets to service_role;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$ select string_to_array(name, '/') $$;

-- ------------------------------------------------------------ publicação
-- A nuvem já traz a publicação de tempo real; aqui ela é criada vazia.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ------------------------------------------------- privilégios padrão
-- A nuvem concede execução de rotinas e uso de sequências criadas no schema
-- público. Sem isto, rotinas que lá funcionam seriam recusadas aqui por um
-- motivo que não existe em produção. Tabelas NÃO entram: cada migração
-- precisa continuar declarando suas próprias permissões.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
