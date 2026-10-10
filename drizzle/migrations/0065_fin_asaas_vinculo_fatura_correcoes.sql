
-- 1) Conciliação Asaas: resolve a pessoa também pelo código de cliente da fatura (externalReference) e
--    exige casamento único (mesma pessoa + mesmo valor em aberto, preferindo mesmo vencimento).
CREATE OR REPLACE FUNCTION public.asaas_conciliar_cobranca(_charge uuid, _actor uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c record; pid uuid; inst uuid; tit uuid; n int; nd int; b jsonb := null; cod text; regra text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  SELECT * INTO c FROM asaas_charges WHERE id = _charge;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok',false,'motivo','inexistente'); END IF;
  IF c.installment_id IS NOT NULL THEN
    IF c.external_status IN ('RECEIVED','CONFIRMED') THEN b := asaas_baixa_automatica(c.id); END IF;
    RETURN jsonb_build_object('ok',true,'ja_vinculada',true,'baixa',b);
  END IF;
  IF c.external_status NOT IN ('PENDING','OVERDUE','RECEIVED','CONFIRMED','DUNNING_REQUESTED') THEN
    RETURN jsonb_build_object('ok',false,'motivo','situacao_'||c.external_status);
  END IF;
  pid := c.party_id;
  IF pid IS NULL THEN
    SELECT coalesce(cu.party_id, (SELECT min(p.id::text)::uuid FROM parties p
             WHERE length(regexp_replace(coalesce(cu.doc,''),'\D','','g'))>=11 AND p.doc_digits = regexp_replace(cu.doc,'\D','','g') HAVING count(*)=1))
      INTO pid FROM asaas_customers cu WHERE cu.account_id=c.account_id AND cu.external_id=c.customer_external_id;
  END IF;
  -- Número da fatura: os 5 primeiros dígitos do externalReference são o código do cliente no sistema antigo.
  cod := nullif(ltrim(substr(coalesce(c.raw->>'externalReference',''),1,5),'0'),'');
  IF pid IS NULL AND cod ~ '^\d+$' THEN
    SELECT min(l.party_id::text)::uuid INTO pid FROM party_codigos_legados l
     WHERE l.sistema='cliente' AND l.codigo = cod HAVING count(DISTINCT l.party_id)=1;
  END IF;
  IF pid IS NULL THEN RETURN jsonb_build_object('ok',false,'motivo','sem_cliente'); END IF;

  -- a) mesma pessoa + mesmo valor em aberto + mesmo vencimento (único)
  SELECT min(i.id::text)::uuid, count(*) INTO inst, nd
    FROM financial_installments i JOIN financial_titles t ON t.id=i.title_id
   WHERE t.direction='receivable' AND t.status='ativo' AND t.party_id = pid
     AND i.vencimento = c.due_date
     AND public.fin_installment_saldo(i.id) = c.value_cents
     AND NOT EXISTS (SELECT 1 FROM asaas_charges x WHERE x.installment_id=i.id AND x.external_status<>'DELETED');
  IF nd = 1 THEN regra := 'Vínculo automático pela fatura: mesma pessoa, mesmo valor e mesmo vencimento (casamento único)';
  ELSE
    inst := NULL;
    -- b) mesma pessoa + mesmo valor em aberto (única parcela) e nenhuma outra cobrança Asaas concorrente
    SELECT min(i.id::text)::uuid, count(*) INTO inst, n
      FROM financial_installments i JOIN financial_titles t ON t.id=i.title_id
     WHERE t.direction='receivable' AND t.status='ativo' AND t.party_id = pid
       AND public.fin_installment_saldo(i.id) = c.value_cents
       AND abs(i.vencimento - c.due_date) <= 60
       AND NOT EXISTS (SELECT 1 FROM asaas_charges x WHERE x.installment_id=i.id AND x.external_status<>'DELETED');
    IF n <> 1 OR EXISTS (SELECT 1 FROM asaas_charges y WHERE y.id<>c.id AND y.installment_id IS NULL
          AND y.external_status NOT IN ('DELETED','REFUNDED') AND y.value_cents=c.value_cents
          AND coalesce(y.party_id,pid)=pid AND y.customer_external_id=c.customer_external_id) THEN
      RETURN jsonb_build_object('ok',false,'motivo', CASE WHEN coalesce(n,0)=0 THEN 'sem_parcela_mesmo_valor' ELSE 'ambigua' END,'party_id',pid);
    END IF;
    regra := 'Vínculo automático pela fatura: mesma pessoa e mesmo valor em aberto (única parcela, vencimento até 60 dias de diferença)';
  END IF;
  SELECT title_id INTO tit FROM financial_installments WHERE id = inst;
  IF c.party_id IS NULL THEN
    PERFORM set_config('lardann.asaas_link','on', true);
    UPDATE asaas_charges SET party_id = pid WHERE id = c.id;
  END IF;
  PERFORM asaas_vincular_interno(c.id, tit, inst, regra || coalesce(' · fatura '||(c.raw->>'externalReference'),''), _actor);
  IF c.external_status IN ('RECEIVED','CONFIRMED') THEN b := asaas_baixa_automatica(c.id); END IF;
  RETURN jsonb_build_object('ok',true,'installment_id',inst,'title_id',tit,'baixa',b);
