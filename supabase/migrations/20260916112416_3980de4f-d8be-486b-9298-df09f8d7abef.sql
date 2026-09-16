
do $$
declare d text := pg_get_functiondef('public.import_job_process(uuid,integer,uuid)'::regprocedure);
begin
  d := replace(d,
    E'forn_id, (p->>''valor_bruto_cents'')::int,\n            p->>''cuidados''',
    E'forn_id, (p->>''valor_bruto_cents'')::int, (p->>''preco_custo_cents'')::int,\n            p->>''cuidados''');
  if d not like '%(p->>''preco_custo_cents'')::int,%p->>''cuidados''%' then
    raise exception 'patch values falhou';
  end if;
  execute d;
end $$;
