-- ===== Escopo do usuário: representante só enxerga a própria carteira =====
create or replace function public.network_scope_party()
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when public.has_role(auth.uid(),'master') or public.has_role(auth.uid(),'diretoria') then null
    when public.has_role(auth.uid(),'representante') then (select party_id from public.profiles where id = auth.uid())
    else null
  end
$$;
revoke execute on function public.network_scope_party() from public, anon;
grant execute on function public.network_scope_party() to authenticated;

-- ===== Base canônica da rede (sem cópia de pessoas ou endereços) =====
create or replace view public.v_network_consultants as
select
  p.id as party_id,
  p.display_name,
  p.code,
  p.status,
  p.created_at,
  cp.representative_party_id,
  cp.wallet,
  cp.region,
  cp.level,
  a.uf::text as uf,
  a.ibge_city_code,
  a.city,
  a.latitude,
  a.longitude,
  a.geo_status,
  a.geo_precision,
  (a.id is not null) as tem_endereco,
  (a.postal_code is not null and a.city is not null and a.uf is not null) as endereco_completo
from public.parties p
join public.party_roles r
  on r.party_id = p.id and r.role = 'consultora' and r.ended_at is null
left join public.consultant_profiles cp on cp.party_id = p.id
left join lateral (
  select * from public.party_addresses pa
  where pa.party_id = p.id
  order by pa.is_primary desc nulls last, pa.updated_at desc
  limit 1
) a on true;

revoke all on public.v_network_consultants from anon, authenticated;

