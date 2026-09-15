-- ============ ENUMS ============
create type public.fin_direction as enum ('receivable','payable');
create type public.fin_title_status as enum ('rascunho','submetido','aprovado','ativo','cancelado');
create type public.fin_settlement_status as enum ('nao_liquidado','parcial','liquidado','excedente');
create type public.fin_reconcile_status as enum ('nao_conciliado','parcial','conciliado','divergente');
create type public.fin_approval_status as enum ('nao_exigida','pendente','aprovada','recusada');
create type public.fin_account_kind as enum ('conta_corrente','poupanca','caixa','carteira','compensacao','provedor','investimento');
create type public.fin_movement_kind as enum ('entrada','saida','transferencia_entrada','transferencia_saida','ajuste','saldo_inicial');
create type public.fin_adjustment_kind as enum ('juros','multa','desconto','abatimento','tarifa','imposto_retido','perda','chargeback','outro');
create type public.fin_account_nature as enum ('receita','deducao','custo','despesa','ativo','passivo','resultado');

-- ============ CADASTROS FINANCEIROS ============
create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  business_entity_id uuid references public.business_entities(id),
  nome text not null,
  apelido text,
  kind public.fin_account_kind not null,
  banco text,
  agencia_masked text,
  conta_masked text,
  moeda text not null default 'BRL',
  saldo_inicial_cents bigint not null default 0,
  data_corte date,
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index financial_accounts_nome_key on public.financial_accounts (lower(nome));

create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  business_entity_id uuid references public.business_entities(id),
  parent_id uuid references public.chart_of_accounts(id),
  codigo text not null,
  nome text not null,
  natureza public.fin_account_nature not null,
  aceita_lancamento boolean not null default true,
  vigencia_inicio date,
  vigencia_fim date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index chart_of_accounts_codigo_key on public.chart_of_accounts (coalesce(business_entity_id,'00000000-0000-0000-0000-000000000000'::uuid), codigo);

create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  business_entity_id uuid references public.business_entities(id),
  parent_id uuid references public.cost_centers(id),
  codigo text not null,
  nome text not null,
  responsavel_party_id uuid references public.parties(id),
  vigencia_inicio date,
  vigencia_fim date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cost_centers_codigo_key on public.cost_centers (coalesce(business_entity_id,'00000000-0000-0000-0000-000000000000'::uuid), codigo);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ TITULOS E PARCELAS ============
create table public.financial_titles (
  id uuid primary key default gen_random_uuid(),
  direction public.fin_direction not null,
  business_entity_id uuid references public.business_entities(id),
  party_id uuid not null references public.parties(id),
  pagador_party_id uuid references public.parties(id),
  descricao text not null,
  documento text,
  emissao date not null default current_date,
  competencia date,
  moeda text not null default 'BRL',
  valor_cents bigint not null,
  chart_account_id uuid references public.chart_of_accounts(id),
  cost_center_id uuid references public.cost_centers(id),
  payment_method_id uuid references public.payment_methods(id),
  financial_account_id uuid references public.financial_accounts(id),
  origem text not null default 'manual',
  origem_id text,
  sistema_origem text,
  id_externo text,
  status public.fin_title_status not null default 'rascunho',
  approval_status public.fin_approval_status not null default 'nao_exigida',
  cancel_reason text,
  observacao text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_titles_valor_pos check (valor_cents > 0)
);
create index financial_titles_dir_idx on public.financial_titles (direction, status);
create index financial_titles_party_idx on public.financial_titles (party_id);
create index financial_titles_doc_idx on public.financial_titles (documento);
create unique index financial_titles_externo_key on public.financial_titles (sistema_origem, id_externo)
  where sistema_origem is not null and id_externo is not null;

create table public.financial_installments (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references public.financial_titles(id) on delete restrict,
  numero integer not null,
  total_parcelas integer not null default 1,
  vencimento date not null,
  valor_cents bigint not null,
  settlement_status public.fin_settlement_status not null default 'nao_liquidado',
  reconcile_status public.fin_reconcile_status not null default 'nao_conciliado',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_installments_valor_pos check (valor_cents > 0),
  constraint financial_installments_numero_pos check (numero > 0),
  unique (title_id, numero)
);
create index financial_installments_venc_idx on public.financial_installments (vencimento);
create index financial_installments_title_idx on public.financial_installments (title_id);

create table public.financial_allocation_targets (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references public.financial_installments(id) on delete restrict,
  chart_account_id uuid references public.chart_of_accounts(id),
  cost_center_id uuid references public.cost_centers(id),
  valor_cents bigint not null,
  created_at timestamptz not null default now(),
  constraint financial_allocation_targets_pos check (valor_cents > 0)
);
create index financial_allocation_targets_inst_idx on public.financial_allocation_targets (installment_id);

