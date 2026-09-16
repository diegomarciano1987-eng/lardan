-- ============================================================
-- 1. Capacidades: somente Master cria/edita/publica produto
-- ============================================================
delete from public.role_capabilities
 where capability in ('product.manage','product.publish')
   and role <> 'master';

-- ============================================================
-- 2. Custos fora do alcance de leitura direta da API
-- ============================================================
do $$
declare c record;
begin
  revoke select on public.products from authenticated;
  revoke select on public.product_variants from authenticated;

  for c in
    select attname from pg_attribute
     where attrelid = 'public.products'::regclass and attnum > 0 and not attisdropped
       and attname not in ('raw_piece_cost_cents','cost_price_cents','markup_percent')
  loop
    execute format('grant select (%I) on public.products to authenticated', c.attname);
  end loop;

  for c in
    select attname from pg_attribute
     where attrelid = 'public.product_variants'::regclass and attnum > 0 and not attisdropped
       and attname not in ('plating_material_cost_cents','varnish_cost_cents','finished_piece_cost_cents')
  loop
    execute format('grant select (%I) on public.product_variants to authenticated', c.attname);
  end loop;
end $$;

-- leitura autorizada de custos (Master, Diretoria, Financeiro)
create or replace function public.product_costs_read(_product uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare _out jsonb;
begin
  if not public.can_view_costs(auth.uid()) then
    raise exception 'Seu perfil não tem permissão para consultar custos.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'produto', jsonb_build_object(
      'id', p.id,
      'raw_piece_cost_cents', p.raw_piece_cost_cents,
      'cost_price_cents', p.cost_price_cents,
      'markup_percent', p.markup_percent),
    'variantes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'plating_material_cost_cents', v.plating_material_cost_cents,
        'varnish_cost_cents', v.varnish_cost_cents,
        'finished_piece_cost_cents', v.finished_piece_cost_cents)
        order by v.position)
        from public.product_variants v where v.product_id = p.id), '[]'::jsonb)
  ) into _out
  from public.products p where p.id = _product;
  if _out is null then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;
  return _out;
end $function$;

revoke execute on function public.product_costs_read(uuid) from public, anon;
grant execute on function public.product_costs_read(uuid) to authenticated;

-- ============================================================
-- 3. Custo da variante: aplicação única, atômica e sem vigência repetida
-- ============================================================
create or replace function public.variant_cost_apply(_variant_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _bruto integer := coalesce(nullif(_payload->>'raw_piece_cost_cents','')::integer, 0);
  _banho integer := coalesce(nullif(_payload->>'plating_material_cost_cents','')::integer, 0);
  _verniz integer := coalesce(nullif(_payload->>'varnish_cost_cents','')::integer, 0);
  _final integer := coalesce(nullif(_payload->>'finished_piece_cost_cents','')::integer, 0);
  _soma integer;
  _just text := btrim(coalesce(_payload->>'justification',''));
  _row variant_costs%rowtype;
  _ult variant_costs%rowtype;
begin
  if not (public.has_capability(auth.uid(),'product.manage') and public.can_view_costs(auth.uid())) then
    raise exception 'Sem permissão para alterar custos.' using errcode = '42501';
  end if;
  if not exists (select 1 from product_variants where id = _variant_id) then
    raise exception 'Variante não encontrada.' using errcode = 'P0002';
  end if;
  if _bruto < 0 or _banho < 0 or _verniz < 0 or _final < 0 then
    raise exception 'Custo não pode ser negativo.' using errcode = '23514';
  end if;
  _soma := _bruto + _banho + _verniz;
  if _final <> _soma and _just = '' then
    raise exception 'O valor final (%) é diferente da soma dos componentes (%). Informe uma justificativa.',
      _final, _soma using errcode = '23514';
  end if;

  select * into _ult from variant_costs
   where variant_id = _variant_id
   order by effective_from desc, created_at desc limit 1;

  -- nada mudou: não cria nova vigência
  if found
     and coalesce(_ult.raw_piece_cost_cents,0) = _bruto
     and coalesce(_ult.plating_material_cost_cents,0) = _banho
     and coalesce(_ult.varnish_cost_cents,0) = _verniz
     and coalesce(_ult.finished_piece_cost_cents,0) = _final then
    return jsonb_build_object('id',_ult.id,'final',_final,'componentes',_soma,
      'diferenca',_final - _soma,'sem_alteracao',true);
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

  return jsonb_build_object('id',_row.id,'final',_final,'componentes',_soma,
    'diferenca',_final - _soma,'sem_alteracao',false);
end $function$;

revoke execute on function public.variant_cost_apply(uuid, jsonb) from public, anon;
grant execute on function public.variant_cost_apply(uuid, jsonb) to authenticated;

create or replace function public.variant_cost_set(_variant_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public.variant_cost_apply(_variant_id, _payload);
end $function$;

-- ============================================================
-- 4. variant_save: nunca apaga custo; grava custo na mesma transação
-- ============================================================
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
      plating_type_id = coalesce(_plat, plating_type_id),
      -- campos de custo só mudam quando vierem explicitamente no payload
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

  -- custo na mesma transação: se falhar, a gravação da variante também é desfeita
  if _custo is not null then
    _rescusto := public.variant_cost_apply(_v.id, _custo);
    select * into _v from product_variants where id = _v.id;
  end if;

  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), case when _id is null then 'catalogo.variante.criar' else 'catalogo.variante.salvar' end,
          'product_variants', _v.id::text,
          jsonb_build_object('sku',_v.sku,'barcode',_v.barcode,
            'justificativa', nullif(_payload->>'sku_justificativa',''),
            'custo', _rescusto));

  return jsonb_build_object('id',_v.id,'sku',_v.sku,'label',_v.label,'barcode',_v.barcode,'custo',_rescusto);
