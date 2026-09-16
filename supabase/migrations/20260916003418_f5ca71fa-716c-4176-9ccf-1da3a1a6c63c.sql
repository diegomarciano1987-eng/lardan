-- registrar arquivo -------------------------------------------------------
create or replace function public.fin_statement_file_register(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_file uuid; v_imp uuid; v_ex record;
begin
  if not has_capability(auth.uid(),'finance.statement.import') then raise exception 'Sem permissão para importar extratos'; end if;
  select f.id as file_id, i.id as import_id into v_ex
    from financial_statement_files f left join financial_statement_imports i on i.file_id = f.id
   where f.sha256 = _payload->>'sha256' limit 1;
  if found then
    return jsonb_build_object('file_id', v_ex.file_id, 'import_id', v_ex.import_id, 'repetido', true);
  end if;
  insert into financial_statement_files (financial_account_id, storage_path, original_name, format, size_bytes, sha256, created_by)
  values ((_payload->>'financial_account_id')::uuid, _payload->>'storage_path', _payload->>'original_name',
          (_payload->>'format')::fin_statement_format, coalesce((_payload->>'size_bytes')::bigint,0),
          _payload->>'sha256', auth.uid())
  returning id into v_file;
  insert into financial_statement_imports (file_id, financial_account_id, created_by)
  values (v_file, (_payload->>'financial_account_id')::uuid, auth.uid())
  returning id into v_imp;
  insert into financial_reconciliation_events (import_id, evento, payload, actor_id)
  values (v_imp, 'arquivo_registrado', jsonb_build_object('sha256', _payload->>'sha256', 'nome', _payload->>'original_name'), auth.uid());
  return jsonb_build_object('file_id', v_file, 'import_id', v_imp, 'repetido', false);
end $$;

-- gravar linhas ------------------------------------------------------------
create or replace function public.fin_statement_lines_stage(_import uuid, _lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp financial_statement_imports%rowtype; e jsonb; v_hash text; v_status fin_statement_line_status;
  v_valor bigint; v_data date; v_kind text; v_err text;
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
    v_data := nullif(e->>'data','')::date;
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
      if exists (select 1 from financial_statement_lines l
                  where l.financial_account_id = imp.financial_account_id and l.hash = v_hash and l.status <> 'repetida') then
        v_status := 'repetida'; c_rep := c_rep + 1;
      else
        v_status := 'pendente'; c_ok := c_ok + 1;
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
end $$;

-- sugestões ----------------------------------------------------------------
create or replace function public.fin_statement_suggest(_line uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l financial_statement_lines%rowtype; v_dir fin_direction; v_res jsonb;
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  select * into l from financial_statement_lines where id = _line;
  if l.id is null then raise exception 'Linha não encontrada'; end if;
  v_dir := case when l.kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;
  delete from financial_match_suggestions where line_id = _line;

  insert into financial_match_suggestions (line_id, installment_id, score, reasons)
  select _line, c.id, c.score, c.reasons from (
    select i.id,
      (case when i.valor_cents - i.pago = l.valor_cents then 50
            when i.valor_cents = l.valor_cents then 30 else 0 end)
      + (case when abs(i.vencimento - l.data) = 0 then 20
              when abs(i.vencimento - l.data) <= 3 then 12
              when abs(i.vencimento - l.data) <= 7 then 6
              when abs(i.vencimento - l.data) <= 15 then 2 else 0 end)
      + (case when coalesce(t.documento,'') <> '' and coalesce(l.documento,'') <> ''
               and upper(t.documento) = upper(l.documento) then 25 else 0 end)
      + (case when p.nome is not null and coalesce(l.historico,'') <> ''
               and unaccent_lower(l.historico) like '%' || unaccent_lower(split_part(p.nome,' ',1)) || '%' then 20 else 0 end)
      as score,
      jsonb_build_object('valor', i.valor_cents - i.pago = l.valor_cents,
                         'dias', abs(i.vencimento - l.data),
                         'documento', coalesce(t.documento,''),
                         'contraparte', coalesce(p.nome,'')) as reasons
    from (
      select i.*, coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0) as pago
      from financial_installments i) i
    join financial_titles t on t.id = i.title_id
    left join parties p on p.id = t.party_id
    where t.direction = v_dir and t.status in ('ativo','aprovado','submetido')
      and i.settlement_status in ('nao_liquidado','parcial')
      and i.valor_cents - i.pago > 0
  ) c
  where c.score >= 20
  order by c.score desc limit 10;

  select coalesce(jsonb_agg(jsonb_build_object('installment_id', s.installment_id, 'score', s.score,
           'reasons', s.reasons, 'vencimento', i.vencimento, 'valor_cents', i.valor_cents,
           'aberto_cents', i.valor_cents - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id=i.id),0),
           'titulo', t.descricao, 'contraparte', p.nome) order by s.score desc), '[]'::jsonb)
    into v_res
  from financial_match_suggestions s
  join financial_installments i on i.id = s.installment_id
  join financial_titles t on t.id = i.title_id
  left join parties p on p.id = t.party_id
  where s.line_id = _line;
  return v_res;
