create or replace function public.limpeza_homolog_total(_executar boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  r record; n int; novos int; rel jsonb; setnull jsonb := '{}'::jsonb;
  excl text[] := array['audit_logs','homolog_purge_runs','homolog_purge_scope','profiles'];
begin
  if auth.uid() is not null then raise exception 'somente rotina interna'; end if;
  create temp table if not exists _esc(tbl text, id uuid, primary key(tbl,id)) on commit drop;
  truncate _esc;
  -- sementes: tudo que é identificado como HOMOLOG / teste
  for r in select * from (values
    ('parties','display_name'),('parties','legal_name'),('products','name'),('products','slug'),
    ('locations','name'),('locations','code'),('financial_accounts','nome'),('import_jobs','file_name'),
    ('import_files','file_name'),('stock_movements','idempotency_key'),('stock_movements','reference'),
    ('stock_reservations','idempotency_key'),('stock_reservations','cancel_reason'),('kit_acceptances','idempotency_key'),
    ('media_assets','alt'),('sales_orders','customer_name'),('sales_orders','idempotency_key'),
    ('financial_titles','descricao'),('cost_centers','codigo'),('chart_of_accounts','codigo'),
    ('financial_settlements','idempotency_key'),('kit_transfers','carrier'),('product_variants','sku'),
    ('product_variants','label'),('suppliers','name'),('contact_points','value'),('taxonomy_slug_history','old_slug'),
    ('showcase_batches','rejected_items')
  ) v(t,c) loop
    execute format('insert into _esc select %L, id from public.%I where %I::text ilike ''%%homolog%%'' or %I::text ilike ''%%@lardan.test%%'' on conflict do nothing', r.t, r.t, r.c, r.c);
  end loop;
  -- propaga para tudo que depende dos registros de teste
  loop
    novos := 0;
    for r in
      select ch.relname child, pa.relname parent, a.attname col
      from pg_constraint k join pg_class ch on ch.oid=k.conrelid join pg_class pa on pa.oid=k.confrelid
      join pg_namespace ns on ns.oid=ch.relnamespace and ns.nspname='public'
      join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
      where k.contype='f' and array_length(k.conkey,1)=1 and k.confdeltype not in ('n','d')
        and ch.relname <> all(excl)
        and exists(select 1 from pg_attribute i where i.attrelid=ch.oid and i.attname='id' and i.atttypid='uuid'::regtype)
    loop
      execute format('insert into _esc select %L, c.id from public.%I c where c.%I in (select id from _esc where tbl=%L) on conflict do nothing', r.child, r.child, r.col, r.parent);
      get diagnostics n = row_count; novos := novos + n;
    end loop;
    exit when novos = 0;
  end loop;
  select jsonb_object_agg(tbl, q) into rel from (select tbl, count(*) q from _esc group by tbl) s;
  if not _executar then return jsonb_build_object('simulacao', true, 'remover', coalesce(rel,'{}')); end if;

  set local session_replication_role = replica;
  -- FKs "set null" e tabelas sem id: soltar/remover referências
  for r in
    select ch.relname child, pa.relname parent, a.attname col, k.confdeltype dt,
      exists(select 1 from pg_attribute i where i.attrelid=ch.oid and i.attname='id' and i.atttypid='uuid'::regtype) temid
    from pg_constraint k join pg_class ch on ch.oid=k.conrelid join pg_class pa on pa.oid=k.confrelid
    join pg_namespace ns on ns.oid=ch.relnamespace and ns.nspname='public'
    join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
    where k.contype='f' and array_length(k.conkey,1)=1
  loop
    continue when not exists(select 1 from _esc where tbl=r.parent);
    if r.child = 'audit_logs' or r.child like 'homolog_purge%' then continue; end if;
    if r.dt in ('n','d') or r.child='profiles' then
      execute format('update public.%I set %I = null where %I in (select id from _esc where tbl=%L)', r.child, r.col, r.col, r.parent);
    elsif not r.temid then
      execute format('delete from public.%I where %I in (select id from _esc where tbl=%L)', r.child, r.col, r.parent);
    end if;
  end loop;
  for r in select distinct tbl from _esc loop
    execute format('delete from public.%I where id in (select id from _esc where tbl=%L)', r.tbl, r.tbl);
  end loop;
  -- contas de teste: sem papéis, inativas
  delete from user_roles where user_id in (select id from profiles where email ilike '%@lardan.test');
  update profiles set is_active=false, party_id=null where email ilike '%@lardan.test';
  set local session_replication_role = origin;
  insert into audit_logs(action, entity, payload) values ('limpeza_homolog_total','sistema', jsonb_build_object('removidos', rel));
  return jsonb_build_object('executado', true, 'removidos', coalesce(rel,'{}'));
end $$;
revoke all on function public.limpeza_homolog_total(boolean) from public, anon, authenticated;
grant execute on function public.limpeza_homolog_total(boolean) to service_role;