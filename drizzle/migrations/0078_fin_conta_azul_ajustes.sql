
-- 1) Estorno com data escolhida (a versão de 2 argumentos continua igual)
CREATE OR REPLACE FUNCTION public.fin_settlement_reverse_data(_settlement uuid, _motivo text, _data date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare s financial_settlements%rowtype; v_new uuid; a record; v_data date;
begin
  if not has_capability(auth.uid(),'finance.settlement.reverse') then raise exception 'Sem permissão para estornar'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Estorno exige motivo'; end if;
  select * into s from financial_settlements where id = _settlement for update;
  if s.id is null then raise exception 'Baixa não encontrada'; end if;
  if exists (select 1 from financial_settlements where reversed_of = _settlement) then raise exception 'Esta baixa já foi estornada'; end if;
  v_data := coalesce(_data, s.data);
  if v_data < s.data then raise exception 'O estorno não pode ter data anterior à baixa (%)', s.data; end if;
  insert into financial_settlements (direction, financial_account_id, data, valor_cents, payment_method_id,
      referencia, observacao, reversed_of, is_reversal, reversal_reason, created_by)
  values (s.direction, s.financial_account_id, v_data, -s.valor_cents, s.payment_method_id,
      s.referencia, s.observacao, s.id, true, _motivo, auth.uid()) returning id into v_new;
  insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
  select installment_id, v_new, kind, -valor_cents, 'Estorno do ajuste da baixa: ' || _motivo, auth.uid()
    from financial_adjustments where settlement_id = s.id;
  for a in select * from financial_allocations where settlement_id = s.id loop
    insert into financial_allocations (settlement_id, installment_id, valor_cents) values (v_new, a.installment_id, -a.valor_cents);
    perform fin_installment_refresh(a.installment_id);
    insert into financial_title_events (title_id, evento, motivo, payload, actor_id)
    select i.title_id, 'estorno', _motivo, jsonb_build_object('settlement_id', s.id, 'estorno_id', v_new, 'data', v_data), auth.uid()
    from financial_installments i where i.id = a.installment_id;
  end loop;
  -- desfaz também a tarifa separada daquela baixa
  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao, created_by)
  select m.financial_account_id, 'ajuste', v_data, -m.valor_cents, v_new, 'Estorno: ' || _motivo, auth.uid()
    from financial_account_movements m where m.settlement_id = s.id;
  return v_new;
end $$;
REVOKE ALL ON FUNCTION public.fin_settlement_reverse_data(uuid,text,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fin_settlement_reverse_data(uuid,text,date) TO authenticated;

-- 2) Editar parcela em aberto (vencimento e valor), com histórico
CREATE OR REPLACE FUNCTION public.fin_installment_editar(_installment uuid, _vencimento date, _valor_cents bigint, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_i financial_installments; v_t financial_titles; v_pago bigint; v_total bigint;
begin
  select * into v_i from financial_installments where id = _installment for update;
  if not found then raise exception 'Parcela não encontrada'; end if;
  select * into v_t from financial_titles where id = v_i.title_id for update;
  if not has_capability(auth.uid(), case when v_t.direction='payable' then 'finance.payable.manage' else 'finance.receivable.manage' end)
    then raise exception 'Sem permissão'; end if;
  if coalesce(trim(_motivo),'') = '' then raise exception 'Informe o motivo'; end if;
  if v_t.status = 'cancelado' then raise exception 'Título cancelado'; end if;
  if _vencimento is null then raise exception 'Informe o vencimento'; end if;
  if coalesce(_valor_cents,0) <= 0 then raise exception 'Valor deve ser maior que zero'; end if;
  select coalesce(sum(valor_cents),0) into v_pago from financial_allocations where installment_id = _installment;
  if v_pago <> 0 and _valor_cents <> v_i.valor_cents then raise exception 'Parcela com baixa: estorne antes de mudar o valor'; end if;
  if exists (select 1 from asaas_charges c where c.installment_id = _installment and c.status in ('PENDING','OVERDUE')) and _valor_cents <> v_i.valor_cents
    then raise exception 'Parcela com cobrança Asaas aberta: cancele a cobrança antes de mudar o valor'; end if;
  update financial_installments set vencimento = _vencimento, valor_cents = _valor_cents where id = _installment;
  select sum(valor_cents) into v_total from financial_installments where title_id = v_t.id;
  update financial_titles set valor_cents = v_total, updated_at = now() where id = v_t.id;
  perform fin_installment_refresh(_installment);
  insert into financial_title_events(title_id, evento, motivo, payload, actor_id)
  values (v_t.id, 'parcela_editada', _motivo, jsonb_build_object('installment_id', v_i.id, 'numero', v_i.numero,
    'antes', jsonb_build_object('vencimento', v_i.vencimento, 'valor_cents', v_i.valor_cents),
    'depois', jsonb_build_object('vencimento', _vencimento, 'valor_cents', _valor_cents), 'total_titulo', v_total), auth.uid());
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'financeiro.parcela_editada', 'financial_installments', _installment::text,
    jsonb_build_object('antes', to_jsonb(v_i), 'vencimento', _vencimento, 'valor_cents', _valor_cents, 'motivo', _motivo));
  return jsonb_build_object('ok', true, 'total_titulo', v_total);
