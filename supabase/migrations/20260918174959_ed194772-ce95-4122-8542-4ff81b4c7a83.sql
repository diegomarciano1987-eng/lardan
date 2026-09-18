-- 1. Colunas novas
alter table public.products
  add column if not exists barcode text,
  add column if not exists reference_code text,
  add column if not exists ncm text;

alter table public.product_variants
  add column if not exists reference_code text,
  add column if not exists ncm text;

-- 2. Validações
alter table public.products
  add constraint products_ncm_ck check (ncm is null or ncm ~ '^[0-9]{8}$'),
  add constraint products_reference_code_ck check (reference_code is null or length(reference_code) between 1 and 40),
  add constraint products_barcode_ck check (barcode is null or barcode ~ '^[0-9A-Za-z._-]{4,60}$');

alter table public.product_variants
  add constraint product_variants_ncm_ck check (ncm is null or ncm ~ '^[0-9]{8}$'),
  add constraint product_variants_reference_code_ck check (reference_code is null or length(reference_code) between 1 and 40);

-- 3. Unicidade (somente quando informado)
create unique index if not exists products_barcode_uq on public.products (barcode) where barcode is not null;
create unique index if not exists products_reference_uq on public.products (upper(reference_code)) where reference_code is not null;
create unique index if not exists product_variants_reference_uq on public.product_variants (upper(reference_code)) where reference_code is not null;