end $function$;

-- ============================================================
-- 5. product_save: custo só muda quando o campo vem no payload
-- ============================================================
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
  if _slug = '' then _slug := 'produto-' || substr(md5(random()::text),1,8); end if;

  if _novo then
    _code := public.product_next_internal_code(_cat);
    while exists (select 1 from products where slug = _slug) loop
      _slug := left(_slug, 70) || '-' || substr(md5(random()::text),1,5);
    end loop;
    insert into products (name, slug, internal_code, legacy_code, category_id, subcategory_id,
      collection_id, short_description, description, material, raw_material, raw_weight_grams,
      raw_supplier_id, raw_piece_cost_cents, cost_price_cents, markup_percent, measurements, care_instructions, warranty_text,
      price_cents, price_is_public, seo_title, seo_description, is_featured, status,
      requires_catalog_review, is_legacy, created_by)
    values (_nome, _slug, _code, nullif(_payload->>'legacy_code',''), _cat, _sub,
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

  return jsonb_build_object('id',_p.id,'internal_code',_p.internal_code,'slug',_p.slug,'status',_p.status);
end $function$;

-- ============================================================
-- 6. Ações em massa: dados do cadastro exigem Master
-- ============================================================
create or replace function public.showcase_bulk(_action text, _ids uuid[], _params jsonb DEFAULT '{}'::jsonb, _filters jsonb DEFAULT '{}'::jsonb, _idempotency_key text DEFAULT NULL::text, _note text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  _key text := coalesce(nullif(btrim(coalesce(_idempotency_key,'')), ''), gen_random_uuid()::text);
  _existing public.showcase_batches;
  _alvos uuid[];
  _bloqueados jsonb := '[]'::jsonb;
  _afetados integer := 0;
  _res jsonb;
  _publica boolean := _action IN ('publicar','despublicar','programar','cancelar_agendamento','arquivar');
  -- únicas ações que pertencem à vitrine e não ao cadastro do produto
  _vitrine boolean := _action IN ('destacar','remover_destaque','lancamento','remover_lancamento');
BEGIN
  IF NOT public.can_manage_content(auth.uid()) THEN
    RAISE EXCEPTION 'sem permissao para acoes em massa na vitrine' USING ERRCODE = '42501';
  END IF;
  IF NOT _vitrine AND NOT public.has_capability(auth.uid(),'product.manage') THEN
    RAISE EXCEPTION 'Somente o perfil Master altera dados do cadastro do produto.' USING ERRCODE = '42501';
  END IF;
  IF _publica AND NOT public.has_capability(auth.uid(),'product.publish') THEN
    RAISE EXCEPTION 'Sem permissão para publicar ou retirar do ar.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _existing FROM showcase_batches WHERE idempotency_key = _key;
  IF FOUND THEN
    RETURN jsonb_build_object('lote_id', _existing.id, 'afetados', _existing.affected,
      'rejeitados', _existing.rejected, 'itens_rejeitados', _existing.rejected_items, 'repetido', true);
  END IF;

  _alvos := coalesce(_ids, ARRAY[]::uuid[]);

  IF cardinality(_alvos) > 0 THEN
    CASE _action
      WHEN 'publicar' THEN
        _res := public.publish_products(_alvos, _note);
        _afetados := (_res->>'afetados')::int;
        _bloqueados := _res->'itens_rejeitados';
      WHEN 'despublicar' THEN
        _res := public.unpublish_products(_alvos, _note, 'rascunho');
        _afetados := (_res->>'afetados')::int;
      WHEN 'arquivar' THEN
        _res := public.unpublish_products(_alvos, _note, 'arquivado');
        _afetados := (_res->>'afetados')::int;
      WHEN 'mostrar_preco' THEN
        UPDATE products SET price_is_public = true, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'esconder_preco' THEN
        UPDATE products SET price_is_public = false, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'definir_categoria' THEN
        UPDATE products SET category_id = (_params->>'categoria_id')::uuid, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'adicionar_colecao' THEN
        UPDATE products SET collection_id = (_params->>'colecao_id')::uuid, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'remover_colecao' THEN
        UPDATE products SET collection_id = NULL, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'destacar' THEN
        UPDATE products SET is_featured = true, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'remover_destaque' THEN
        UPDATE products SET is_featured = false, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'lancamento' THEN
        UPDATE products SET is_new_arrival = true, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'remover_lancamento' THEN
        UPDATE products SET is_new_arrival = false, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'programar' THEN
        UPDATE products SET scheduled_publish_at = (_params->>'quando')::timestamptz, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'cancelar_agendamento' THEN
        UPDATE products SET scheduled_publish_at = NULL, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'estoque_visibilidade' THEN
        UPDATE products SET stock_visibility = (_params->>'estrategia'), updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      ELSE RAISE EXCEPTION 'acao desconhecida: %', _action;
    END CASE;
  END IF;

  INSERT INTO showcase_batches (idempotency_key, action, params, filters, affected, rejected, rejected_items, note, actor_id)
  VALUES (_key, _action, coalesce(_params,'{}'::jsonb), coalesce(_filters,'{}'::jsonb), _afetados,
          jsonb_array_length(_bloqueados), _bloqueados, _note, auth.uid())
  RETURNING * INTO _existing;

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'vitrine.' || _action, 'products', _existing.id::text,
          jsonb_build_object('afetados', _afetados, 'rejeitados', jsonb_array_length(_bloqueados),
            'filtros', coalesce(_filters,'{}'::jsonb), 'params', coalesce(_params,'{}'::jsonb),
            'ids', to_jsonb(_alvos), 'chave', _key));

  RETURN jsonb_build_object('lote_id', _existing.id, 'afetados', _afetados,
    'rejeitados', jsonb_array_length(_bloqueados), 'itens_rejeitados', _bloqueados, 'repetido', false);
END;
$function$;

-- despublicar/arquivar exige a mesma permissão de publicar produto
create or replace function public.unpublish_products(_ids uuid[], _note text DEFAULT NULL::text, _para text DEFAULT 'rascunho'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  _alvos uuid[] := coalesce(_ids, ARRAY[]::uuid[]);
  _mudados uuid[];
  _afetados integer := 0;
BEGIN
  IF NOT public.has_capability(auth.uid(),'product.publish') THEN
    RAISE EXCEPTION 'Sem permissão para despublicar.' USING ERRCODE = '42501';
  END IF;
  IF _para NOT IN ('rascunho','revisao','arquivado') THEN
    RAISE EXCEPTION 'Destino inválido para despublicação: %', _para;
  END IF;
  IF cardinality(_alvos) = 0 THEN
    RETURN jsonb_build_object('afetados', 0);
  END IF;
  IF btrim(coalesce(_note,'')) = '' THEN
    RAISE EXCEPTION 'Informe o motivo para retirar do ar.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('lardan.publicacao', 'canonica', true);
  WITH alterados AS (
    UPDATE products
       SET status = _para::content_status, scheduled_publish_at = NULL, updated_at = now()
     WHERE id = ANY(_alvos) AND status = 'publicado'
     RETURNING id)
  SELECT array_agg(id) INTO _mudados FROM alterados;
  PERFORM set_config('lardan.publicacao', '', true);

  _mudados := coalesce(_mudados, ARRAY[]::uuid[]);
  _afetados := cardinality(_mudados);

  IF _afetados > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    SELECT auth.uid(), 'catalogo.despublicar', 'products', pid::text,
           jsonb_build_object('motivo', _note, 'destino', _para)
      FROM unnest(_mudados) AS pid;
  END IF;

  RETURN jsonb_build_object('afetados', _afetados);
END $function$;

-- ============================================================
-- 7. Importação: comparação completa e publicação só para Master
-- ============================================================
do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_job_process';

  novo := regexp_replace(src,
    'pode_publicar\s*:=\s*public\.has_capability\(auth\.uid\(\),''showcase\.publish''\)\s*OR public\.has_capability\(auth\.uid\(\),''catalog\.publish''\);',
    'pode_publicar := public.has_capability(auth.uid(),''product.publish'');');
  if novo = src then raise exception 'falha ao ajustar a permissão de publicação da importação'; end if;
  src := novo;

  novo := regexp_replace(src,
    'pr\.seo_title,\s*pr\.seo_description\)',
    'pr.seo_title, pr.seo_description, pr.raw_piece_cost_cents, pr.cost_price_cents, pr.plating)');
  if novo = src then raise exception 'falha ao ajustar a comparação do produto (lado atual)'; end if;
  src := novo;

  novo := regexp_replace(src,
    'coalesce\(p->>''seo_descricao'', pr\.seo_description\)\) THEN',
    'coalesce(p->>''seo_descricao'', pr.seo_description), '
    || 'coalesce((p->>''valor_bruto_cents'')::int, pr.raw_piece_cost_cents), '
    || 'coalesce((p->>''preco_custo_cents'')::int, pr.cost_price_cents), '
    || 'coalesce(p->>''banho'', pr.plating)) THEN');
  if novo = src then raise exception 'falha ao ajustar a comparação do produto (lado novo)'; end if;
  src := novo;

  novo := regexp_replace(src,
    'pv\.is_active\) IS DISTINCT FROM',
    'pv.is_active, pv.plating_material_cost_cents, pv.varnish_cost_cents, pv.finished_piece_cost_cents) IS DISTINCT FROM');
  if novo = src then raise exception 'falha ao ajustar a comparação da variante (lado atual)'; end if;
  src := novo;

  novo := regexp_replace(src,
    'coalesce\(\(p->>''variante_ativa''\)::boolean, pv\.is_active\)\) THEN',
    'coalesce((p->>''variante_ativa'')::boolean, pv.is_active), '
    || 'coalesce((p->>''valor_banho_cents'')::int, pv.plating_material_cost_cents), '
    || 'coalesce((p->>''valor_verniz_cents'')::int, pv.varnish_cost_cents), '
    || 'coalesce((p->>''custo_cents'')::int, pv.finished_piece_cost_cents)) THEN');
  if novo = src then raise exception 'falha ao ajustar a comparação da variante (lado novo)'; end if;
  src := novo;

  execute src;
end $$;