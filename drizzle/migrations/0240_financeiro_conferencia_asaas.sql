-- 0235 — Financeiro: as telas passam a bater entre si e com o Asaas (05/11/2026).
-- (pacote lardan-0235-0236; texto integral do arquivo 0235_financeiro_conferencia_asaas.sql)

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
    'saldo_contas_cents', coalesce((select sum(fin_saldo_conta(a.id, v_corte)) from financial_accounts a where a.excluida_em is null and not a.is_homologacao),0),
    'titulos_pendentes_aprovacao', coalesce((select count(*) from financial_titles where approval_status='pendente'),0),
    'asaas_recebido_conferir_qtd', (select n from axr),
    'asaas_recebido_conferir_cents', (select v from axr),
    'asaas_a_vincular_qtd', (select count(*) from p where fonte='asaas' and vencimento between v_de and v_ate),
    'asaas_a_vincular_cents', coalesce((select sum(saldo_cents) from p where fonte='asaas' and vencimento between v_de and v_ate),0)
  ) into r;
  return r;
end $function$;

create or replace function public.fin_cashflow(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_de date := coalesce(nullif(_filtros->>'de','')::date, (now() at time zone 'America/Sao_Paulo')::date);
        v_ate date := coalesce(nullif(_filtros->>'ate','')::date, (now() at time zone 'America/Sao_Paulo')::date + 30);
        v_conta uuid := nullif(_filtros->>'conta_id','')::uuid;
        v_cc uuid := nullif(_filtros->>'centro_custo_id','')::uuid;
        v_ent uuid := nullif(_filtros->>'entidade_id','')::uuid;
        v_grupo text := coalesce(_filtros->>'agrupamento','dia');
        v_abertura bigint; r jsonb; v_class boolean := (v_cc is not null or v_ent is not null);
        v_com_asaas boolean;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  if v_ate < v_de then raise exception 'Período inválido'; end if;
  if v_ate - v_de > 1100 then raise exception 'Período máximo de 3 anos por consulta'; end if;
  if v_grupo not in ('dia','semana','mes') then raise exception 'Agrupamento inválido'; end if;
  v_com_asaas := not v_class and (v_conta is null or exists (
    select 1 from asaas_accounts aa where aa.financial_account_id = v_conta and aa.environment = 'producao'));

  select coalesce(sum(m.valor_cents),0) into v_abertura
  from financial_account_movements m join financial_accounts a on a.id = m.financial_account_id
  where not a.is_homologacao
    and (v_conta is null or m.financial_account_id = v_conta)
    and m.data <= v_hoje
    and (m.data < v_de or (m.data <= v_ate and m.kind = 'saldo_inicial'));

  with mov as (
    select m.id, m.data, m.valor_cents, m.kind, (m.data > v_hoje) as futuro,
           (m.kind in ('transferencia_entrada','transferencia_saida') or m.transfer_id is not null) as e_transferencia,
           exists (select 1 from financial_allocations al
             join financial_installments i on i.id = al.installment_id
             join financial_titles t on t.id = i.title_id
             where al.settlement_id = m.settlement_id
               and (v_cc is null or t.cost_center_id = v_cc)
               and (v_ent is null or t.business_entity_id = v_ent)) as bate_filtro
    from financial_account_movements m join financial_accounts a on a.id = m.financial_account_id
    where not a.is_homologacao and m.data between v_de and v_ate and m.kind <> 'saldo_inicial'
      and (v_conta is null or m.financial_account_id = v_conta)
  ), classificado as (
    select *, case
        when e_transferencia and v_conta is null then 'transferencia'
        when v_class and not bate_filtro then 'nao_classificado'
        else 'operacional' end as faixa
    from mov
  ), realizado as (
    select case v_grupo when 'mes' then date_trunc('month', data)::date
                        when 'semana' then date_trunc('week', data)::date else data end as bucket,
           sum(case when faixa='operacional' and valor_cents > 0 then valor_cents else 0 end) as entradas,
           sum(case when faixa='operacional' and valor_cents < 0 then -valor_cents else 0 end) as saidas,
           sum(case when faixa='transferencia' then abs(valor_cents) else 0 end) as transferencias,
           sum(case when faixa='nao_classificado' and valor_cents > 0 then valor_cents else 0 end) as nc_entradas,
           sum(case when faixa='nao_classificado' and valor_cents < 0 then -valor_cents else 0 end) as nc_saidas
    from classificado where not futuro group by 1
  ), mov_futuro as (
    select case v_grupo when 'mes' then date_trunc('month', data)::date
                        when 'semana' then date_trunc('week', data)::date else data end as bucket,
           sum(case when valor_cents > 0 then valor_cents else 0 end) as entradas,
           sum(case when valor_cents < 0 then -valor_cents else 0 end) as saidas
    from classificado where futuro and faixa <> 'transferencia' group by 1
  ), previsto_tit as (
    select case v_grupo when 'mes' then date_trunc('month', i.vencimento)::date
                        when 'semana' then date_trunc('week', i.vencimento)::date else i.vencimento end as bucket,
           sum(case when t.direction='receivable' then s.saldo else 0 end) as entradas,
           sum(case when t.direction='payable' then s.saldo else 0 end) as saidas
    from financial_installments i join financial_titles t on t.id = i.title_id
    cross join lateral (select greatest(i.valor_cents
           + coalesce((select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                                       when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end)
                       from financial_adjustments j where j.installment_id = i.id),0)
           - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0), 0) as saldo) s
    where i.vencimento between v_de and v_ate and t.status in ('ativo','aprovado') and s.saldo > 0
      and (v_cc is null or t.cost_center_id = v_cc)
      and (v_ent is null or t.business_entity_id = v_ent)
      and (v_conta is null or t.financial_account_id = v_conta)
    group by 1
  ), previsto_asaas as (
    select case v_grupo when 'mes' then date_trunc('month', x.due_date)::date
                        when 'semana' then date_trunc('week', x.due_date)::date else x.due_date end as bucket,
           sum(x.value_cents)::bigint as entradas, 0::bigint as saidas
    from fin_asaas_abertas(v_hoje) x
    where v_com_asaas and x.due_date between v_de and v_ate
    group by 1
  ), previsto as (
    select bucket, sum(entradas) entradas, sum(saidas) saidas
    from (select * from previsto_tit union all select * from mov_futuro union all select * from previsto_asaas) x group by 1
  ), buckets as (
    select bucket from realizado union select bucket from previsto
  ), joined as (
    select b.bucket,
           coalesce(r.entradas,0) as entradas_realizadas, coalesce(r.saidas,0) as saidas_realizadas,
           coalesce(r.transferencias,0) as transferencias_cents,
           coalesce(r.nc_entradas,0) as nao_classificado_entradas_cents,
           coalesce(r.nc_saidas,0) as nao_classificado_saidas_cents,
           coalesce(p.entradas,0) as entradas_previstas, coalesce(p.saidas,0) as saidas_previstas
    from buckets b left join realizado r on r.bucket = b.bucket left join previsto p on p.bucket = b.bucket
  ), acumulado as (
    select j.*,
      v_abertura + sum(j.entradas_realizadas - j.saidas_realizadas
                       + j.nao_classificado_entradas_cents - j.nao_classificado_saidas_cents) over (order by j.bucket) as saldo_realizado,
      v_abertura + sum((j.entradas_realizadas + j.nao_classificado_entradas_cents + j.entradas_previstas)
                     - (j.saidas_realizadas + j.nao_classificado_saidas_cents + j.saidas_previstas)) over (order by j.bucket) as saldo_projetado
    from joined j
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate, 'agrupamento', v_grupo, 'data_corte_realizado', least(v_ate, v_hoje)),
    'saldo_abertura_cents', v_abertura, 'saldo_inicial_cents', v_abertura,
    'filtros', jsonb_build_object('conta_id', v_conta, 'centro_custo_id', v_cc, 'entidade_id', v_ent, 'classificacao_aplicada', v_class),
    'totais', jsonb_build_object(
      'entradas_realizadas_cents', coalesce((select sum(entradas_realizadas) from acumulado),0),
      'saidas_realizadas_cents', coalesce((select sum(saidas_realizadas) from acumulado),0),
      'transferencias_cents', coalesce((select sum(transferencias_cents) from acumulado),0),
      'nao_classificado_entradas_cents', coalesce((select sum(nao_classificado_entradas_cents) from acumulado),0),
      'nao_classificado_saidas_cents', coalesce((select sum(nao_classificado_saidas_cents) from acumulado),0),
      'entradas_previstas_cents', coalesce((select sum(entradas_previstas) from acumulado),0),
      'entradas_previstas_asaas_cents', coalesce((select sum(entradas) from previsto_asaas),0),
      'saidas_previstas_cents', coalesce((select sum(saidas_previstas) from acumulado),0),
      'saldo_final_realizado_cents', v_abertura + coalesce((select sum(entradas_realizadas - saidas_realizadas + nao_classificado_entradas_cents - nao_classificado_saidas_cents) from acumulado),0),
      'saldo_final_projetado_cents', coalesce((select saldo_projetado from acumulado order by bucket desc limit 1), v_abertura)),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object(
        'bucket', bucket, 'entradas_realizadas_cents', entradas_realizadas,
        'saidas_realizadas_cents', saidas_realizadas, 'transferencias_cents', transferencias_cents,
        'nao_classificado_entradas_cents', nao_classificado_entradas_cents,
        'nao_classificado_saidas_cents', nao_classificado_saidas_cents,
        'entradas_previstas_cents', entradas_previstas, 'saidas_previstas_cents', saidas_previstas,
        'saldo_realizado_cents', saldo_realizado, 'saldo_projetado_cents', saldo_projetado) order by bucket) from acumulado),'[]'::jsonb)
  ) into r;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.asaas_mesa_pendentes(_busca text DEFAULT NULL, _offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE res jsonb; b text := nullif(btrim(coalesce(_busca,'')),''); dig text := regexp_replace(coalesce(_busca,''),'\D','','g');
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  WITH base AS (
    SELECT c.id, c.external_id, c.value_cents, coalesce(c.net_value_cents, c.value_cents - coalesce(c.fee_cents,0)) liquido_cents,
           c.payment_date, c.due_date, c.billing_type, c.party_id,
           coalesce(p.display_name, cu.name) nome,
           CASE WHEN length(regexp_replace(coalesce(cu.doc,''),'\D','','g'))=11
                THEN '***.'||substr(regexp_replace(cu.doc,'\D','','g'),4,3)||'.'||substr(regexp_replace(cu.doc,'\D','','g'),7,3)||'-**'
                ELSE cu.doc END doc,
           c.raw->>'description' descricao
      FROM asaas_charges c
      LEFT JOIN asaas_customers cu ON cu.account_id=c.account_id AND cu.external_id=c.customer_external_id
      LEFT JOIN parties p ON p.id=c.party_id
     WHERE c.external_status='RECEIVED' AND c.installment_id IS NULL AND c.title_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM financial_statement_lines l JOIN asaas_accounts aa ON aa.financial_account_id = l.financial_account_id
                        WHERE aa.id = c.account_id AND l.documento = c.external_id AND l.kind = 'entrada' AND l.status = 'conciliada')
       AND (b IS NULL
            OR (b ILIKE 'pay\_%' AND c.external_id = b)
            OR (b NOT ILIKE 'pay\_%' AND (
                  coalesce(p.display_name,cu.name,'') ILIKE '%'||b||'%'
                  OR c.external_id ILIKE '%'||b||'%'
                  OR (b !~ '[A-Za-z]' AND length(dig) >= 3 AND regexp_replace(coalesce(cu.doc,''),'\D','','g') LIKE '%'||dig||'%'))))
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM base),'soma_cents',(SELECT coalesce(sum(value_cents),0) FROM base),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.payment_date DESC NULLS LAST) FROM
       (SELECT * FROM base ORDER BY payment_date DESC NULLS LAST LIMIT 50 OFFSET greatest(_offset,0)) x),'[]'))
    INTO res;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.asaas_mesa_pendentes(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_mesa_pendentes(text,int) TO authenticated;

drop function if exists public.fin_asaas_conferencia();
create or replace function public.fin_asaas_conferencia(_conta uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_conta uuid; v_acc uuid; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ult record; r jsonb;
begin
  if not (has_capability(auth.uid(),'finance.bank.view') or has_capability(auth.uid(),'finance.reconcile')) then
    raise exception 'Sem permissão'; end if;
  select aa.financial_account_id, aa.id into v_conta, v_acc from asaas_accounts aa
   where aa.financial_account_id is not null
     and (case when _conta is null then aa.environment = 'producao' else aa.financial_account_id = _conta end)
   order by aa.is_active desc limit 1;
  if v_conta is null then return jsonb_build_object('configurada', false); end if;

  select l.data, round((l.raw->>'balance')::numeric * 100)::bigint as saldo into v_ult
    from financial_statement_lines l
   where l.financial_account_id = v_conta and l.raw ? 'balance' and l.status <> 'repetida'
   order by l.data desc, nullif(regexp_replace(coalesce(l.bank_id,''),'\D','','g'),'')::numeric desc nulls last, l.line_no desc
   limit 1;

  with linhas as (
    select l.*, case when l.kind = 'saida' then -l.valor_cents else l.valor_cents end as v
      from financial_statement_lines l
     where l.financial_account_id = v_conta and l.status <> 'repetida'
  ), baixas as (
    select s.id, s.data, s.valor_cents, substr(s.referencia, 7) as pay
      from financial_settlements s
     where s.financial_account_id = v_conta and not s.is_reversal and s.referencia like 'Asaas pay\_%'
       and not exists (select 1 from financial_settlements x where x.reversed_of = s.id)
  ), importados as (
    select m.id, m.data, m.valor_cents, m.settlement_id
      from financial_account_movements m
     where m.financial_account_id = v_conta and m.valor_cents > 0 and m.descricao ilike 'Recebimento importado%'
       and not exists (select 1 from financial_settlements x where x.reversed_of = m.settlement_id)
  ), recebidos as (
    select l.id, l.data, l.valor_cents, l.historico, l.documento, l.status,
           (select count(*) from baixas b where b.pay = l.documento) as n_baixa,
           (select count(*) from importados i where i.valor_cents = l.valor_cents and i.data between l.data - 3 and l.data + 3) as n_import
      from linhas l
     where l.kind = 'entrada' and coalesce(l.raw->>'type','') <> 'TRANSFER' and l.status <> 'ignorada'
  ), sem_lancamento as (
    select * from recebidos where status <> 'conciliada' and n_baixa = 0 and n_import = 0
  ), duplicados as (
    select * from recebidos where n_baixa + n_import + (case when status = 'conciliada' and n_baixa = 0 and n_import = 0 then 1 else 0 end) > 1
      and documento is not null
  ), em_dinheiro as (
    select b.id, b.data, b.valor_cents, b.pay, coalesce(pa.display_name, cu.name) as nome
      from baixas b join asaas_charges c on c.account_id = v_acc and c.external_id = b.pay
      left join parties pa on pa.id = c.party_id
      left join asaas_customers cu on cu.account_id = c.account_id and cu.external_id = c.customer_external_id
     where c.external_status = 'RECEIVED_IN_CASH'
  ), meses as (
    select to_char(d, 'YYYY-MM') as mes, (d + interval '1 month - 1 day')::date as fim
      from generate_series(date_trunc('month', v_hoje - interval '11 months'), date_trunc('month', v_hoje), interval '1 month') d
  ), por_mes as (
    select m.mes, least(m.fim, v_hoje) as ate,
           (select round((l.raw->>'balance')::numeric * 100)::bigint from financial_statement_lines l
             where l.financial_account_id = v_conta and l.raw ? 'balance' and l.status <> 'repetida' and l.data <= m.fim
             order by l.data desc, nullif(regexp_replace(coalesce(l.bank_id,''),'\D','','g'),'')::numeric desc nulls last, l.line_no desc limit 1) as saldo_asaas,
           fin_saldo_conta(v_conta, least(m.fim, v_hoje)) as saldo_lardan
      from meses m
  )
  select jsonb_build_object(
    'configurada', true,
    'conta_id', v_conta,
    'saldo_lardan_cents', fin_saldo_conta(v_conta, v_hoje),
    'saldo_asaas_cents', v_ult.saldo,
    'saldo_asaas_data', v_ult.data,
    'diferenca_cents', coalesce(v_ult.saldo, 0) - fin_saldo_conta(v_conta, v_hoje),
    'sem_lancamento', coalesce((select jsonb_agg(jsonb_build_object('linha_id', id, 'data', data, 'valor_cents', valor_cents,
        'historico', historico, 'pay', documento) order by data desc) from sem_lancamento), '[]'::jsonb),
    'sem_lancamento_cents', coalesce((select sum(valor_cents) from sem_lancamento), 0),
    'em_dinheiro', coalesce((select jsonb_agg(jsonb_build_object('settlement_id', id, 'data', data, 'valor_cents', valor_cents,
        'pay', pay, 'nome', nome) order by data desc) from em_dinheiro), '[]'::jsonb),
    'em_dinheiro_cents', coalesce((select sum(valor_cents) from em_dinheiro), 0),
    'duplicados', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'valor_cents', valor_cents, 'pay', documento,
        'historico', historico, 'baixas', n_baixa, 'importados', n_import) order by data desc) from duplicados), '[]'::jsonb),
    'por_mes', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'saldo_asaas_cents', saldo_asaas, 'saldo_lardan_cents', saldo_lardan,
        'diferenca_cents', coalesce(saldo_asaas,0) - saldo_lardan) order by mes) from por_mes where saldo_asaas is not null), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.fin_asaas_conferencia(uuid) from public, anon;
grant execute on function public.fin_asaas_conferencia(uuid) to authenticated;

do $$
declare c record;
begin
  for c in
    select ch.id, ch.title_id, ch.installment_id from asaas_charges ch
      join financial_titles t on t.id = ch.title_id
     where ch.external_id in ('pay_e32madljqw8gci7u','pay_lgj89nhdervukgp3')
       and t.status = 'cancelado'
  loop
    perform set_config('lardann.asaas_link','on', true);
    update asaas_charges set title_id = null, installment_id = null, reconcile_status = 'pendente',
           reconcile_note = 'Vínculo desfeito (0235): vinculada por engano na correção do saldo Asaas de 05/11'
     where id = c.id;
    perform set_config('lardann.asaas_link','off', true);
    update asaas_charge_matches set status = 'recusado', motivo = 'Vínculo desfeito (0235)', decidido_em = now(), updated_at = now()
     where charge_id = c.id and status = 'confirmado';
    insert into asaas_charge_changes (charge_id, campo, de, para, origem, actor_user_id)
    values (c.id, 'title_id', c.title_id::text, null, 'migracao_0235', null),
           (c.id, 'installment_id', c.installment_id::text, null, 'migracao_0235', null);
  end loop;
end $$;