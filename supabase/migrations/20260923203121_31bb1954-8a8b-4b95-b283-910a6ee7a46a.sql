create or replace function public.limpeza_homolog_total(_executar boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  r record; n int; novos int; rel jsonb; devolvido int := 0;
  excl text[] := array['audit_logs','homolog_purge_runs','homolog_purge_scope','profiles'];
begin
  if auth.uid() is not null then raise exception 'somente rotina interna'; end if;
  create temp table if not exists _esc(tbl text, id uuid, primary key(tbl,id)) on commit drop;
  create temp table if not exists _teste(id uuid primary key) on commit drop;
  truncate _esc; truncate _teste;
  insert into _teste select id from profiles where email ilike '%@lardan.test';
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
  -- tudo criado pelas contas de teste
  for r in select c.table_name t from information_schema.columns c
    join information_schema.columns i on i.table_schema='public' and i.table_name=c.table_name and i.column_name='id' and i.data_type='uuid'
    join information_schema.tables tb on tb.table_schema='public' and tb.table_name=c.table_name and tb.table_type='BASE TABLE'
    where c.table_schema='public' and c.column_name='created_by' and c.data_type='uuid' and c.table_name <> all(excl)
  loop
    execute format('insert into _esc select %L, id from public.%I where created_by in (select id from _teste) on conflict do nothing', r.t, r.t);
  end loop;
  -- locais das maletas de teste
  insert into _esc select 'locations', l.id from locations l join kits k on k.code=l.code
    where l.kind='maleta' and k.id in (select id from _esc where tbl='kits') on conflict do nothing;
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
  -- devolve aos locais reais o efeito das movimentações de teste
  with d as (
    select variant_id, from_location_id loc, quantity q from stock_movements where id in (select id from _esc where tbl='stock_movements') and from_location_id is not null
    union all
    select variant_id, to_location_id, -quantity from stock_movements where id in (select id from _esc where tbl='stock_movements') and to_location_id is not null
  ), g as (select variant_id, loc, sum(q) q from d where loc not in (select id from _esc where tbl='locations') group by 1,2 having sum(q)<>0)
  update stock_balances b set quantity = b.quantity + g.q, updated_at=now() from g
   where b.variant_id=g.variant_id and b.location_id=g.loc and b.id not in (select id from _esc where tbl='stock_balances');
  get diagnostics devolvido = row_count;
  -- reservas de teste em saldos reais
  update stock_balances b set reserved = greatest(0, b.reserved - s.q) from (
    select variant_id, location_id, sum(quantity) q from stock_reservations
    where id in (select id from _esc where tbl='stock_reservations') and status='ativa' group by 1,2) s
   where b.variant_id=s.variant_id and b.location_id=s.location_id and b.id not in (select id from _esc where tbl='stock_balances');
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
  delete from user_roles where user_id in (select id from _teste);
  update profiles set is_active=false, party_id=null where id in (select id from _teste);
  set local session_replication_role = origin;
  insert into audit_logs(action, entity, payload) values ('limpeza_homolog_total','sistema', jsonb_build_object('removidos', rel, 'saldos_reais_devolvidos', devolvido));
  return jsonb_build_object('executado', true, 'removidos', coalesce(rel,'{}'), 'saldos_reais_devolvidos', devolvido);
end $$;
revoke all on function public.limpeza_homolog_total(boolean) from public, anon, authenticated;
grant execute on function public.limpeza_homolog_total(boolean) to service_role;