-- 4. Gravação do produto: novos campos + propagação do código de barras para a variante única
create or replace function public.product_save(_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _p products%rowtype;
  _nome text := btrim(coalesce(_payload->>'name',''));
  _slug text := btrim(coalesce(_payload->>'slug',''));
  _cat uuid := nullif(_payload->>'category_id','')::uuid;
  _sub uuid := nullif(_payload->>'subcategory_id','')::uuid;
  _bar text := nullif(btrim(coalesce(_payload->>'barcode','')),'');
  _ref text := nullif(btrim(coalesce(_payload->>'reference_code','')),'');
  _ncm text := nullif(regexp_replace(coalesce(_payload->>'ncm',''), '\D', '', 'g'),'');
  _conflito text;
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

  if _ncm is not null and length(_ncm) <> 8 then
    raise exception 'NCM deve ter 8 dígitos (exemplo: 71171900).' using errcode = '23514';
  end if;

  if _sub is not null and _cat is not null and not exists (
    select 1 from categories s where s.id = _sub and s.parent_id = _cat
  ) then
    raise exception 'A subcategoria escolhida não pertence à categoria selecionada.' using errcode = '23514';
  end if;

  -- código de barras não pode colidir com outro produto nem com variante de outro produto
  if _bar is not null then
    select p.name into _conflito from products p
     where p.barcode = _bar and (_id is null or p.id <> _id) limit 1;
    if _conflito is not null then
      raise exception 'Código de barras % já está em uso pelo produto %.', _bar, _conflito using errcode = '23505';
    end if;
    select p.name || ' — ' || v.label into _conflito
      from product_variants v join products p on p.id = v.product_id
     where v.barcode = _bar and (_id is null or v.product_id <> _id) limit 1;
    if _conflito is not null then
      raise exception 'Código de barras % já está em uso por %.', _bar, _conflito using errcode = '23505';
    end if;
  end if;

  if _ref is not null then
    select p.name into _conflito from products p
     where upper(p.reference_code) = upper(_ref) and (_id is null or p.id <> _id) limit 1;
    if _conflito is not null then
      raise exception 'Código de referência % já está em uso pelo produto %.', _ref, _conflito using errcode = '23505';
    end if;
  end if;

  if _slug = '' then
    _slug := left(regexp_replace(lower(translate(_nome,
      'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', '-', 'g'), 80);
    _slug := btrim(_slug, '-');
  end if;
  if _slug = '' then _slug := 'produto-' || substr(md5(random()::text),1,8); end if;

  if _novo then
    _code := public.product_next_internal_code(_cat);
    while exists (select 1 from products where slug = _slug) loop
      _slug := left(_slug, 70) || '-' || substr(md5(random()::text),1,5);
    end loop;
    insert into products (name, slug, internal_code, legacy_code, barcode, reference_code, ncm,
      category_id, subcategory_id,
      collection_id, short_description, description, material, raw_material, raw_weight_grams,
      raw_supplier_id, raw_piece_cost_cents, cost_price_cents, markup_percent, measurements, care_instructions, warranty_text,
      price_cents, price_is_public, seo_title, seo_description, is_featured, status,
      requires_catalog_review, is_legacy, created_by)
    values (_nome, _slug, _code, nullif(_payload->>'legacy_code',''), _bar, _ref, _ncm, _cat, _sub,
      nullif(_payload->>'collection_id','')::uuid,
      nullif(_payload->>'short_description',''), nullif(_payload->>'description',''),
      nullif(_payload->>'raw_material',''), nullif(_payload->>'raw_material',''),
      nullif(_payload->>'raw_weight_grams','')::numeric,
      nullif(_payload->>'raw_supplier_id','')::uuid,
      nullif(_payload->>'raw_piece_cost_cents','')::integer, nullif(_payload->>'cost_price_cents','')::integer,
      nullif(_payload->>'markup_percent','')::numeric,
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
      barcode = case when _payload ? 'barcode' then _bar else barcode end,
      reference_code = case when _payload ? 'reference_code' then _ref else reference_code end,
      ncm = case when _payload ? 'ncm' then _ncm else ncm end,
      category_id = _cat,
      subcategory_id = _sub,
      collection_id = nullif(_payload->>'collection_id','')::uuid,
      short_description = nullif(_payload->>'short_description',''),
      description = nullif(_payload->>'description',''),
      raw_material = nullif(_payload->>'raw_material',''),
      material = coalesce(nullif(_payload->>'raw_material',''), material),
      raw_weight_grams = nullif(_payload->>'raw_weight_grams','')::numeric,
      raw_supplier_id = nullif(_payload->>'raw_supplier_id','')::uuid,
      raw_piece_cost_cents = case when _payload ? 'raw_piece_cost_cents'
        then nullif(_payload->>'raw_piece_cost_cents','')::integer else raw_piece_cost_cents end,
      cost_price_cents = case when _payload ? 'cost_price_cents'
        then nullif(_payload->>'cost_price_cents','')::integer else cost_price_cents end,
      markup_percent = case when _payload ? 'markup_percent'
        then nullif(_payload->>'markup_percent','')::numeric else markup_percent end,
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
    values (auth.uid(),'catalogo.produto.salvar','products',_p.id::text,
      jsonb_build_object('rascunho', _p.status <> 'publicado'));
  end if;

  -- produto com uma única variante: o código de barras e o NCM valem também para ela
  if _p.barcode is not null and (select count(*) from product_variants v where v.product_id = _p.id) = 1 then
    update product_variants v set barcode = _p.barcode, updated_at = now()
     where v.product_id = _p.id and v.barcode is distinct from _p.barcode
       and not exists (select 1 from product_variants o where o.barcode = _p.barcode and o.id <> v.id);
  end if;

  return jsonb_build_object('id',_p.id,'internal_code',_p.internal_code,'slug',_p.slug,'status',_p.status,
    'barcode',_p.barcode,'reference_code',_p.reference_code,'ncm',_p.ncm);
end $function$;

-- 5. Variante: referência e NCM próprios
create or replace function public.variant_save(_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _v product_variants%rowtype;
  _pid uuid := nullif(_payload->>'product_id','')::uuid;
  _sku text := upper(btrim(coalesce(_payload->>'sku','')));
  _bar text := btrim(coalesce(_payload->>'barcode',''));
  _ref text := nullif(btrim(coalesce(_payload->>'reference_code','')),'');
  _ncm text := nullif(regexp_replace(coalesce(_payload->>'ncm',''), '\D', '', 'g'),'');
  _plat uuid := nullif(_payload->>'plating_type_id','')::uuid;
  _label text := btrim(coalesce(_payload->>'label',''));
  _conflito record;
  _tem_mov boolean := false;
  _prod products%rowtype;
  _token text; _size text := btrim(coalesce(_payload->>'size',''));
  _custo jsonb := case when jsonb_typeof(_payload->'custo') = 'object' then _payload->'custo' else null end;
  _rescusto jsonb := null;
begin
  if not public.has_capability(auth.uid(),'product.manage') then
    raise exception 'Somente o perfil Master pode criar ou editar variantes.' using errcode = '42501';
  end if;

  if _ncm is not null and length(_ncm) <> 8 then
    raise exception 'NCM deve ter 8 dígitos (exemplo: 71171900).' using errcode = '23514';
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
    if exists (select 1 from products p where p.barcode = _bar and p.id <> _pid) then
      raise exception 'Código de barras % já está em uso por outro produto.', _bar using errcode = '23505';
    end if;
  end if;

  if _ref is not null then
    select p.name as produto, v.label as variante into _conflito
      from product_variants v join products p on p.id = v.product_id
     where upper(v.reference_code) = upper(_ref) and (_id is null or v.id <> _id) limit 1;
    if found then
      raise exception 'Código de referência % já está em uso por % — %.', _ref, _conflito.produto, _conflito.variante
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
    insert into product_variants (product_id, label, sku, barcode, reference_code, ncm, legacy_code, size, color,
      price_cents, position, is_default, is_active, plating_type_id, plating_supplier_id,
      plating_material_cost_cents, varnish_name, varnish_cost_cents, finished_piece_cost_cents,
      final_weight_grams)
    values (_pid, _label, _sku, nullif(_bar,''), _ref, _ncm, nullif(_payload->>'legacy_code',''),
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
      reference_code = case when _payload ? 'reference_code' then _ref else reference_code end,
      ncm = case when _payload ? 'ncm' then _ncm else ncm end,
      legacy_code = nullif(_payload->>'legacy_code',''),
      size = nullif(_size,''), color = nullif(_payload->>'color',''),
      price_cents = nullif(_payload->>'price_cents','')::integer,
      position = coalesce((_payload->>'position')::integer, position),
      is_default = coalesce((_payload->>'is_default')::boolean, is_default),
      is_active = coalesce((_payload->>'is_active')::boolean, is_active),
      plating_type_id = coalesce(_plat, plating_type_id),
      plating_supplier_id = case when _payload ? 'plating_supplier_id'
        then nullif(_payload->>'plating_supplier_id','')::uuid else plating_supplier_id end,
      plating_material_cost_cents = case when _payload ? 'plating_material_cost_cents'
        then nullif(_payload->>'plating_material_cost_cents','')::integer else plating_material_cost_cents end,
      varnish_name = case when _payload ? 'varnish_name'
        then nullif(_payload->>'varnish_name','') else varnish_name end,
      varnish_cost_cents = case when _payload ? 'varnish_cost_cents'
        then nullif(_payload->>'varnish_cost_cents','')::integer else varnish_cost_cents end,
      finished_piece_cost_cents = case when _payload ? 'finished_piece_cost_cents'
        then nullif(_payload->>'finished_piece_cost_cents','')::integer else finished_piece_cost_cents end,
      final_weight_grams = nullif(_payload->>'final_weight_grams','')::numeric,
      updated_at = now()
    where id = _id returning * into _v;
  end if;

  if _custo is not null then
    _rescusto := public.variant_cost_apply(_v.id, _custo);
    select * into _v from product_variants where id = _v.id;
  end if;

  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), case when _id is null then 'catalogo.variante.criar' else 'catalogo.variante.salvar' end,
          'product_variants', _v.id::text,
          jsonb_build_object('sku',_v.sku,'barcode',_v.barcode,'referencia',_v.reference_code,'ncm',_v.ncm,
            'justificativa', nullif(_payload->>'sku_justificativa',''),
            'custo', _rescusto));

  return jsonb_build_object('id',_v.id,'sku',_v.sku,'label',_v.label,'barcode',_v.barcode,
    'reference_code',_v.reference_code,'ncm',_v.ncm,'custo',_rescusto);
end $function$;

-- 6. Leitor: encontra por código de barras, referência, SKU ou código interno
create or replace function public.barcode_lookup(_code text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select jsonb_build_object(
      'encontrado', true,
      'product_id', p.id, 'produto', p.name, 'produto_status', p.status,
      'variant_id', v.id, 'variante', v.label, 'sku', v.sku,
      'barcode', coalesce(v.barcode, p.barcode),
      'reference_code', coalesce(v.reference_code, p.reference_code),
      'ncm', coalesce(v.ncm, p.ncm))
     from product_variants v join products p on p.id = v.product_id
     where public.has_capability(auth.uid(),'catalog.view')
       and (v.barcode = btrim(_code)
            or p.barcode = btrim(_code)
            or upper(v.reference_code) = upper(btrim(_code))
            or upper(p.reference_code) = upper(btrim(_code))
            or upper(v.sku) = upper(btrim(_code))
            or upper(p.internal_code) = upper(btrim(_code)))
     order by (v.barcode = btrim(_code)) desc, v.is_default desc
     limit 1),
    jsonb_build_object('encontrado', false));
$function$;

revoke execute on function public.barcode_lookup(text) from anon;