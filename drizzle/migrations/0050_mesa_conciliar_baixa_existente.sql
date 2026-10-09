-- Mesa de conciliação: ligar linha(s) do extrato a uma baixa JÁ lançada, sem criar nova baixa.
create or replace function public.fin_mesa_baixas_existentes(_line_id uuid, _busca text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l financial_statement_lines%rowtype; v_dir fin_direction; v_res jsonb;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  select * into l from financial_statement_lines where id = _line_id;
  if l.id is null then raise exception 'Linha não encontrada'; end if;
  v_dir := case when l.kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;
  with base as (
    select s.id, s.data, s.valor_cents,
      abs(coalesce((select sum(m.valor_cents) from financial_account_movements m where m.settlement_id = s.id),0)) liquido,
      (select string_agg(distinct coalesce(t.numero,'') || ' ' || coalesce(t.descricao,'') || coalesce(' · ' || p.display_name,''), ' | ')
         from financial_allocations a join financial_installments i on i.id = a.installment_id
         join financial_titles t on t.id = i.title_id left join parties p on p.id = t.party_id
        where a.settlement_id = s.id) titulos
    from financial_settlements s
    where s.financial_account_id = l.financial_account_id and s.direction = v_dir
      and not s.is_reversal
      and not exists (select 1 from financial_settlements r where r.reversed_of = s.id)
      and not exists (select 1 from financial_reconciliations rc where rc.settlement_id = s.id and not rc.is_reversal
                        and not exists (select 1 from financial_reconciliations rr where rr.reversed_of = rc.id))
      and s.data between l.data - 60 and l.data + 60
  )
  select coalesce(jsonb_agg(to_jsonb(b) order by abs(b.liquido - (l.valor_cents - l.conciliado_cents)), abs(b.data - l.data)), '[]'::jsonb)
    into v_res
  from (select * from base
         where _busca is null or btrim(_busca) = '' or unaccent(coalesce(titulos,'')) ilike '%' || unaccent(_busca) || '%'
         order by abs(liquido - (l.valor_cents - l.conciliado_cents)), abs(data - l.data) limit 30) b;
  return v_res;
end $$;

create or replace function public.fin_reconcile_baixa_existente(_line_ids uuid[], _settlement uuid, _idempotency_key text default null, _observacao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; s financial_settlements%rowtype; v_soma bigint := 0; v_liq bigint; v_rec uuid; v_ex financial_reconciliations%rowtype;
  v_fp text; v_lin uuid[] := '{}'; v_kind text;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  v_fp := fin_fingerprint(jsonb_build_object('linhas', (select jsonb_agg(x order by x) from unnest(_line_ids) x), 'baixa', _settlement, 'modo', 'existente'));
  if _idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext('fin_reconcile:' || _idempotency_key));
    select * into v_ex from financial_reconciliations where idempotency_key = _idempotency_key;
    if found then
      if v_ex.payload_fingerprint <> v_fp then raise exception 'Colisão de chave de idempotência' using errcode='23505'; end if;
      return jsonb_build_object('id', v_ex.id, 'settlement_id', v_ex.settlement_id, 'repetido', true);
    end if;
  end if;
  select * into s from financial_settlements where id = _settlement for update;
  if s.id is null or s.is_reversal then raise exception 'Baixa não encontrada'; end if;
  if exists (select 1 from financial_settlements r where r.reversed_of = s.id) then raise exception 'Esta baixa foi estornada'; end if;
  if exists (select 1 from financial_reconciliations rc where rc.settlement_id = s.id and not rc.is_reversal
               and not exists (select 1 from financial_reconciliations rr where rr.reversed_of = rc.id)) then
    raise exception 'Esta baixa já está conciliada com outra linha do extrato';
  end if;
  for l in select * from financial_statement_lines where id = any(_line_ids) order by data, line_no for update loop
    if l.status not in ('pendente','parcial','divergente') then raise exception 'Linha % não está disponível (situação: %)', l.line_no, l.status; end if;
    if l.financial_account_id <> s.financial_account_id then raise exception 'A linha e a baixa são de contas diferentes'; end if;
    if (l.kind = 'entrada') <> (s.direction = 'receivable') then raise exception 'Entrada do extrato só liga com recebimento; saída só com pagamento'; end if;
    if v_kind is null then v_kind := l.kind; elsif v_kind <> l.kind then raise exception 'Não misture entradas e saídas'; end if;
    v_soma := v_soma + (l.valor_cents - l.conciliado_cents); v_lin := v_lin || l.id;
  end loop;
  if coalesce(array_length(v_lin,1),0) = 0 then raise exception 'Selecione ao menos uma linha do extrato'; end if;
  -- valor que realmente passou no banco = soma dos movimentos da baixa (bruto ± tarifa)
  v_liq := abs(coalesce((select sum(valor_cents) from financial_account_movements where settlement_id = s.id),0));
  if v_liq <> v_soma then
    raise exception 'O valor do extrato (%) precisa ser igual ao valor que a baixa movimentou na conta (%)', v_soma, v_liq;
  end if;
  insert into financial_reconciliations (financial_account_id, settlement_id, idempotency_key, payload_fingerprint, observacao, created_by)
  values (s.financial_account_id, s.id, _idempotency_key, v_fp, coalesce(nullif(_observacao,''),'Ligado a baixa já lançada'), auth.uid())
  returning id into v_rec;
  insert into financial_reconciliation_allocations (reconciliation_id, line_id, installment_id, valor_cents)
  select v_rec, x.id, null, x.valor_cents - x.conciliado_cents from financial_statement_lines x where x.id = any(v_lin);
  update financial_statement_lines set conciliado_cents = valor_cents, status = 'conciliada', updated_at = now() where id = any(v_lin);
  insert into financial_reconciliation_events (reconciliation_id, evento, payload, actor_id)
  values (v_rec, 'conciliado', jsonb_build_object('settlement_id', s.id, 'valor_cents', v_soma, 'modo', 'baixa_existente'), auth.uid());
  return jsonb_build_object('id', v_rec, 'settlement_id', s.id, 'repetido', false, 'valor_cents', v_soma);
end $$;

revoke execute on function public.fin_mesa_baixas_existentes(uuid, text) from public, anon;
revoke execute on function public.fin_reconcile_baixa_existente(uuid[], uuid, text, text) from public, anon;
grant execute on function public.fin_mesa_baixas_existentes(uuid, text) to authenticated;
grant execute on function public.fin_reconcile_baixa_existente(uuid[], uuid, text, text) to authenticated;