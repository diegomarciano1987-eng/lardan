-- 1) Estoque deixa de ter acesso a custo unitário
DELETE FROM public.role_capabilities WHERE role = 'estoque' AND capability = 'stock.cost.view';

-- 2) A listagem não devolve a chave de custo para quem não tem a capacidade
CREATE OR REPLACE FUNCTION public.stock_movements_list(_search text DEFAULT NULL::text, _kind text DEFAULT NULL::text, _variant uuid DEFAULT NULL::uuid, _page integer DEFAULT 0, _size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ver_custo boolean; termo text; lim integer; off integer; res jsonb; qtd bigint;
begin
  if not public.has_capability(auth.uid(),'stock.view') then
    raise exception 'Sem permissão para ver o estoque.' using errcode = '42501';
  end if;
  ver_custo := public.has_capability(auth.uid(),'stock.cost.view');
  termo := nullif(trim(coalesce(_search,'')), '');
  lim := least(greatest(coalesce(_size,20),1), 100);
  off := greatest(coalesce(_page,0),0) * lim;

  create temp table _mv on commit drop as
  select m.* from public.stock_movements m
  join public.product_variants v on v.id = m.variant_id
  join public.products pr on pr.id = v.product_id
  where (_kind is null or _kind = 'todos' or m.kind::text = _kind)
    and (_variant is null or m.variant_id = _variant)
    and (termo is null or v.label ilike '%'||termo||'%' or coalesce(v.sku,'') ilike '%'||termo||'%'
         or pr.name ilike '%'||termo||'%' or coalesce(v.barcode,'') ilike '%'||termo||'%');

  select count(*) into qtd from _mv;

  select jsonb_build_object(
    'total', qtd,
    'pode_ver_custo', ver_custo,
    'rows', coalesce((
      select jsonb_agg(
        (jsonb_build_object(
          'id', m.id, 'kind', m.kind, 'quantity', m.quantity,
          'unit_cost_cents', m.unit_cost_cents,
          'reason_code', m.reason_code, 'reference', m.reference, 'note', m.note,
          'balance_after', m.balance_after, 'created_at', m.created_at,
          'variante', v.label, 'sku', v.sku, 'produto', pr.name,
          'origem', lo.name, 'destino', ld.name)
         - (case when ver_custo then '{}'::text[] else array['unit_cost_cents'] end))
        order by m.created_at desc)
      from (select * from _mv order by created_at desc limit lim offset off) m
      join public.product_variants v on v.id = m.variant_id
      join public.products pr on pr.id = v.product_id
      left join public.locations lo on lo.id = m.from_location_id
      left join public.locations ld on ld.id = m.to_location_id
    ), '[]'::jsonb)
  ) into res;
  return res;
end $function$;