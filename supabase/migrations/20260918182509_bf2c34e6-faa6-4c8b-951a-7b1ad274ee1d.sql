CREATE OR REPLACE FUNCTION public.catalog_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  if not has_capability(auth.uid(),'catalog.view') then
    raise exception 'Sem permissão';
  end if;

  with base as (
    select p.id, p.name, p.status::text as status, p.slug,
           coalesce(p.cost_price_cents,0) as custo,
           coalesce(p.price_cents,0) as venda,
           p.ncm, p.reference_code
    from products p
    where p.status <> 'arquivado'
  ), comercial as (
    select *, case when custo > 0 and venda > 0
                   then round((venda - custo)::numeric * 100 / custo, 1) end as margem
    from base
  ), estoque as (
    select v.product_id, p.name as produto, v.label, v.sku,
           sum(b.quantity) as quantidade,
           sum(b.quantity) * coalesce(max(v.price_cents), max(p.price_cents), 0) as valor_venda,
           sum(b.quantity) * coalesce(max(p.cost_price_cents), 0) as valor_custo
    from stock_balances b
    join product_variants v on v.id = b.variant_id
    join products p on p.id = v.product_id
    where b.quantity > 0
    group by v.product_id, p.name, v.label, v.sku
  )
  select jsonb_build_object(
    'totais', jsonb_build_object(
      'produtos', (select count(*) from products),
      'ativos', (select count(*) from base),
      'publicados', (select count(*) from products where status = 'publicado'),
      'rascunhos', (select count(*) from products where status = 'rascunho'),
      'arquivados', (select count(*) from products where status = 'arquivado'),
      'variantes', (select count(*) from product_variants),
      'categorias', (select count(*) from categories),
      'com_barcode', (select count(*) from product_variants where barcode is not null),
      'sem_barcode', (select count(*) from product_variants where barcode is null),
      'sem_custo', (select count(*) from comercial where custo = 0),
      'sem_preco', (select count(*) from comercial where venda = 0),
      'sem_ncm', (select count(*) from comercial where ncm is null),
      'sem_referencia', (select count(*) from comercial where reference_code is null)
    ),
    'valores', jsonb_build_object(
      'custo_total_cents', (select coalesce(sum(custo),0) from comercial),
      'venda_total_cents', (select coalesce(sum(venda),0) from comercial),
      'lucro_potencial_cents', (select coalesce(sum(venda - custo),0) from comercial where custo > 0 and venda > 0),
      'markup_medio', (select round(avg(margem),1) from comercial where margem is not null),
      'markup_mediano', (select round(percentile_cont(0.5) within group (order by margem)::numeric,1)
                         from comercial where margem is not null),
      'custo_medio_cents', (select round(avg(custo)) from comercial where custo > 0),
      'venda_media_cents', (select round(avg(venda)) from comercial where venda > 0)
    ),
    'estoque', jsonb_build_object(
      'pecas', (select coalesce(sum(quantidade),0) from estoque),
      'itens', (select count(*) from estoque),
      'valor_venda_cents', (select coalesce(sum(valor_venda),0) from estoque),
      'valor_custo_cents', (select coalesce(sum(valor_custo),0) from estoque),
      'sem_saldo', (select count(*) from product_variants v
                    where not exists (select 1 from stock_balances b
                                      where b.variant_id = v.id and b.quantity > 0))
    ),
    'top_estoque', coalesce((select jsonb_agg(x) from (
        select product_id, produto, label, sku, quantidade, valor_venda
        from estoque order by quantidade desc, valor_venda desc limit 10) x), '[]'::jsonb),
    'mais_caros', coalesce((select jsonb_agg(x) from (
        select id, name, venda, custo, margem from comercial
        where venda > 0 order by venda desc limit 5) x), '[]'::jsonb),
    'mais_baratos', coalesce((select jsonb_agg(x) from (
        select id, name, venda, custo, margem from comercial
        where venda > 0 order by venda asc limit 5) x), '[]'::jsonb),
    'melhor_margem', coalesce((select jsonb_agg(x) from (
        select id, name, venda, custo, margem from comercial
        where margem is not null order by margem desc, venda desc limit 10) x), '[]'::jsonb),
    'pior_margem', coalesce((select jsonb_agg(x) from (
        select id, name, venda, custo, margem from comercial
        where margem is not null order by margem asc, venda desc limit 5) x), '[]'::jsonb),
    'faixas', coalesce((select jsonb_agg(x order by x->>'ordem') from (
        select jsonb_build_object('ordem', o, 'faixa', faixa, 'pecas', qtd, 'venda_cents', soma) as x
        from (
          select case
                   when venda < 5000 then 1 when venda < 10000 then 2
                   when venda < 20000 then 3 when venda < 40000 then 4
                   else 5 end as o,
                 case
                   when venda < 5000 then 'Até R$ 50'
                   when venda < 10000 then 'R$ 50 a R$ 100'
                   when venda < 20000 then 'R$ 100 a R$ 200'
                   when venda < 40000 then 'R$ 200 a R$ 400'
                   else 'Acima de R$ 400' end as faixa,
                 count(*) as qtd, sum(venda) as soma
          from comercial where venda > 0 group by 1,2
        ) f) x), '[]'::jsonb),
    'alertas', jsonb_build_object(
      'margem_negativa', (select count(*) from comercial where custo > 0 and venda > 0 and venda < custo),
      'referencias_repetidas', (select count(*) from (
          select reference_code from base where reference_code is not null
          group by 1 having count(*) > 1) d),
      'publicados_sem_preco', (select count(*) from products
          where status = 'publicado' and coalesce(price_cents,0) = 0)
    )
  ) into r;

  return r;
end $function$;

REVOKE EXECUTE ON FUNCTION public.catalog_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.catalog_overview() TO authenticated;