END $function$;

-- 2) Estorno de baixa também estorna juros/multa/desconto lançados naquela baixa.
CREATE OR REPLACE FUNCTION public.fin_settlement_reverse(_settlement uuid, _motivo text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare s financial_settlements%rowtype; v_new uuid; a record;
begin
  if not has_capability(auth.uid(),'finance.settlement.reverse') then raise exception 'Sem permissão para estornar'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Estorno exige motivo'; end if;
  select * into s from financial_settlements where id = _settlement for update;
  if s.id is null then raise exception 'Baixa não encontrada'; end if;
  if exists (select 1 from financial_settlements where reversed_of = _settlement) then
    raise exception 'Esta baixa já foi estornada';
  end if;
  insert into financial_settlements (direction, financial_account_id, data, valor_cents, payment_method_id,
      referencia, observacao, reversed_of, is_reversal, reversal_reason, created_by)
  values (s.direction, s.financial_account_id, s.data, -s.valor_cents, s.payment_method_id,
      s.referencia, s.observacao, s.id, true, _motivo, auth.uid())
  returning id into v_new;
  insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
  select installment_id, v_new, kind, -valor_cents, 'Estorno do ajuste da baixa: ' || _motivo, auth.uid()
    from financial_adjustments where settlement_id = s.id;
  for a in select * from financial_allocations where settlement_id = s.id loop
    insert into financial_allocations (settlement_id, installment_id, valor_cents)
    values (v_new, a.installment_id, -a.valor_cents);
    perform fin_installment_refresh(a.installment_id);
    insert into financial_title_events (title_id, evento, motivo, payload, actor_id)
    select i.title_id, 'estorno', _motivo, jsonb_build_object('settlement_id', s.id, 'estorno_id', v_new), auth.uid()
    from financial_installments i where i.id = a.installment_id;
  end loop;
  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao, created_by)
  values (s.financial_account_id, 'ajuste', s.data,
      case when s.direction='payable' then s.valor_cents else -s.valor_cents end, v_new,
      'Estorno: ' || _motivo, auth.uid());
  return v_new;
end $function$;

-- 3) Pedido de consultora e acerto de maleta nascem classificados (3.1.1 + Comercial) quando vierem sem categoria.
CREATE OR REPLACE FUNCTION public.fin_titulo_categoria_padrao()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if new.direction = 'receivable' and new.origem in ('consultora','representante','maleta','acerto','pedido')
     and (new.descricao ~* '^(pedido consultora|acerto de maleta)' or coalesce(new.id_externo,'') ~ '^(pedido|acerto):') then
    if new.chart_account_id is null then
      select id into new.chart_account_id from chart_of_accounts where codigo = '3.1.1' limit 1;
    end if;
    if new.cost_center_id is null then
      select id into new.cost_center_id from cost_centers where codigo = 'comercial' limit 1;
    end if;
  end if;
  return new;
end $function$;
DROP TRIGGER IF EXISTS trg_fin_titulo_categoria_padrao ON public.financial_titles;
CREATE TRIGGER trg_fin_titulo_categoria_padrao BEFORE INSERT ON public.financial_titles
  FOR EACH ROW EXECUTE FUNCTION public.fin_titulo_categoria_padrao();

