-- Uma linha por município (código IBGE): grafias diferentes da cidade ("Londrina"/"LONDRINA") não dividem mais a contagem.
CREATE OR REPLACE FUNCTION public.network_geo_municipios(_uf text, _filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(codigo_ibge text, municipio text, total bigint, ativas bigint, localizadas bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare s jsonb; escopo uuid;
begin
  s := public.network_scope();
  escopo := case when s->>'modo' in ('representante','proprio') then (s->>'party_id')::uuid end;
  return query
  select coalesce(c.ibge_city_code,''),
         coalesce(max(m.nome), mode() within group (order by c.city), 'Sem município informado'),
         count(*), count(*) filter (where c.status='ativo'), count(*) filter (where c.latitude is not null)
  from public.v_network_consultants c
  left join public.ibge_municipios m on m.codigo_ibge = c.ibge_city_code
  where c.uf = upper(_uf)
    and (escopo is null or c.representative_party_id = escopo)
    and (_filtros->>'representante' is null or c.representative_party_id = (_filtros->>'representante')::uuid)
    and (_filtros->>'carteira' is null or c.wallet = _filtros->>'carteira')
    and (coalesce(_filtros->>'situacao','todas') = 'todas'
         or (_filtros->>'situacao' = 'ativa' and c.status = 'ativo')
         or (_filtros->>'situacao' = 'inativa' and c.status in ('bloqueado','inativo','desligado')))
  group by coalesce(c.ibge_city_code,''), case when c.ibge_city_code is null then lower(c.city) end
  order by 3 desc, 2;
end $function$;