create table public.financial_title_events (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references public.financial_titles(id) on delete restrict,
  evento text not null,
  motivo text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index financial_title_events_title_idx on public.financial_title_events (title_id, created_at);

-- ============ LIQUIDACOES ============
create table public.financial_settlements (
  id uuid primary key default gen_random_uuid(),
  direction public.fin_direction not null,
  financial_account_id uuid not null references public.financial_accounts(id),
  data date not null default current_date,
  valor_cents bigint not null,
  payment_method_id uuid references public.payment_methods(id),
  referencia text,
  observacao text,
  idempotency_key text,
  reversed_of uuid references public.financial_settlements(id),
  is_reversal boolean not null default false,
  reversal_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint financial_settlements_valor_nz check (valor_cents <> 0)
);
create unique index financial_settlements_idem_key on public.financial_settlements (idempotency_key) where idempotency_key is not null;
create index financial_settlements_acc_idx on public.financial_settlements (financial_account_id, data);

create table public.financial_allocations (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.financial_settlements(id) on delete restrict,
  installment_id uuid not null references public.financial_installments(id) on delete restrict,
  valor_cents bigint not null,
  created_at timestamptz not null default now(),
  constraint financial_allocations_valor_nz check (valor_cents <> 0)
);
create index financial_allocations_inst_idx on public.financial_allocations (installment_id);
create index financial_allocations_settle_idx on public.financial_allocations (settlement_id);

create table public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid references public.financial_installments(id) on delete restrict,
  settlement_id uuid references public.financial_settlements(id) on delete restrict,
  kind public.fin_adjustment_kind not null,
  valor_cents bigint not null,
  motivo text,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint financial_adjustments_valor_nz check (valor_cents <> 0)
);
create index financial_adjustments_inst_idx on public.financial_adjustments (installment_id);

create table public.financial_transfers (
  id uuid primary key default gen_random_uuid(),
  from_account_id uuid not null references public.financial_accounts(id),
  to_account_id uuid not null references public.financial_accounts(id),
  data date not null default current_date,
  valor_cents bigint not null,
  referencia text,
  motivo text,
  idempotency_key text,
  reversed_of uuid references public.financial_transfers(id),
  is_reversal boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint financial_transfers_valor_pos check (valor_cents > 0),
  constraint financial_transfers_distintas check (from_account_id <> to_account_id)
);
create unique index financial_transfers_idem_key on public.financial_transfers (idempotency_key) where idempotency_key is not null;

create table public.financial_account_movements (
  id uuid primary key default gen_random_uuid(),
  financial_account_id uuid not null references public.financial_accounts(id),
  kind public.fin_movement_kind not null,
  data date not null default current_date,
  valor_cents bigint not null,
  settlement_id uuid references public.financial_settlements(id),
  transfer_id uuid references public.financial_transfers(id),
  descricao text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint financial_account_movements_valor_nz check (valor_cents <> 0)
);
create index financial_account_movements_acc_idx on public.financial_account_movements (financial_account_id, data);

-- ============ RECONHECIMENTO DE DIVIDA ============
create table public.financial_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references public.financial_titles(id) on delete restrict,
  reconhecido_cents bigint not null default 0,
  contestado_cents bigint not null default 0,
  motivo text,
  evidencia text,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index financial_acknowledgements_title_idx on public.financial_acknowledgements (title_id, created_at);

