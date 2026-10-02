-- Correção financeiro (rodada única): tarifa com regra única, DRE com encargos,
-- consultas de leitura, Mesa atômica, conciliação 1:N, sugestões e webhook.

create or replace function public.fin_reconcile(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_key text; v_fp text; v_intent jsonb; v_ex financial_reconciliations%rowtype;
  v_acc uuid; v_dir fin_direction; v_kind text; v_soma_linhas bigint := 0; v_soma_aloc bigint := 0;
  v_tarifa bigint := coalesce((_payload->>'tarifa_cents')::bigint,0);
  v_juros bigint := coalesce((_payload->>'juros_cents')::bigint,0);
  v_desc bigint := coalesce((_payload->>'desconto_cents')::bigint,0);
  v_exced boolean := coalesce((_payload->>'permitir_excedente')::boolean,false);
  v_data date; l record; e jsonb; v_set jsonb; v_set_id uuid; v_rec uuid; v_inst uuid; v_aberto bigint; v_alvo uuid;
  v_esperado bigint; v_primeira boolean := true;
  v_lin_ids uuid[]; v_lin_val bigint[]; v_al_ids uuid[]; v_al_val bigint[];
  i_l int := 1; i_a int := 1; v_par bigint;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  if v_tarifa < 0 or v_juros < 0 or v_desc < 0 then raise exception 'Tarifa, juros e desconto não podem ser negativos'; end if;
  v_key := nullif(_payload->>'idempotency_key','');

  select jsonb_build_object(
    'linhas', (select coalesce(jsonb_agg(x order by x::text),'[]'::jsonb) from jsonb_array_elements_text(_payload->'line_ids') x),
    'alocacoes', (select coalesce(jsonb_agg(y order by y->>'installment_id', y->>'valor_cents'),'[]'::jsonb) from jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb)) y),
    'tarifa', v_tarifa, 'juros', v_juros, 'desconto', v_desc) into v_intent;
  v_fp := fin_fingerprint(v_intent);

  if v_key is not null then
    perform pg_advisory_xact_lock(hashtext('fin_reconcile:' || v_key));
    select * into v_ex from financial_reconciliations where idempotency_key = v_key;
    if found then
      if v_ex.payload_fingerprint <> v_fp then
        raise exception 'Colisão de chave de idempotência: a chave % já foi usada com outro conteúdo.', v_key using errcode='23505';
      end if;
      return jsonb_build_object('id', v_ex.id, 'settlement_id', v_ex.settlement_id, 'repetido', true);
    end if;
  end if;

  for l in select * from financial_statement_lines
            where id in (select (x)::uuid from jsonb_array_elements_text(_payload->'line_ids') x)
            order by data, line_no for update loop
    if l.status not in ('pendente','parcial','divergente') then
      raise exception 'Linha % não está disponível para conciliação (situação: %)', l.line_no, l.status;
    end if;
    if v_acc is null then v_acc := l.financial_account_id; v_kind := l.kind; v_data := l.data;
    elsif v_acc <> l.financial_account_id then raise exception 'As linhas selecionadas são de contas diferentes';
    elsif v_kind <> l.kind then raise exception 'Não é possível misturar entradas e saídas na mesma conciliação';
    end if;
    v_soma_linhas := v_soma_linhas + (l.valor_cents - l.conciliado_cents);
    v_lin_ids := v_lin_ids || l.id; v_lin_val := v_lin_val || (l.valor_cents - l.conciliado_cents);
    if l.data > v_data then v_data := l.data; end if;
  end loop;
  if v_acc is null then raise exception 'Selecione ao menos uma linha do extrato'; end if;
  if v_soma_linhas <= 0 then raise exception 'As linhas selecionadas já estão conciliadas'; end if;
  v_dir := case when v_kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;

  for e in select * from jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb)) loop
    v_inst := (e->>'installment_id')::uuid;
    select i.valor_cents
      + coalesce((select sum(case when kind in ('juros','multa') then valor_cents
                                  when kind in ('desconto','abatimento') then -valor_cents else 0 end)
                    from financial_adjustments where installment_id = i.id),0)
      - coalesce((select sum(valor_cents) from financial_allocations where installment_id = i.id),0)
      into v_aberto
      from financial_installments i join financial_titles t on t.id = i.title_id
     where i.id = v_inst and t.direction = v_dir for update of i;
    if v_aberto is null then raise exception 'Parcela não encontrada ou de natureza incompatível com a linha bancária'; end if;
    if v_primeira then v_aberto := v_aberto + v_juros - v_desc; v_primeira := false; end if;
    if (e->>'valor_cents')::bigint > v_aberto and not v_exced then
      raise exception 'Valor alocado maior que o saldo em aberto da parcela. Marque como excedente explicitamente.';
    end if;
    v_soma_aloc := v_soma_aloc + (e->>'valor_cents')::bigint;
    v_al_ids := v_al_ids || v_inst; v_al_val := v_al_val || (e->>'valor_cents')::bigint;
  end loop;

  v_esperado := case when v_kind = 'entrada' then v_soma_aloc - v_tarifa else v_soma_aloc + v_tarifa end;
  if v_esperado <> v_soma_linhas then
    raise exception 'A soma alocada (%) % tarifa (%) precisa ser igual ao valor do extrato (%)',
      v_soma_aloc, case when v_kind='entrada' then '−' else '+' end, v_tarifa, v_soma_linhas;
  end if;

  v_set := fin_settlement_create(jsonb_build_object(
    'direction', v_dir, 'financial_account_id', v_acc, 'data', v_data::text,
    'valor_cents', v_soma_aloc, 'referencia', coalesce(_payload->>'observacao','Conciliação bancária'),
    'idempotency_key', case when v_key is null then null else 'conc:' || v_key end,
    'alocacoes', coalesce(_payload->'alocacoes','[]'::jsonb)));
  v_set_id := (v_set->>'id')::uuid;

  if v_tarifa > 0 and not coalesce((v_set->>'repetido')::boolean,false) then
    insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao, created_by)
    values (v_acc, 'ajuste', v_data, -v_tarifa, v_set_id, 'Tarifa', auth.uid());
  end if;

  insert into financial_reconciliations (financial_account_id, settlement_id, idempotency_key, payload_fingerprint,
    observacao, created_by)
  values (v_acc, v_set_id, v_key, v_fp, nullif(_payload->>'observacao',''), auth.uid())
  returning id into v_rec;

  v_alvo := v_al_ids[1];
  if v_alvo is not null and (v_juros > 0 or v_desc > 0) then
    if v_juros > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
      values (v_alvo, v_set_id, 'juros', v_juros, 'Juros reconhecidos na conciliação', auth.uid()); end if;
    if v_desc > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
      values (v_alvo, v_set_id, 'desconto', v_desc, 'Desconto reconhecido na conciliação', auth.uid()); end if;
    perform fin_installment_refresh(v_alvo);
  end if;

  while i_a <= coalesce(array_length(v_al_ids,1),0) loop
    if i_l < array_length(v_lin_ids,1) then
      v_par := least(v_lin_val[i_l], v_al_val[i_a]);
    else
      v_par := v_al_val[i_a];
    end if;
    if v_par > 0 then
      insert into financial_reconciliation_allocations (reconciliation_id, line_id, installment_id, valor_cents)
      values (v_rec, v_lin_ids[i_l], v_al_ids[i_a], v_par);
    end if;
    v_lin_val[i_l] := v_lin_val[i_l] - v_par; v_al_val[i_a] := v_al_val[i_a] - v_par;
    if v_al_val[i_a] <= 0 then i_a := i_a + 1; end if;
    if v_lin_val[i_l] <= 0 and i_l < array_length(v_lin_ids,1) then i_l := i_l + 1; end if;
  end loop;

  update financial_statement_lines
     set conciliado_cents = valor_cents, status = 'conciliada', updated_at = now()
   where id = any(v_lin_ids);

  insert into financial_reconciliation_events (reconciliation_id, evento, payload, actor_id)
  values (v_rec, 'conciliado', jsonb_build_object('settlement_id', v_set_id, 'valor_cents', v_soma_linhas,
    'bruto_cents', v_soma_aloc, 'tarifa', v_tarifa, 'juros', v_juros, 'desconto', v_desc), auth.uid());

  return jsonb_build_object('id', v_rec, 'settlement_id', v_set_id, 'repetido', false,
    'valor_cents', v_soma_linhas, 'bruto_cents', v_soma_aloc);
