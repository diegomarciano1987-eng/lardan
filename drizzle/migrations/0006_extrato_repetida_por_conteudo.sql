create or replace function public.fin_hist_norm(_t text) returns text
language sql immutable set search_path to 'public' as $$
  select btrim(regexp_replace(lower(translate(coalesce(_t,''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
    '[^a-z0-9]+', ' ', 'g'))
$$;

create index if not exists financial_statement_lines_conteudo_idx
  on public.financial_statement_lines (financial_account_id, data, valor_cents);

create or replace function public.fin_statement_lines_stage(_import uuid, _lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare imp financial_statement_imports%rowtype; e jsonb; v_hash text; v_status fin_statement_line_status;
  v_valor bigint; v_data date; v_kind text; v_err text; v_ck text; v_k int; v_prev int;
  v_ocorr jsonb := '{}'::jsonb;
  c_total int := 0; c_ok int := 0; c_inv int := 0; c_rep int := 0;
begin
  if not has_capability(auth.uid(),'finance.statement.import') then raise exception 'Sem permissão para importar extratos'; end if;
  select * into imp from financial_statement_imports where id = _import for update;
  if imp.id is null then raise exception 'Importação não encontrada'; end if;
  if imp.total_linhas > 0 then
    return jsonb_build_object('repetido', true, 'total', imp.total_linhas, 'validas', imp.validas,
      'invalidas', imp.invalidas, 'repetidas', imp.repetidas);
  end if;

  for e in select * from jsonb_array_elements(_lines) loop
    c_total := c_total + 1;
    v_err := nullif(e->>'error_reason','');
    v_valor := nullif(e->>'valor_cents','')::bigint;
    v_data := fin_safe_date(nullif(e->>'data',''));
    v_kind := nullif(e->>'kind','');
    if v_err is null then
      if v_data is null then v_err := 'Data ausente ou ambígua';
      elsif v_valor is null or v_valor = 0 then v_err := 'Valor inválido';
      elsif v_kind not in ('entrada','saida') then v_err := 'Tipo de lançamento indefinido';
      end if;
    end if;

    if v_err is not null then
      v_status := 'invalida'; v_hash := null; c_inv := c_inv + 1;
    else
      v_hash := md5(imp.financial_account_id::text || '|' || v_data::text || '|' || v_valor::text || '|' || v_kind
        || '|' || coalesce(nullif(e->>'bank_id',''), coalesce(e->>'documento','') || coalesce(e->>'historico','') || (e->>'line_no')));
      v_ck := v_data::text || '|' || abs(v_valor)::text || '|' || v_kind || '|' || fin_hist_norm(e->>'historico');
      v_k := coalesce((v_ocorr->>v_ck)::int, 0) + 1;
      v_ocorr := v_ocorr || jsonb_build_object(v_ck, v_k);
      if exists (select 1 from financial_statement_lines l
                  where l.financial_account_id = imp.financial_account_id and l.hash = v_hash and l.status <> 'repetida') then
        v_status := 'repetida'; c_rep := c_rep + 1;
      else
        select count(*) into v_prev from financial_statement_lines l
         where l.financial_account_id = imp.financial_account_id and l.import_id <> _import
           and l.data = v_data and l.valor_cents = abs(v_valor) and l.kind = v_kind
           and l.status not in ('repetida','invalida')
           and fin_hist_norm(l.historico) = fin_hist_norm(e->>'historico');
        if v_prev >= v_k then v_status := 'repetida'; c_rep := c_rep + 1;
        else v_status := 'pendente'; c_ok := c_ok + 1; end if;
      end if;
    end if;

    insert into financial_statement_lines (import_id, file_id, financial_account_id, line_no, raw, raw_text,
      data, valor_cents, kind, historico, documento, bank_id, hash, status, error_reason, created_by)
    values (_import, imp.file_id, imp.financial_account_id, coalesce((e->>'line_no')::int, c_total),
      coalesce(e->'raw','{}'::jsonb), e->>'raw_text', v_data, abs(coalesce(v_valor,0)), v_kind,
      nullif(e->>'historico',''), nullif(e->>'documento',''), nullif(e->>'bank_id',''),
      v_hash, v_status, v_err, auth.uid());
  end loop;

  update financial_statement_imports
     set total_linhas = c_total, validas = c_ok, invalidas = c_inv, repetidas = c_rep, pendentes = c_ok,
         status = 'analisado', updated_at = now()
   where id = _import;
  insert into financial_reconciliation_events (import_id, evento, payload, actor_id)
  values (_import, 'linhas_importadas', jsonb_build_object('total', c_total, 'validas', c_ok, 'invalidas', c_inv, 'repetidas', c_rep), auth.uid());

  return jsonb_build_object('repetido', false, 'total', c_total, 'validas', c_ok, 'invalidas', c_inv, 'repetidas', c_rep);
end $function$;