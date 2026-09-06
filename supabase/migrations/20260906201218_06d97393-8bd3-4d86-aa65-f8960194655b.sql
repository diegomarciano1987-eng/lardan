-- ===== Fundação de ranking (versionado, explicável) =====
create table if not exists public.ranking_programs (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  periodo_inicio date,
  periodo_fim date,
  status text not null default 'rascunho' check (status in ('rascunho','publicado','encerrado','cancelado')),
  escopo text not null default 'nacional' check (escopo in ('nacional','estado','regiao','representante','carteira','nivel','campanha')),
  escopo_valor text,
  publico_elegivel jsonb not null default '{}'::jsonb,
  metricas jsonb not null default '[]'::jsonb,
  pesos jsonb not null default '{}'::jsonb,
  desempate jsonb not null default '[]'::jsonb,
  criterios_minimos jsonb not null default '{}'::jsonb,
  criterios_desclassificacao jsonb not null default '{}'::jsonb,
  versao integer not null default 1,
  aprovado_por uuid,
  aprovado_em timestamptz,
  publicado_em timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.ranking_programs(id) on delete cascade,
  versao integer not null,
  apurado_em timestamptz not null default now(),
  imutavel boolean not null default true,
  regra jsonb not null default '{}'::jsonb,
  posicoes jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (program_id, versao)
);

-- ===== Fundação de premiações =====
create table if not exists public.award_campaigns (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references public.ranking_programs(id) on delete set null,
  nome text not null,
  descricao text,
  regulamento text,
  media_id uuid,
  periodo_inicio date,
  periodo_fim date,
  status text not null default 'planejada' check (status in ('planejada','publicada','em_apuracao','aguardando_aprovacao','concedida','entregue','cancelada')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.award_prizes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.award_campaigns(id) on delete cascade,
  nome text not null,
  descricao text,
  quantidade integer not null default 1 check (quantidade >= 0),
  posicao_inicio integer,
  posicao_fim integer,
  faixa text,
  created_at timestamptz not null default now()
);

create table if not exists public.award_grants (
  id uuid primary key default gen_random_uuid(),
  prize_id uuid not null references public.award_prizes(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete restrict,
  snapshot_id uuid references public.ranking_snapshots(id) on delete set null,
  status text not null default 'aguardando_aprovacao' check (status in ('aguardando_aprovacao','concedida','aceita','entregue','cancelada')),
  motivo text,
  aprovado_por uuid,
  aprovado_em timestamptz,
  aceito_em timestamptz,
  entregue_em timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prize_id, party_id)
);

grant select on public.ranking_programs, public.ranking_snapshots, public.award_campaigns, public.award_prizes, public.award_grants to authenticated;
grant insert, update, delete on public.ranking_programs, public.award_campaigns, public.award_prizes, public.award_grants to authenticated;
grant insert on public.ranking_snapshots to authenticated;
grant all on public.ranking_programs, public.ranking_snapshots, public.award_campaigns, public.award_prizes, public.award_grants to service_role;

alter table public.ranking_programs enable row level security;
alter table public.ranking_snapshots enable row level security;
alter table public.award_campaigns enable row level security;
alter table public.award_prizes enable row level security;
alter table public.award_grants enable row level security;

create policy "ranking_programs_read" on public.ranking_programs for select to authenticated
  using (public.has_capability(auth.uid(),'partners.view'));
create policy "ranking_programs_write" on public.ranking_programs for all to authenticated
  using (public.has_capability(auth.uid(),'partners.manage'))
  with check (public.has_capability(auth.uid(),'partners.manage'));

create policy "ranking_snapshots_read" on public.ranking_snapshots for select to authenticated
  using (public.has_capability(auth.uid(),'partners.view'));
create policy "ranking_snapshots_write" on public.ranking_snapshots for insert to authenticated
  with check (public.has_capability(auth.uid(),'partners.manage'));

create policy "award_campaigns_read" on public.award_campaigns for select to authenticated
  using (public.has_capability(auth.uid(),'partners.view'));
create policy "award_campaigns_write" on public.award_campaigns for all to authenticated
  using (public.has_capability(auth.uid(),'partners.manage'))
  with check (public.has_capability(auth.uid(),'partners.manage'));

create policy "award_prizes_read" on public.award_prizes for select to authenticated
  using (public.has_capability(auth.uid(),'partners.view'));
create policy "award_prizes_write" on public.award_prizes for all to authenticated
  using (public.has_capability(auth.uid(),'partners.manage'))
  with check (public.has_capability(auth.uid(),'partners.manage'));

create policy "award_grants_read" on public.award_grants for select to authenticated
  using (public.has_capability(auth.uid(),'partners.view'));
create policy "award_grants_write" on public.award_grants for all to authenticated
  using (public.has_capability(auth.uid(),'partners.manage'))
  with check (public.has_capability(auth.uid(),'partners.manage'));

-- snapshot encerrado é imutável
create or replace function public.ranking_snapshots_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.imutavel then
    raise exception 'snapshot de ranking é imutável';
  end if;
  return new;
end $$;
drop trigger if exists trg_ranking_snapshots_immutable on public.ranking_snapshots;
create trigger trg_ranking_snapshots_immutable
before update or delete on public.ranking_snapshots
for each row execute function public.ranking_snapshots_immutable();