end $function$;

create or replace function public.fin_parcela_posicao(_corte date)
returns table(installment_id uuid, title_id uuid, direction fin_direction, vencimento date, competencia date,
  valor_cents bigint, ajustes_cents bigint, liquidado_cents bigint, saldo_cents bigint)
language sql stable security definer set search_path = public as $function$
  select i.id, i.title_id, t.direction, i.vencimento, coalesce(i.competencia, t.competencia, t.emissao),
         i.valor_cents,
         coalesce(adj.v,0)::bigint,
         coalesce(al.v,0)::bigint,
         greatest(i.valor_cents + coalesce(adj.v,0) - coalesce(al.v,0), 0)::bigint
  from financial_installments i
  join financial_titles t on t.id = i.title_id and t.status <> 'cancelado'
  left join lateral (
    select sum(case when j.kind in ('juros','multa') then j.valor_cents
                    when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end) v
    from financial_adjustments j left join financial_settlements s on s.id = j.settlement_id
    where j.installment_id = i.id and coalesce(s.data, (j.created_at at time zone 'America/Sao_Paulo')::date) <= _corte
  ) adj on true
  left join lateral (
    select sum(case when s.is_reversal then -abs(a.valor_cents) else a.valor_cents end) v
    from financial_allocations a join financial_settlements s on s.id = a.settlement_id
    where a.installment_id = i.id and s.data <= _corte
  ) al on true
