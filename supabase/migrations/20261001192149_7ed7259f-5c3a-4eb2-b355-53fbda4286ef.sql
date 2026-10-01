create or replace function public.fin_asaas_abertas(_corte date)
returns table(id uuid, due_date date, value_cents bigint, pessoa_chave text)
language sql stable security definer set search_path = public as $$
  select c.id, c.due_date, c.value_cents, coalesce(c.party_id::text, c.customer_external_id)
  from asaas_charges c join asaas_accounts ac on ac.id=c.account_id and ac.environment='producao'
  where c.title_id is null and c.installment_id is null and c.reconcile_status <> 'ignorado'
    and not exists (select 1 from asaas_charge_matches mm where mm.charge_id=c.id and mm.status='confirmado')
    and coalesce(c.external_status,'') not in ('DELETED','REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE')
    and not ((c.payment_date is not null and c.payment_date <= _corte)
             or (c.payment_date is null and c.external_status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')))
$$;
revoke all on function public.fin_asaas_abertas(date) from public, anon, authenticated;
grant execute on function public.fin_asaas_abertas(date) to service_role;

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
  with p0 as (select direction::text as direction, vencimento, saldo_cents, 'lardan'::text as fonte from fin_parcela_posicao(v_corte) where saldo_cents > 0),
  ax as (select 'receivable'::text as direction, due_date as vencimento, value_cents as saldo_cents, 'asaas'::text as fonte from fin_asaas_abertas(v_corte)),
  p as (select * from p0 union all select * from ax),
  liq as (select direction, sum(case when is_reversal then -abs(valor_cents) else valor_cents end) v, count(*) n
          from financial_settlements where data between v_de and least(v_ate, v_hoje) group by direction),
  axr as (select count(*) n, coalesce(sum(c.value_cents),0) v
          from asaas_charges c join asaas_accounts ac on ac.id=c.account_id and ac.environment='producao'
          where c.title_id is null and c.installment_id is null and c.reconcile_status <> 'ignorado'
            and not exists (select 1 from asaas_charge_matches mm where mm.charge_id=c.id and mm.status='confirmado')
            and coalesce(c.external_status,'') not in ('DELETED','REFUNDED')
            and c.due_date between v_de and v_ate
            and ((c.payment_date is not null and c.payment_date <= v_corte)
                 or (c.payment_date is null and c.external_status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH'))))
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'data_corte_saldo', v_corte,
    'data_referencia_vencidos', v_ref,
    'a_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and vencimento between v_de and v_ate),0),
    'a_receber_qtd', (select count(*) from p where direction='receivable' and vencimento between v_de and v_ate),
    'a_receber_lardan_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and fonte='lardan' and vencimento between v_de and v_ate),0),
    'a_receber_lardan_qtd', (select count(*) from p where direction='receivable' and fonte='lardan' and vencimento between v_de and v_ate),
    'a_receber_asaas_cents', coalesce((select sum(saldo_cents) from p where fonte='asaas' and vencimento between v_de and v_ate),0),
    'a_receber_asaas_qtd', (select count(*) from p where fonte='asaas' and vencimento between v_de and v_ate),
    'a_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and vencimento between v_de and v_ate),0),
    'a_pagar_qtd', (select count(*) from p where direction='payable' and vencimento between v_de and v_ate),
    'vencido_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and vencimento between v_de and v_ate and vencimento < v_ref),0),
    'vencido_receber_qtd', (select count(*) from p where direction='receivable' and vencimento between v_de and v_ate and vencimento < v_ref),
    'vencido_receber_asaas_cents', coalesce((select sum(saldo_cents) from p where fonte='asaas' and vencimento between v_de and v_ate and vencimento < v_ref),0),
    'vencido_receber_asaas_qtd', (select count(*) from p where fonte='asaas' and vencimento between v_de and v_ate and vencimento < v_ref),
    'vencido_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and vencimento between v_de and v_ate and vencimento < v_ref),0),
    'vencido_pagar_qtd', (select count(*) from p where direction='payable' and vencimento between v_de and v_ate and vencimento < v_ref),
    'atraso_anterior_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and vencimento < v_de),0),
    'atraso_anterior_receber_asaas_cents', coalesce((select sum(saldo_cents) from p where fonte='asaas' and vencimento < v_de),0),
    'atraso_anterior_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and vencimento < v_de),0),
    'proj30_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and vencimento between v_hoje and v_hoje+30),0),
    'proj30_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and vencimento between v_hoje and v_hoje+30),0),
    'proj60_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and vencimento between v_hoje and v_hoje+60),0),
    'proj60_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and vencimento between v_hoje and v_hoje+60),0),
    'proj90_receber_cents', coalesce((select sum(saldo_cents) from p where direction='receivable' and vencimento between v_hoje and v_hoje+90),0),
    'proj90_pagar_cents', coalesce((select sum(saldo_cents) from p where direction='payable' and vencimento between v_hoje and v_hoje+90),0),
    'recebido_periodo_cents', coalesce((select v from liq where direction='receivable'),0),
    'recebido_qtd', coalesce((select n from liq where direction='receivable'),0),
    'pago_periodo_cents', coalesce((select v from liq where direction='payable'),0),
    'pago_qtd', coalesce((select n from liq where direction='payable'),0),
    'saldo_contas_cents', coalesce((select sum(fin_saldo_conta(a.id, v_corte)) from financial_accounts a where a.is_active and not a.is_homologacao),0),
    'titulos_pendentes_aprovacao', coalesce((select count(*) from financial_titles where approval_status='pendente'),0),
    'asaas_recebido_conferir_qtd', (select n from axr),
    'asaas_recebido_conferir_cents', (select v from axr),
    'asaas_a_vincular_qtd', (select count(*) from p where fonte='asaas' and vencimento between v_de and v_ate),
    'asaas_a_vincular_cents', coalesce((select sum(saldo_cents) from p where fonte='asaas' and vencimento between v_de and v_ate),0)
  ) into r;
  return r;
end $function$;

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
           case when exists (select 1 from asaas_charges c where c.installment_id = p.installment_id or (c.title_id = p.title_id and c.installment_id is null))
                  or exists (select 1 from asaas_charge_matches mm where mm.installment_id = p.installment_id and mm.status='confirmado') then 'asaas'
                else coalesce(t.origem,'manual') end as origem,
           coalesce(pa.display_name, pa.legal_name, pa.code) as pessoa,
           t.descricao, t.numero as titulo_numero, i.numero, i.total_parcelas, p.vencimento, p.competencia,
           p.valor_cents, p.ajustes_cents, p.liquidado_cents, p.saldo_cents,
           case when p.saldo_cents = 0 then 'quitado' when p.vencimento < v_ref then 'vencido' else 'aberto' end as situacao,
           fa.nome as conta_prevista,
           (select string_agg(distinct a2.nome, ', ') from financial_allocations al join financial_settlements s on s.id=al.settlement_id
              join financial_accounts a2 on a2.id=s.financial_account_id where al.installment_id=p.installment_id and s.data <= v_corte) as conta_liquidacao,
           p.title_id, null::text as external_id, null::text as invoice_url, null::text as status_externo,
           true as no_total
    from fin_parcela_posicao(v_corte) p
    join financial_installments i on i.id = p.installment_id
    join financial_titles t on t.id = p.title_id
    join parties pa on pa.id = t.party_id
    left join financial_accounts fa on fa.id = t.financial_account_id
    where p.vencimento between v_de and v_ate
      and ((p.direction='receivable' and pode_rec and _natureza in ('todos','receber')) or (p.direction='payable' and pode_pag and _natureza in ('todos','pagar')))
  ), ext0 as (
    select c.*, ((c.payment_date is not null and c.payment_date <= v_corte)
                 or (c.payment_date is null and c.external_status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH'))) as recebida,
           coalesce(pa.display_name, pa.legal_name, cu.name, c.customer_external_id) as pessoa_nome
    from asaas_charges c join asaas_accounts ac on ac.id=c.account_id and ac.environment='producao'
    left join asaas_customers cu on cu.account_id=c.account_id and cu.external_id=c.customer_external_id
    left join parties pa on pa.id = coalesce(c.party_id, cu.party_id)
    where c.title_id is null and c.installment_id is null and c.reconcile_status <> 'ignorado'
      and not exists (select 1 from asaas_charge_matches mm where mm.charge_id=c.id and mm.status='confirmado')
      and coalesce(c.external_status,'') not in ('DELETED','REFUNDED')
      and c.due_date between v_de and v_ate and pode_rec and _natureza in ('todos','receber')
  ), ext as (
    select c.id, 'cobranca_asaas'::text, 'receivable'::text, 'asaas'::text, c.pessoa_nome,
           coalesce(nullif(c.raw->>'description',''),'Cobrança Asaas'), c.external_id, c.installment_number, null::int, c.due_date, c.due_date,
           c.value_cents, 0::bigint,
           case when c.recebida then coalesce(c.received_cents, c.value_cents) else 0 end,
           case when c.recebida then 0 else c.value_cents end,
           case when c.recebida then 'recebido_asaas' when c.due_date < v_ref then 'vencido' else 'aberto' end,
           null::text, case when c.recebida then 'Asaas' end, null::uuid, c.external_id, c.invoice_url, c.external_status,
           not c.recebida
    from ext0 c
  ), u as (select * from parc union all select * from ext),
  f as (
    select * from u
    where (coalesce(_origem,'todas') = 'todas' or origem = _origem)
      and (coalesce(_situacao,'todos') = 'todos' or situacao = _situacao
           or (_situacao='aberto' and situacao in ('aberto','vencido'))
           or (_situacao='quitado' and situacao = 'recebido_asaas')
           or (_situacao='a_vincular' and tipo = 'cobranca_asaas'))
      and (coalesce(_search,'') = '' or descricao ilike '%'||_search||'%' or coalesce(pessoa,'') ilike '%'||_search||'%'
           or coalesce(titulo_numero,'') ilike '%'||_search||'%' or coalesce(external_id,'') ilike '%'||_search||'%')
  )
  select coalesce((select jsonb_agg(to_jsonb(x) order by x.vencimento, x.descricao, x.id) from
            (select * from f order by vencimento, descricao, id limit greatest(least(_limit,500),1) offset greatest(_offset,0)) x),'[]'::jsonb),
         jsonb_build_object(
           'linhas', (select count(*) from f),
           'receber', jsonb_build_object('qtd', (select count(*) from f where direction='receivable' and no_total),
               'valor_cents', (select coalesce(sum(valor_cents),0) from f where direction='receivable' and no_total),
               'liquidado_cents', (select coalesce(sum(liquidado_cents),0) from f where direction='receivable' and no_total),
               'saldo_cents', (select coalesce(sum(saldo_cents),0) from f where direction='receivable' and no_total),
               'lardan_qtd', (select count(*) from f where direction='receivable' and tipo='parcela'),
               'lardan_saldo_cents', (select coalesce(sum(saldo_cents),0) from f where direction='receivable' and tipo='parcela'),
               'asaas_qtd', (select count(*) from f where tipo='cobranca_asaas' and no_total),
               'asaas_saldo_cents', (select coalesce(sum(saldo_cents),0) from f where tipo='cobranca_asaas' and no_total)),
           'pagar', jsonb_build_object('qtd', (select count(*) from f where direction='payable'),
               'valor_cents', (select coalesce(sum(valor_cents),0) from f where direction='payable'),
               'liquidado_cents', (select coalesce(sum(liquidado_cents),0) from f where direction='payable'),
               'saldo_cents', (select coalesce(sum(saldo_cents),0) from f where direction='payable')),
           'asaas_a_vincular', jsonb_build_object('qtd', (select count(*) from f where tipo='cobranca_asaas'),
               'valor_cents', (select coalesce(sum(valor_cents),0) from f where tipo='cobranca_asaas'),
               'aberto_qtd', (select count(*) from f where tipo='cobranca_asaas' and no_total),
               'aberto_cents', (select coalesce(sum(saldo_cents),0) from f where tipo='cobranca_asaas' and no_total),
               'recebido_qtd', (select count(*) from f where tipo='cobranca_asaas' and not no_total),
               'recebido_cents', (select coalesce(sum(liquidado_cents),0) from f where tipo='cobranca_asaas' and not no_total),
               'clientes', (select count(distinct pessoa) from f where tipo='cobranca_asaas'),
               'clientes_aberto', (select count(distinct pessoa) from f where tipo='cobranca_asaas' and no_total))
         )
    into v_rows, v_tot;
  return jsonb_build_object('rows', v_rows, 'totais', v_tot, 'periodo', jsonb_build_object('de',v_de,'ate',v_ate,'corte',v_corte),
    'criterio', 'Uma linha por parcela Lardan ou cobrança Asaas, com saldo na data de corte (fim do período ou hoje). Cobranças Asaas em aberto somam no total a receber; as já recebidas no Asaas e ainda não conferidas aparecem como "Recebido no Asaas" e ficam fora do total. Cobranças conferidas com um título aparecem só uma vez, no próprio título.');
end $function$;