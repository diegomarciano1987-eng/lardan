-- ============ P0.1 CAPACIDADES NOVAS ============
insert into public.role_capabilities(role, capability) values
  ('master','stock.cost.view'),('diretoria','stock.cost.view'),('financeiro','stock.cost.view'),('estoque','stock.cost.view'),
  ('master','network.aggregate.view'),('master','network.identity.view'),('master','network.manage'),('master','network.export'),
  ('diretoria','network.aggregate.view'),('diretoria','network.identity.view'),('diretoria','network.manage'),('diretoria','network.export'),
  ('marketing','network.aggregate.view')
on conflict (role, capability) do nothing;

-- ============ P0.2 DOCUMENTO CANÔNICO ============
revoke select (doc_canon) on public.parties from authenticated;
revoke select (doc_canon) on public.parties from anon;
revoke select on public.parties from anon;
revoke execute on function public.list_parties(text,text,text,text,integer,integer) from anon;
revoke execute on function public.get_party_full(uuid) from anon;
revoke execute on function public.mask_doc(text) from anon;
revoke execute on function public.doc_canon(text) from anon;

create index if not exists parties_doc_canon_idx on public.parties (doc_canon) where doc_canon is not null;

-- busca sempre mascarada; comparação por valor canônico (suporta CNPJ alfanumérico)
create or replace function public.list_parties(
  _search text default null, _kind text default null, _role text default null,
  _status text default null, _limit integer default 20, _offset integer default 0)
returns table(id uuid, kind party_kind, code text, display_name text, legal_name text,
  social_name text, doc text, birth_date date, status party_status, is_active boolean,
  created_at timestamptz, updated_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = public as $$
DECLARE termo text; canon text;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN
    RAISE EXCEPTION 'Sem permissão para consultar cadastros.' USING errcode = '42501';
  END IF;
  termo := nullif(trim(coalesce(_search,'')), '');
  canon := nullif(upper(regexp_replace(coalesce(termo,''), '[^0-9A-Za-z]', '', 'g')), '');
  IF canon is not null and length(canon) < 3 THEN canon := null; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT p.* FROM public.parties p
    WHERE (_kind IS NULL OR _kind = 'todos' OR p.kind::text = _kind)
      AND (_status IS NULL OR _status = 'todos' OR p.status::text = _status)
      AND (_role IS NULL OR _role = 'todos' OR EXISTS (
            SELECT 1 FROM public.party_roles pr
            WHERE pr.party_id = p.id AND pr.role::text = _role))
      AND (termo IS NULL OR p.display_name ILIKE '%'||termo||'%'
           OR p.legal_name ILIKE '%'||termo||'%'
           OR p.social_name ILIKE '%'||termo||'%'
           OR p.code ILIKE '%'||termo||'%'
           OR (canon IS NOT NULL AND p.doc_canon LIKE '%'||canon||'%'))
  ), contagem AS (SELECT count(*)::bigint AS n FROM base)
  SELECT b.id, b.kind, b.code, b.display_name, b.legal_name, b.social_name,
         b.doc_masked,
         b.birth_date, b.status, b.is_active, b.created_at, b.updated_at,
         (SELECT n FROM contagem)
  FROM base b
  ORDER BY b.updated_at DESC
  LIMIT greatest(coalesce(_limit,20),1) OFFSET greatest(coalesce(_offset,0),0);
END $$;

