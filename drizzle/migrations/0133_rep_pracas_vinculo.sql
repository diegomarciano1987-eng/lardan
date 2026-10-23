create or replace function public.rep_pracas_vinculo(_rep uuid, _consultora uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_codes int[]; v_res jsonb; v_sug uuid;
begin
  if not (has_capability(auth.uid(),'registry.view') or cob_pode(auth.uid())) then
    raise exception 'Sem permissão';
  end if;
  select array_agg(distinct x) into v_codes from (
    select unnest(pracas) x from legado_representantes where party_id = _rep
    union select c.codigo from remessas r join cob_pracas c on c.id = r.praca_id where r.representante_party_id = _rep
  ) s;
  with p as (
    select distinct c.id, c.codigo, c.nome from cob_pracas c
    left join legado_pracas l on l.praca_id = c.id
    where c.ativo and (c.codigo = any(coalesce(v_codes,'{}')) or l.codigo = any(coalesce(v_codes,'{}')))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'codigo',codigo,'nome',nome) order by codigo),'[]') into v_res from p;
  if _consultora is not null then
    select c.id into v_sug from legado_consultoras lc join cob_pracas c on c.codigo::text = trim(lc.praca)
    where lc.party_id = _consultora and c.codigo = any(coalesce(v_codes,'{}')) limit 1;
  end if;
  return jsonb_build_object('pracas', v_res, 'sugestao', v_sug);
end $$;
revoke all on function public.rep_pracas_vinculo(uuid, uuid) from public, anon;
grant execute on function public.rep_pracas_vinculo(uuid, uuid) to authenticated;