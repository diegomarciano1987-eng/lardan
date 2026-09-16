
do $$
declare d text := pg_get_functiondef('public.import_job_validate(uuid,integer)'::regprocedure);
        n int;
begin
  d := replace(d,
    'pode_custo boolean; custo int; preco int;',
    'pode_custo boolean; custo int; preco int; pcusto int;');

  d := replace(d,
    E'    custo := v_final;\n',
    E'    custo := v_final;\n\n'
    '    mny := public.import_money(coalesce(nullif(r.raw->>(m->>''preco_custo''),''''), d->>''preco_custo'', ''''));'||E'\n'
    '    IF mny ? ''erro'' THEN st := ''erro'';'||E'\n'
    '      msgs := msgs || jsonb_build_object(''campo'',''preco_custo'',''erro'',mny->>''erro'',''correcao'',''Use o formato 1.234,56.'');'||E'\n'
    '    ELSE pcusto := (mny->>''cents'')::int; END IF;'||E'\n'
    '    IF pcusto IS NULL OR pcusto <= 0 THEN pcusto := nullif(v_final,0); END IF;'||E'\n');

  d := replace(d,
    E'      ''preco_cents'', preco,',
    E'      ''preco_custo_cents'', pcusto,\n      ''preco_cents'', preco,');

  d := replace(d,
    E'    IF preco IS NOT NULL AND preco < 0 THEN',
    E'    IF coalesce(pcusto,0) <= 0 THEN\n'
    '      st := ''erro'';'||E'\n'
    '      msgs := msgs || jsonb_build_object(''campo'',''preco_custo'','||E'\n'
    '        ''erro'',''Preço de custo é obrigatório.'','||E'\n'
    '        ''correcao'',''Inclua a coluna "Preço de custo" na planilha (planilhas antigas podem usar "Valor de custo") e preencha um valor maior que zero.'');'||E'\n'
    '    END IF;'||E'\n'
    '    IF preco IS NOT NULL AND preco < 0 THEN');

  n := (select count(*) from regexp_matches(d, 'preco_custo_cents', 'g'));
  if n <> 1 or d not like '%pcusto int;%' or d not like '%Preço de custo é obrigatório.%' then
    raise exception 'patch validate falhou: n=%', n;
  end if;
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('public.import_job_process(uuid,integer,uuid)'::regprocedure);
        n int;
begin
  d := replace(d,
    E'              raw_piece_cost_cents = coalesce((p->>''valor_bruto_cents'')::int, raw_piece_cost_cents),',
    E'              raw_piece_cost_cents = coalesce((p->>''valor_bruto_cents'')::int, raw_piece_cost_cents),\n'
    '              cost_price_cents = coalesce((p->>''preco_custo_cents'')::int, cost_price_cents),');
  d := replace(d,
    'raw_supplier_id, raw_piece_cost_cents,',
    'raw_supplier_id, raw_piece_cost_cents, cost_price_cents,');
  d := regexp_replace(d,
    '(\(p->>''valor_bruto_cents''\)::int,)(\s*\n?\s*)(nullif\(p->>''medidas''|p->>''medidas'')',
    E'\\1 (p->>''preco_custo_cents'')::int,\\2\\3', 'g');
  n := (select count(*) from regexp_matches(d, 'preco_custo_cents', 'g'));
  if n < 1 then raise exception 'patch process falhou: n=%', n; end if;
  raise notice 'ocorrencias preco_custo_cents=%', n;
  execute d;
end $$;

select pg_get_functiondef('public.import_job_process(uuid,integer,uuid)'::regprocedure) like '%cost_price_cents%' as process_ok;
