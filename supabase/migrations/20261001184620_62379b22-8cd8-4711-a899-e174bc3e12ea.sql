-- Fonte canônica de parcelas (posição histórica na data de corte), espelho Asaas e área "Pagar e receber".

create or replace function public.fin_parcela_posicao(_corte date)
returns table(installment_id uuid, title_id uuid, direction fin_direction, vencimento date, competencia date,
  valor_cents bigint, ajustes_cents bigint, liquidado_cents bigint, saldo_cents bigint)
language sql stable security definer set search_path = public as $$
  select i.id, i.title_id, t.direction, i.vencimento, coalesce(i.competencia, t.competencia, t.emissao),
         i.valor_cents,
         coalesce(adj.v,0)::bigint,
         coalesce(al.v,0)::bigint,
         greatest(i.valor_cents + coalesce(adj.v,0) - coalesce(al.v,0), 0)::bigint
  from financial_installments i
  join financial_titles t on t.id = i.title_id and t.status <> 'cancelado'
  left join lateral (
    select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                    when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end) v
    from financial_adjustments j left join financial_settlements s on s.id = j.settlement_id
    where j.installment_id = i.id and coalesce(s.data, (j.created_at at time zone 'America/Sao_Paulo')::date) <= _corte
  ) adj on true
  left join lateral (
    select sum(case when s.is_reversal then -abs(a.valor_cents) else a.valor_cents end) v
    from financial_allocations a join financial_settlements s on s.id = a.settlement_id
    where a.installment_id = i.id and s.data <= _corte
  ) al on true
$$;
revoke all on function public.fin_parcela_posicao(date) from public, anon, authenticated;
grant execute on function public.fin_parcela_posicao(date) to service_role;

create or replace function public.fin_overview(_de date default null, _ate date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_de date := coalesce(_de, date_trunc('month', v_hoje)::date);
        v_ate date := coalesce(_ate, (date_trunc('month', v_hoje) + interval '1 month - 1 day')::date);
        v_corte date := least(coalesce(_ate, v_hoje), v_hoje);
        v_ref date := least(v_ate + 1, v_hoje);
        r jsonb;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  if v_de > v_ate then raise exception 'Período inválido: início depois do fim.'; end if;
  with p as (select * from fin_parcela_posicao(v_corte)),
  liq as (select direction, sum(case when is_reversal then -abs(valor_cents) else valor_cents end) v, count(*) n
          from financial_settlements where data between v_de and least(v_ate, v_hoje) group by direction)
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'data_corte_saldo', v_corte,
    'data_referencia_vencidos', v_ref,
    'a_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and saldo_cents>0 and vencimento between v_de and v_ate),0),
    'a_receber_qtd', (select count(*) from p where direction='receivable' and saldo_cents>0 and vencimento between v_de and v_ate),
    'a_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and saldo_cents>0 and vencimento between v_de and v_ate),0),
    'a_pagar_qtd', (select count(*) from p where direction='payable' and saldo_cents>0 and vencimento between v_de and v_ate),
    'vencido_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and saldo_cents>0 and vencimento between v_de and v_ate and vencimento < v_ref),0),
    'vencido_receber_qtd', (select count(*) from p where direction='receivable' and saldo_cents>0 and vencimento between v_de and v_ate and vencimento < v_ref),
    'vencido_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and saldo_cents>0 and vencimento between v_de and v_ate and vencimento < v_ref),0),
    'vencido_pagar_qtd', (select count(*) from p where direction='payable' and saldo_cents>0 and vencimento between v_de and v_ate and vencimento < v_ref),
    'atraso_anterior_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and saldo_cents>0 and vencimento < v_de),0),
    'atraso_anterior_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and saldo_cents>0 and vencimento < v_de),0),
    'proj30_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and saldo_cents>0 and vencimento between v_hoje and v_hoje+30),0),
    'proj30_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and saldo_cents>0 and vencimento between v_hoje and v_hoje+30),0),
    'proj60_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and saldo_cents>0 and vencimento between v_hoje and v_hoje+60),0),
    'proj60_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and saldo_cents>0 and vencimento between v_hoje and v_hoje+60),0),
    'proj90_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and saldo_cents>0 and vencimento between v_hoje and v_hoje+90),0),
    'proj90_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and saldo_cents>0 and vencimento between v_hoje and v_hoje+90),0),
    'recebido_periodo_cents', coalesce((select v from liq where direction='receivable'),0),
    'recebido_qtd', coalesce((select n from liq where direction='receivable'),0),
    'pago_periodo_cents', coalesce((select v from liq where direction='payable'),0),
    'pago_qtd', coalesce((select n from liq where direction='payable'),0),
    'saldo_contas_cents', coalesce((select sum(fin_saldo_conta(a.id, v_corte)) from financial_accounts a where a.is_active and not a.is_homologacao),0),
    'titulos_pendentes_aprovacao', coalesce((select count(*) from financial_titles where approval_status='pendente'),0),
    'asaas_a_vincular_qtd', (select count(*) from asaas_charges c join asaas_accounts ac on ac.id=c.account_id and ac.environment='producao'
        where c.title_id is null and c.reconcile_status <> 'ignorado' and coalesce(c.external_status,'') not in ('DELETED','REFUNDED') and c.due_date between v_de and v_ate),
    'asaas_a_vincular_cents', coalesce((select sum(c.value_cents) from asaas_charges c join asaas_accounts ac on ac.id=c.account_id and ac.environment='producao'
        where c.title_id is null and c.reconcile_status <> 'ignorado' and coalesce(c.external_status,'') not in ('DELETED','REFUNDED') and c.due_date between v_de and v_ate),0)
  ) into r;
  return r;
