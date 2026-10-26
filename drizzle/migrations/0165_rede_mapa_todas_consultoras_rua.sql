-- Fila de localização: pendentes primeiro, ativas antes; depois refina por rua quem só tinha o CEP (geo-1).
CREATE OR REPLACE FUNCTION public.geo_fila_proxima(_limite int DEFAULT 20, _ibge text DEFAULT NULL)
RETURNS TABLE(id uuid, postal_code text, street text, district text, city text, uf text, ibge_city_code text,
  geo_hash text, geo_status text, latitude numeric, longitude numeric, geo_precision text, ativa boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  with base as (
    select pa.id, pa.postal_code, pa.street, pa.district, pa.city, pa.uf::text as uf, pa.ibge_city_code,
      pa.geo_hash, pa.geo_status, pa.latitude, pa.longitude, pa.geo_precision,
      coalesce(bool_or(p.status = 'ativo'), false) as ativa,
      count(r.party_id) > 0 as consultora,
      pa.updated_at
    from party_addresses pa
    left join party_roles r on r.party_id = pa.party_id and r.role = 'consultora' and r.ended_at is null
    left join parties p on p.id = r.party_id
    where (_ibge is null or pa.ibge_city_code = _ibge)
    group by pa.id
  )
  select b.id, b.postal_code, b.street, b.district, b.city, b.uf, b.ibge_city_code, b.geo_hash, b.geo_status,
    b.latitude, b.longitude, b.geo_precision, b.ativa
  from base b
  where b.geo_status in ('nao_solicitado','desatualizado','falha_temporaria')
     or (b.consultora and coalesce(b.geo_status,'') <> 'endereco_incompleto'
         and b.geo_status is not null
         and (select pa2.geo_normalizer_version from party_addresses pa2 where pa2.id = b.id) is distinct from 'geo-2')
  order by
    case when b.geo_status in ('nao_solicitado','desatualizado','falha_temporaria') then 0 else 1 end,
    b.ativa desc,
    b.updated_at asc
  limit greatest(1, least(_limite, 200));
$$;
REVOKE ALL ON FUNCTION public.geo_fila_proxima(int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geo_fila_proxima(int, text) TO service_role;

-- Situação da fila (sem endereço): quantos faltam por cidade.
CREATE OR REPLACE FUNCTION public.geo_fila_restantes(_ibge text DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select count(*) from party_addresses pa
  where (_ibge is null or pa.ibge_city_code = _ibge)
    and (pa.geo_status in ('nao_solicitado','desatualizado','falha_temporaria')
      or (pa.geo_status is not null and pa.geo_status <> 'endereco_incompleto'
          and pa.geo_normalizer_version is distinct from 'geo-2'
          and exists (select 1 from party_roles r where r.party_id = pa.party_id and r.role = 'consultora' and r.ended_at is null)));
$$;
REVOKE ALL ON FUNCTION public.geo_fila_restantes(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geo_fila_restantes(text) TO service_role;

-- Mapa da cidade: todas as consultoras, com rua para a busca e o cartão. Mesmo escopo da versão anterior.
CREATE OR REPLACE FUNCTION public.network_geo_municipio_consultoras_v2(_ibge text)
RETURNS TABLE(party_id uuid, nome text, codigo text, status text, lat numeric, lng numeric, precisao text,
  bairro text, cep text, rua text, numero text, geo_fonte text, geo_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare s jsonb; escopo uuid;
begin
  s := public.network_scope();
  IF public.colab_restrita() AND NOT public.has_capability(auth.uid(),'network.identity.view') THEN RETURN; END IF;
  if s->>'modo' = 'agregado' or s->>'modo' is null then return; end if;
  escopo := case when s->>'modo' in ('representante','proprio') then (s->>'party_id')::uuid end;
  return query
  select c.party_id, c.display_name, c.code, c.status::text, c.latitude::numeric, c.longitude::numeric, c.geo_precision,
    a.district, a.postal_code, a.street, a.street_number, a.geo_source, c.geo_status
  from v_network_consultants c
  left join lateral (
    select pa.district, pa.postal_code, pa.street, pa.street_number, pa.geo_source
    from party_addresses pa where pa.party_id = c.party_id
    order by pa.is_primary desc nulls last, pa.updated_at desc limit 1
  ) a on true
  where c.ibge_city_code = _ibge
    and (escopo is null or c.representative_party_id = escopo)
  order by (c.status = 'ativo') desc, c.display_name
  limit 5000;
end $$;
REVOKE ALL ON FUNCTION public.network_geo_municipio_consultoras_v2(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_geo_municipio_consultoras_v2(text) TO authenticated, service_role;