end $$;
REVOKE ALL ON FUNCTION public.fin_installment_editar(uuid,date,bigint,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fin_installment_editar(uuid,date,bigint,text) TO authenticated;

-- 3) Cheque compensado: lança o dinheiro no banco na data escolhida (baixa oficial se houver parcela)
CREATE OR REPLACE FUNCTION public.fin_cheque_mudar(_id uuid, _para text, _payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare c fin_cheques%rowtype; ok boolean; v_data date; v_inst uuid; v_conta uuid; v_set jsonb;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para movimentar cheques'; end if;
  select * into c from fin_cheques where id = _id for update;
  if not found then raise exception 'Cheque não encontrado'; end if;
  ok := (c.status,_para) in (('em_maos','repassado'),('em_maos','depositado'),('em_maos','devolvido'),('em_maos','cancelado'),
        ('depositado','compensado'),('depositado','devolvido'),('repassado','devolvido'),('devolvido','em_maos'));
  if not ok then raise exception 'Mudança não permitida: de % para %', c.status, _para; end if;
  if _para = 'repassado' and nullif(_payload->>'party_id','') is null and coalesce(trim(_payload->>'nome'),'') = '' then
    raise exception 'Informe para quem o cheque foi passado'; end if;
  if _para = 'depositado' and nullif(_payload->>'account_id','') is null then raise exception 'Informe a conta do depósito'; end if;
  if _para in ('devolvido','cancelado') and coalesce(trim(_payload->>'motivo'),'') = '' then raise exception 'Informe o motivo'; end if;
  if _para = 'compensado' then
    v_data := coalesce(nullif(_payload->>'data','')::date, (now() at time zone 'America/Sao_Paulo')::date);
    v_conta := coalesce(nullif(_payload->>'account_id','')::uuid, c.deposito_account_id);
    if v_conta is null then raise exception 'Informe a conta onde o cheque compensou'; end if;
    v_inst := nullif(_payload->>'installment_id','')::uuid;
    if v_inst is not null then
      v_set := fin_settlement_create_ajustes(jsonb_build_object(
        'direction','receivable','financial_account_id',v_conta,'data',v_data,'valor_cents',c.valor_cents,
        'referencia','Cheque nº '||c.numero,'idempotency_key','cheque:'||c.id,
        'alocacoes', jsonb_build_array(jsonb_build_object('installment_id',v_inst,'valor_cents',c.valor_cents))));
    else
      insert into financial_account_movements (financial_account_id, kind, data, valor_cents, descricao, created_by)
      values (v_conta, 'entrada', v_data, c.valor_cents, 'Cheque compensado nº '||c.numero||' · '||c.emitente_nome, auth.uid());
    end if;
    _payload := _payload || jsonb_build_object('data', v_data, 'account_id', v_conta, 'baixa', v_set);
  end if;
  update fin_cheques set status = _para, updated_at = now(),
    repassado_para_party_id = case when _para='repassado' then nullif(_payload->>'party_id','')::uuid else repassado_para_party_id end,
    repassado_para_nome = case when _para='repassado' then nullif(trim(_payload->>'nome'),'') else repassado_para_nome end,
    deposito_account_id = case when _para in ('depositado','compensado') then coalesce(nullif(_payload->>'account_id','')::uuid, deposito_account_id) else deposito_account_id end
  where id = _id;
  insert into fin_cheque_eventos (cheque_id,de,para,motivo,detalhe,created_by)
    values (_id,c.status,_para,nullif(trim(_payload->>'motivo'),''),_payload,auth.uid());
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
    values (auth.uid(),'cheque.'||_para,'fin_cheques',_id::text,jsonb_build_object('de',c.status,'para',_para,'detalhe',_payload));
end $$;

-- 4) Expurgo de títulos cancelados cujas baixas foram estornadas (soma zero), com backup
CREATE OR REPLACE FUNCTION public.fin_expurgo_titulos_estornados(_titles uuid[], _lote text, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_t uuid; v_n int := 0; v_sets uuid[]; v_inst uuid[];
begin
  if coalesce(trim(_motivo),'') = '' or coalesce(trim(_lote),'') = '' then raise exception 'Lote e motivo obrigatórios'; end if;
  foreach v_t in array _titles loop
    if not exists (select 1 from financial_titles where id = v_t and status = 'cancelado') then raise exception 'Título % não está cancelado', v_t; end if;
    select array_agg(id) into v_inst from financial_installments where title_id = v_t;
    select array_agg(distinct settlement_id) into v_sets from financial_allocations where installment_id = any(v_inst);
    if exists (select 1 from financial_allocations a where a.settlement_id = any(v_sets) and not (a.installment_id = any(v_inst))) then
      raise exception 'Baixa do título % também paga outros títulos', v_t; end if;
    if coalesce((select sum(valor_cents) from financial_allocations where installment_id = any(v_inst)),0) <> 0
      or coalesce((select sum(valor_cents) from financial_account_movements where settlement_id = any(v_sets)),0) <> 0 then
      raise exception 'Título % não soma zero no saldo: não pode sair', v_t; end if;
    insert into fin_expurgo_backup(lote,motivo,tabela,registro_id,registro)
      select _lote,_motivo,'financial_account_movements',m.id,to_jsonb(m) from financial_account_movements m where m.settlement_id = any(v_sets)
      union all select _lote,_motivo,'financial_adjustments',x.id,to_jsonb(x) from financial_adjustments x where x.settlement_id = any(v_sets) or x.installment_id = any(v_inst)
      union all select _lote,_motivo,'financial_allocations',x.id,to_jsonb(x) from financial_allocations x where x.installment_id = any(v_inst)
      union all select _lote,_motivo,'financial_settlements',x.id,to_jsonb(x) from financial_settlements x where x.id = any(v_sets)
      union all select _lote,_motivo,'financial_title_events',x.id,to_jsonb(x) from financial_title_events x where x.title_id = v_t
      union all select _lote,_motivo,'financial_installments',x.id,to_jsonb(x) from financial_installments x where x.title_id = v_t
      union all select _lote,_motivo,'financial_titles',x.id,to_jsonb(x) from financial_titles x where x.id = v_t;
    perform set_config('lardan.fin_expurgo','on',true);
    delete from financial_account_movements where settlement_id = any(v_sets);
    delete from financial_adjustments where settlement_id = any(v_sets) or installment_id = any(v_inst);
    delete from financial_allocations where installment_id = any(v_inst);
    delete from financial_settlements where id = any(v_sets) and reversed_of is not null;
    delete from financial_settlements where id = any(v_sets);
    delete from financial_title_events where title_id = v_t;
    delete from financial_installments where title_id = v_t;
    delete from financial_titles where id = v_t;
    perform set_config('lardan.fin_expurgo','off',true);
    v_n := v_n + 1;
  end loop;
  insert into audit_logs(action, entity, entity_id, payload)
    values ('fin.expurgo_titulos_estornados','financial_titles',null, jsonb_build_object('lote',_lote,'motivo',_motivo,'titulos',_titles));
  return jsonb_build_object('titulos', v_n);
end $$;
REVOKE ALL ON FUNCTION public.fin_expurgo_titulos_estornados(uuid[],text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_expurgo_titulos_estornados(uuid[],text,text) TO service_role;
