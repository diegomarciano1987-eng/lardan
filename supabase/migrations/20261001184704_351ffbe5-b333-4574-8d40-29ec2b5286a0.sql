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