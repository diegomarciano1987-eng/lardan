do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_job_process';

  novo := replace(src,
    'variant_id, supplier_id, cost_cents, note, raw_supplier_id, raw_piece_cost_cents, cost_price_cents,',
    'variant_id, supplier_id, cost_cents, note, raw_supplier_id, raw_piece_cost_cents,');
  if novo = src then raise exception 'coluna inexistente não encontrada na importação'; end if;
  execute novo;
end $$;