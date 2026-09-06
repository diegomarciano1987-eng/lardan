alter table public.party_addresses
  add column if not exists geo_status text not null default 'nao_solicitado',
  add column if not exists geo_precision text,
  add column if not exists geo_source text,
  add column if not exists geo_hash text,
  add column if not exists geo_attempted_at timestamptz,
  add column if not exists geo_located_at timestamptz,
  add column if not exists geo_error text,
  add column if not exists geo_normalizer_version text;

do $$ begin
  alter table public.party_addresses add constraint party_addresses_geo_status_chk
    check (geo_status in ('nao_solicitado','aguardando','localizado_cep','localizado_endereco','aproximado_municipio','aproximado_estado','endereco_incompleto','cep_nao_localizado','sem_coordenadas','falha_temporaria','revisao_manual','desatualizado'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.party_addresses add constraint party_addresses_geo_precision_chk
    check (geo_precision is null or geo_precision in ('endereco','cep','municipio','estado'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.party_addresses add constraint party_addresses_latlng_chk
    check (
      (latitude is null and longitude is null)
      or (latitude between -90 and 90 and longitude between -180 and 180)
    );
exception when duplicate_object then null; end $$;

create or replace function public.address_geo_fingerprint(
  _postal text, _street text, _number text, _district text, _city text, _uf text
) returns text
language sql immutable set search_path = public as $$
  select md5(
    coalesce(regexp_replace(coalesce(_postal,''), '\D', '', 'g'),'') || '|' ||
    lower(trim(coalesce(_street,''))) || '|' ||
    lower(trim(coalesce(_number,''))) || '|' ||
    lower(trim(coalesce(_district,''))) || '|' ||
    lower(trim(coalesce(_city,''))) || '|' ||
    upper(trim(coalesce(_uf,'')))
  )
$$;

create or replace function public.party_addresses_geo_invalidate()
returns trigger language plpgsql set search_path = public as $$
declare novo text;
begin
  novo := public.address_geo_fingerprint(new.postal_code, new.street, new.street_number, new.district, new.city, new.uf::text);
  if tg_op = 'INSERT' then
    new.geo_hash := coalesce(new.geo_hash, novo);
    return new;
  end if;
  if novo is distinct from public.address_geo_fingerprint(old.postal_code, old.street, old.street_number, old.district, old.city, old.uf::text) then
    new.geo_hash := novo;
    new.latitude := null;
    new.longitude := null;
    new.geo_precision := null;
    new.geo_source := null;
    new.geo_located_at := null;
    new.geo_error := null;
    new.geo_status := case when old.geo_status = 'nao_solicitado' then 'nao_solicitado' else 'desatualizado' end;
  end if;
  return new;
end $$;

drop trigger if exists trg_party_addresses_geo on public.party_addresses;
create trigger trg_party_addresses_geo
before insert or update on public.party_addresses
for each row execute function public.party_addresses_geo_invalidate();

create index if not exists party_addresses_geo_idx on public.party_addresses (uf, ibge_city_code, geo_status);
create index if not exists party_addresses_geo_hash_idx on public.party_addresses (geo_hash);

create table if not exists public.geocode_cache (
  geo_hash text primary key,
  postal_digits text,
  ibge_city_code text,
  uf text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  precision text not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days',
  constraint geocode_cache_latlng_chk check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180))
);
grant all on public.geocode_cache to service_role;
alter table public.geocode_cache enable row level security;

create table if not exists public.geocode_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pendente' check (status in ('pendente','processando','pausado','concluido','erro')),
  escopo jsonb not null default '{}'::jsonb,
  total integer not null default 0,
  processados integer not null default 0,
  localizados integer not null default 0,
  aproximados integer not null default 0,
  falhas integer not null default 0,
  checkpoint text,
  mensagem text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.geocode_batches to authenticated;
grant all on public.geocode_batches to service_role;
alter table public.geocode_batches enable row level security;
drop policy if exists "geocode_batches_read" on public.geocode_batches;
create policy "geocode_batches_read" on public.geocode_batches for select to authenticated
  using (public.has_capability(auth.uid(),'partners.view'));

create table if not exists public.uf_centroides (
  uf char(2) primary key,
  nome text not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null
);
grant select on public.uf_centroides to authenticated;
grant all on public.uf_centroides to service_role;
alter table public.uf_centroides enable row level security;
drop policy if exists "uf_centroides_read" on public.uf_centroides;
create policy "uf_centroides_read" on public.uf_centroides for select to authenticated using (true);

insert into public.uf_centroides (uf, nome, latitude, longitude) values
('AC','Acre',-9.0238,-70.8120),('AL','Alagoas',-9.5713,-36.7820),('AP','Amapá',1.4144,-51.7865),
('AM','Amazonas',-3.4168,-65.8561),('BA','Bahia',-12.5797,-41.7007),('CE','Ceará',-5.4984,-39.3206),
('DF','Distrito Federal',-15.7998,-47.8645),('ES','Espírito Santo',-19.1834,-40.3089),('GO','Goiás',-15.8270,-49.8362),
('MA','Maranhão',-4.9609,-45.2744),('MT','Mato Grosso',-12.6819,-56.9211),('MS','Mato Grosso do Sul',-20.7722,-54.7852),
('MG','Minas Gerais',-18.5122,-44.5550),('PA','Pará',-3.9014,-52.4788),('PB','Paraíba',-7.2400,-36.7820),
('PR','Paraná',-24.8932,-51.4144),('PE','Pernambuco',-8.8137,-36.9541),('PI','Piauí',-7.7183,-42.7289),
('RJ','Rio de Janeiro',-22.1114,-43.2064),('RN','Rio Grande do Norte',-5.4026,-36.9541),('RS','Rio Grande do Sul',-30.0346,-53.2000),
('RO','Rondônia',-10.9472,-62.8278),('RR','Roraima',1.9981,-61.3300),('SC','Santa Catarina',-27.2423,-50.2189),
('SP','São Paulo',-22.1900,-48.7900),('SE','Sergipe',-10.5741,-37.3857),('TO','Tocantins',-10.1753,-48.2982)
on conflict (uf) do nothing;