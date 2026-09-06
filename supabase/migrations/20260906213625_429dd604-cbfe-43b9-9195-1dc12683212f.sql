create or replace function public.homolog_purge(_prefix text default 'HOMOLOG')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  n int;
  slug_like text := lower(_prefix) || '-%';
  txt_like text := _prefix || '%';
begin
  -- Bancada de homologação: bypass dos gatilhos de imutabilidade apenas aqui.
  perform set_config('session_replication_role', 'replica', true);

  delete from public.stock_movements where reference like txt_like; get diagnostics n = row_count;
  r := r || jsonb_build_object('stock_movements', n);

  delete from public.stock_balances sb using public.product_variants v, public.products p
    where sb.variant_id = v.id and v.product_id = p.id and p.slug like slug_like;
  get diagnostics n = row_count; r := r || jsonb_build_object('stock_balances', n);

  delete from public.stock_balances sb using public.locations l
    where sb.location_id = l.id and l.code like txt_like;
  get diagnostics n = row_count; r := r || jsonb_build_object('stock_balances_locais', n);

  delete from public.stock_movements sm using public.locations l
    where l.code like txt_like and (sm.from_location_id = l.id or sm.to_location_id = l.id);

  delete from public.product_media pm using public.products p
    where pm.product_id = p.id and p.slug like slug_like;

  delete from public.variant_costs vc using public.product_variants v, public.products p
    where vc.variant_id = v.id and v.product_id = p.id and p.slug like slug_like;

  delete from public.public_price_list pl using public.products p
    where pl.product_id = p.id and p.slug like slug_like;

  delete from public.product_variants v using public.products p
    where v.product_id = p.id and p.slug like slug_like;
  get diagnostics n = row_count; r := r || jsonb_build_object('product_variants', n);

  delete from public.products where slug like slug_like; get diagnostics n = row_count;
  r := r || jsonb_build_object('products', n);

  delete from public.collections where slug like slug_like; get diagnostics n = row_count;
  r := r || jsonb_build_object('collections', n);

  delete from public.categories where slug like slug_like; get diagnostics n = row_count;
  r := r || jsonb_build_object('categories', n);

  delete from public.locations where code like txt_like; get diagnostics n = row_count;
  r := r || jsonb_build_object('locations', n);

  delete from public.suppliers where name like txt_like; get diagnostics n = row_count;
  r := r || jsonb_build_object('suppliers', n);

  delete from public.business_entities where legal_name like txt_like; get diagnostics n = row_count;
  r := r || jsonb_build_object('business_entities', n);

  delete from public.consultant_profiles cp using public.parties p
    where cp.party_id = p.id and p.notes like txt_like;
  get diagnostics n = row_count; r := r || jsonb_build_object('consultant_profiles', n);

  delete from public.party_addresses pa using public.parties p
    where pa.party_id = p.id and p.notes like txt_like;
  get diagnostics n = row_count; r := r || jsonb_build_object('party_addresses', n);

  delete from public.contact_points cpt using public.parties p
    where cpt.party_id = p.id and p.notes like txt_like;
  get diagnostics n = row_count; r := r || jsonb_build_object('contact_points', n);

  delete from public.party_roles pr using public.parties p
    where pr.party_id = p.id and p.notes like txt_like;
  get diagnostics n = row_count; r := r || jsonb_build_object('party_roles', n);

  delete from public.party_links pl using public.parties p
    where pl.party_id = p.id and p.notes like txt_like;

  update public.consultant_profiles cp set representative_party_id = null
    from public.parties p where cp.representative_party_id = p.id and p.notes like txt_like;
  update public.consultant_profiles cp set sponsor_party_id = null
    from public.parties p where cp.sponsor_party_id = p.id and p.notes like txt_like;
  update public.leads l set party_id = null
    from public.parties p where l.party_id = p.id and p.notes like txt_like;

  delete from public.parties where notes like txt_like; get diagnostics n = row_count;
  r := r || jsonb_build_object('parties', n);

  perform set_config('session_replication_role', 'origin', true);
  return r;
end $$;

revoke all on function public.homolog_purge(text) from public, anon, authenticated;
grant execute on function public.homolog_purge(text) to service_role;