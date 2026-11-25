CREATE OR REPLACE FUNCTION public.variant_save(_id uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _auto boolean := false; _base text; _n int := 1;
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
  if _sku = '' and _id is not null and _v.sku is not null then
    _sku := upper(_v.sku);
  elsif _sku = '' and _prod.internal_code is not null then
    _sku := _prod.internal_code || coalesce('-' || _token,'') || coalesce('-' || upper(nullif(_size,'')),'');
    _auto := true;
  end if;
  _sku := regexp_replace(_sku, '[^A-Z0-9\-]', '', 'g');
  if _sku = '' then _sku := null; end if;
  if _auto and _sku is not null then
    _base := _sku;
    while exists (select 1 from product_variants v where upper(v.sku) = _sku and (_id is null or v.id <> _id)) loop
      _n := _n + 1;
      _sku := _base || '-' || _n;
    end loop;
  end if;

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