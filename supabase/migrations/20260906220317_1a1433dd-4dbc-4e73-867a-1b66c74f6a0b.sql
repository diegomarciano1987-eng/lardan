CREATE OR REPLACE FUNCTION public.homolog_purge_movimentos(_prefix text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  alter table public.stock_movements disable trigger stock_movements_immutable;
  delete from public.stock_movements sm
   where sm.reference like _prefix || '%'
      or exists (select 1 from public.locations l
                  where l.code like _prefix || '%'
                    and (sm.from_location_id = l.id or sm.to_location_id = l.id))
      or exists (select 1 from public.product_variants v
                  join public.products p on p.id = v.product_id
                 where v.id = sm.variant_id and p.slug like lower(_prefix) || '-%');
  get diagnostics n = row_count;
  alter table public.stock_movements enable trigger stock_movements_immutable;
  return n;
exception when others then
  alter table public.stock_movements enable trigger stock_movements_immutable;
  raise;
end $function$;

REVOKE ALL ON FUNCTION public.homolog_purge_movimentos(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homolog_purge_movimentos(text) TO service_role;