end $function$;

-- Lista unificada: parcelas (receber/pagar) + cobranças Asaas ainda sem vínculo, com totais no servidor.
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
  create temp table if not exists _pr(like _pr_tipo) on commit drop;
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
           p.title_id, null::text as external_id, null::text as invoice_url
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
           c.value_cents, 0::bigint, coalesce(c.received_cents,0), case when coalesce(c.received_cents,0)>0 then 0 else c.value_cents end,
           'a_vincular'::text, 'Asaas'::text, null::text, null::uuid, c.external_id, c.invoice_url
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
               'clientes', (select count(distinct pessoa) from f where tipo='cobranca_asaas'))
         )
    into v_rows, v_tot;
  return jsonb_build_object('rows', v_rows, 'totais', v_tot, 'periodo', jsonb_build_object('de',v_de,'ate',v_ate,'corte',v_corte),
    'criterio', 'Uma linha por parcela, com saldo na data de corte (fim do período ou hoje). Cobranças Asaas sem vínculo aparecem como "A vincular" e ficam fora dos totais de parcelas até a conciliação.');
end $function$;

-- Liquidações (recebido/pago) por data de pagamento: composição exata dos cards.
create or replace function public.fin_liquidacoes_list(_direction text, _de date, _ate date, _limit int default 50, _offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_dir fin_direction := _direction::fin_direction; v_rows jsonb; v_n bigint; v_s bigint;
begin
  if not has_capability(auth.uid(), case when v_dir='payable' then 'finance.payable.view' else 'finance.receivable.view' end) then raise exception 'Sem permissão'; end if;
  with f as (
    select s.id, s.data, case when s.is_reversal then -abs(s.valor_cents) else s.valor_cents end as valor_cents, s.is_reversal, s.referencia,
           a.nome as conta,
           (select string_agg(distinct t.descricao, ' · ') from financial_allocations al join financial_installments i on i.id=al.installment_id
              join financial_titles t on t.id=i.title_id where al.settlement_id=s.id) as descricao,
           (select string_agg(distinct coalesce(p.display_name,p.legal_name), ', ') from financial_allocations al join financial_installments i on i.id=al.installment_id
              join financial_titles t on t.id=i.title_id join parties p on p.id=t.party_id where al.settlement_id=s.id) as pessoa
    from financial_settlements s left join financial_accounts a on a.id = s.financial_account_id
    where s.direction = v_dir and s.data between _de and least(_ate, v_hoje)
  )
  select coalesce((select jsonb_agg(to_jsonb(x) order by x.data, x.id) from (select * from f order by data, id limit greatest(least(_limit,500),1) offset greatest(_offset,0)) x),'[]'::jsonb),
         (select count(*) from f), (select coalesce(sum(valor_cents),0) from f) into v_rows, v_n, v_s;
  return jsonb_build_object('rows', v_rows, 'total', v_n, 'soma_cents', v_s,
    'criterio', 'Liquidações efetivas pela data de pagamento, de início até o menor entre o fim do período e hoje; estornos entram negativos.');
end $function$;

revoke all on function public.fin_pagar_receber(text,date,date,text,text,text,int,int) from public, anon;
grant execute on function public.fin_pagar_receber(text,date,date,text,text,text,int,int) to authenticated;
revoke all on function public.fin_liquidacoes_list(text,date,date,int,int) from public, anon;
grant execute on function public.fin_liquidacoes_list(text,date,date,int,int) to authenticated;
revoke all on function public.fin_overview(date,date) from public, anon;
grant execute on function public.fin_overview(date,date) to authenticated;

-- Registro das sincronizações do espelho Asaas
create table public.asaas_charge_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaas_accounts(id),
  filtro text not null,
  de date not null, ate date not null,
  status text not null default 'executando' check (status in ('executando','concluida','falhou')),
  paginas int not null default 0, recebidas int not null default 0, inseridas int not null default 0, atualizadas int not null default 0,
  erro text, iniciado_por uuid, iniciado_em timestamptz not null default now(), concluido_em timestamptz
);
grant select on public.asaas_charge_sync_runs to authenticated;
grant all on public.asaas_charge_sync_runs to service_role;
alter table public.asaas_charge_sync_runs enable row level security;
create policy "Financeiro vê sincronizações" on public.asaas_charge_sync_runs for select to authenticated
  using (public.has_capability(auth.uid(),'finance.receivable.view'));

