-- Cobertura: município conta uma vez por código IBGE, mesmo com grafias diferentes da cidade.
CREATE OR REPLACE FUNCTION public.network_cobertura(_filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare s jsonb; escopo uuid; ident boolean; res jsonb;
begin
  s := public.network_scope();
  escopo := case when s->>'modo' in ('representante','proprio') then (s->>'party_id')::uuid end;
  ident := public.has_capability(auth.uid(),'network.identity.view') or s->>'modo' = 'representante';
  with base as (
    select * from public.v_network_consultants c
    where (escopo is null or c.representative_party_id = escopo)
  ), por_uf as (
    select u.uf, u.nome, count(b.party_id) total
    from public.uf_centroides u left join base b on b.uf = u.uf group by u.uf, u.nome
  ), por_mun as (
    select b.ibge_city_code, coalesce(max(m.nome), mode() within group (order by b.city)) city, max(b.uf) uf, count(*) total
    from base b left join public.ibge_municipios m on m.codigo_ibge = b.ibge_city_code
    where b.ibge_city_code is not null group by 1
  ), por_rep as (
    select representative_party_id, count(*) total, count(distinct ibge_city_code) municipios
    from base where representative_party_id is not null group by 1
  )
  select jsonb_build_object(
    'estados_atendidos', (select count(*) from por_uf where total > 0),
    'estados_sem_cobertura', (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'nome', nome) order by nome), '[]'::jsonb) from por_uf where total = 0),
    'municipios_atendidos', (select count(*) from por_mun),
    'municipios_unica_consultora', (select count(*) from por_mun where total = 1),
    'municipios_concentrados', (select coalesce(jsonb_agg(jsonb_build_object('municipio', city, 'uf', uf, 'total', total) order by total desc), '[]'::jsonb) from (select * from por_mun order by total desc limit 10) t),
    'sem_territorio', (select count(*) from base where uf is null),
    'localizacoes_pendentes', (select count(*) from base where latitude is null),
    'por_representante', case when not ident then '[]'::jsonb else
      (select coalesce(jsonb_agg(jsonb_build_object('representante', p.display_name, 'total', r.total, 'municipios', r.municipios) order by r.total desc), '[]'::jsonb)
        from por_rep r join public.parties p on p.id = r.representative_party_id) end,
    'por_uf', (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'nome', nome, 'total', total) order by total desc, nome), '[]'::jsonb) from por_uf)
  ) into res;
  return res;
end $function$;