end $$;

-- conciliar ----------------------------------------------------------------
create or replace function public.fin_reconcile(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text; v_fp text; v_intent jsonb; v_ex financial_reconciliations%rowtype;
  v_acc uuid; v_dir fin_direction; v_kind text; v_soma_linhas bigint := 0; v_soma_aloc bigint := 0;
  v_tarifa bigint := coalesce((_payload->>'tarifa_cents')::bigint,0);
  v_juros bigint := coalesce((_payload->>'juros_cents')::bigint,0);
  v_desc bigint := coalesce((_payload->>'desconto_cents')::bigint,0);
  v_exced boolean := coalesce((_payload->>'permitir_excedente')::boolean,false);
  v_data date; l record; e jsonb; v_set jsonb; v_rec uuid; v_inst uuid; v_aberto bigint; v_alvo uuid;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  v_key := nullif(_payload->>'idempotency_key','');

  select jsonb_build_object(
    'linhas', (select coalesce(jsonb_agg(x order by x::text),'[]'::jsonb) from jsonb_array_elements_text(_payload->'line_ids') x),
    'alocacoes', (select coalesce(jsonb_agg(y order by y->>'installment_id', y->>'valor_cents'),'[]'::jsonb) from jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb)) y),
    'tarifa', v_tarifa, 'juros', v_juros, 'desconto', v_desc) into v_intent;
  v_fp := fin_fingerprint(v_intent);

  if v_key is not null then
    select * into v_ex from financial_reconciliations where idempotency_key = v_key;
    if found then
      if v_ex.payload_fingerprint <> v_fp then
        raise exception 'Colisão de chave de idempotência: a chave % já foi usada com outro conteúdo.', v_key using errcode='23505';
      end if;
      return jsonb_build_object('id', v_ex.id, 'settlement_id', v_ex.settlement_id, 'repetido', true);
    end if;
  end if;

  for l in select * from financial_statement_lines
            where id in (select (x)::uuid from jsonb_array_elements_text(_payload->'line_ids') x) for update loop
    if l.status not in ('pendente','parcial','divergente') then
      raise exception 'Linha % não está disponível para conciliação (situação: %)', l.line_no, l.status;
    end if;
    if v_acc is null then v_acc := l.financial_account_id; v_kind := l.kind; v_data := l.data;
    elsif v_acc <> l.financial_account_id then raise exception 'As linhas selecionadas são de contas diferentes';
    elsif v_kind <> l.kind then raise exception 'Não é possível misturar entradas e saídas na mesma conciliação';
    end if;
    v_soma_linhas := v_soma_linhas + (l.valor_cents - l.conciliado_cents);
    if l.data > v_data then v_data := l.data; end if;
  end loop;
  if v_acc is null then raise exception 'Selecione ao menos uma linha do extrato'; end if;
  if v_soma_linhas <= 0 then raise exception 'As linhas selecionadas já estão conciliadas'; end if;
  v_dir := case when v_kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;

  for e in select * from jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb)) loop
    v_inst := (e->>'installment_id')::uuid;
    select i.valor_cents
      + coalesce((select sum(case when kind in ('juros','multa','tarifa') then valor_cents else -valor_cents end)
                    from financial_adjustments where installment_id = i.id),0)
      - coalesce((select sum(valor_cents) from financial_allocations where installment_id = i.id),0)
      into v_aberto
      from financial_installments i join financial_titles t on t.id = i.title_id
     where i.id = v_inst and t.direction = v_dir for update;
    if v_aberto is null then raise exception 'Parcela não encontrada ou de natureza incompatível com a linha bancária'; end if;
    if (e->>'valor_cents')::bigint > v_aberto + v_tarifa + v_desc and not v_exced then
      raise exception 'Valor alocado maior que o saldo em aberto da parcela. Marque como excedente explicitamente.';
    end if;
    v_soma_aloc := v_soma_aloc + (e->>'valor_cents')::bigint;
  end loop;
  if v_soma_aloc <> v_soma_linhas then
    raise exception 'A soma alocada (%) precisa ser igual ao valor conciliado do extrato (%)', v_soma_aloc, v_soma_linhas;
  end if;

  v_set := fin_settlement_create(jsonb_build_object(
    'direction', v_dir, 'financial_account_id', v_acc, 'data', v_data::text,
    'valor_cents', v_soma_linhas, 'referencia', coalesce(_payload->>'observacao','Conciliação bancária'),
    'idempotency_key', case when v_key is null then null else 'conc:' || v_key end,
    'alocacoes', coalesce(_payload->'alocacoes','[]'::jsonb)));

  insert into financial_reconciliations (financial_account_id, settlement_id, idempotency_key, payload_fingerprint,
    observacao, created_by)
  values (v_acc, (v_set->>'id')::uuid, v_key, v_fp, nullif(_payload->>'observacao',''), auth.uid())
  returning id into v_rec;

  -- ajustes explícitos na primeira parcela alocada
  select (jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb))->>'installment_id')::uuid into v_alvo limit 1;
  if v_alvo is not null then
    if v_tarifa > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
      values (v_alvo, (v_set->>'id')::uuid, 'tarifa', v_tarifa, 'Tarifa bancária na conciliação', auth.uid()); end if;
    if v_juros > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
      values (v_alvo, (v_set->>'id')::uuid, 'juros', v_juros, 'Juros reconhecidos na conciliação', auth.uid()); end if;
    if v_desc > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
      values (v_alvo, (v_set->>'id')::uuid, 'desconto', v_desc, 'Desconto reconhecido na conciliação', auth.uid()); end if;
    if v_tarifa + v_juros + v_desc > 0 then perform fin_installment_refresh(v_alvo); end if;
  end if;

  for l in select * from financial_statement_lines
            where id in (select (x)::uuid from jsonb_array_elements_text(_payload->'line_ids') x) loop
    insert into financial_reconciliation_allocations (reconciliation_id, line_id, installment_id, valor_cents)
    values (v_rec, l.id, v_alvo, l.valor_cents - l.conciliado_cents);
    update financial_statement_lines
       set conciliado_cents = l.valor_cents, status = 'conciliada', updated_at = now()
     where id = l.id;
  end loop;

  insert into financial_reconciliation_events (reconciliation_id, evento, payload, actor_id)
  values (v_rec, 'conciliado', jsonb_build_object('settlement_id', v_set->>'id', 'valor_cents', v_soma_linhas,
    'tarifa', v_tarifa, 'juros', v_juros, 'desconto', v_desc), auth.uid());

  return jsonb_build_object('id', v_rec, 'settlement_id', v_set->>'id', 'repetido', false, 'valor_cents', v_soma_linhas);