$function$;

create or replace function public.fin_auditoria_tarifa_conciliacao()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
begin
  if not has_capability(auth.uid(),'finance.view') then raise exception 'Sem permissão'; end if;
  return jsonb_build_object(
    'quantidade', (select count(*) from financial_adjustments where kind = 'tarifa'),
    'valor_cents', (select coalesce(sum(valor_cents),0) from financial_adjustments where kind = 'tarifa'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'adjustment_id', j.id, 'installment_id', j.installment_id, 'settlement_id', j.settlement_id,
        'titulo', t.descricao, 'parcela', i.numero || '/' || i.total_parcelas,
        'valor_cents', j.valor_cents, 'data', coalesce(s.data, (j.created_at at time zone 'America/Sao_Paulo')::date),
        'motivo', j.motivo, 'situacao_parcela', i.settlement_status) order by j.created_at)
      from financial_adjustments j
      join financial_installments i on i.id = j.installment_id
      join financial_titles t on t.id = i.title_id
      left join financial_settlements s on s.id = j.settlement_id
      where j.kind = 'tarifa'), '[]'::jsonb));
end $function$;

create or replace function public.fin_auditoria_asaas_duplicidade()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v jsonb;
begin
  if not has_capability(auth.uid(),'finance.view') then raise exception 'Sem permissão'; end if;
  with ab as (select a.*, c.party_id, cu.doc cpf_cnpj from fin_asaas_abertas(v_hoje) a
                join asaas_charges c on c.id = a.id
                left join asaas_customers cu on cu.account_id = c.account_id and cu.external_id = c.customer_external_id),
  par as (
    select ab.id charge_id, ab.value_cents, ab.due_date, p.installment_id, p.title_id, p.vencimento, p.saldo_cents
      from ab join fin_parcela_posicao(v_hoje) p on p.direction = 'receivable' and p.saldo_cents > 0
      join financial_titles t on t.id = p.title_id and t.status in ('ativo','aprovado')
      left join parties pt on pt.id = t.party_id
     where p.saldo_cents = ab.value_cents and abs(p.vencimento - ab.due_date) <= 3
       and ((ab.party_id is not null and ab.party_id = t.party_id)
         or (ab.cpf_cnpj is not null and pt.doc_digits is not null
            and regexp_replace(ab.cpf_cnpj,'\D','','g') = pt.doc_digits)))
  select jsonb_build_object(
    'cobrancas', (select count(distinct charge_id) from par),
    'valor_cents', (select coalesce(sum(value_cents),0) from (select distinct charge_id, value_cents from par) x),
    'pares', (select count(*) from par),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('charge_id', charge_id, 'valor_cents', value_cents,
        'vencimento_asaas', due_date, 'installment_id', installment_id, 'vencimento_titulo', vencimento)) from (select * from par limit 200) y), '[]'::jsonb))
  into v;
  return v;
end $function$;

create or replace function public.fin_encargos_contas()
returns jsonb language sql stable security definer set search_path = public as $function$
  select coalesce((select value from site_settings where key = 'financeiro.contas_encargos'), '{}'::jsonb)
$function$;

