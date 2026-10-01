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
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  if v_ate < v_de then raise exception 'Período inválido'; end if;
  if v_ate - v_de > 1100 then raise exception 'Período máximo de 3 anos por consulta'; end if;
  if v_grupo not in ('dia','semana','mes') then raise exception 'Agrupamento inválido'; end if;

  -- Abertura: realizado antes do período + saldo inicial dentro do período (nunca data futura).
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
    -- lançamento com data futura entra só no previsto
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
  ), previsto as (
    select bucket, sum(entradas) entradas, sum(saidas) saidas
    from (select * from previsto_tit union all select * from mov_futuro) x group by 1
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