-- Espelho: grava cobranças existentes do provedor, sem vínculo, sem baixa, sem criar nada no Asaas. Idempotente por (conta, id externo).
create or replace function public.asaas_espelho_upsert(_account_id uuid, _rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare r jsonb; v_ins int := 0; v_upd int := 0; v_party uuid; v_id uuid; v_old record;
begin
  perform set_config('lardann.asaas_link','on', true);
  for r in select * from jsonb_array_elements(_rows) loop
    select party_id into v_party from asaas_customers where account_id=_account_id and external_id = r->>'customer';
    select * into v_old from asaas_charges where account_id=_account_id and external_id = r->>'id';
    if v_old.id is null then
      insert into asaas_charges(account_id, external_id, customer_external_id, party_id, value_cents, net_value_cents, due_date, payment_date, credit_date,
        confirmed_date, billing_type, external_status, invoice_url, installment_external_id, installment_number, raw, reconcile_status)
      values (_account_id, r->>'id', r->>'customer', v_party, round((r->>'value')::numeric*100), round(nullif(r->>'netValue','')::numeric*100),
        (r->>'dueDate')::date, nullif(r->>'paymentDate','')::date, nullif(r->>'creditDate','')::date, nullif(r->>'confirmedDate','')::date,
        r->>'billingType', r->>'status', r->>'invoiceUrl', r->>'installment', nullif(r->>'installmentNumber','')::int, r, 'pendente');
      v_ins := v_ins + 1;
    else
      update asaas_charges set value_cents = round((r->>'value')::numeric*100), net_value_cents = round(nullif(r->>'netValue','')::numeric*100),
        due_date=(r->>'dueDate')::date, payment_date=nullif(r->>'paymentDate','')::date, credit_date=nullif(r->>'creditDate','')::date,
        confirmed_date=nullif(r->>'confirmedDate','')::date, external_status=r->>'status', invoice_url=r->>'invoiceUrl', raw=r,
        party_id = coalesce(party_id, v_party)
      where id = v_old.id and (external_status is distinct from r->>'status' or value_cents <> round((r->>'value')::numeric*100)
        or due_date is distinct from (r->>'dueDate')::date or payment_date is distinct from nullif(r->>'paymentDate','')::date);
      if found then v_upd := v_upd + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('inseridas', v_ins, 'atualizadas', v_upd);
end $function$;
revoke all on function public.asaas_espelho_upsert(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.asaas_espelho_upsert(uuid,jsonb) to service_role;