-- ===== Indicadores + coroplético por estado =====
create or replace function public.network_geo_overview(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare escopo uuid; res jsonb;
begin
  if not public.has_capability(auth.uid(),'partners.view') then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  escopo := public.network_scope_party();

  with base as (
    select * from public.v_network_consultants c
    where (escopo is null or c.representative_party_id = escopo)
      and (_filtros->>'uf' is null or c.uf = _filtros->>'uf')
      and (_filtros->>'ibge' is null or c.ibge_city_code = _filtros->>'ibge')
      and (_filtros->>'representante' is null or c.representative_party_id = (_filtros->>'representante')::uuid)
      and (_filtros->>'carteira' is null or c.wallet = _filtros->>'carteira')
      and (_filtros->>'regiao' is null or c.region = _filtros->>'regiao')
      and (_filtros->>'nivel' is null or c.level = _filtros->>'nivel')
      and (coalesce(_filtros->>'situacao','todas') = 'todas'
           or (_filtros->>'situacao' = 'ativa' and c.status = 'ativo')
           or (_filtros->>'situacao' = 'inativa' and c.status in ('bloqueado','inativo','desligado')))
      and (_filtros->>'desde' is null or c.created_at >= (_filtros->>'desde')::timestamptz)
      and (_filtros->>'ate' is null or c.created_at < ((_filtros->>'ate')::date + 1))
  ), ind as (
    select
      count(*) total,
      count(*) filter (where status = 'ativo') ativas,
      count(*) filter (where status in ('bloqueado','inativo','desligado')) inativas,
      count(*) filter (where latitude is not null) localizadas,
      count(*) filter (where tem_endereco and not endereco_completo) incompletas,
      count(*) filter (where not tem_endereco) sem_endereco,
      count(*) filter (where geo_status in ('nao_solicitado','aguardando','desatualizado') and tem_endereco) aguardando,
      count(*) filter (where geo_status in ('cep_nao_localizado','sem_coordenadas','falha_temporaria','revisao_manual','endereco_incompleto')) falhas,
      count(distinct uf) filter (where uf is not null) estados,
      count(distinct ibge_city_code) filter (where ibge_city_code is not null) municipios,
      count(distinct representative_party_id) filter (where representative_party_id is not null) representantes,
      count(distinct wallet) filter (where wallet is not null) carteiras
    from base
  ), estados as (
    select u.uf, u.nome,
      count(b.party_id) total,
      count(b.party_id) filter (where b.status = 'ativo') ativas,
      count(b.party_id) filter (where b.latitude is not null) localizadas
    from public.uf_centroides u
    left join base b on b.uf = u.uf
    group by u.uf, u.nome
  )
  select jsonb_build_object(
    'atualizado_em', now(),
    'escopo_restrito', escopo is not null,
    'indicadores', (select to_jsonb(ind) from ind),
    'estados', (select coalesce(jsonb_agg(to_jsonb(e) order by e.uf), '[]'::jsonb) from estados e)
  ) into res;
  return res;
end $$;
revoke execute on function public.network_geo_overview(jsonb) from public, anon;
grant execute on function public.network_geo_overview(jsonb) to authenticated;

-- ===== Municípios de um estado =====
create or replace function public.network_geo_municipios(_uf text, _filtros jsonb default '{}'::jsonb)
returns table (codigo_ibge text, municipio text, total bigint, ativas bigint, localizadas bigint)
language plpgsql stable security definer set search_path = public as $$
declare escopo uuid;
begin
  if not public.has_capability(auth.uid(),'partners.view') then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  escopo := public.network_scope_party();
  return query
  select coalesce(c.ibge_city_code,'') , coalesce(c.city,'Sem município informado'),
         count(*), count(*) filter (where c.status='ativo'), count(*) filter (where c.latitude is not null)
  from public.v_network_consultants c
  where c.uf = upper(_uf)
    and (escopo is null or c.representative_party_id = escopo)
    and (_filtros->>'representante' is null or c.representative_party_id = (_filtros->>'representante')::uuid)
    and (_filtros->>'carteira' is null or c.wallet = _filtros->>'carteira')
    and (coalesce(_filtros->>'situacao','todas') = 'todas'
         or (_filtros->>'situacao' = 'ativa' and c.status = 'ativo')
         or (_filtros->>'situacao' = 'inativa' and c.status in ('bloqueado','inativo','desligado')))
  group by 1,2
  order by 3 desc, 2;
end $$;
revoke execute on function public.network_geo_municipios(text, jsonb) from public, anon;
grant execute on function public.network_geo_municipios(text, jsonb) to authenticated;

-- ===== Painel territorial =====
create or replace function public.network_geo_territorio(_uf text default null, _ibge text default null, _filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare escopo uuid; res jsonb;
begin
  if not public.has_capability(auth.uid(),'partners.view') then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  escopo := public.network_scope_party();
  with base as (
    select * from public.v_network_consultants c
    where (escopo is null or c.representative_party_id = escopo)
      and (_uf is null or c.uf = upper(_uf))
      and (_ibge is null or c.ibge_city_code = _ibge)
  ), tot as (
    select count(*) total from public.v_network_consultants c
    where (escopo is null or c.representative_party_id = escopo)
  )
  select jsonb_build_object(
    'uf', _uf, 'ibge', _ibge,
    'total', (select count(*) from base),
    'ativas', (select count(*) from base where status='ativo'),
    'inativas', (select count(*) from base where status in ('bloqueado','inativo','desligado')),
    'percentual_rede', case when (select total from tot) = 0 then 0
      else round(100.0 * (select count(*) from base) / (select total from tot), 1) end,
    'representantes', (select count(distinct representative_party_id) from base where representative_party_id is not null),
    'carteiras', (select count(distinct wallet) from base where wallet is not null),
    'enderecos_completos', (select count(*) from base where endereco_completo),
    'enderecos_incompletos', (select count(*) from base where tem_endereco and not endereco_completo),
    'sem_endereco', (select count(*) from base where not tem_endereco),
    'nao_localizadas', (select count(*) from base where latitude is null),
    'municipios', (select count(distinct ibge_city_code) from base where ibge_city_code is not null),
    'ultimas_entradas', (select coalesce(jsonb_agg(jsonb_build_object('nome', display_name, 'codigo', code, 'cidade', city, 'uf', uf, 'entrou_em', created_at) order by created_at desc), '[]'::jsonb)
                          from (select * from base order by created_at desc limit 5) u)
  ) into res;
  return res;
end $$;
revoke execute on function public.network_geo_territorio(text, text, jsonb) from public, anon;
grant execute on function public.network_geo_territorio(text, text, jsonb) to authenticated;

-- ===== Camada de concentração: pontos agregados em grade, nunca residência exata =====
create or replace function public.network_geo_pontos(_filtros jsonb default '{}'::jsonb)
returns table (lat numeric, lng numeric, total bigint, ativas bigint, aproximado boolean)
language plpgsql stable security definer set search_path = public as $$
declare escopo uuid;
begin
  if not public.has_capability(auth.uid(),'partners.view') then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  escopo := public.network_scope_party();
  return query
  select round(c.latitude::numeric, 1), round(c.longitude::numeric, 1),
         count(*), count(*) filter (where c.status='ativo'),
         bool_or(c.geo_precision in ('municipio','estado'))
  from public.v_network_consultants c
  where c.latitude is not null
    and (escopo is null or c.representative_party_id = escopo)
    and (_filtros->>'uf' is null or c.uf = _filtros->>'uf')
  group by 1,2;
end $$;
revoke execute on function public.network_geo_pontos(jsonb) from public, anon;
grant execute on function public.network_geo_pontos(jsonb) to authenticated;

-- ===== Cobertura territorial =====
create or replace function public.network_cobertura(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare escopo uuid; res jsonb;
begin
  if not public.has_capability(auth.uid(),'partners.view') then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  escopo := public.network_scope_party();
  with base as (
    select * from public.v_network_consultants c
    where (escopo is null or c.representative_party_id = escopo)
  ), por_uf as (
    select u.uf, u.nome, count(b.party_id) total
    from public.uf_centroides u left join base b on b.uf = u.uf
    group by u.uf, u.nome
  ), por_mun as (
    select ibge_city_code, city, uf, count(*) total from base
    where ibge_city_code is not null group by 1,2,3
  ), por_rep as (
    select representative_party_id, count(*) total, count(distinct ibge_city_code) municipios
    from base where representative_party_id is not null group by 1
  )
  select jsonb_build_object(
    'estados_atendidos', (select count(*) from por_uf where total > 0),
    'estados_sem_cobertura', (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'nome', nome) order by nome) , '[]'::jsonb) from por_uf where total = 0),
    'municipios_atendidos', (select count(*) from por_mun),
    'municipios_unica_consultora', (select count(*) from por_mun where total = 1),
    'municipios_concentrados', (select coalesce(jsonb_agg(jsonb_build_object('municipio', city, 'uf', uf, 'total', total) order by total desc), '[]'::jsonb) from (select * from por_mun order by total desc limit 10) t),
    'sem_territorio', (select count(*) from base where uf is null),
    'localizacoes_pendentes', (select count(*) from base where latitude is null),
    'por_representante', (select coalesce(jsonb_agg(jsonb_build_object('representante', p.display_name, 'total', r.total, 'municipios', r.municipios) order by r.total desc), '[]'::jsonb)
                           from por_rep r join public.parties p on p.id = r.representative_party_id),
    'por_uf', (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'nome', nome, 'total', total) order by total desc, nome), '[]'::jsonb) from por_uf)
  ) into res;
  return res;
end $$;
revoke execute on function public.network_cobertura(jsonb) from public, anon;
grant execute on function public.network_cobertura(jsonb) to authenticated;