end $$;

-- desfazer -----------------------------------------------------------------
create or replace function public.fin_reconcile_undo(_reconciliation uuid, _motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r financial_reconciliations%rowtype; v_new uuid; a record;
begin
  if not has_capability(auth.uid(),'finance.reconcile.undo') then raise exception 'Sem permissão para desfazer conciliação'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Desfazer conciliação exige motivo'; end if;
  select * into r from financial_reconciliations where id = _reconciliation for update;
  if r.id is null then raise exception 'Conciliação não encontrada'; end if;
  if r.status <> 'ativa' then raise exception 'Esta conciliação já foi desfeita'; end if;

  perform fin_settlement_reverse(r.settlement_id, _motivo);

  insert into financial_reconciliations (financial_account_id, settlement_id, status, motivo, reversed_of, is_reversal, created_by)
  values (r.financial_account_id, r.settlement_id, 'estorno', _motivo, r.id, true, auth.uid())
  returning id into v_new;
  update financial_reconciliations set status = 'estornada', motivo = _motivo where id = r.id;

  for a in select * from financial_reconciliation_allocations where reconciliation_id = r.id loop
    update financial_statement_lines
       set conciliado_cents = greatest(conciliado_cents - a.valor_cents, 0),
           status = case when greatest(conciliado_cents - a.valor_cents,0) = 0 then 'pendente' else 'parcial' end,
           updated_at = now()
     where id = a.line_id;
  end loop;

  insert into financial_reconciliation_events (reconciliation_id, evento, motivo, payload, actor_id)
  values (r.id, 'desfeita', _motivo, jsonb_build_object('estorno_id', v_new), auth.uid());
  return v_new;
end $$;

-- marcar linha -------------------------------------------------------------
create or replace function public.fin_statement_line_flag(_line uuid, _status text, _motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_capability(auth.uid(),'finance.statement.flag') then raise exception 'Sem permissão'; end if;
  if _status not in ('ignorada','divergente','pendente') then raise exception 'Situação inválida'; end if;
  if _status <> 'pendente' and coalesce(_motivo,'') = '' then raise exception 'Informe o motivo'; end if;
  if exists (select 1 from financial_statement_lines where id=_line and status = 'conciliada') then
    raise exception 'Linha conciliada: desfaça a conciliação antes de alterar a situação';
  end if;
  update financial_statement_lines set status = _status::fin_statement_line_status,
    flag_reason = nullif(_motivo,''), updated_at = now() where id = _line;
  insert into financial_reconciliation_events (line_id, evento, motivo, actor_id)
  values (_line, 'linha_' || _status, _motivo, auth.uid());
end $$;

-- listagem e resumo --------------------------------------------------------
create or replace function public.fin_statement_lines_list(_filtros jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_total int; v_lim int := least(coalesce((_filtros->>'limit')::int,25),100);
  v_off int := coalesce((_filtros->>'offset')::int,0); v_q text := nullif(_filtros->>'q','');
  v_acc uuid := nullif(_filtros->>'financial_account_id','')::uuid;
  v_st text := nullif(_filtros->>'status',''); v_imp uuid := nullif(_filtros->>'import_id','')::uuid;
  v_de date := nullif(_filtros->>'de','')::date; v_ate date := nullif(_filtros->>'ate','')::date;
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  with base as (
    select l.* from financial_statement_lines l
    where (v_acc is null or l.financial_account_id = v_acc)
      and (v_st is null or l.status::text = v_st)
      and (v_imp is null or l.import_id = v_imp)
      and (v_de is null or l.data >= v_de)
      and (v_ate is null or l.data <= v_ate)
      and (v_q is null or l.historico ilike '%'||v_q||'%' or l.documento ilike '%'||v_q||'%' or l.bank_id ilike '%'||v_q||'%')
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc, x.line_no), '[]'::jsonb), (select count(*) from base)
    into v_rows, v_total
  from (select * from base order by data desc, line_no limit v_lim offset v_off) x;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;

create or replace function public.fin_statement_overview(_filtros jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_acc uuid := nullif(_filtros->>'financial_account_id','')::uuid;
  v_de date := nullif(_filtros->>'de','')::date; v_ate date := nullif(_filtros->>'ate','')::date;
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'entradas_cents', coalesce(sum(case when kind='entrada' then valor_cents else 0 end),0),
    'saidas_cents', coalesce(sum(case when kind='saida' then valor_cents else 0 end),0),
    'pendentes', count(*) filter (where status='pendente'),
    'conciliadas', count(*) filter (where status='conciliada'),
    'parciais', count(*) filter (where status='parcial'),
    'divergentes', count(*) filter (where status='divergente'),
    'ignoradas', count(*) filter (where status='ignorada'),
    'invalidas', count(*) filter (where status='invalida'),
    'repetidas', count(*) filter (where status='repetida'),
    'total', count(*)) into v
  from financial_statement_lines
  where (v_acc is null or financial_account_id = v_acc)
    and (v_de is null or data >= v_de) and (v_ate is null or data <= v_ate);
  return v;
end $$;

revoke all on function public.fin_statement_file_register(jsonb), public.fin_statement_lines_stage(uuid,jsonb),
  public.fin_statement_suggest(uuid), public.fin_reconcile(jsonb), public.fin_reconcile_undo(uuid,text),
  public.fin_statement_line_flag(uuid,text,text), public.fin_statement_lines_list(jsonb),
  public.fin_statement_overview(jsonb) from public, anon;
grant execute on function public.fin_statement_file_register(jsonb), public.fin_statement_lines_stage(uuid,jsonb),
  public.fin_statement_suggest(uuid), public.fin_reconcile(jsonb), public.fin_reconcile_undo(uuid,text),
  public.fin_statement_line_flag(uuid,text,text), public.fin_statement_lines_list(jsonb),
  public.fin_statement_overview(jsonb) to authenticated;