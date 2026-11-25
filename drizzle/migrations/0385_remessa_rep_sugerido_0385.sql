create or replace function public.remessa_rep_sugerido(_praca uuid)
returns table(party_id uuid, nome text, consultoras bigint)
language sql stable security definer set search_path = public as $$
  select r.id, r.display_name, count(*)
  from consultant_profiles cp
  join parties r on r.id = cp.representative_party_id and r.status = 'ativo'
  join party_roles pr on pr.party_id = r.id and pr.role = 'representante'
  where cp.praca_id = _praca and _praca is not null
    and (select public.has_capability(auth.uid(), 'kit.manage'))
  group by r.id, r.display_name
  order by count(*) desc, r.display_name
$$;
revoke all on function public.remessa_rep_sugerido(uuid) from public, anon;
grant execute on function public.remessa_rep_sugerido(uuid) to authenticated, service_role;

update public.remessas set representante_party_id = 'f38ce2e8-6973-43e6-bccf-0d2cdc1acc4f'
 where numero = 941 and representante_party_id is null;
insert into public.audit_logs(action, entity, entity_id, payload)
select 'remessa.representante_definir', 'remessas', id::text,
  jsonb_build_object('numero',941,'representante','GUILHERME AUGUSTO PELEGRINI DA SILVA','motivo','Solicitação Diego: abertura sem representante (0385)')
from public.remessas where numero = 941;