create table public.financial_attachments (
  id uuid primary key default gen_random_uuid(),
  title_id uuid references public.financial_titles(id) on delete restrict,
  settlement_id uuid references public.financial_settlements(id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  content_type text,
  byte_size bigint,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ============ GRANTS (somente leitura; escrita via RPC) ============
grant select on public.financial_accounts, public.chart_of_accounts, public.cost_centers,
  public.payment_methods, public.financial_titles, public.financial_installments,
  public.financial_allocation_targets, public.financial_title_events,
  public.financial_settlements, public.financial_allocations, public.financial_adjustments,
  public.financial_transfers, public.financial_account_movements,
  public.financial_acknowledgements, public.financial_attachments to authenticated;
grant all on public.financial_accounts, public.chart_of_accounts, public.cost_centers,
  public.payment_methods, public.financial_titles, public.financial_installments,
  public.financial_allocation_targets, public.financial_title_events,
  public.financial_settlements, public.financial_allocations, public.financial_adjustments,
  public.financial_transfers, public.financial_account_movements,
  public.financial_acknowledgements, public.financial_attachments to service_role;

-- ============ RLS ============
alter table public.financial_accounts enable row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.cost_centers enable row level security;
alter table public.payment_methods enable row level security;
alter table public.financial_titles enable row level security;
alter table public.financial_installments enable row level security;
alter table public.financial_allocation_targets enable row level security;
alter table public.financial_title_events enable row level security;
alter table public.financial_settlements enable row level security;
alter table public.financial_allocations enable row level security;
alter table public.financial_adjustments enable row level security;
alter table public.financial_transfers enable row level security;
alter table public.financial_account_movements enable row level security;
alter table public.financial_acknowledgements enable row level security;
alter table public.financial_attachments enable row level security;

create policy "fin accounts read" on public.financial_accounts for select to authenticated
  using (public.has_capability(auth.uid(),'finance.bank.view'));
create policy "fin chart read" on public.chart_of_accounts for select to authenticated
  using (public.has_capability(auth.uid(),'finance.dashboard.view'));
create policy "fin cc read" on public.cost_centers for select to authenticated
  using (public.has_capability(auth.uid(),'finance.dashboard.view'));
create policy "fin methods read" on public.payment_methods for select to authenticated
  using (public.has_capability(auth.uid(),'finance.dashboard.view'));
create policy "fin titles read" on public.financial_titles for select to authenticated
  using (
    (direction = 'payable' and public.has_capability(auth.uid(),'finance.payable.view'))
    or (direction = 'receivable' and public.has_capability(auth.uid(),'finance.receivable.view'))
  );
create policy "fin installments read" on public.financial_installments for select to authenticated
  using (exists (select 1 from public.financial_titles t where t.id = title_id));
create policy "fin targets read" on public.financial_allocation_targets for select to authenticated
  using (exists (select 1 from public.financial_installments i where i.id = installment_id));
create policy "fin events read" on public.financial_title_events for select to authenticated
  using (exists (select 1 from public.financial_titles t where t.id = title_id));
create policy "fin settlements read" on public.financial_settlements for select to authenticated
  using (
    (direction = 'payable' and public.has_capability(auth.uid(),'finance.payable.view'))
    or (direction = 'receivable' and public.has_capability(auth.uid(),'finance.receivable.view'))
  );
create policy "fin allocations read" on public.financial_allocations for select to authenticated
  using (exists (select 1 from public.financial_settlements s where s.id = settlement_id));
create policy "fin adjustments read" on public.financial_adjustments for select to authenticated
  using (public.has_capability(auth.uid(),'finance.dashboard.view'));
create policy "fin transfers read" on public.financial_transfers for select to authenticated
  using (public.has_capability(auth.uid(),'finance.bank.view'));
create policy "fin movements read" on public.financial_account_movements for select to authenticated
  using (public.has_capability(auth.uid(),'finance.bank.view'));
create policy "fin ack read" on public.financial_acknowledgements for select to authenticated
  using (public.has_capability(auth.uid(),'finance.receivable.view'));
create policy "fin attachments read" on public.financial_attachments for select to authenticated
  using (public.has_capability(auth.uid(),'finance.dashboard.view'));

-- ============ CAPACIDADES ============
insert into public.role_capabilities (role, capability) values
  ('master','finance.dashboard.view'),('master','finance.payable.view'),('master','finance.payable.manage'),
  ('master','finance.receivable.view'),('master','finance.receivable.manage'),('master','finance.title.approve'),
  ('master','finance.settlement.create'),('master','finance.settlement.reverse'),('master','finance.bank.view'),
  ('master','finance.bank.manage'),('master','finance.reconcile'),('master','finance.dre.view'),
  ('master','finance.import.run'),('master','finance.import.approve'),('master','finance.export'),
  ('master','finance.audit.view'),('master','finance.settings.manage'),
  ('master','collection.view'),('master','collection.operate'),('master','collection.negotiate'),('master','collection.discount.approve'),
  ('diretoria','finance.dashboard.view'),('diretoria','finance.payable.view'),('diretoria','finance.receivable.view'),
  ('diretoria','finance.title.approve'),('diretoria','finance.bank.view'),('diretoria','finance.dre.view'),
  ('diretoria','finance.export'),('diretoria','finance.audit.view'),('diretoria','finance.import.approve'),
  ('diretoria','collection.view'),('diretoria','collection.discount.approve'),
  ('financeiro','finance.dashboard.view'),('financeiro','finance.payable.view'),('financeiro','finance.payable.manage'),
  ('financeiro','finance.receivable.view'),('financeiro','finance.receivable.manage'),
  ('financeiro','finance.settlement.create'),('financeiro','finance.settlement.reverse'),
  ('financeiro','finance.bank.view'),('financeiro','finance.bank.manage'),('financeiro','finance.reconcile'),
  ('financeiro','finance.dre.view'),('financeiro','finance.import.run'),('financeiro','finance.export'),
  ('financeiro','collection.view'),
  ('cobranca','finance.receivable.view'),('cobranca','collection.view'),('cobranca','collection.operate'),
  ('cobranca','collection.negotiate')
on conflict do nothing;

-- ============ TRIGGERS ============
create trigger financial_accounts_touch before update on public.financial_accounts
  for each row execute function public.set_updated_at();
create trigger financial_titles_touch before update on public.financial_titles
  for each row execute function public.set_updated_at();
create trigger financial_installments_touch before update on public.financial_installments
  for each row execute function public.set_updated_at();