create or replace function public.fin_encargos_contas_set(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare k text; v uuid; v_res jsonb := '{}'::jsonb; v_antes jsonb;
begin
  if not has_capability(auth.uid(),'finance.settings.manage') then raise exception 'Sem permissão'; end if;
  foreach k in array array['tarifas','juros_recebidos','juros_pagos','descontos_concedidos'] loop
    v := nullif(_payload->>k,'')::uuid;
    if v is not null and not exists (select 1 from chart_of_accounts where id = v and is_active) then
      raise exception 'Conta do plano inválida ou inativa para %', k;
    end if;
    v_res := v_res || jsonb_build_object(k, v);
  end loop;
  v_antes := fin_encargos_contas();
  insert into site_settings (key, value) values ('financeiro.contas_encargos', v_res)
    on conflict (key) do update set value = excluded.value;
  insert into audit_logs (actor_id, action, entity, payload)
  values (auth.uid(), 'fin.encargos_contas', 'site_settings', jsonb_build_object('antes', v_antes, 'depois', v_res));
  return v_res;
end $function$;

create or replace function public.fin_dre_base(_de date, _ate date, _regime text, _cc uuid, _ent uuid)
returns table(origem text, natureza text, chart_id uuid, codigo text, nome text, valor_cents bigint,
  title_id uuid, cc uuid, ref_id uuid, data date, descricao text, contraparte text, direction text)
language plpgsql stable security definer set search_path = public as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; cfg jsonb := fin_encargos_contas();
  v_lim date := case when _regime = 'caixa' then least(_ate, (now() at time zone 'America/Sao_Paulo')::date) else _ate end;
begin
  if _regime = 'competencia' then
    return query
    select 'titulo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome, i.valor_cents, t.id, t.cost_center_id, i.id,
           coalesce(i.competencia, t.competencia, t.emissao),
           t.descricao || case when i.total_parcelas > 1 then ' — parcela '||i.numero||'/'||i.total_parcelas else '' end,
           coalesce(p.display_name,p.legal_name,p.code), t.direction::text
    from financial_installments i join financial_titles t on t.id = i.title_id
    left join parties p on p.id = t.party_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    where t.status in ('ativo','aprovado')
      and coalesce(i.competencia, t.competencia, t.emissao) between _de and _ate
      and (_cc is null or t.cost_center_id = _cc) and (_ent is null or t.business_entity_id = _ent);
  else
    return query
    select 'titulo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome,
           case when s.is_reversal then -abs(al.valor_cents) else abs(al.valor_cents) end, t.id, t.cost_center_id, s.id,
           s.data, coalesce(s.referencia, t.descricao), coalesce(p.display_name,p.legal_name,p.code), t.direction::text
    from financial_settlements s
    join financial_accounts fa on fa.id = s.financial_account_id
    join financial_allocations al on al.settlement_id = s.id
    join financial_installments i on i.id = al.installment_id
    join financial_titles t on t.id = i.title_id
    left join parties p on p.id = t.party_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    where not fa.is_homologacao and s.data between _de and v_lim and t.status <> 'cancelado'
      and (_cc is null or t.cost_center_id = _cc) and (_ent is null or t.business_entity_id = _ent);

    return query
    select 'titulo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome,
           (case when j.kind in ('juros','multa') then -j.valor_cents else j.valor_cents end)::bigint,
           t.id, t.cost_center_id, j.id, s.data, 'Encargo separado da baixa: '||j.kind,
           coalesce(p.display_name,p.legal_name,p.code), t.direction::text
    from financial_adjustments j
    join financial_settlements s on s.id = j.settlement_id
    join financial_accounts fa on fa.id = s.financial_account_id
    join financial_installments i on i.id = j.installment_id
    join financial_titles t on t.id = i.title_id
    left join parties p on p.id = t.party_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    where j.kind in ('juros','multa','desconto','abatimento') and not s.is_reversal
      and not fa.is_homologacao and s.data between _de and v_lim and t.status <> 'cancelado'
      and (_cc is null or t.cost_center_id = _cc) and (_ent is null or t.business_entity_id = _ent);
  end if;

  return query
  select 'encargo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome, j.valor_cents::bigint,
         t.id, t.cost_center_id, j.id, coalesce(s.data, (j.created_at at time zone 'America/Sao_Paulo')::date),
         initcap(j.kind::text) || ' — ' || t.descricao, coalesce(p.display_name,p.legal_name,p.code), t.direction::text
  from financial_adjustments j
  join financial_installments i on i.id = j.installment_id
  join financial_titles t on t.id = i.title_id
  left join financial_settlements s on s.id = j.settlement_id
  left join financial_accounts fa on fa.id = s.financial_account_id
  left join parties p on p.id = t.party_id
  left join chart_of_accounts ca on ca.id = nullif(cfg->>(case
        when j.kind in ('juros','multa') and t.direction = 'receivable' then 'juros_recebidos'
        when j.kind in ('juros','multa') and t.direction = 'payable' then 'juros_pagos'
        when j.kind in ('desconto','abatimento') and t.direction = 'receivable' then 'descontos_concedidos'
        else 'nenhuma' end),'')::uuid
  where j.kind in ('juros','multa','desconto','abatimento') and t.status <> 'cancelado'
    and coalesce(s.is_reversal,false) = false and coalesce(fa.is_homologacao,false) = false
    and coalesce(s.data, (j.created_at at time zone 'America/Sao_Paulo')::date) between _de and v_lim
    and (_cc is null or t.cost_center_id = _cc) and (_ent is null or t.business_entity_id = _ent);

  return query
  select 'encargo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome, abs(m.valor_cents)::bigint,
         tt.id, tt.cost_center_id, m.id, m.data, coalesce(m.descricao,'Tarifa') || ' — ' || fa.nome,
         tt.contraparte, 'payable'::text
  from financial_account_movements m
  join financial_accounts fa on fa.id = m.financial_account_id
  left join lateral (select t.id, t.cost_center_id, t.business_entity_id,
                            coalesce(p.display_name,p.legal_name,p.code) contraparte
                       from financial_allocations a join financial_installments i on i.id = a.installment_id
                       join financial_titles t on t.id = i.title_id left join parties p on p.id = t.party_id
                      where a.settlement_id = m.settlement_id order by a.created_at, a.id limit 1) tt on true
  left join chart_of_accounts ca on ca.id = nullif(cfg->>'tarifas','')::uuid
  where m.kind = 'ajuste' and m.settlement_id is not null and m.valor_cents < 0 and m.descricao ilike 'tarifa%'
    and not fa.is_homologacao and m.data between _de and v_lim
    and (_cc is null or tt.cost_center_id = _cc) and (_ent is null or tt.business_entity_id = _ent);
end $function$;

create or replace function public.fin_dre(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_de date := coalesce(nullif(_filtros->>'de','')::date, date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date);
        v_ate date := coalesce(nullif(_filtros->>'ate','')::date, (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + interval '1 month - 1 day')::date);
        v_regime text := coalesce(_filtros->>'regime','competencia');
        v_cc uuid := nullif(_filtros->>'centro_custo_id','')::uuid;
        v_ent uuid := nullif(_filtros->>'entidade_id','')::uuid;
        v_linhas jsonb; v_pend jsonb; v_sem_cc jsonb; v_parc jsonb; v_conc jsonb; v_fora jsonb; v_enc jsonb;
        v_rec bigint; v_ded bigint; v_cus bigint; v_des bigint;
begin
  if not has_capability(auth.uid(),'finance.dre.view') then raise exception 'Sem permissão'; end if;
  if v_ate < v_de then raise exception 'Período inválido'; end if;
  if v_regime not in ('competencia','caixa') then raise exception 'Regime inválido'; end if;

  create temp table if not exists _dre_base2 on commit drop as
    select * from fin_dre_base(v_de, v_ate, v_regime, v_cc, v_ent) limit 0;
  truncate _dre_base2;
  insert into _dre_base2 select * from fin_dre_base(v_de, v_ate, v_regime, v_cc, v_ent);

  select coalesce(sum(valor_cents) filter (where natureza='receita'),0),
         coalesce(sum(valor_cents) filter (where natureza='deducao'),0),
         coalesce(sum(valor_cents) filter (where natureza='custo'),0),
         coalesce(sum(valor_cents) filter (where natureza='despesa'),0)
    into v_rec, v_ded, v_cus, v_des from _dre_base2;

  select coalesce(jsonb_agg(jsonb_build_object('natureza', natureza, 'chart_id', chart_id, 'codigo', codigo,
           'nome', nome, 'valor_cents', v) order by natureza, codigo), '[]'::jsonb) into v_linhas
  from (select natureza, chart_id, codigo, nome, sum(valor_cents) v from _dre_base2
        where natureza in ('receita','deducao','custo','despesa') group by 1,2,3,4) x;

  select jsonb_build_object('quantidade', count(distinct title_id), 'valor_cents', coalesce(sum(valor_cents),0),
    'criterio', 'Títulos do período sem conta do plano de contas. Ficam fora da DRE até serem classificados.')
    into v_pend from _dre_base2 where origem = 'titulo' and chart_id is null;

  select jsonb_build_object('quantidade', count(distinct title_id), 'valor_cents', coalesce(sum(valor_cents),0),
    'criterio', 'Títulos do período com conta, mas sem centro de custo. Entram na DRE; faltam só para a visão por centro.')
    into v_sem_cc from _dre_base2 where origem = 'titulo' and chart_id is not null and cc is null;

  select jsonb_build_object('quantidade', count(*) filter (where natureza not in ('receita','deducao','custo','despesa')),
    'valor_cents', coalesce(sum(valor_cents) filter (where natureza not in ('receita','deducao','custo','despesa')),0),
    'criterio', 'Títulos classificados em contas de ativo, passivo ou resultado (ex.: amortização de empréstimo). Não são receita nem despesa.')
    into v_fora from _dre_base2 where chart_id is not null;

  select jsonb_build_object('quantidade', count(*), 'valor_cents', coalesce(sum(valor_cents),0),
    'criterio', 'Tarifas, juros, multas e descontos do período sem conta padrão configurada em Configurações do financeiro. Ficam fora da DRE até a conta ser definida.')
    into v_enc from _dre_base2 where origem = 'encargo' and chart_id is null;

  select jsonb_build_object('quantidade', count(*), 'valor_cents', coalesce(sum(saldo),0),
    'criterio', 'Parcelas com vencimento no período e saldo em aberto (cada parcela conta uma vez).')
    into v_parc from (
      select i.valor_cents
        + coalesce((select sum(case when j.kind in ('juros','multa') then j.valor_cents
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
      then 'Competência: valor de cada parcela uma vez, pela competência da parcela (ou do título, ou emissão), mais tarifas, juros, multas e descontos nas contas padrão. Não se compara com recebimentos.'
      else 'Caixa: baixas efetivas pelo valor bruto até a data de corte, uma vez cada; tarifas, juros, multas e descontos vão para as contas padrão; estornos subtraem. Transferências e saldo inicial ficam de fora.' end,
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
      'encargos_sem_conta', v_enc,
      'parcelas_em_aberto', v_parc,
      'nao_conciliados', v_conc)
  );
end $function$;

create or replace function public.fin_dre_detalhe(_filtros jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_de date := coalesce(nullif(_filtros->>'de','')::date, date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date);
        v_ate date := coalesce(nullif(_filtros->>'ate','')::date, (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + interval '1 month - 1 day')::date);
        v_regime text := coalesce(_filtros->>'regime','competencia');
        v_chart uuid := nullif(_filtros->>'chart_id','')::uuid;
        v_cc uuid := nullif(_filtros->>'centro_custo_id','')::uuid;
        v_ent uuid := nullif(_filtros->>'entidade_id','')::uuid;
        v_sem boolean := coalesce((_filtros->>'sem_classificacao')::boolean, false);
        v_enc boolean := coalesce((_filtros->>'encargos_sem_conta')::boolean, false);
        v_rows jsonb; v_soma bigint;
begin
  if not has_capability(auth.uid(),'finance.dre.view') then raise exception 'Sem permissão'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.ref_id, 'data', b.data, 'descricao', b.descricao,
           'contraparte', b.contraparte, 'direction', b.direction, 'valor_cents', b.valor_cents, 'origem', b.origem)
           order by b.data), '[]'::jsonb),
         coalesce(sum(b.valor_cents),0)
    into v_rows, v_soma
  from fin_dre_base(v_de, v_ate, v_regime, v_cc, v_ent) b
  where case when v_enc then b.origem = 'encargo' and b.chart_id is null
             when v_sem then b.origem = 'titulo' and b.chart_id is null
             else b.chart_id = v_chart end;
  return jsonb_build_object('rows', v_rows, 'soma_cents', v_soma);
end $function$;

create or replace function public.fin_mesa_novo_conciliar(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare l financial_statement_lines%rowtype; v_dir fin_direction; v_ext text; v_title uuid; v_inst uuid;
  v_tarifa bigint := coalesce((_payload->>'tarifa_cents')::bigint,0); v_valor bigint; v_regra jsonb;
  v_key text; v_ex financial_reconciliations%rowtype; v_rec jsonb;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  if v_tarifa < 0 then raise exception 'Tarifa não pode ser negativa'; end if;
  select * into l from financial_statement_lines where id = nullif(_payload->>'line_id','')::uuid for update;
  if l.id is null then raise exception 'Linha do extrato não encontrada'; end if;
  v_ext := 'extrato:' || l.id; v_key := 'mesa-novo:' || l.id;

  select * into v_ex from financial_reconciliations where idempotency_key = v_key;
  if found then
    select id into v_title from financial_titles where sistema_origem = 'extrato' and id_externo = v_ext;
    return jsonb_build_object('id', v_ex.id, 'settlement_id', v_ex.settlement_id, 'title_id', v_title, 'repetido', true);
  end if;
  if exists (select 1 from financial_titles where sistema_origem = 'extrato' and id_externo = v_ext) then
    raise exception 'Já existe um lançamento criado para esta linha do extrato.';
  end if;
  if l.status not in ('pendente','parcial','divergente') then
    raise exception 'Linha % não está disponível para conciliação (situação: %)', l.line_no, l.status;
  end if;

  v_dir := case when l.kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;
  v_valor := (l.valor_cents - l.conciliado_cents) + case when l.kind = 'entrada' then v_tarifa else -v_tarifa end;
  if v_valor <= 0 then raise exception 'Tarifa maior que o valor da linha'; end if;

  v_regra := fin_approval_rule();
  if coalesce((v_regra->>'exigir')::boolean,false) and v_valor >= coalesce((v_regra->>'valor_minimo_cents')::bigint,0) then
    raise exception 'A regra de aprovação exige que este lançamento nasça em rascunho. Crie o título em Pagar e receber, aprove e depois concilie.';
  end if;

  v_title := fin_title_create(jsonb_build_object(
    'direction', v_dir, 'party_id', _payload->>'party_id', 'descricao', _payload->>'descricao',
    'documento', _payload->>'documento', 'emissao', l.data::text,
    'competencia', coalesce(nullif(_payload->>'competencia',''), l.data::text),
    'observacao', _payload->>'observacao', 'cost_center_id', _payload->>'cost_center_id',
    'chart_account_id', _payload->>'chart_account_id', 'payment_method_id', _payload->>'payment_method_id',
    'business_entity_id', _payload->>'business_entity_id', 'financial_account_id', l.financial_account_id,
    'valor_cents', v_valor, 'status', 'ativo', 'origem', 'conciliacao',
    'sistema_origem', 'extrato', 'id_externo', v_ext,
    'parcelas', jsonb_build_array(jsonb_build_object('vencimento', l.data::text, 'valor_cents', v_valor))));
  select id into v_inst from financial_installments where title_id = v_title order by numero limit 1;

  v_rec := fin_reconcile(jsonb_build_object('line_ids', jsonb_build_array(l.id),
    'alocacoes', jsonb_build_array(jsonb_build_object('installment_id', v_inst, 'valor_cents', v_valor)),
    'tarifa_cents', v_tarifa, 'observacao', _payload->>'observacao', 'idempotency_key', v_key));
  return v_rec || jsonb_build_object('title_id', v_title);
end $function$;

create or replace function public.fin_statement_suggest(_line uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare l financial_statement_lines%rowtype; v_dir fin_direction; v_res jsonb;
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  select * into l from financial_statement_lines where id = _line;
  if l.id is null then raise exception 'Linha não encontrada'; end if;
  v_dir := case when l.kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;
  delete from financial_match_suggestions where line_id = _line;

  insert into financial_match_suggestions (line_id, installment_id, score, reasons)
  select _line, c.id, c.score, c.reasons from (
    select i.id,
      (case when i.valor_cents - i.pago = l.valor_cents then 50
            when i.valor_cents = l.valor_cents then 30 else 0 end)
      + (case when abs(i.vencimento - l.data) = 0 then 20
              when abs(i.vencimento - l.data) <= 3 then 12
              when abs(i.vencimento - l.data) <= 7 then 6
              when abs(i.vencimento - l.data) <= 15 then 2 else 0 end)
      + (case when coalesce(t.documento,'') <> '' and coalesce(l.documento,'') <> ''
               and upper(t.documento) = upper(l.documento) then 25 else 0 end)
      + (case when p.display_name is not null and coalesce(l.historico,'') <> ''
               and fin_unaccent_lower(l.historico) like '%' || fin_unaccent_lower(split_part(p.display_name,' ',1)) || '%' then 20 else 0 end)
      as score,
      jsonb_build_object('valor_exato', i.valor_cents - i.pago = l.valor_cents,
                         'dias', abs(i.vencimento - l.data),
                         'documento', coalesce(t.documento,''),
                         'contraparte', coalesce(p.display_name,'')) as reasons
    from (
      select i.*, coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0) as pago
      from financial_installments i) i
    join financial_titles t on t.id = i.title_id
    left join parties p on p.id = t.party_id
    where t.direction = v_dir and t.status in ('ativo','aprovado')
      and t.approval_status in ('nao_exigida','aprovada')
      and i.settlement_status in ('nao_liquidado','parcial')
      and i.valor_cents - i.pago > 0
  ) c
  where c.score >= 20
  order by c.score desc limit 10;

  select coalesce(jsonb_agg(jsonb_build_object('installment_id', s.installment_id, 'score', s.score,
           'reasons', s.reasons, 'vencimento', i.vencimento, 'valor_cents', i.valor_cents,
           'aberto_cents', i.valor_cents - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id=i.id),0),
           'titulo', t.descricao, 'contraparte', p.display_name) order by s.score desc), '[]'::jsonb)
    into v_res
  from financial_match_suggestions s
  join financial_installments i on i.id = s.installment_id
  join financial_titles t on t.id = i.title_id
  left join parties p on p.id = t.party_id
  where s.line_id = _line;
  return v_res;
end $function$;

create or replace function public.asaas_evento_processar(_evento uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
DECLARE e record; tipo record; c record; p jsonb; atrasado boolean := false;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT public.has_capability(auth.uid(),'finance.reconcile') THEN
    RAISE EXCEPTION 'Sem permissão para conciliar eventos.';
  END IF;
  SELECT * INTO e FROM public.asaas_events WHERE id=_evento FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Evento inexistente.'; END IF;
  IF e.processed_at IS NOT NULL THEN
    RETURN jsonb_build_object('id', e.id, 'repetido', true, 'status', e.status);
  END IF;
  SELECT * INTO tipo FROM public.asaas_event_types WHERE event = e.event;
  p := coalesce(e.payload,'{}'::jsonb);

  SELECT * INTO c FROM public.asaas_charges
    WHERE account_id = e.account_id AND external_id = e.charge_external_id FOR UPDATE;

  IF tipo.event IS NULL THEN
    UPDATE public.asaas_events SET status='na_fila', classification='desconhecido',
      last_error='Tipo de evento não catalogado.', attempts = attempts + 1 WHERE id=e.id;
    RETURN jsonb_build_object('id', e.id, 'status','na_fila','motivo','tipo_desconhecido');
  END IF;

  IF c.id IS NULL THEN
    UPDATE public.asaas_events SET status='na_fila', classification='revisao',
      last_error='Evento sem cobrança espelhada.', attempts = attempts + 1 WHERE id=e.id;
    RETURN jsonb_build_object('id', e.id, 'status','na_fila','motivo','sem_cobranca');
  END IF;

  IF c.updated_at > e.event_at AND c.external_status IS DISTINCT FROM tipo.estado_externo
     AND EXISTS (SELECT 1 FROM public.asaas_events z
                  WHERE z.account_id=e.account_id AND z.charge_external_id=e.charge_external_id
                    AND z.processed_at IS NOT NULL AND z.event_at > e.event_at) THEN
    atrasado := true;
  END IF;

  PERFORM set_config('lardann.asaas_link','on', true);
  IF atrasado THEN
    UPDATE public.asaas_events SET status='na_fila', classification='revisao',
      last_error='Evento anterior a uma situação mais recente: exige conciliação.',
      processed_at=now() WHERE id=e.id;
  ELSE
    UPDATE public.asaas_charges SET
      external_status = tipo.estado_externo,
      received_cents = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN coalesce((p->>'valuePaidCents')::bigint, received_cents) ELSE received_cents END,
      fee_cents      = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN coalesce((p->>'feeCents')::bigint, fee_cents) ELSE fee_cents END,
      net_value_cents= CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN coalesce((p->>'netValueCents')::bigint, net_value_cents) ELSE net_value_cents END,
      refunded_cents = CASE WHEN tipo.estorno IN ('total','parcial')
                            THEN coalesce((p->>'refundedCents')::bigint, refunded_cents) ELSE refunded_cents END,
      payment_date   = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN coalesce(nullif(p->>'paymentDate','')::date, payment_date)
                            ELSE payment_date END,
      credit_date    = CASE WHEN tipo.efeito_caixa = 'credita_conta_asaas'
                            THEN coalesce(nullif(p->>'creditDate','')::date, credit_date)
                            ELSE credit_date END
    WHERE id = c.id;

    UPDATE public.asaas_events SET
      status = CASE WHEN tipo.revisao_manual OR tipo.efeito_recebivel <> 'espelha'
                    THEN 'na_fila' ELSE 'processado' END,
      classification = CASE WHEN tipo.revisao_manual THEN 'revisao' ELSE 'conhecido' END,
      processed_at = now(),
      last_error = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                        THEN 'Recebimento espelhado. A baixa depende de regra contábil ainda não definida.'
                        WHEN tipo.revisao_manual THEN 'Ocorrência pendente de decisão humana.'
                        ELSE NULL END
     WHERE id = e.id;
  END IF;
  PERFORM set_config('lardann.asaas_link','off', true);

  RETURN jsonb_build_object('id', e.id, 'atrasado', atrasado,
    'estado_externo', tipo.estado_externo, 'efeito_recebivel', tipo.efeito_recebivel,
    'efeito_caixa', tipo.efeito_caixa, 'estorno', tipo.estorno,
    'revisao_manual', tipo.revisao_manual, 'baixa_criada', false,
    'aviso','Nenhuma baixa nasce de evento: a regra contábil do recebimento continua pendente.');
END $function$;

revoke all on function public.fin_reconcile(jsonb), public.fin_parcela_posicao(date),
  public.fin_auditoria_tarifa_conciliacao(), public.fin_auditoria_asaas_duplicidade(),
  public.fin_encargos_contas(), public.fin_encargos_contas_set(jsonb),
  public.fin_dre_base(date,date,text,uuid,uuid), public.fin_dre(jsonb), public.fin_dre_detalhe(jsonb),
  public.fin_mesa_novo_conciliar(jsonb), public.fin_statement_suggest(uuid), public.asaas_evento_processar(uuid)
  from public, anon;
revoke all on function public.fin_dre_base(date,date,text,uuid,uuid), public.fin_parcela_posicao(date) from authenticated;
grant execute on function public.fin_reconcile(jsonb), public.fin_auditoria_tarifa_conciliacao(),
  public.fin_auditoria_asaas_duplicidade(), public.fin_encargos_contas(), public.fin_encargos_contas_set(jsonb),
  public.fin_dre(jsonb), public.fin_dre_detalhe(jsonb), public.fin_mesa_novo_conciliar(jsonb),
  public.fin_statement_suggest(uuid), public.asaas_evento_processar(uuid) to authenticated;
grant execute on function public.asaas_evento_processar(uuid), public.fin_parcela_posicao(date),
  public.fin_dre_base(date,date,text,uuid,uuid) to service_role;
