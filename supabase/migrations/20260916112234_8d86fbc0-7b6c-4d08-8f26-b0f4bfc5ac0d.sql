
do $$
declare d text := pg_get_functiondef('public.product_save(uuid,jsonb)'::regprocedure);
        n1 int; n2 int; n3 int;
begin
  d := regexp_replace(d, 'raw_piece_cost_cents,\s*measurements,', 'raw_piece_cost_cents, cost_price_cents, markup_percent, measurements,', 'g');
  n1 := (select count(*) from regexp_matches(d, 'cost_price_cents, markup_percent, measurements,', 'g'));

  d := regexp_replace(d,
    '(nullif\(_payload->>''raw_piece_cost_cents'',''''\)::integer,)(\s*nullif\(_payload->>''measurements'')',
    '\1 nullif(_payload->>''cost_price_cents'','''')::integer, nullif(_payload->>''markup_percent'','''')::numeric,\2', 'g');
  n2 := (select count(*) from regexp_matches(d, 'nullif\(_payload->>''cost_price_cents''', 'g'));

  d := regexp_replace(d,
    '(raw_piece_cost_cents = nullif\(_payload->>''raw_piece_cost_cents'',''''\)::integer,)',
    '\1 cost_price_cents = nullif(_payload->>''cost_price_cents'','''')::integer, markup_percent = nullif(_payload->>''markup_percent'','''')::numeric,', 'g');
  n3 := (select count(*) from regexp_matches(d, 'cost_price_cents = nullif', 'g'));

  if n1 <> 1 or n2 <> 1 or n3 <> 1 then
    raise exception 'patch nao aplicado: n1=% n2=% n3=%', n1, n2, n3;
  end if;
  execute d;
end $$;
