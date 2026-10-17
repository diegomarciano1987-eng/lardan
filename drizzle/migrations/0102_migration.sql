create or replace function public.asaas_exec_contato(_party uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email', (select value from contact_points where party_id=_party and kind::text='email' and value ~ '@' order by is_primary desc, updated_at desc limit 1),
    'celular', (select regexp_replace(value,'\D','','g') from contact_points where party_id=_party and kind::text in ('whatsapp','telefone') and length(regexp_replace(value,'\D','','g')) between 10 and 13 order by (kind::text='whatsapp') desc, is_primary desc, updated_at desc limit 1)
  );
$$;
revoke all on function public.asaas_exec_contato(uuid) from public, anon, authenticated;
grant execute on function public.asaas_exec_contato(uuid) to service_role;