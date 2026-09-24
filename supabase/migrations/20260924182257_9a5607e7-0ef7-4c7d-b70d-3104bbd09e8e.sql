-- Código de barras automático (EAN-13) para variantes novas

create sequence if not exists public.variant_ean_seq start with 10000000;

create or replace function public.ean13_check_digit(_body12 text)
returns text
language plpgsql
immutable
as $fn$
declare
  s int := 0;
  i int;
  d int;
begin
  for i in 1..12 loop
    d := substr(_body12, i, 1)::int;
    s := s + d * (case when i % 2 = 1 then 1 else 3 end);
  end loop;
  return ((10 - (s % 10)) % 10)::text;
end
$fn$;

create or replace function public.variant_ean_next()
returns text
language plpgsql
security definer
set search_path to public
as $fn$
declare
  tent int := 0;
  corpo text;
  codigo text;
begin
  loop
    tent := tent + 1;
    if tent > 25 then
      raise exception 'Não foi possível gerar um código de barras livre.' using errcode = '23505';
    end if;
    corpo := '789' || lpad(nextval('public.variant_ean_seq')::text, 9, '0');
    codigo := corpo || public.ean13_check_digit(corpo);
    if not exists (select 1 from public.product_variants v where v.barcode = codigo)
       and not exists (select 1 from public.products p where p.barcode = codigo) then
      return codigo;
    end if;
  end loop;
end
$fn$;

create or replace function public.variant_barcode_autofill()
returns trigger
language plpgsql
security definer
set search_path to public
as $fn$
declare
  padrao_vazia boolean;
begin
  if coalesce(btrim(new.barcode), '') <> '' then
    return new;
  end if;
  -- Variante padrão ainda vazia (rascunho criado junto com o produto):
  -- continua sem código para a importação reconhecê-la e preenchê-la.
  padrao_vazia := new.is_default
    and new.sku is null and new.legacy_code is null and new.price_cents is null
    and new.label = 'Padrão';
  if padrao_vazia then
    return new;
  end if;
  new.barcode := public.variant_ean_next();
  return new;
end
$fn$;

drop trigger if exists trg_variant_barcode_autofill on public.product_variants;
create trigger trg_variant_barcode_autofill
  before insert or update of barcode, sku, label, legacy_code, price_cents, is_default
  on public.product_variants
  for each row execute function public.variant_barcode_autofill();

grant execute on function public.ean13_check_digit(text) to authenticated, service_role;
grant execute on function public.variant_ean_next() to authenticated, service_role;
grant usage on sequence public.variant_ean_seq to authenticated, service_role;