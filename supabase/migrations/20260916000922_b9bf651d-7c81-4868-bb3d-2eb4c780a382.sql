-- ============ 1. CAPACIDADES ============
insert into public.role_capabilities(role, capability) values
  ('master','product.manage'), ('master','product.publish')
on conflict do nothing;

-- ============ 2. TIPOS DE BANHO ============
create table if not exists public.plating_types (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sku_token text not null,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists plating_types_code_key on public.plating_types (upper(code));
create unique index if not exists plating_types_name_key on public.plating_types (upper(name));
grant select on public.plating_types to authenticated, anon;
grant insert, update, delete on public.plating_types to authenticated;
grant all on public.plating_types to service_role;
alter table public.plating_types enable row level security;
drop policy if exists plating_types_read on public.plating_types;
create policy plating_types_read on public.plating_types for select using (true);
drop policy if exists plating_types_manage on public.plating_types;
create policy plating_types_manage on public.plating_types for all to authenticated
  using (public.has_capability(auth.uid(),'product.manage'))
  with check (public.has_capability(auth.uid(),'product.manage'));

insert into public.plating_types (code, name, sku_token, position) values
  ('ouro','Ouro','OURO',1),
  ('prata','Prata','PRATA',2),
  ('rodio_branco','Ródio Branco','RODIO',3)
on conflict do nothing;

-- ============ 3. ABREVIAÇÃO DA CATEGORIA + CONTADOR DE CÓDIGO ============
alter table public.categories add column if not exists code_abbrev text;
update public.categories c
   set code_abbrev = left(regexp_replace(translate(upper(c.name),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC'), '[^A-Z]', '', 'g'), 3)
 where c.code_abbrev is null and c.parent_id is null;
create unique index if not exists categories_code_abbrev_key
  on public.categories (upper(code_abbrev)) where code_abbrev is not null;

create table if not exists public.product_code_counters (
  prefix text primary key,
  last_value bigint not null default 0,
  updated_at timestamptz not null default now()
);
grant all on public.product_code_counters to service_role;
alter table public.product_code_counters enable row level security;

-- ============ 4. CAMPOS DO PRODUTO-BASE ============
alter table public.products
  add column if not exists internal_code text,
  add column if not exists subcategory_id uuid references public.categories(id),
  add column if not exists raw_material text,
  add column if not exists raw_weight_grams numeric(10,3),
  add column if not exists raw_supplier_id uuid references public.suppliers(id),
  add column if not exists raw_piece_cost_cents integer,
  add column if not exists requires_catalog_review boolean not null default false,
  add column if not exists is_legacy boolean not null default false,
  add column if not exists catalog_defaults_version integer;

create unique index if not exists products_internal_code_key
  on public.products (upper(internal_code)) where internal_code is not null;
create index if not exists products_subcategory_idx on public.products (subcategory_id);

alter table public.products drop constraint if exists products_raw_weight_positive;
alter table public.products add constraint products_raw_weight_positive
  check (raw_weight_grams is null or raw_weight_grams > 0);
alter table public.products drop constraint if exists products_raw_cost_nonneg;
alter table public.products add constraint products_raw_cost_nonneg
  check (raw_piece_cost_cents is null or raw_piece_cost_cents >= 0);

-- ============ 5. CAMPOS DA VARIANTE ============
alter table public.product_variants
  add column if not exists plating_type_id uuid references public.plating_types(id),
  add column if not exists plating_supplier_id uuid references public.suppliers(id),
  add column if not exists plating_material_cost_cents integer,
  add column if not exists varnish_name text,
  add column if not exists varnish_cost_cents integer,
  add column if not exists finished_piece_cost_cents integer,
  add column if not exists final_weight_grams numeric(10,3);

alter table public.product_variants drop constraint if exists variants_costs_nonneg;
alter table public.product_variants add constraint variants_costs_nonneg check (
  coalesce(plating_material_cost_cents,0) >= 0
  and coalesce(varnish_cost_cents,0) >= 0
  and coalesce(finished_piece_cost_cents,0) >= 0
  and (final_weight_grams is null or final_weight_grams > 0)
);

-- ============ 6. HISTÓRICO DE CUSTOS (evolui variant_costs) ============
alter table public.variant_costs
  add column if not exists raw_supplier_id uuid references public.suppliers(id),
  add column if not exists raw_piece_cost_cents integer,
  add column if not exists plating_supplier_id uuid references public.suppliers(id),
  add column if not exists plating_material_cost_cents integer,
  add column if not exists varnish_name text,
  add column if not exists varnish_cost_cents integer,
  add column if not exists finished_piece_cost_cents integer,
  add column if not exists components_total_cents integer,
  add column if not exists justification text;

-- ============ 7. HISTÓRICO DE ENDEREÇOS ============
create table if not exists public.product_slug_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  old_slug text not null,
  new_slug text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists product_slug_history_old_key on public.product_slug_history (old_slug);
grant select on public.product_slug_history to authenticated, anon;
grant all on public.product_slug_history to service_role;
alter table public.product_slug_history enable row level security;
drop policy if exists product_slug_history_read on public.product_slug_history;
create policy product_slug_history_read on public.product_slug_history for select using (true);

-- ============ 8. PADRÕES DO CADASTRO DE PRODUTO ============
create table if not exists public.catalog_defaults (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  care_instructions text,
  warranty_text text,
  seo_title_template text,
  seo_description_template text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists catalog_defaults_version_key on public.catalog_defaults (version);
grant select on public.catalog_defaults to authenticated;
grant insert, update on public.catalog_defaults to authenticated;
grant all on public.catalog_defaults to service_role;
alter table public.catalog_defaults enable row level security;
drop policy if exists catalog_defaults_read on public.catalog_defaults;
create policy catalog_defaults_read on public.catalog_defaults for select to authenticated
  using (public.has_capability(auth.uid(),'catalog.view'));
drop policy if exists catalog_defaults_manage on public.catalog_defaults;
create policy catalog_defaults_manage on public.catalog_defaults for all to authenticated
  using (public.has_capability(auth.uid(),'product.manage'))
  with check (public.has_capability(auth.uid(),'product.manage'));

-- ============ 9. PERMISSÃO: SOMENTE MASTER EDITA PRODUTO ============
drop policy if exists products_manage on public.products;
create policy products_manage on public.products for all to authenticated
  using (public.has_capability(auth.uid(),'product.manage'))
  with check (public.has_capability(auth.uid(),'product.manage'));

drop policy if exists variants_manage on public.product_variants;
create policy variants_manage on public.product_variants for all to authenticated
  using (public.has_capability(auth.uid(),'product.manage'))
  with check (public.has_capability(auth.uid(),'product.manage'));

drop policy if exists product_media_manage on public.product_media;
create policy product_media_manage on public.product_media for all to authenticated
  using (public.has_capability(auth.uid(),'product.manage'))
  with check (public.has_capability(auth.uid(),'product.manage'));

drop policy if exists variant_costs_manage on public.variant_costs;
create policy variant_costs_manage on public.variant_costs for all to authenticated
  using (public.has_capability(auth.uid(),'product.manage') and public.can_view_costs(auth.uid()))
  with check (public.has_capability(auth.uid(),'product.manage') and public.can_view_costs(auth.uid()));

-- ============ 10. CÓDIGO INTERNO ============
create or replace function public.product_next_internal_code(_category_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _pref text; _n bigint; _code text;
begin
  select upper(coalesce(nullif(btrim(c.code_abbrev),''),
         left(regexp_replace(translate(upper(c.name),
           'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC'), '[^A-Z]', '', 'g'), 3)))
    into _pref
    from categories c where c.id = _category_id;
  _pref := coalesce(nullif(_pref,''), 'GER');

  insert into product_code_counters(prefix) values (_pref) on conflict (prefix) do nothing;

  loop
    update product_code_counters
       set last_value = last_value + 1, updated_at = now()
     where prefix = _pref
    returning last_value into _n;
    _code := 'LAR-' || _pref || '-' || lpad(_n::text, 6, '0');
    exit when not exists (select 1 from products p where upper(p.internal_code) = _code);
  end loop;
  return _code;
end $$;

-- ============ 11. CONSULTA DE CÓDIGO DE BARRAS ============
create or replace function public.barcode_lookup(_code text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_build_object(
    'encontrado', true,
    'product_id', p.id, 'produto', p.name, 'produto_status', p.status,
    'variant_id', v.id, 'variante', v.label, 'sku', v.sku, 'barcode', v.barcode),
    jsonb_build_object('encontrado', false))
  from product_variants v join products p on p.id = v.product_id
  where v.barcode = btrim(_code)
    and public.has_capability(auth.uid(),'catalog.view')
  limit 1;
$$;

-- ============ 12. CHECKLIST DE PUBLICAÇÃO ============
create or replace function public.product_publish_blockers(_id uuid)
returns text[] language sql stable security definer set search_path to 'public' as $$
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
$$;

create or replace function public.product_publish_checklist(_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
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
$$;

-- ============ 13. PUBLICAÇÃO SOMENTE PELO MASTER ============
create or replace function public.publish_products(_ids uuid[], _note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  _alvos uuid[] := coalesce(_ids, ARRAY[]::uuid[]);
  _bloqueados jsonb := '[]'::jsonb;
  _aptos uuid[];
  _afetados integer := 0;
begin
  if not public.has_capability(auth.uid(),'product.publish') then
    raise exception 'Sem permissão para publicar produtos.' using errcode = '42501';
  end if;
  if cardinality(_alvos) = 0 then
    return jsonb_build_object('afetados',0,'rejeitados',0,'itens_rejeitados','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nome',p.name,'faltando',b.faltando,
            'detalhes', public.product_publish_checklist(p.id))), '[]'::jsonb)
    into _bloqueados
    from products p
    cross join lateral (select public.product_publish_blockers(p.id) as faltando) b
   where p.id = any(_alvos) and cardinality(b.faltando) > 0;

  _aptos := array(select p.id from products p
     where p.id = any(_alvos) and cardinality(public.product_publish_blockers(p.id)) = 0);

  if cardinality(_aptos) > 0 then
    perform set_config('lardan.publicacao','canonica',true);
    update products
       set status = 'publicado',
           published_at = coalesce(published_at, now()),
           scheduled_publish_at = null,
           requires_catalog_review = false,
           updated_at = now()
     where id = any(_aptos);
    get diagnostics _afetados = row_count;
    perform set_config('lardan.publicacao','',true);

    insert into audit_logs (actor_id, action, entity, entity_id, payload)
    select auth.uid(), 'catalogo.publicar', 'products', pid::text, jsonb_build_object('motivo',_note)
      from unnest(_aptos) as pid;
  end if;

  return jsonb_build_object('afetados',_afetados,
    'rejeitados', jsonb_array_length(_bloqueados), 'itens_rejeitados', _bloqueados);
end $$;

-- ============ 14. SALVAR PRODUTO (rascunho e edição) ============
create or replace function public.product_save(_id uuid, _payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  _p products%rowtype;
  _nome text := btrim(coalesce(_payload->>'name',''));
  _slug text := btrim(coalesce(_payload->>'slug',''));
  _cat uuid := nullif(_payload->>'category_id','')::uuid;
  _sub uuid := nullif(_payload->>'subcategory_id','')::uuid;
  _code text;
  _novo boolean := _id is null;
begin
  if not public.has_capability(auth.uid(),'product.manage') then
    raise exception 'Somente o perfil Master pode criar ou editar produtos.' using errcode = '42501';
  end if;
  if _nome = '' and btrim(coalesce(_payload->>'legacy_code','')) = '' then
    raise exception 'Informe ao menos um nome provisório ou um código identificador.' using errcode = '23514';
  end if;
  if _nome = '' then _nome := 'Sem nome — ' || btrim(_payload->>'legacy_code'); end if;

  if _sub is not null and _cat is not null and not exists (
    select 1 from categories s where s.id = _sub and s.parent_id = _cat
  ) then
    raise exception 'A subcategoria escolhida não pertence à categoria selecionada.' using errcode = '23514';
  end if;

  if _slug = '' then
    _slug := left(regexp_replace(lower(translate(_nome,
      'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', '-', 'g'), 80);
    _slug := btrim(_slug, '-');
  end if;

  if _novo then
    _code := public.product_next_internal_code(_cat);
    while exists (select 1 from products where slug = _slug) loop
      _slug := left(_slug, 70) || '-' || substr(md5(random()::text),1,5);
    end loop;
    insert into products (name, slug, internal_code, legacy_code, category_id, subcategory_id,
      collection_id, short_description, description, material, raw_material, raw_weight_grams,
      raw_supplier_id, raw_piece_cost_cents, measurements, care_instructions, warranty_text,
      price_cents, price_is_public, seo_title, seo_description, is_featured, status,
      requires_catalog_review, is_legacy, created_by)
    values (_nome, _slug, _code, nullif(_payload->>'legacy_code',''), _cat, _sub,
      nullif(_payload->>'collection_id','')::uuid,
      nullif(_payload->>'short_description',''), nullif(_payload->>'description',''),
      nullif(_payload->>'raw_material',''), nullif(_payload->>'raw_material',''),
      nullif(_payload->>'raw_weight_grams','')::numeric,
      nullif(_payload->>'raw_supplier_id','')::uuid,
      nullif(_payload->>'raw_piece_cost_cents','')::integer,
      nullif(_payload->>'measurements',''), nullif(_payload->>'care_instructions',''),
      nullif(_payload->>'warranty_text',''), nullif(_payload->>'price_cents','')::integer,
      coalesce((_payload->>'price_is_public')::boolean, true),
      nullif(_payload->>'seo_title',''), nullif(_payload->>'seo_description',''),
      coalesce((_payload->>'is_featured')::boolean, false), 'rascunho', false, false, auth.uid())
    returning * into _p;

    insert into audit_logs (actor_id, action, entity, entity_id, payload)
    values (auth.uid(),'catalogo.produto.criar','products',_p.id::text,
      jsonb_build_object('codigo_interno',_p.internal_code));
  else
    select * into _p from products where id = _id;
    if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;

    if _p.status = 'publicado' and _slug is distinct from _p.slug then
      insert into product_slug_history (product_id, old_slug, new_slug, created_by)
      values (_p.id, _p.slug, _slug, auth.uid())
      on conflict (old_slug) do nothing;
    end if;

    update products set
      name = _nome,
      slug = _slug,
      legacy_code = nullif(_payload->>'legacy_code',''),
      category_id = _cat,
      subcategory_id = _sub,
      collection_id = nullif(_payload->>'collection_id','')::uuid,
      short_description = nullif(_payload->>'short_description',''),
      description = nullif(_payload->>'description',''),
      raw_material = nullif(_payload->>'raw_material',''),
      material = coalesce(nullif(_payload->>'raw_material',''), material),
      raw_weight_grams = nullif(_payload->>'raw_weight_grams','')::numeric,
      raw_supplier_id = nullif(_payload->>'raw_supplier_id','')::uuid,
      raw_piece_cost_cents = nullif(_payload->>'raw_piece_cost_cents','')::integer,
      measurements = nullif(_payload->>'measurements',''),
      care_instructions = nullif(_payload->>'care_instructions',''),
      warranty_text = nullif(_payload->>'warranty_text',''),
      price_cents = nullif(_payload->>'price_cents','')::integer,
      price_is_public = coalesce((_payload->>'price_is_public')::boolean, price_is_public),
      seo_title = nullif(_payload->>'seo_title',''),
      seo_description = nullif(_payload->>'seo_description',''),
      is_featured = coalesce((_payload->>'is_featured')::boolean, is_featured),
      internal_code = coalesce(internal_code, public.product_next_internal_code(_cat)),
      updated_at = now()
    where id = _id returning * into _p;

    insert into audit_logs (actor_id, action, entity, entity_id, payload)
    values (auth.uid(),'catalogo.produto.salvar','products',_p.id::text, jsonb_build_object('rascunho', _p.status <> 'publicado'));
  end if;

  return jsonb_build_object('id',_p.id,'internal_code',_p.internal_code,'slug',_p.slug,'status',_p.status);
end $$;

-- ============ 15. SALVAR VARIANTE ============
create or replace function public.variant_save(_id uuid, _payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  _v product_variants%rowtype;
  _pid uuid := nullif(_payload->>'product_id','')::uuid;
  _sku text := upper(btrim(coalesce(_payload->>'sku','')));
  _bar text := btrim(coalesce(_payload->>'barcode',''));
  _plat uuid := nullif(_payload->>'plating_type_id','')::uuid;
  _label text := btrim(coalesce(_payload->>'label',''));
  _conflito record;
  _tem_mov boolean := false;
  _prod products%rowtype;
  _token text; _size text := btrim(coalesce(_payload->>'size',''));
begin
  if not public.has_capability(auth.uid(),'product.manage') then
    raise exception 'Somente o perfil Master pode criar ou editar variantes.' using errcode = '42501';
  end if;

  if _id is not null then
    select * into _v from product_variants where id = _id;
    if not found then raise exception 'Variante não encontrada.' using errcode = 'P0002'; end if;
    _pid := _v.product_id;
  end if;
  select * into _prod from products where id = _pid;
  if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;

  select upper(sku_token) into _token from plating_types where id = _plat;

  if _label = '' then
    _label := _prod.name || coalesce(' — ' || (select name from plating_types where id = _plat), '')
                         || coalesce(' — ' || nullif(_size,''), '');
  end if;
  if _sku = '' and _prod.internal_code is not null then
    _sku := _prod.internal_code || coalesce('-' || _token,'') || coalesce('-' || upper(nullif(_size,'')),'');
  end if;
  _sku := regexp_replace(_sku, '[^A-Z0-9\-]', '', 'g');
  if _sku = '' then _sku := null; end if;

  if _bar <> '' then
    select p.name as produto, v.label as variante into _conflito
      from product_variants v join products p on p.id = v.product_id
     where v.barcode = _bar and (_id is null or v.id <> _id) limit 1;
    if found then
      raise exception 'Código de barras % já está em uso por % — %.', _bar, _conflito.produto, _conflito.variante
        using errcode = '23505';
    end if;
  end if;

  if _sku is not null then
    select p.name as produto, v.label as variante into _conflito
      from product_variants v join products p on p.id = v.product_id
     where upper(v.sku) = _sku and (_id is null or v.id <> _id) limit 1;
    if found then
      raise exception 'SKU % já está em uso por % — %.', _sku, _conflito.produto, _conflito.variante
        using errcode = '23505';
    end if;
  end if;

  if _id is not null and _v.sku is distinct from _sku then
    select exists (select 1 from stock_movements m where m.variant_id = _id) into _tem_mov;
    if _tem_mov and btrim(coalesce(_payload->>'sku_justificativa','')) = '' then
      raise exception 'Esta variante já tem movimentação de estoque. Para alterar o SKU informe uma justificativa.'
        using errcode = '23514';
    end if;
  end if;

  if _id is null then
    insert into product_variants (product_id, label, sku, barcode, legacy_code, size, color,
      price_cents, position, is_default, is_active, plating_type_id, plating_supplier_id,
      plating_material_cost_cents, varnish_name, varnish_cost_cents, finished_piece_cost_cents,
      final_weight_grams)
    values (_pid, _label, _sku, nullif(_bar,''), nullif(_payload->>'legacy_code',''),
      nullif(_size,''), nullif(_payload->>'color',''),
      nullif(_payload->>'price_cents','')::integer,
      coalesce((_payload->>'position')::integer,0),
      coalesce((_payload->>'is_default')::boolean,false),
      coalesce((_payload->>'is_active')::boolean,true),
      _plat, nullif(_payload->>'plating_supplier_id','')::uuid,
      nullif(_payload->>'plating_material_cost_cents','')::integer,
      nullif(_payload->>'varnish_name',''),
      nullif(_payload->>'varnish_cost_cents','')::integer,
      nullif(_payload->>'finished_piece_cost_cents','')::integer,
      nullif(_payload->>'final_weight_grams','')::numeric)
    returning * into _v;
  else
    update product_variants set
      label = _label, sku = _sku, barcode = nullif(_bar,''),
      legacy_code = nullif(_payload->>'legacy_code',''),
      size = nullif(_size,''), color = nullif(_payload->>'color',''),
      price_cents = nullif(_payload->>'price_cents','')::integer,
      position = coalesce((_payload->>'position')::integer, position),
      is_default = coalesce((_payload->>'is_default')::boolean, is_default),
      is_active = coalesce((_payload->>'is_active')::boolean, is_active),
      plating_type_id = _plat,
      plating_supplier_id = nullif(_payload->>'plating_supplier_id','')::uuid,
      plating_material_cost_cents = nullif(_payload->>'plating_material_cost_cents','')::integer,
      varnish_name = nullif(_payload->>'varnish_name',''),
      varnish_cost_cents = nullif(_payload->>'varnish_cost_cents','')::integer,
      finished_piece_cost_cents = nullif(_payload->>'finished_piece_cost_cents','')::integer,
      final_weight_grams = nullif(_payload->>'final_weight_grams','')::numeric,
      updated_at = now()
    where id = _id returning * into _v;
  end if;

  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), case when _id is null then 'catalogo.variante.criar' else 'catalogo.variante.salvar' end,
          'product_variants', _v.id::text,
          jsonb_build_object('sku',_v.sku,'barcode',_v.barcode,
            'justificativa', nullif(_payload->>'sku_justificativa','')));

  return jsonb_build_object('id',_v.id,'sku',_v.sku,'label',_v.label,'barcode',_v.barcode);
end $$;

-- ============ 16. NOVA VIGÊNCIA DE CUSTO ============
create or replace function public.variant_cost_set(_variant_id uuid, _payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  _bruto integer := coalesce(nullif(_payload->>'raw_piece_cost_cents','')::integer, 0);
  _banho integer := coalesce(nullif(_payload->>'plating_material_cost_cents','')::integer, 0);
  _verniz integer := coalesce(nullif(_payload->>'varnish_cost_cents','')::integer, 0);
  _final integer := coalesce(nullif(_payload->>'finished_piece_cost_cents','')::integer, 0);
  _soma integer;
  _just text := btrim(coalesce(_payload->>'justification',''));
  _row variant_costs%rowtype;
begin
  if not (public.has_capability(auth.uid(),'product.manage') and public.can_view_costs(auth.uid())) then
    raise exception 'Sem permissão para alterar custos.' using errcode = '42501';
  end if;
  if _bruto < 0 or _banho < 0 or _verniz < 0 or _final < 0 then
    raise exception 'Custo não pode ser negativo.' using errcode = '23514';
  end if;
  _soma := _bruto + _banho + _verniz;
  if _final <> _soma and _just = '' then
    raise exception 'O valor final (%) é diferente da soma dos componentes (%). Informe uma justificativa.',
      _final, _soma using errcode = '23514';
  end if;

  insert into variant_costs (variant_id, supplier_id, cost_cents, effective_from, note,
    raw_supplier_id, raw_piece_cost_cents, plating_supplier_id, plating_material_cost_cents,
    varnish_name, varnish_cost_cents, finished_piece_cost_cents, components_total_cents,
    justification, created_by)
  values (_variant_id, nullif(_payload->>'plating_supplier_id','')::uuid, _final,
    coalesce(nullif(_payload->>'effective_from','')::date, current_date),
    nullif(_payload->>'note',''),
    nullif(_payload->>'raw_supplier_id','')::uuid, _bruto,
    nullif(_payload->>'plating_supplier_id','')::uuid, _banho,
    nullif(_payload->>'varnish_name',''), _verniz, _final, _soma,
    nullif(_just,''), auth.uid())
  returning * into _row;

  update product_variants set
    plating_material_cost_cents = _banho,
    varnish_cost_cents = _verniz,
    finished_piece_cost_cents = _final,
    varnish_name = coalesce(nullif(_payload->>'varnish_name',''), varnish_name),
    plating_supplier_id = coalesce(nullif(_payload->>'plating_supplier_id','')::uuid, plating_supplier_id),
    updated_at = now()
  where id = _variant_id;

  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'catalogo.custo.vigencia','variant_costs',_row.id::text,
    jsonb_build_object('variante',_variant_id,'final',_final,'componentes',_soma,'justificativa',nullif(_just,'')));

  return jsonb_build_object('id',_row.id,'final',_final,'componentes',_soma,'diferenca',_final - _soma);
end $$;

-- ============ 17. LEGADO: CÓDIGO INTERNO E MARCADOR DE REVISÃO ============
do $$
declare r record;
begin
  for r in select id, category_id from products where internal_code is null order by created_at loop
    update products set internal_code = public.product_next_internal_code(r.category_id) where id = r.id;
  end loop;
end $$;

update public.products p
   set is_legacy = true,
       requires_catalog_review = true
 where cardinality(public.product_publish_blockers(p.id)) > 0;

grant execute on function public.product_save(uuid, jsonb) to authenticated;
grant execute on function public.variant_save(uuid, jsonb) to authenticated;
grant execute on function public.variant_cost_set(uuid, jsonb) to authenticated;
grant execute on function public.barcode_lookup(text) to authenticated;
grant execute on function public.product_publish_checklist(uuid) to authenticated;
grant execute on function public.product_next_internal_code(uuid) to authenticated;