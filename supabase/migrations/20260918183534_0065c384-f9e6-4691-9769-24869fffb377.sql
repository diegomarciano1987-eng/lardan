create or replace function public.catalog_pendencias(_tipo text, _busca text default null, _limite int default 50, _offset int default 0)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare r jsonb; _t text := lower(coalesce(_tipo,'sem_custo')); _b text := nullif(btrim(coalesce(_busca,'')), '');
begin
  if not has_capability(auth.uid(),'catalog.view') then
    raise exception 'Sem permissão';
  end if;
  if _t not in ('sem_custo','sem_preco','sem_ncm','sem_referencia') then
    raise exception 'Tipo inválido';
  end if;

  with base as (
    select p.id, p.name, p.status::text as status,
           coalesce(p.cost_price_cents,0) as custo,
           coalesce(p.price_cents,0) as venda,
           p.ncm, p.reference_code, p.created_at,
           (select v.barcode from product_variants v
             where v.product_id = p.id and v.barcode is not null
             order by v.is_default desc, v.position asc limit 1) as barcode
    from products p
    where p.status <> 'arquivado'
  ), filtrado as (
    select * from base
    where case _t
            when 'sem_custo' then custo = 0
            when 'sem_preco' then venda = 0
            when 'sem_ncm' then ncm is null
            else reference_code is null
          end
      and (_b is null
           or name ilike '%'||_b||'%'
           or coalesce(reference_code,'') ilike '%'||_b||'%'
           or coalesce(barcode,'') ilike '%'||_b||'%')
  )
  select jsonb_build_object(
    'tipo', _t,
    'total', (select count(*) from filtrado),
    'itens', coalesce((select jsonb_agg(x) from (
        select id, name, status, custo, venda, ncm, reference_code, barcode
        from filtrado
        order by name asc
        limit greatest(1, least(coalesce(_limite,50), 200))
        offset greatest(0, coalesce(_offset,0))) x), '[]'::jsonb)
  ) into r;

  return r;
end;
$$;

revoke all on function public.catalog_pendencias(text, text, int, int) from public;
grant execute on function public.catalog_pendencias(text, text, int, int) to authenticated, service_role;