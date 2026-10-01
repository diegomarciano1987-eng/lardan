create or replace function public.fin_saldo_conta(_conta uuid, _ate date)
returns bigint language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(m.valor_cents),0)::bigint from financial_account_movements m
  where m.financial_account_id = _conta and m.data <= _ate
$$;
revoke all on function public.fin_saldo_conta(uuid,date) from public, anon;
grant execute on function public.fin_saldo_conta(uuid,date) to authenticated, service_role;

create or replace function public.fin_accounts_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare r jsonb; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', a.id, 'nome', a.nome, 'kind', a.kind, 'banco', a.banco, 'is_active', a.is_active,
      'saldo_cents', fin_saldo_conta(a.id, v_hoje),
      'previsto_futuro_cents', coalesce((select sum(m.valor_cents) from financial_account_movements m
                                  where m.financial_account_id = a.id and m.data > v_hoje),0),
      'data_corte', v_hoje,
      'ultimo_movimento', (select max(m.data)::text from financial_account_movements m
                            where m.financial_account_id = a.id and m.data <= v_hoje)
    ) as x
    from financial_accounts a where not a.is_homologacao
  ) s;
  return r;
end $function$;

create or replace function public.fin_overview(_de date default null, _ate date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_de date := coalesce(_de, date_trunc('month', v_hoje)::date);
        v_ate date := coalesce(_ate, (date_trunc('month', v_hoje) + interval '1 month - 1 day')::date);
        v_corte date := least(coalesce(_ate, v_hoje), v_hoje);
        r jsonb;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  with aberto as (
    select t.direction, i.vencimento,
           i.valor_cents
             + coalesce((select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                                         when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end)
                         from financial_adjustments j where j.installment_id = i.id),0)
             - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0) as saldo
    from financial_installments i join financial_titles t on t.id = i.title_id
    where t.status in ('ativo','aprovado')
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'data_corte_saldo', v_corte,
    'a_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0),0),
    'a_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0),0),
    'vencido_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0 and vencimento < v_hoje),0),
    'vencido_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0 and vencimento < v_hoje),0),
    'proj30_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0 and vencimento between v_hoje and v_hoje + 30),0),
    'proj30_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0 and vencimento between v_hoje and v_hoje + 30),0),
    'proj60_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0 and vencimento between v_hoje and v_hoje + 60),0),
    'proj60_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0 and vencimento between v_hoje and v_hoje + 60),0),
    'proj90_receber_cents', coalesce((select sum(saldo) from aberto where direction='receivable' and saldo > 0 and vencimento between v_hoje and v_hoje + 90),0),
    'proj90_pagar_cents', coalesce((select sum(saldo) from aberto where direction='payable' and saldo > 0 and vencimento between v_hoje and v_hoje + 90),0),
    'recebido_periodo_cents', coalesce((select sum(valor_cents) from financial_settlements where direction='receivable' and data between v_de and least(v_ate, v_hoje)),0),
    'pago_periodo_cents', coalesce((select sum(-valor_cents) from financial_settlements where direction='payable' and data between v_de and least(v_ate, v_hoje)),0) * -1,
    -- saldo inicial já é movimento (kind saldo_inicial): somar só movimentos, sem dupla contagem
    'saldo_contas_cents', coalesce((select sum(fin_saldo_conta(a.id, v_corte)) from financial_accounts a where a.is_active and not a.is_homologacao),0),
    'titulos_pendentes_aprovacao', coalesce((select count(*) from financial_titles where approval_status='pendente'),0)
  ) into r;
  return r;
end $function$;