revoke all on function public.list_parties(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.list_parties(text,text,text,text,integer,integer) to authenticated;

create or replace function public.party_doc_reveal(_id uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v text;
begin
  if not public.has_capability(auth.uid(), 'registry.doc.view') then
    raise exception 'Sem permissão para ver documentos.' using errcode = '42501';
  end if;
  select p.doc into v from public.parties p where p.id = _id;
  if not found then raise exception 'Cadastro não encontrado.' using errcode = 'P0002'; end if;
  insert into public.audit_logs(actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'doc.reveal', 'parties', _id::text, jsonb_build_object('em', now()));
  return v;
end $$;
revoke all on function public.party_doc_reveal(uuid) from public, anon;
grant execute on function public.party_doc_reveal(uuid) to authenticated;

-- ============ P0.3 CUSTO DO ESTOQUE ============
revoke select on public.stock_movements from authenticated, anon;
grant select (id, kind, variant_id, from_location_id, to_location_id, quantity,
  reason_code, reference, note, balance_after, created_by, created_at, idempotency_key)
  on public.stock_movements to authenticated;
revoke all on public.variant_costs from anon;

create or replace function public.stock_movements_list(
  _search text default null, _kind text default null, _variant uuid default null,
  _page integer default 0, _size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'quantity', m.quantity,
        'unit_cost_cents', case when ver_custo then m.unit_cost_cents else null end,
        'reason_code', m.reason_code, 'reference', m.reference, 'note', m.note,
        'balance_after', m.balance_after, 'created_at', m.created_at,
        'variante', v.label, 'sku', v.sku, 'produto', pr.name,
        'origem', lo.name, 'destino', ld.name) order by m.created_at desc)
      from (select * from _mv order by created_at desc limit lim offset off) m
      join public.product_variants v on v.id = m.variant_id
      join public.products pr on pr.id = v.product_id
      left join public.locations lo on lo.id = m.from_location_id
      left join public.locations ld on ld.id = m.to_location_id
    ), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.stock_movements_list(text,text,uuid,integer,integer) from public, anon;
grant execute on function public.stock_movements_list(text,text,uuid,integer,integer) to authenticated;

-- ============ P0.4 ESCOPO EXPLÍCITO DA REDE ============
create or replace function public.network_scope()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid; pid uuid; ativo boolean;
begin
  uid := auth.uid();
  if uid is null then raise exception 'acesso negado' using errcode = '42501'; end if;
  select p.party_id, pf.is_active into pid, ativo
    from public.profiles pf left join public.profiles p on p.id = pf.id where pf.id = uid;
  if coalesce(ativo,false) = false then raise exception 'acesso negado' using errcode = '42501'; end if;

  if public.has_role(uid,'master') or public.has_role(uid,'diretoria')
     or public.has_capability(uid,'network.identity.view') then
    return jsonb_build_object('modo','nacional','party_id', null);
  end if;
  if public.has_role(uid,'representante') then
    if pid is null then raise exception 'acesso negado' using errcode = '42501'; end if;
    return jsonb_build_object('modo','representante','party_id', pid);
  end if;
  if public.has_capability(uid,'network.aggregate.view') then
    return jsonb_build_object('modo','agregado','party_id', null);
  end if;
  if public.has_role(uid,'consultora') then
    if pid is null then raise exception 'acesso negado' using errcode = '42501'; end if;
    return jsonb_build_object('modo','proprio','party_id', pid);
  end if;
  raise exception 'acesso negado' using errcode = '42501';
end $$;
revoke all on function public.network_scope() from public, anon;
grant execute on function public.network_scope() to authenticated;

create or replace function public.network_scope_party()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare s jsonb;
begin
  s := public.network_scope();
  if s->>'modo' in ('representante','proprio') then return (s->>'party_id')::uuid; end if;
  return null;
end $$;
revoke all on function public.network_scope_party() from public, anon;
grant execute on function public.network_scope_party() to authenticated;

create or replace function public.network_geo_pontos(_filtros jsonb default '{}'::jsonb)
returns table(lat numeric, lng numeric, total bigint, ativas bigint, aproximado boolean)
language plpgsql stable security definer set search_path = public as $$
declare s jsonb; escopo uuid; kmin integer;
begin
  s := public.network_scope();
  escopo := case when s->>'modo' in ('representante','proprio') then (s->>'party_id')::uuid end;
  kmin := case when s->>'modo' = 'agregado' then 3 else 1 end;
  return query
  select round(c.latitude::numeric, 1), round(c.longitude::numeric, 1),
         count(*), count(*) filter (where c.status='ativo'),
         bool_or(c.geo_precision in ('municipio','estado'))
  from public.v_network_consultants c
  where c.latitude is not null
    and (escopo is null or c.representative_party_id = escopo)
    and (_filtros->>'uf' is null or c.uf = _filtros->>'uf')
  group by 1,2
  having count(*) >= kmin;
end $$;

