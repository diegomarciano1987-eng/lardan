create or replace function public.fin_dre(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_de date := coalesce(nullif(_filtros->>'de','')::date, date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date);
        v_ate date := coalesce(nullif(_filtros->>'ate','')::date, (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + interval '1 month - 1 day')::date);
        v_regime text := coalesce(_filtros->>'regime','competencia');
        v_cc uuid := nullif(_filtros->>'centro_custo_id','')::uuid;
        v_ent uuid := nullif(_filtros->>'entidade_id','')::uuid;
        v_linhas jsonb; v_pend jsonb; v_sem_cc jsonb; v_parc jsonb; v_conc jsonb; v_fora jsonb;
        v_rec bigint; v_ded bigint; v_cus bigint; v_des bigint;
begin
  if not has_capability(auth.uid(),'finance.dre.view') then raise exception 'Sem permissão'; end if;
  if v_ate < v_de then raise exception 'Período inválido'; end if;
  if v_regime not in ('competencia','caixa') then raise exception 'Regime inválido'; end if;

  create temp table if not exists _dre_base(natureza text, chart_id uuid, codigo text, nome text, valor_cents bigint, title_id uuid, cc uuid) on commit drop;
  truncate _dre_base;

  if v_regime = 'competencia' then
    -- competência: valor do título, uma vez, pela data de competência (ou emissão)
    insert into _dre_base
    select ca.natureza::text, ca.id, ca.codigo, ca.nome, t.valor_cents, t.id, t.cost_center_id
    from financial_titles t left join chart_of_accounts ca on ca.id = t.chart_account_id
    where t.status in ('ativo','aprovado')
      and coalesce(t.competencia, t.emissao) between v_de and v_ate
      and (v_cc is null or t.cost_center_id = v_cc)
      and (v_ent is null or t.business_entity_id = v_ent);
  else
    -- caixa: baixa efetiva até hoje, uma vez; estorno entra com sinal negativo
    insert into _dre_base
    select ca.natureza::text, ca.id, ca.codigo, ca.nome,
           case when s.is_reversal then -abs(al.valor_cents) else abs(al.valor_cents) end, t.id, t.cost_center_id
    from financial_settlements s
    join financial_accounts fa on fa.id = s.financial_account_id
    join financial_allocations al on al.settlement_id = s.id
    join financial_installments i on i.id = al.installment_id
    join financial_titles t on t.id = i.title_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    where not fa.is_homologacao
      and s.data between v_de and least(v_ate, v_hoje)
      and t.status <> 'cancelado'
      and (v_cc is null or t.cost_center_id = v_cc)
      and (v_ent is null or t.business_entity_id = v_ent);
  end if;

  select coalesce(sum(valor_cents) filter (where natureza='receita'),0),
         coalesce(sum(valor_cents) filter (where natureza='deducao'),0),
         coalesce(sum(valor_cents) filter (where natureza='custo'),0),
         coalesce(sum(valor_cents) filter (where natureza='despesa'),0)
    into v_rec, v_ded, v_cus, v_des from _dre_base;

  select coalesce(jsonb_agg(jsonb_build_object('natureza', natureza, 'chart_id', chart_id, 'codigo', codigo,
           'nome', nome, 'valor_cents', v) order by natureza, codigo), '[]'::jsonb) into v_linhas
  from (select natureza, chart_id, codigo, nome, sum(valor_cents) v from _dre_base
        where natureza in ('receita','deducao','custo','despesa') group by 1,2,3,4) x;

  select jsonb_build_object('quantidade', count(distinct title_id), 'valor_cents', coalesce(sum(valor_cents),0),
    'criterio', 'Títulos do período sem conta do plano de contas. Ficam fora da DRE até serem classificados.')
    into v_pend from _dre_base where chart_id is null;

  select jsonb_build_object('quantidade', count(distinct title_id), 'valor_cents', coalesce(sum(valor_cents),0),
    'criterio', 'Títulos do período com conta, mas sem centro de custo. Entram na DRE; faltam só para a visão por centro.')
    into v_sem_cc from _dre_base where chart_id is not null and cc is null;

  select jsonb_build_object('quantidade', count(*) filter (where natureza not in ('receita','deducao','custo','despesa')),
    'valor_cents', coalesce(sum(valor_cents) filter (where natureza not in ('receita','deducao','custo','despesa')),0),
    'criterio', 'Títulos classificados em contas de ativo, passivo ou resultado (ex.: amortização de empréstimo). Não são receita nem despesa.')
    into v_fora from _dre_base where chart_id is not null;

  -- independentes do regime: não confundir "não pago" com "sem classificação"
  select jsonb_build_object('quantidade', count(*), 'valor_cents', coalesce(sum(saldo),0),
    'criterio', 'Parcelas com vencimento no período e saldo em aberto (cada parcela conta uma vez).')
    into v_parc from (
      select i.valor_cents
        + coalesce((select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                                    when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end)
                    from financial_adjustments j where j.installment_id = i.id),0)
        - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0) as saldo
      from financial_installments i join financial_titles t on t.id = i.title_id
      where t.status in ('ativo','aprovado') and i.vencimento between v_de and v_ate
        and (v_cc is null or t.cost_center_id = v_cc)
        and (v_ent is null or t.business_entity_id = v_ent)) p where saldo > 0;

  select jsonb_build_object('quantidade', count(*), 'valor_cents', coalesce(sum(abs(coalesce(l.valor_cents,0)) - l.conciliado_cents),0),
    'criterio', 'Linhas de extrato importadas com data no período ainda pendentes, parciais ou divergentes.')
    into v_conc from financial_statement_lines l join financial_accounts fa on fa.id = l.financial_account_id
    where not fa.is_homologacao and l.data between v_de and v_ate and l.status in ('pendente','parcial','divergente');

  return jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate, 'regime', v_regime,
        'data_corte', case when v_regime='caixa' then least(v_ate, v_hoje) else v_ate end),
    'fonte', case when v_regime='competencia'
      then 'Competência: valor de cada título uma vez, pela data de competência (ou emissão, quando não houver). Não se compara com recebimentos.'
      else 'Caixa: baixas efetivas até a data de corte, uma vez cada; estornos subtraem. Transferências e saldo inicial ficam de fora.' end,
    'linhas', v_linhas,
    'totais', jsonb_build_object(
      'receita_bruta_cents', v_rec, 'deducoes_cents', v_ded, 'receita_liquida_cents', v_rec - v_ded,
      'custos_cents', v_cus, 'resultado_bruto_cents', v_rec - v_ded - v_cus,
      'despesas_cents', v_des, 'resultado_cents', v_rec - v_ded - v_cus - v_des),
    'pendentes_classificacao', v_pend,
    'indicadores', jsonb_build_object(
      'sem_conta_contabil', v_pend,
      'sem_centro_custo', v_sem_cc,
      'fora_da_dre', v_fora,
      'parcelas_em_aberto', v_parc,
      'nao_conciliados', v_conc)
  );
end $function$;