-- 4) Fluxo projetado: cheque que já tem parcela a receber igual não soma de novo; fiado opcional por %.
DROP FUNCTION IF EXISTS public.fin_projecao_diaria(integer);
CREATE OR REPLACE FUNCTION public.fin_projecao_diaria(_dias integer DEFAULT 60, _fiado_pct numeric DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_fim date; v_saldo bigint; r jsonb; v_hist numeric; v_pct numeric;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  if _dias is null or _dias < 1 or _dias > 366 then raise exception 'Informe de 1 a 366 dias'; end if;
  if _fiado_pct is not null and (_fiado_pct < 0 or _fiado_pct > 100) then raise exception 'Percentual do fiado entre 0 e 100'; end if;
  v_fim := v_hoje + _dias;
  -- % histórico: faturas de consultora no Asaas vencidas nos últimos 12 meses que foram pagas, em valor.
  select round(100.0 * sum(value_cents) filter (where external_status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH'))
               / nullif(sum(value_cents),0), 1)
    into v_hist from asaas_charges
   where external_status not in ('DELETED','REFUNDED') and due_date between v_hoje - 365 and v_hoje;
  v_pct := coalesce(_fiado_pct, 0);
  select coalesce(sum(m.valor_cents),0) into v_saldo from financial_account_movements m
    join financial_accounts a on a.id = m.financial_account_id where not a.is_homologacao and m.data <= v_hoje;
  with parc as (
    select i.id, i.vencimento, t.direction, t.party_id, t.descricao, coalesce(t.sistema_origem,'') = 'fiado_historico' as fiado, fin_installment_saldo(i.id) saldo
    from financial_installments i join financial_titles t on t.id = i.title_id
    where t.status in ('ativo','aprovado') and i.settlement_status in ('nao_liquidado','parcial') and i.vencimento <= v_fim
  ), chq as (
    select c.*, exists (
      select 1 from parc p left join parties pa on pa.id = p.party_id
       where p.direction='receivable' and p.vencimento = c.bom_para and p.saldo = c.valor_cents
         and (p.party_id = c.recebido_de_party_id
              or upper(coalesce(pa.display_name,'') || ' ' || coalesce(p.descricao,'')) like '%' || upper(split_part(trim(c.emitente_nome),' ',1)) || '%')
    ) as ja_no_titulo
    from fin_cheques c where c.status='em_maos'
  ), dias as (select generate_series(v_hoje + 1, v_fim, interval '1 day')::date d), linhas as (
    select d,
      coalesce((select sum(saldo) from parc where vencimento = d and direction='receivable' and not fiado and saldo > 0),0)::bigint receber,
      round(v_pct/100.0 * coalesce((select sum(saldo) from parc where vencimento = d and direction='receivable' and fiado and saldo > 0),0))::bigint fiado,
      coalesce((select sum(saldo) from parc where vencimento = d and direction='payable' and saldo > 0),0)::bigint pagar,
      coalesce((select sum(valor_cents) from chq where bom_para = d and not ja_no_titulo),0)::bigint cheques,
      coalesce((select sum(m.valor_cents) from financial_account_movements m join financial_accounts a on a.id=m.financial_account_id where not a.is_homologacao and m.data = d and m.settlement_id is null and m.transfer_id is null),0)::bigint futuros
    from dias
  ), acum as (
    select *, v_saldo + sum(receber + fiado + cheques - pagar + futuros) over (order by d) as saldo_projetado from linhas
  )
  select jsonb_build_object(
    'hoje', v_hoje, 'ate', v_fim, 'saldo_hoje_cents', v_saldo,
    'fiado_pct', v_pct, 'fiado_pct_historico', v_hist,
    'vencidos_receber_cents', (select coalesce(sum(saldo),0) from parc where vencimento <= v_hoje and direction='receivable' and not fiado and saldo > 0),
    'vencidos_pagar_cents', (select coalesce(sum(saldo),0) from parc where vencimento <= v_hoje and direction='payable' and saldo > 0),
    'fiado_no_periodo_cents', (select coalesce(sum(saldo),0) from parc where vencimento > v_hoje and fiado and saldo > 0),
    'cheques_sem_data_cents', (select coalesce(sum(valor_cents),0) from chq where not ja_no_titulo and (bom_para is null or bom_para <= v_hoje)),
    'cheques_ja_no_titulo_cents', (select coalesce(sum(valor_cents),0) from chq where ja_no_titulo and bom_para > v_hoje and bom_para <= v_fim),
    'criterio', 'Saldo realizado hoje + parcelas em aberto a receber + cheques em mãos (bom para) que ainda não têm parcela a receber igual − parcelas em aberto a pagar, dia a dia. Fiado histórico entra só se você escolher um percentual de recebimento. Vencidos ficam à parte.',
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('data', d, 'receber_cents', receber, 'fiado_cents', fiado, 'cheques_cents', cheques, 'pagar_cents', pagar, 'outros_cents', futuros, 'saldo_projetado_cents', saldo_projetado) order by d) from acum), '[]'::jsonb)
  ) into r;
  return r;
