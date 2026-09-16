
alter table public.products
  add column if not exists cost_price_cents integer,
  add column if not exists markup_percent numeric(6,2);

comment on column public.products.cost_price_cents is 'Preço de custo total da peça (centavos). Obrigatório para publicar.';
comment on column public.products.markup_percent is 'Margem individual em %, sobrepõe a margem global do catálogo.';

insert into public.site_settings (key, value, is_public)
values ('catalogo.markup', jsonb_build_object('percent', 0), false)
on conflict (key) do nothing;

create or replace function public.catalog_markup_get()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((value->>'percent')::numeric, 0)
  from public.site_settings where key = 'catalogo.markup';
$$;

create or replace function public.catalog_markup_set(_percent numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare _v numeric := round(coalesce(_percent,0)::numeric, 2);
begin
  if not public.has_capability(auth.uid(),'product.manage') then
    raise exception 'Somente o perfil Master pode alterar a margem padrão.' using errcode = '42501';
  end if;
  if _v < 0 or _v > 10000 then
    raise exception 'Informe uma margem entre 0%% e 10000%%.' using errcode = '23514';
  end if;
  insert into public.site_settings (key, value, is_public, updated_by, updated_at)
  values ('catalogo.markup', jsonb_build_object('percent', _v), false, auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value, updated_by = auth.uid(), updated_at = now();
  insert into public.audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'catalogo.markup.alterar','site_settings','catalogo.markup',
          jsonb_build_object('percent', _v));
  return _v;
end $$;

revoke all on function public.catalog_markup_get() from public, anon;
revoke all on function public.catalog_markup_set(numeric) from public, anon;
grant execute on function public.catalog_markup_get() to authenticated;
grant execute on function public.catalog_markup_set(numeric) to authenticated;

create or replace function public.product_publish_blockers(_id uuid)
 returns text[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select array_remove(ARRAY[
    case when btrim(coalesce(p.name,'')) = '' then 'nome' end,
    case when btrim(coalesce(p.slug,'')) = '' then 'slug' end,
    case when btrim(coalesce(p.internal_code,'')) = '' then 'codigo_interno' end,
    case when exists (select 1 from products o where o.slug = p.slug and o.id <> p.id) then 'slug_duplicado' end,
    case when p.category_id is null then 'categoria' end,
    case when p.category_id is not null and not exists (
      select 1 from categories c where c.id = p.category_id and c.status = 'publicado'
    ) then 'categoria_nao_publicada' end,
    case when p.subcategory_id is null and exists (
      select 1 from categories s where s.parent_id = p.category_id and s.status = 'publicado'
    ) then 'subcategoria' end,
    case when p.subcategory_id is not null and not exists (
      select 1 from categories s where s.id = p.subcategory_id and s.parent_id = p.category_id
        and s.status = 'publicado'
    ) then 'subcategoria_invalida' end,
    case when btrim(coalesce(p.raw_material,'')) = '' then 'material_bruto' end,
    case when coalesce(p.raw_weight_grams,0) <= 0 then 'peso_bruto' end,
    case when p.raw_supplier_id is null then 'fornecedor_bruto' end,
    case when coalesce(p.raw_piece_cost_cents,0) <= 0 then 'custo_bruto' end,
    case when coalesce(p.cost_price_cents,0) <= 0 then 'preco_custo' end,
    case when btrim(coalesce(p.measurements,'')) = '' then 'medidas' end,
    case when btrim(coalesce(p.short_description,'')) = '' then 'resumo' end,
    case when btrim(coalesce(p.description,'')) = '' then 'descricao' end,
    case when btrim(coalesce(p.care_instructions,'')) = '' then 'cuidados' end,
    case when btrim(coalesce(p.warranty_text,'')) = '' then 'garantia' end,
    case when btrim(coalesce(p.seo_title,'')) = '' then 'seo_titulo' end,
    case when btrim(coalesce(p.seo_description,'')) = '' then 'seo_descricao' end,
    case when not exists (
      select 1 from product_media pm join media_assets ma on ma.id = pm.media_id
       where pm.product_id = p.id and coalesce(ma.is_archived,false) = false
    ) then 'imagem' end,
    case when exists (
      select 1 from product_media pm join media_assets ma on ma.id = pm.media_id
       where pm.product_id = p.id and coalesce(ma.is_archived,false) = false
         and btrim(coalesce(ma.alt,'')) = ''
    ) then 'texto_alternativo' end,
    case when p.price_is_public and coalesce(p.price_cents,0) <= 0 then 'preco' end,
    case when not exists (
      select 1 from product_variants v where v.product_id = p.id and v.is_active
    ) then 'variante_ativa' end,
    case when exists (
      select 1 from product_variants v
       where v.product_id = p.id and v.is_active and (
         btrim(coalesce(v.label,'')) = ''
         or btrim(coalesce(v.sku,'')) = ''
         or btrim(coalesce(v.barcode,'')) = ''
         or v.plating_type_id is null
         or v.plating_supplier_id is null
         or coalesce(v.plating_material_cost_cents,0) <= 0
         or btrim(coalesce(v.varnish_name,'')) = ''
         or coalesce(v.varnish_cost_cents,0) <= 0
         or coalesce(v.finished_piece_cost_cents,0) <= 0
         or (p.price_is_public and coalesce(v.price_cents, p.price_cents, 0) <= 0)
       )
    ) then 'variante_incompleta' end
  ], NULL)
  from products p where p.id = _id;
$function$;

create or replace function public.product_publish_checklist(_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with b as (select unnest(public.product_publish_blockers(_id)) as codigo),
  m(codigo, grupo, rotulo) as (values
    ('nome','Identificação','Nome do produto'),
    ('slug','Identificação','Endereço da página'),
    ('slug_duplicado','Identificação','Endereço já usado por outra peça'),
    ('codigo_interno','Identificação','Código interno'),
    ('categoria','Classificação','Categoria'),
    ('categoria_nao_publicada','Classificação','Categoria não está publicada'),
    ('subcategoria','Classificação','Subcategoria'),
    ('subcategoria_invalida','Classificação','Subcategoria não pertence à categoria'),
    ('material_bruto','Material bruto','Material bruto'),
    ('peso_bruto','Material bruto','Peso bruto'),
    ('fornecedor_bruto','Material bruto','Fornecedor do bruto'),
    ('custo_bruto','Material bruto','Valor da peça no bruto'),
    ('preco_custo','Custos','Preço de custo da peça'),
    ('medidas','Conteúdo','Medidas'),
    ('resumo','Conteúdo','Resumo'),
    ('descricao','Conteúdo','Descrição completa'),
    ('cuidados','Conteúdo','Cuidados'),
    ('garantia','Conteúdo','Garantia'),
    ('seo_titulo','SEO','Título para buscadores'),
    ('seo_descricao','SEO','Descrição para buscadores'),
    ('imagem','Imagens','Pelo menos uma imagem'),
    ('texto_alternativo','Imagens','Descrição (texto alternativo) em todas as imagens'),
    ('preco','Custos','Preço de venda'),
    ('variante_ativa','Variantes','Pelo menos uma variante ativa'),
    ('variante_incompleta','Variantes','Variante ativa com dados faltando (SKU, barcode, banho, fornecedor, verniz, custos)')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'codigo', b.codigo,
      'grupo', coalesce(m.grupo,'Outros'),
      'rotulo', coalesce(m.rotulo, b.codigo))
    order by coalesce(m.grupo,'Outros')), '[]'::jsonb)
  from b left join m on m.codigo = b.codigo;
$function$;
