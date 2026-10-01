create or replace function public.asaas_espelho_upsert(_account_id uuid, _rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare r jsonb; v_ins int := 0; v_upd int := 0; v_party uuid; v_old record;
        v_val bigint; v_net bigint; v_rec bigint; v_fee bigint; v_recebido boolean;
begin
  perform set_config('lardann.asaas_link','on', true);
  for r in select * from jsonb_array_elements(_rows) loop
    v_val := round((r->>'value')::numeric*100);
    v_net := round(nullif(r->>'netValue','')::numeric*100);
    v_recebido := r->>'status' in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH');
    v_rec := case when v_recebido then v_val else null end;
    v_fee := case when v_recebido and v_net is not null then v_val - v_net else null end;
    if not v_recebido then v_net := v_net; end if;
    select party_id into v_party from asaas_customers where account_id=_account_id and external_id = r->>'customer';
    select * into v_old from asaas_charges where account_id=_account_id and external_id = r->>'id';
    if v_old.id is null then
      insert into asaas_charges(account_id, external_id, customer_external_id, party_id, value_cents, net_value_cents, received_cents, fee_cents,
        due_date, payment_date, credit_date, confirmed_date, billing_type, external_status, invoice_url, installment_external_id, installment_number, raw, reconcile_status)
      values (_account_id, r->>'id', r->>'customer', v_party, v_val, v_net, v_rec, v_fee,
        (r->>'dueDate')::date, nullif(r->>'paymentDate','')::date, nullif(r->>'creditDate','')::date, nullif(r->>'confirmedDate','')::date,
        r->>'billingType', r->>'status', r->>'invoiceUrl', r->>'installment', nullif(r->>'installmentNumber','')::int, r, 'pendente');
      v_ins := v_ins + 1;
    else
      update asaas_charges set value_cents = v_val, net_value_cents = v_net, received_cents = v_rec, fee_cents = v_fee,
        due_date=(r->>'dueDate')::date, payment_date=nullif(r->>'paymentDate','')::date, credit_date=nullif(r->>'creditDate','')::date,
        confirmed_date=nullif(r->>'confirmedDate','')::date, external_status=r->>'status', invoice_url=r->>'invoiceUrl', raw=r,
        party_id = coalesce(party_id, v_party)
      where id = v_old.id and (external_status is distinct from r->>'status' or value_cents <> v_val
        or due_date is distinct from (r->>'dueDate')::date or payment_date is distinct from nullif(r->>'paymentDate','')::date
        or received_cents is distinct from v_rec or fee_cents is distinct from v_fee);
      if found then v_upd := v_upd + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('inseridas', v_ins, 'atualizadas', v_upd);
end $function$;
revoke all on function public.asaas_espelho_upsert(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.asaas_espelho_upsert(uuid,jsonb) to service_role;

-- "A vincular" separa cobrança em aberto de cobrança já recebida no provedor; sem rótulo de conta inventado.
create or replace function public.fin_pagar_receber(_natureza text default 'todos', _de date default null, _ate date default null,
  _situacao text default 'todos', _origem text default 'todas', _search text default null, _limit int default 50, _offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_de date := coalesce(_de, date_trunc('month', v_hoje)::date);
        v_ate date := coalesce(_ate, (date_trunc('month', v_hoje) + interval '1 month - 1 day')::date);
        v_corte date := least(v_ate, v_hoje);
        v_ref date := least(v_ate + 1, v_hoje);
        pode_rec boolean := has_capability(auth.uid(),'finance.receivable.view');
        pode_pag boolean := has_capability(auth.uid(),'finance.payable.view');
        v_rows jsonb; v_tot jsonb;
begin
  if not (pode_rec or pode_pag) then raise exception 'Sem permissão'; end if;
  if v_de > v_ate then raise exception 'Período inválido: início depois do fim.'; end if;
  if _natureza = 'receber' and not pode_rec then raise exception 'Sem permissão'; end if;
  if _natureza = 'pagar' and not pode_pag then raise exception 'Sem permissão'; end if;
  with parc as (
    select p.installment_id as id, 'parcela'::text as tipo, p.direction::text as direction,
           case when exists (select 1 from asaas_charges c where c.installment_id = p.installment_id or (c.title_id = p.title_id and c.installment_id is null)) then 'asaas'
                else coalesce(t.origem,'manual') end as origem,
           coalesce(pa.display_name, pa.legal_name, pa.code) as pessoa,
           t.descricao, t.numero as titulo_numero, i.numero, i.total_parcelas, p.vencimento, p.competencia,
           p.valor_cents, p.ajustes_cents, p.liquidado_cents, p.saldo_cents,
           case when p.saldo_cents = 0 then 'quitado' when p.vencimento < v_ref then 'vencido' else 'aberto' end as situacao,
           fa.nome as conta_prevista,
           (select string_agg(distinct a2.nome, ', ') from financial_allocations al join financial_settlements s on s.id=al.settlement_id
              join financial_accounts a2 on a2.id=s.financial_account_id where al.installment_id=p.installment_id and s.data <= v_corte) as conta_liquidacao,
           p.title_id, null::text as external_id, null::text as invoice_url, null::text as status_externo
    from fin_parcela_posicao(v_corte) p
    join financial_installments i on i.id = p.installment_id
    join financial_titles t on t.id = p.title_id
    join parties pa on pa.id = t.party_id
    left join financial_accounts fa on fa.id = t.financial_account_id
    where p.vencimento between v_de and v_ate
      and ((p.direction='receivable' and pode_rec and _natureza in ('todos','receber')) or (p.direction='payable' and pode_pag and _natureza in ('todos','pagar')))
  ), ext as (
    select c.id, 'cobranca_asaas'::text, 'receivable'::text, 'asaas'::text,
           coalesce(pa.display_name, pa.legal_name, cu.name, c.customer_external_id),
           coalesce(c.raw->>'description','Cobrança Asaas'), c.external_id, null::int, null::int, c.due_date, c.due_date,
           c.value_cents, 0::bigint,
           case when c.payment_date is not null and c.payment_date <= v_corte then coalesce(c.received_cents,0) else 0 end,
           case when c.payment_date is not null and c.payment_date <= v_corte then 0 else c.value_cents end,
           'a_vincular'::text, null::text,
           case when c.payment_date is not null then 'Asaas (sem vínculo)' end, null::uuid, c.external_id, c.invoice_url, c.external_status
    from asaas_charges c join asaas_accounts ac on ac.id=c.account_id and ac.environment='producao'
    left join asaas_customers cu on cu.account_id=c.account_id and cu.external_id=c.customer_external_id
    left join parties pa on pa.id = coalesce(c.party_id, cu.party_id)
    where c.title_id is null and c.reconcile_status <> 'ignorado' and coalesce(c.external_status,'') not in ('DELETED','REFUNDED')
      and c.due_date between v_de and v_ate and pode_rec and _natureza in ('todos','receber')
  ), u as (select * from parc union all select * from ext),
  f as (
    select * from u
    where (coalesce(_origem,'todas') = 'todas' or origem = _origem)
      and (coalesce(_situacao,'todos') = 'todos' or situacao = _situacao
           or (_situacao='aberto' and situacao in ('aberto','vencido')))
      and (coalesce(_search,'') = '' or descricao ilike '%'||_search||'%' or coalesce(pessoa,'') ilike '%'||_search||'%'
           or coalesce(titulo_numero,'') ilike '%'||_search||'%' or coalesce(external_id,'') ilike '%'||_search||'%')
  )
  select coalesce((select jsonb_agg(to_jsonb(x) order by x.vencimento, x.descricao, x.id) from
            (select * from f order by vencimento, descricao, id limit greatest(least(_limit,500),1) offset greatest(_offset,0)) x),'[]'::jsonb),
         jsonb_build_object(
           'linhas', (select count(*) from f),
           'receber', jsonb_build_object('qtd', (select count(*) from f where direction='receivable' and tipo='parcela'),
               'valor_cents', (select coalesce(sum(valor_cents),0) from f where direction='receivable' and tipo='parcela'),
               'liquidado_cents', (select coalesce(sum(liquidado_cents),0) from f where direction='receivable' and tipo='parcela'),
               'saldo_cents', (select coalesce(sum(saldo_cents),0) from f where direction='receivable' and tipo='parcela')),
           'pagar', jsonb_build_object('qtd', (select count(*) from f where direction='payable'),
               'valor_cents', (select coalesce(sum(valor_cents),0) from f where direction='payable'),
               'liquidado_cents', (select coalesce(sum(liquidado_cents),0) from f where direction='payable'),
               'saldo_cents', (select coalesce(sum(saldo_cents),0) from f where direction='payable')),
           'asaas_a_vincular', jsonb_build_object('qtd', (select count(*) from f where tipo='cobranca_asaas'),
               'valor_cents', (select coalesce(sum(valor_cents),0) from f where tipo='cobranca_asaas'),
               'aberto_qtd', (select count(*) from f where tipo='cobranca_asaas' and saldo_cents > 0),
               'aberto_cents', (select coalesce(sum(saldo_cents),0) from f where tipo='cobranca_asaas'),
               'recebido_qtd', (select count(*) from f where tipo='cobranca_asaas' and liquidado_cents > 0),
               'recebido_cents', (select coalesce(sum(liquidado_cents),0) from f where tipo='cobranca_asaas'),
               'clientes', (select count(distinct pessoa) from f where tipo='cobranca_asaas'),
               'clientes_aberto', (select count(distinct pessoa) from f where tipo='cobranca_asaas' and saldo_cents > 0))
         )
    into v_rows, v_tot;
  return jsonb_build_object('rows', v_rows, 'totais', v_tot, 'periodo', jsonb_build_object('de',v_de,'ate',v_ate,'corte',v_corte),
    'criterio', 'Uma linha por parcela, com saldo na data de corte (fim do período ou hoje). Cobranças Asaas sem vínculo aparecem como "A vincular" e ficam fora dos totais de parcelas até a conciliação.');
end $function$;