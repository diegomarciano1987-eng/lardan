-- 0. Visitante não alcança nada do Financeiro ------------------------------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename like 'financial%' loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- 1. Enums -----------------------------------------------------------------
do $$ begin
  create type public.fin_statement_line_status as enum
    ('pendente','invalida','repetida','parcial','conciliada','ignorada','divergente');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fin_statement_format as enum ('csv','ofx');
exception when duplicate_object then null; end $$;

-- 2. Arquivos de extrato ---------------------------------------------------
create table if not exists public.financial_statement_files (
  id uuid primary key default gen_random_uuid(),
  financial_account_id uuid not null references public.financial_accounts(id),
  storage_path text not null,
  original_name text not null,
  format public.fin_statement_format not null,
  size_bytes bigint not null default 0,
  sha256 text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
grant select on public.financial_statement_files to authenticated;
grant all on public.financial_statement_files to service_role;
alter table public.financial_statement_files enable row level security;
create policy "extrato arquivos read" on public.financial_statement_files for select to authenticated
  using (has_capability(auth.uid(),'finance.statement.view'));

-- 3. Importações -----------------------------------------------------------
create table if not exists public.financial_statement_imports (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.financial_statement_files(id),
  financial_account_id uuid not null references public.financial_accounts(id),
  status text not null default 'analisando',
  total_linhas int not null default 0,
  validas int not null default 0,
  invalidas int not null default 0,
  repetidas int not null default 0,
  pendentes int not null default 0,
  diagnostico jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.financial_statement_imports to authenticated;
grant all on public.financial_statement_imports to service_role;
alter table public.financial_statement_imports enable row level security;
create policy "extrato importacoes read" on public.financial_statement_imports for select to authenticated
  using (has_capability(auth.uid(),'finance.statement.view'));

-- 4. Linhas originais ------------------------------------------------------
create table if not exists public.financial_statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.financial_statement_imports(id),
  file_id uuid not null references public.financial_statement_files(id),
  financial_account_id uuid not null references public.financial_accounts(id),
  line_no int not null,
  raw jsonb not null default '{}'::jsonb,
  raw_text text,
  data date,
  valor_cents bigint,
  kind text,
  historico text,
  documento text,
  bank_id text,
  hash text,
  status public.fin_statement_line_status not null default 'pendente',
  conciliado_cents bigint not null default 0,
  error_reason text,
  flag_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists financial_statement_lines_hash_uidx
  on public.financial_statement_lines (financial_account_id, hash) where hash is not null and status <> 'repetida';
create index if not exists financial_statement_lines_busca_idx
  on public.financial_statement_lines (financial_account_id, data desc, status);
grant select on public.financial_statement_lines to authenticated;
grant all on public.financial_statement_lines to service_role;
alter table public.financial_statement_lines enable row level security;
create policy "extrato linhas read" on public.financial_statement_lines for select to authenticated
  using (has_capability(auth.uid(),'finance.statement.view'));

-- 5. Sugestões -------------------------------------------------------------
create table if not exists public.financial_match_suggestions (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.financial_statement_lines(id) on delete cascade,
  installment_id uuid not null references public.financial_installments(id),
  score int not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (line_id, installment_id)
);
grant select on public.financial_match_suggestions to authenticated;
grant all on public.financial_match_suggestions to service_role;
alter table public.financial_match_suggestions enable row level security;
create policy "sugestoes read" on public.financial_match_suggestions for select to authenticated
  using (has_capability(auth.uid(),'finance.statement.view'));

-- 6. Conciliações ----------------------------------------------------------
create table if not exists public.financial_reconciliations (
  id uuid primary key default gen_random_uuid(),
  financial_account_id uuid not null references public.financial_accounts(id),
  settlement_id uuid references public.financial_settlements(id),
  status text not null default 'ativa',
  idempotency_key text unique,
  payload_fingerprint text,
  observacao text,
  motivo text,
  reversed_of uuid references public.financial_reconciliations(id),
  is_reversal boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
grant select on public.financial_reconciliations to authenticated;
grant all on public.financial_reconciliations to service_role;
alter table public.financial_reconciliations enable row level security;
create policy "conciliacoes read" on public.financial_reconciliations for select to authenticated
  using (has_capability(auth.uid(),'finance.statement.view'));

create table if not exists public.financial_reconciliation_allocations (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.financial_reconciliations(id),
  line_id uuid not null references public.financial_statement_lines(id),
  installment_id uuid references public.financial_installments(id),
  valor_cents bigint not null,
  created_at timestamptz not null default now()
);
grant select on public.financial_reconciliation_allocations to authenticated;
grant all on public.financial_reconciliation_allocations to service_role;
alter table public.financial_reconciliation_allocations enable row level security;
create policy "conciliacao alocacoes read" on public.financial_reconciliation_allocations for select to authenticated
  using (has_capability(auth.uid(),'finance.statement.view'));

create table if not exists public.financial_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid references public.financial_reconciliations(id),
  line_id uuid references public.financial_statement_lines(id),
  import_id uuid references public.financial_statement_imports(id),
  evento text not null,
  motivo text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
grant select on public.financial_reconciliation_events to authenticated;
grant all on public.financial_reconciliation_events to service_role;
alter table public.financial_reconciliation_events enable row level security;
create policy "conciliacao eventos read" on public.financial_reconciliation_events for select to authenticated
  using (has_capability(auth.uid(),'finance.statement.audit'));

-- histórico imutável
drop trigger if exists fin_reconciliation_events_immutable on public.financial_reconciliation_events;
create trigger fin_reconciliation_events_immutable before update or delete on public.financial_reconciliation_events
  for each row execute function public.fin_block_mutation();
drop trigger if exists fin_reconciliation_alloc_immutable on public.financial_reconciliation_allocations;
create trigger fin_reconciliation_alloc_immutable before update or delete on public.financial_reconciliation_allocations
  for each row execute function public.fin_block_mutation();

-- 7. Capacidades -----------------------------------------------------------
insert into public.role_capabilities (role, capability) values
  ('master','finance.statement.view'),('master','finance.statement.import'),
  ('master','finance.reconcile.undo'),('master','finance.statement.flag'),('master','finance.statement.audit'),
  ('diretoria','finance.statement.view'),('diretoria','finance.statement.audit'),
  ('financeiro','finance.statement.view'),('financeiro','finance.statement.import'),
  ('financeiro','finance.reconcile.undo'),('financeiro','finance.statement.flag'),
  ('financeiro','finance.statement.audit')
on conflict do nothing;