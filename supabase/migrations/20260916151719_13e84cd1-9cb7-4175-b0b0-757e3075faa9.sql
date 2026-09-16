CREATE OR REPLACE FUNCTION public.fin_dre(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_de date := coalesce(nullif(_filtros->>'de','')::date, date_trunc('month', current_date)::date);
        v_ate date := coalesce(nullif(_filtros->>'ate','')::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date);
        v_regime text := coalesce(_filtros->>'regime','competencia');
        v_cc uuid := nullif(_filtros->>'centro_custo_id','')::uuid;
        v_ent uuid := nullif(_filtros->>'entidade_id','')::uuid;
        v_linhas jsonb; v_pend jsonb;
        v_rec bigint; v_ded bigint; v_cus bigint; v_des bigint;
begin
  if not has_capability(auth.uid(),'finance.dre.view') then raise exception 'Sem permissão'; end if;
  if v_ate < v_de then raise exception 'Período inválido'; end if;
  if v_regime not in ('competencia','caixa') then raise exception 'Regime inválido'; end if;

  with base as (
    select ca.natureza::text as natureza, ca.id as chart_id, ca.codigo, ca.nome,
           sum(t.valor_cents) as valor_cents
    from financial_titles t
    join chart_of_accounts ca on ca.id = t.chart_account_id
    where v_regime = 'competencia'
      and t.status in ('ativo','aprovado')
      and coalesce(t.competencia, t.emissao) between v_de and v_ate
      and (v_cc is null or t.cost_center_id = v_cc)
      and (v_ent is null or t.business_entity_id = v_ent)
    group by 1,2,3,4
    union all
    select ca.natureza::text, ca.id, ca.codigo, ca.nome, sum(abs(al.valor_cents))
    from financial_account_movements m
    join financial_accounts fa on fa.id = m.financial_account_id
    join financial_allocations al on al.settlement_id = m.settlement_id
    join financial_installments i on i.id = al.installment_id
    join financial_titles t on t.id = i.title_id
    join chart_of_accounts ca on ca.id = t.chart_account_id
    where v_regime = 'caixa'
      and not fa.is_homologacao
      and m.data between v_de and v_ate
      and m.kind not in ('saldo_inicial','transferencia_entrada','transferencia_saida')
      and t.status <> 'cancelado'
      and (v_cc is null or t.cost_center_id = v_cc)
      and (v_ent is null or t.business_entity_id = v_ent)
    group by 1,2,3,4
  )
  select coalesce(sum(valor_cents) filter (where natureza='receita'),0),
         coalesce(sum(valor_cents) filter (where natureza='deducao'),0),
         coalesce(sum(valor_cents) filter (where natureza='custo'),0),
         coalesce(sum(valor_cents) filter (where natureza='despesa'),0),
         coalesce(jsonb_agg(jsonb_build_object('natureza', natureza, 'chart_id', chart_id,
             'codigo', codigo, 'nome', nome, 'valor_cents', valor_cents)
             order by natureza, codigo), '[]'::jsonb)
    into v_rec, v_ded, v_cus, v_des, v_linhas
  from base;

  with pend as (
    select t.id, t.valor_cents
    from financial_titles t
    where v_regime = 'competencia'
      and t.status in ('ativo','aprovado')
      and t.chart_account_id is null
      and coalesce(t.competencia, t.emissao) between v_de and v_ate
      and (v_cc is null or t.cost_center_id = v_cc)
      and (v_ent is null or t.business_entity_id = v_ent)
    union all
    select t.id, abs(al.valor_cents)
    from financial_account_movements m
    join financial_accounts fa on fa.id = m.financial_account_id
    join financial_allocations al on al.settlement_id = m.settlement_id
    join financial_installments i on i.id = al.installment_id
    join financial_titles t on t.id = i.title_id
    where v_regime = 'caixa'
      and not fa.is_homologacao
      and m.data between v_de and v_ate
      and m.kind not in ('saldo_inicial','transferencia_entrada','transferencia_saida')
      and t.chart_account_id is null
      and t.status <> 'cancelado'
      and (v_cc is null or t.cost_center_id = v_cc)
      and (v_ent is null or t.business_entity_id = v_ent)
  )
  select jsonb_build_object('quantidade', count(distinct id), 'valor_cents', coalesce(sum(valor_cents),0))
    into v_pend from pend;

  return jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate, 'regime', v_regime),
    'fonte', case when v_regime='competencia'
      then 'Títulos classificados, pela data de competência (ou emissão, quando não houver competência).'
      else 'Movimentos das contas no período, ligados a títulos classificados. Transferências entre contas e saldo inicial ficam de fora.' end,
    'linhas', v_linhas,
    'totais', jsonb_build_object(
      'receita_bruta_cents', v_rec,
      'deducoes_cents', v_ded,
      'receita_liquida_cents', v_rec - v_ded,
      'custos_cents', v_cus,
      'resultado_bruto_cents', v_rec - v_ded - v_cus,
      'despesas_cents', v_des,
      'resultado_cents', v_rec - v_ded - v_cus - v_des),
    'pendentes_classificacao', v_pend
  );
end $function$;