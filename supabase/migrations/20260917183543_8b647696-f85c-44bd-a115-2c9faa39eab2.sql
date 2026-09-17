CREATE OR REPLACE FUNCTION public.network_geo_candidaturas(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare res jsonb;
begin
  if not (public.has_capability(auth.uid(), 'candidaturas.view')
          or public.has_capability(auth.uid(), 'partners.view')) then
    raise exception 'sem_permissao';
  end if;

  with base as (
    select l.id, l.uf, l.city, l.postal_code, l.outcome, l.archived_at, l.created_at,
           regexp_replace(coalesce(l.postal_code,''), '\D', '', 'g') as cep
    from public.leads l
    where l.archived_at is null
      and (_filtros->>'uf' is null or l.uf = upper(_filtros->>'uf'))
      and (_filtros->>'desde' is null or l.created_at >= (_filtros->>'desde')::timestamptz)
      and (_filtros->>'ate' is null or l.created_at < ((_filtros->>'ate')::date + 1))
  ), com_mun as (
    select b.*, m.codigo_ibge, coalesce(m.nome, b.city) as municipio
    from base b
    left join public.ibge_municipios m
      on m.uf = b.uf and m.nome_norm = public.norm_name(b.city)
  ), ind as (
    select count(*) total,
      count(*) filter (where coalesce(outcome,'') not in ('ganho','perdido')) abertas,
      count(*) filter (where outcome = 'ganho') ganhas,
      count(*) filter (where outcome = 'perdido') perdidas,
      count(distinct uf) filter (where uf is not null) estados,
      count(distinct codigo_ibge) filter (where codigo_ibge is not null) municipios
    from com_mun
  ), estados as (
    select u.uf, u.nome, count(c.id) total,
      count(c.id) filter (where coalesce(c.outcome,'') not in ('ganho','perdido')) abertas
    from public.uf_centroides u
    left join com_mun c on c.uf = u.uf
    group by u.uf, u.nome
  ), municipios as (
    select coalesce(c.codigo_ibge,'') codigo_ibge,
           coalesce(nullif(btrim(c.municipio),''),'Sem município informado') municipio,
           c.uf,
           count(*) total,
           count(*) filter (where coalesce(c.outcome,'') not in ('ganho','perdido')) abertas
    from com_mun c
    group by 1,2,3
  ), pontos as (
    select round(coalesce(g.latitude, u.latitude), 2) lat,
           round(coalesce(g.longitude, u.longitude), 2) lng,
           (g.latitude is null) aproximado,
           count(*) total,
           count(*) filter (where coalesce(c.outcome,'') not in ('ganho','perdido')) abertas
    from com_mun c
    left join public.geocode_cache g
      on length(c.cep) = 8 and g.postal_digits = c.cep and g.latitude is not null
    left join public.uf_centroides u on u.uf = c.uf
    where coalesce(g.latitude, u.latitude) is not null
    group by 1,2,3
  )
  select jsonb_build_object(
    'atualizado_em', now(),
    'indicadores', (select to_jsonb(i) from ind i),
    'estados', (select coalesce(jsonb_agg(to_jsonb(e) order by e.total desc, e.nome), '[]'::jsonb) from estados e),
    'municipios', (select coalesce(jsonb_agg(to_jsonb(m) order by m.total desc, m.municipio), '[]'::jsonb) from municipios m),
    'pontos', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from pontos p)
  ) into res;
  return res;
end $function$;

REVOKE ALL ON FUNCTION public.network_geo_candidaturas(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_geo_candidaturas(jsonb) TO authenticated, service_role;