end $function$;
GRANT EXECUTE ON FUNCTION public.fin_projecao_diaria(integer, numeric) TO authenticated;

-- 5) DFC: estorno desconta na própria linha (não vira entrada e saída); linhas zeradas (títulos cancelados/estornados) não aparecem.
CREATE OR REPLACE FUNCTION public.fin_dfc(_de date, _ate date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_fim date; r jsonb;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  if _de is null or _ate is null or _ate < _de then raise exception 'Período inválido'; end if;
  if _ate - _de > 1100 then raise exception 'Período máximo de 3 anos'; end if;
  v_fim := least(_ate, v_hoje);
  with contas as (
    select id, nome from financial_accounts where not is_homologacao
  ), mov as (
    select m.*, c.nome as conta,
      (m.kind in ('transferencia_entrada','transferencia_saida') or m.transfer_id is not null) as e_transf,
      coalesce((select s.is_reversal from financial_settlements s where s.id = m.settlement_id), false) as e_estorno,
      (select ca.natureza::text || '|' || ca.codigo || ' ' || ca.nome
         from financial_allocations al join financial_installments i on i.id = al.installment_id
         join financial_titles t on t.id = i.title_id
         left join chart_of_accounts ca on ca.id = t.chart_account_id
        where al.settlement_id = m.settlement_id order by abs(al.valor_cents) desc limit 1) as plano
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
      coalesce(nullif(split_part(plano,'|',2),''), case when settlement_id is null then coalesce(descricao,'Ajuste de saldo') else 'Sem conta contábil' end) as linha,
      case when e_estorno then least(valor_cents,0) else greatest(valor_cents,0) end as e_val,
      case when e_estorno then -greatest(valor_cents,0) else greatest(-valor_cents,0) end as s_val
    from mov
  ), porlinha as (
    select atividade, linha, sum(e_val)::bigint e, sum(s_val)::bigint s from cls group by 1,2
  ), grupos as (
    select atividade, jsonb_agg(jsonb_build_object('linha', linha, 'entradas_cents', e, 'saidas_cents', s, 'liquido_cents', e - s) order by linha) filter (where e <> 0 or s <> 0) linhas,
           sum(e)::bigint e, sum(s)::bigint s
    from porlinha group by atividade
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
    'criterio', 'Método direto: movimentos bancários realizados (data até hoje), classificados pela natureza da conta contábil do título baixado. Estornos são descontados na própria linha (não viram entrada e saída) e linhas zeradas por estorno/cancelamento não aparecem. Transferências entre contas aparecem à parte.',
    'atividades', coalesce((select jsonb_object_agg(atividade, jsonb_build_object('entradas_cents', e, 'saidas_cents', s, 'liquido_cents', e - s, 'linhas', coalesce(linhas,'[]'::jsonb))) from grupos), '{}'::jsonb),
    'saldo_inicial_cents', (select coalesce(sum(inicial),0) from porconta),
    'saldo_final_cents', (select coalesce(sum(final),0) from porconta),
    'variacao_cents', (select coalesce(sum(valor_cents),0) from mov),
    'contas', (select coalesce(jsonb_agg(jsonb_build_object('conta', conta, 'inicial_cents', inicial, 'entradas_cents', entradas, 'saidas_cents', saidas, 'final_cents', final, 'confere', inicial + entradas - saidas = final) order by conta), '[]'::jsonb) from porconta where inicial <> 0 or entradas <> 0 or saidas <> 0 or final <> 0)
  ) into r;
  return r;
end $function$;
