CREATE OR REPLACE FUNCTION public.fin_pagar_faixas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
begin
  if not has_capability(auth.uid(),'finance.payable.view') then raise exception 'Sem permissão'; end if;
  with p as (
    select i.vencimento, fin_installment_saldo(i.id) as saldo
    from financial_installments i join financial_titles t on t.id = i.title_id
    where t.direction = 'payable' and t.status in ('ativo','aprovado')
      and i.settlement_status in ('nao_liquidado','parcial')
  ), f as (
    select case when vencimento < v_hoje then 'vencidas'
                when vencimento <= v_hoje + 7 then 'ate_7'
                when vencimento <= v_hoje + 15 then 'ate_15'
                when vencimento <= v_hoje + 30 then 'ate_30'
                else 'acima_30' end as faixa, saldo
    from p where saldo > 0
  )
  select jsonb_build_object('hoje', v_hoje, 'faixas', coalesce(jsonb_object_agg(faixa, jsonb_build_object('qtd', q, 'saldo_cents', s)), '{}'::jsonb))
  into r from (select faixa, count(*) q, sum(saldo)::bigint s from f group by faixa) x;
  return r;
end $$;
REVOKE ALL ON FUNCTION public.fin_pagar_faixas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_pagar_faixas() TO authenticated;

CREATE OR REPLACE FUNCTION public.fin_dfc(_de date, _ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_fim date; r jsonb;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  if _de is null or _ate is null or _ate < _de then raise exception 'Período inválido'; end if;
  if _ate - _de > 1100 then raise exception 'Período máximo de 3 anos'; end if;
  v_fim := least(_ate, v_hoje);  -- realizado nunca inclui data futura
  with contas as (
    select id, nome from financial_accounts where not is_homologacao
  ), mov as (
    select m.*, c.nome as conta,
      (m.kind in ('transferencia_entrada','transferencia_saida') or m.transfer_id is not null) as e_transf,
      (select ca.natureza::text || '|' || ca.codigo || ' ' || ca.nome
         from financial_allocations al join financial_installments i on i.id = al.installment_id
         join financial_titles t on t.id = i.title_id
         left join chart_of_accounts ca on ca.id = t.chart_account_id
        where al.settlement_id = m.settlement_id order by al.valor_cents desc limit 1) as plano
    from financial_account_movements m join contas c on c.id = m.financial_account_id
    where m.data between _de and v_fim
  ), cls as (
    select *, case
      when e_transf then 'transferencias'
      when kind = 'saldo_inicial' then 'saldo_inicial'
      when settlement_id is null then 'ajustes'
      when plano is null or split_part(plano,'|',1) = '' then 'nao_classificado'
      when split_part(plano,'|',1) in ('receita','deducao','custo','despesa') then 'operacional'
      when split_part(plano,'|',1) = 'ativo' then 'investimento'
      else 'financiamento' end as atividade,
      coalesce(nullif(split_part(plano,'|',2),''), case when settlement_id is null then coalesce(descricao,'Ajuste de saldo') else 'Sem conta contábil' end) as linha
    from mov
  ), grupos as (
    select atividade, jsonb_agg(jsonb_build_object('linha', linha, 'entradas_cents', e, 'saidas_cents', s, 'liquido_cents', e - s) order by linha) linhas,
           sum(e)::bigint e, sum(s)::bigint s
    from (select atividade, linha, sum(greatest(valor_cents,0))::bigint e, sum(greatest(-valor_cents,0))::bigint s from cls group by 1,2) x
    group by atividade
  ), porconta as (
    select c.nome conta,
      coalesce((select sum(valor_cents) from financial_account_movements where financial_account_id=c.id and data < _de),0)::bigint inicial,
      coalesce((select sum(greatest(valor_cents,0)) from mov where financial_account_id=c.id),0)::bigint entradas,
      coalesce((select sum(greatest(-valor_cents,0)) from mov where financial_account_id=c.id),0)::bigint saidas,
      coalesce((select sum(valor_cents) from financial_account_movements where financial_account_id=c.id and data <= v_fim),0)::bigint final
    from contas c
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', _de, 'ate', _ate, 'realizado_ate', v_fim),
    'criterio', 'Método direto: movimentos bancários realizados (data até hoje), classificados pela natureza da conta contábil do título baixado. Receita/dedução/custo/despesa = operacional; ativo = investimento; passivo/resultado = financiamento. Transferências entre contas aparecem à parte.',
    'atividades', coalesce((select jsonb_object_agg(atividade, jsonb_build_object('entradas_cents', e, 'saidas_cents', s, 'liquido_cents', e - s, 'linhas', linhas)) from grupos), '{}'::jsonb),
    'saldo_inicial_cents', (select coalesce(sum(inicial),0) from porconta),
    'saldo_final_cents', (select coalesce(sum(final),0) from porconta),
    'variacao_cents', (select coalesce(sum(valor_cents),0) from mov),
    'contas', (select coalesce(jsonb_agg(jsonb_build_object('conta', conta, 'inicial_cents', inicial, 'entradas_cents', entradas, 'saidas_cents', saidas, 'final_cents', final, 'confere', inicial + entradas - saidas = final) order by conta), '[]'::jsonb) from porconta where inicial <> 0 or entradas <> 0 or saidas <> 0 or final <> 0)
  ) into r;
  return r;
end $$;
REVOKE ALL ON FUNCTION public.fin_dfc(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_dfc(date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.fin_projecao_diaria(_dias integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_fim date; v_saldo bigint; r jsonb;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  if _dias is null or _dias < 1 or _dias > 366 then raise exception 'Informe de 1 a 366 dias'; end if;
  v_fim := v_hoje + _dias;
  select coalesce(sum(m.valor_cents),0) into v_saldo from financial_account_movements m
    join financial_accounts a on a.id = m.financial_account_id where not a.is_homologacao and m.data <= v_hoje;
  with parc as (
    select i.vencimento, t.direction, coalesce(t.sistema_origem,'') = 'fiado_historico' as fiado, fin_installment_saldo(i.id) saldo
    from financial_installments i join financial_titles t on t.id = i.title_id
    where t.status in ('ativo','aprovado') and i.settlement_status in ('nao_liquidado','parcial') and i.vencimento <= v_fim
  ), dias as (select generate_series(v_hoje + 1, v_fim, interval '1 day')::date d), linhas as (
    select d,
      coalesce((select sum(saldo) from parc where vencimento = d and direction='receivable' and not fiado and saldo > 0),0)::bigint receber,
      coalesce((select sum(saldo) from parc where vencimento = d and direction='payable' and saldo > 0),0)::bigint pagar,
      coalesce((select sum(valor_cents) from fin_cheques where status='em_maos' and bom_para = d),0)::bigint cheques,
      coalesce((select sum(m.valor_cents) from financial_account_movements m join financial_accounts a on a.id=m.financial_account_id where not a.is_homologacao and m.data = d and m.settlement_id is null and m.transfer_id is null),0)::bigint futuros
    from dias
  ), acum as (
    select *, v_saldo + sum(receber + cheques - pagar + futuros) over (order by d) as saldo_projetado from linhas
  )
  select jsonb_build_object(
    'hoje', v_hoje, 'ate', v_fim, 'saldo_hoje_cents', v_saldo,
    'vencidos_receber_cents', (select coalesce(sum(saldo),0) from parc where vencimento <= v_hoje and direction='receivable' and not fiado and saldo > 0),
    'vencidos_pagar_cents', (select coalesce(sum(saldo),0) from parc where vencimento <= v_hoje and direction='payable' and saldo > 0),
    'fiado_no_periodo_cents', (select coalesce(sum(saldo),0) from parc where vencimento > v_hoje and fiado and saldo > 0),
    'cheques_sem_data_cents', (select coalesce(sum(valor_cents),0) from fin_cheques where status='em_maos' and (bom_para is null or bom_para <= v_hoje)),
    'criterio', 'Saldo realizado hoje + parcelas em aberto a receber + cheques em mãos (bom para) − parcelas em aberto a pagar, dia a dia. Vencidos e fiado histórico (Cobrança) ficam fora da linha e aparecem à parte.',
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('data', d, 'receber_cents', receber, 'cheques_cents', cheques, 'pagar_cents', pagar, 'outros_cents', futuros, 'saldo_projetado_cents', saldo_projetado) order by d) from acum), '[]'::jsonb)
  ) into r;
  return r;
end $$;
REVOKE ALL ON FUNCTION public.fin_projecao_diaria(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_projecao_diaria(integer) TO authenticated;