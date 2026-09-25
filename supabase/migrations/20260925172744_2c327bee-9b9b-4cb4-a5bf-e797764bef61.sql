drop function if exists public.network_geo_municipio_consultoras(text,jsonb);
create function public.network_geo_municipio_consultoras(_ibge text, _filtros jsonb default '{}'::jsonb)
 returns table(party_id uuid, nome text, codigo text, status text, lat numeric, lng numeric, precisao text, bairro text, cep text, geo_fonte text)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare s jsonb; escopo uuid;
begin
  s := public.network_scope();
  if s->>'modo' = 'agregado' or s->>'modo' is null then return; end if;
  escopo := case when s->>'modo' in ('representante','proprio') then (s->>'party_id')::uuid end;
  return query
  select c.party_id, c.display_name, c.code, c.status::text, c.latitude::numeric, c.longitude::numeric, c.geo_precision,
    a.district, a.postal_code, a.geo_source
  from v_network_consultants c
  left join lateral (select pa.district, pa.postal_code, pa.geo_source from party_addresses pa where pa.party_id=c.party_id order by pa.is_primary desc nulls last limit 1) a on true
  where c.ibge_city_code = _ibge
    and (escopo is null or c.representative_party_id = escopo)
    and (coalesce(_filtros->>'situacao','todas')='todas'
      or (_filtros->>'situacao'='ativa' and c.status='ativo')
      or (_filtros->>'situacao'='inativa' and c.status<>'ativo'))
  order by c.display_name
  limit 5000;
end $function$;
revoke all on function public.network_geo_municipio_consultoras(text,jsonb) from public, anon;
grant execute on function public.network_geo_municipio_consultoras(text,jsonb) to authenticated;