create or replace function public.network_geo_municipios(_uf text, _filtros jsonb default '{}'::jsonb)
returns table(codigo_ibge text, municipio text, total bigint, ativas bigint, localizadas bigint)
language plpgsql stable security definer set search_path = public as $$
declare s jsonb; escopo uuid;
begin
  s := public.network_scope();
  escopo := case when s->>'modo' in ('representante','proprio') then (s->>'party_id')::uuid end;
  return query
  select coalesce(c.ibge_city_code,''), coalesce(c.city,'Sem município informado'),
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

create or replace function public.network_geo_territorio(_uf text default null, _ibge text default null, _filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb; escopo uuid; ident boolean; res jsonb;
begin
  s := public.network_scope();
  escopo := case when s->>'modo' in ('representante','proprio') then (s->>'party_id')::uuid end;
  ident := public.has_capability(auth.uid(),'network.identity.view') or s->>'modo' = 'representante';
  return (
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
    'identidade_visivel', ident,
    'ultimas_entradas', case when not ident then '[]'::jsonb else
      (select coalesce(jsonb_agg(jsonb_build_object('nome', display_name, 'codigo', code, 'cidade', city, 'uf', uf, 'entrou_em', created_at) order by created_at desc), '[]'::jsonb)
        from (select * from base order by created_at desc limit 5) u) end
  ));
end $$;

create or replace function public.network_geo_overview(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb; escopo uuid; res jsonb;
begin
  s := public.network_scope();
  escopo := case when s->>'modo' in ('representante','proprio') then (s->>'party_id')::uuid end;
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
    select count(*) total,
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
    select u.uf, u.nome, count(b.party_id) total,
      count(b.party_id) filter (where b.status = 'ativo') ativas,
      count(b.party_id) filter (where b.latitude is not null) localizadas
    from public.uf_centroides u left join base b on b.uf = u.uf
    group by u.uf, u.nome
  )
  select jsonb_build_object(
    'atualizado_em', now(),
    'escopo', s->>'modo',
    'indicadores', (select to_jsonb(i) from ind i),
    'estados', (select coalesce(jsonb_agg(to_jsonb(e) order by e.total desc, e.nome), '[]'::jsonb) from estados e)
  ) into res;
  return res;
end $$;

create or replace function public.network_cobertura(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
    select ibge_city_code, city, uf, count(*) total from base
    where ibge_city_code is not null group by 1,2,3
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
end $$;

-- ============ P0.5 LOGS E INTEGRAÇÕES ============
create or replace function public.mask_reference(v text)
returns text language sql immutable set search_path = public as $$
  select case
    when v is null or length(trim(v)) = 0 then null
    else left(md5(coalesce(v,'')), 10) || ':' || right(regexp_replace(v, '[^0-9A-Za-z]', '', 'g'), 2)
  end
$$;
revoke all on function public.mask_reference(text) from public, anon;
grant execute on function public.mask_reference(text) to authenticated, service_role;

create or replace function public.integration_lookups_mask()
returns trigger language plpgsql set search_path = public as $$
begin
  new.referencia := public.mask_reference(new.referencia);
  return new;
end $$;
drop trigger if exists integration_lookups_mask_ref on public.integration_lookups;
create trigger integration_lookups_mask_ref before insert or update on public.integration_lookups
  for each row execute function public.integration_lookups_mask();

update public.integration_lookups
   set referencia = public.mask_reference(referencia)
 where referencia is not null and referencia !~ '^[0-9a-f]{10}:';

revoke select on public.external_data_applications from authenticated, anon;
grant select (id, party_id, provider, mapping_version, response_hash, applied_fields, applied_by, applied_at)
  on public.external_data_applications to authenticated;
revoke all on public.integration_lookups from anon;

create or replace function public.purge_integration_data()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c1 int; c2 int; c3 int;
begin
  delete from public.integration_cache where expires_at < now(); get diagnostics c1 = row_count;
  delete from public.geocode_cache where expires_at < now(); get diagnostics c2 = row_count;
  delete from public.integration_lookups where created_at < now() - interval '90 days'; get diagnostics c3 = row_count;
  return jsonb_build_object('cache', c1, 'geocode_cache', c2, 'lookups', c3);
end $$;
revoke all on function public.purge_integration_data() from public, anon, authenticated;
grant execute on function public.purge_integration_data() to service_role;