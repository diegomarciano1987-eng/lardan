-- 1) Número do sistema para cada título
create sequence if not exists public.fin_title_numero_seq;

alter table public.financial_titles add column if not exists numero text;

create or replace function public.fin_title_numero_set()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.numero is null or btrim(new.numero) = '' then
    new.numero := to_char(coalesce(new.created_at, now()), 'YYYY') || '-' ||
                  lpad(nextval('public.fin_title_numero_seq')::text, 6, '0');
  end if;
  return new;
end $$;

drop trigger if exists financial_titles_numero on public.financial_titles;
create trigger financial_titles_numero
before insert on public.financial_titles
for each row execute function public.fin_title_numero_set();

do $$
declare r record;
begin
  for r in select id, created_at from public.financial_titles where numero is null order by created_at, id loop
    update public.financial_titles
       set numero = to_char(r.created_at, 'YYYY') || '-' || lpad(nextval('public.fin_title_numero_seq')::text, 6, '0')
     where id = r.id;
  end loop;
end $$;

create unique index if not exists financial_titles_numero_key on public.financial_titles (numero);

-- 2) Área de recepção da planilha de contas a pagar
create table if not exists public.financial_import_ap_stage (
  id uuid primary key default gen_random_uuid(),
  lote text not null,
  linha integer not null,
  fornecedor text,
  competencia date,
  vencimento date not null,
  recorrente boolean not null default false,
  parcela_num integer not null default 1,
  parcela_total integer not null default 1,
  descricao text not null,
  situacao text,
  valor_cents bigint not null,
  forma text,
  pago_cents bigint,
  conta text,
  categoria text,
  centro text,
  grupo text not null,
  title_id uuid references public.financial_titles(id),
  installment_id uuid references public.financial_installments(id),
  processed_at timestamptz,
  erro text,
  created_at timestamptz not null default now()
);

create unique index if not exists fin_import_ap_stage_lote_linha on public.financial_import_ap_stage (lote, linha);
create index if not exists fin_import_ap_stage_grupo on public.financial_import_ap_stage (lote, grupo);
create index if not exists fin_import_ap_stage_pendente on public.financial_import_ap_stage (lote) where processed_at is null;

grant all on public.financial_import_ap_stage to service_role;
grant select on public.financial_import_ap_stage to authenticated;

alter table public.financial_import_ap_stage enable row level security;

drop policy if exists "import ap stage master read" on public.financial_import_ap_stage;
create policy "import ap stage master read"
on public.financial_import_ap_stage
for select
to authenticated
using (public.has_role(auth.uid(), 'master'::app_role));