do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname not in ('submit_lead','submit_contact_request','public_catalog_browse',
        'public_catalog_list','public_categories','public_category','public_product')
      and exists (select 1 from aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
                  where r.rolname in ('anon','public') and a.privilege_type = 'EXECUTE')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname not in ('ensure_entity_party','ensure_profile_party','ensure_supplier_party') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;