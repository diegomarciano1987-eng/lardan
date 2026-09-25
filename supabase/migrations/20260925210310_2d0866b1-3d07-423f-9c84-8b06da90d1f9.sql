-- ===== A. baixa: validação completa antes de qualquer efeito + identidade com encargos =====
CREATE OR REPLACE FUNCTION public.fin_settlement_create(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare v_dir fin_direction; v_valor bigint; v_soma bigint := 0; v_id uuid; v_key text; e jsonb;
  v_inst uuid; v_ex financial_settlements%rowtype; v_fp text; v_intent jsonb; v_conta financial_accounts%rowtype;
  r record;
begin
  if not has_capability(auth.uid(),'finance.settlement.create') then raise exception 'Sem permissão para registrar baixa'; end if;
  v_dir := (_payload->>'direction')::fin_direction;
  v_valor := (_payload->>'valor_cents')::bigint;
  v_key := nullif(_payload->>'idempotency_key','');
  if v_dir is null then raise exception 'Informe se é recebimento ou pagamento'; end if;
  if v_valor is null or v_valor <= 0 then raise exception 'Valor da baixa deve ser maior que zero'; end if;

  -- identidade completa: inclui tarifa, juros e desconto
  select jsonb_build_object(
    'direction', _payload->>'direction',
    'account', _payload->>'financial_account_id',
    'data', coalesce(nullif(_payload->>'data',''), current_date::text),
    'valor_cents', v_valor,
    'tarifa_cents', coalesce((_payload->>'tarifa_cents')::bigint,0),
    'juros_cents', coalesce((_payload->>'juros_cents')::bigint,0),
    'desconto_cents', coalesce((_payload->>'desconto_cents')::bigint,0),
    'alocacoes', coalesce(jsonb_agg(x order by x->>'installment_id', x->>'valor_cents'), '[]'::jsonb))
  into v_intent
  from jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb)) x;
  v_fp := fin_fingerprint(v_intent);

  if v_key is not null then
    perform pg_advisory_xact_lock(hashtext('fin_settlement:' || v_key));
    select * into v_ex from financial_settlements where idempotency_key = v_key;
    if found then
      if v_ex.payload_fingerprint is distinct from v_fp then
        raise exception 'Colisão de chave de idempotência: a chave % já foi usada com outro conteúdo.', v_key
          using errcode = '23505';
      end if;
      return jsonb_build_object('id', v_ex.id, 'repetido', true,
        'nao_alocado_cents', v_ex.valor_cents - coalesce((select sum(valor_cents) from financial_allocations where settlement_id = v_ex.id),0));
    end if;
  end if;

  select * into v_conta from financial_accounts where id = nullif(_payload->>'financial_account_id','')::uuid;
  if v_conta.id is null then raise exception 'Conta financeira inexistente'; end if;
  if v_conta.is_active is false then raise exception 'Conta financeira inativa'; end if;

  for e in select * from jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb)) loop
    v_inst := (e->>'installment_id')::uuid;
    select i.id, t.direction, t.status, t.approval_status, t.business_entity_id into r
      from financial_installments i join financial_titles t on t.id = i.title_id
     where i.id = v_inst for update of i;
    if r.id is null then raise exception 'Parcela inexistente'; end if;
    if r.direction <> v_dir then
      raise exception 'Natureza incompatível: baixa de % não pode quitar parcela de %',
        case when v_dir='receivable' then 'recebimento' else 'pagamento' end,
        case when r.direction='receivable' then 'conta a receber' else 'conta a pagar' end;
    end if;
    if r.status not in ('ativo','aprovado') then raise exception 'Título em situação % não aceita baixa', r.status; end if;
    if r.approval_status not in ('nao_exigida','aprovada') then raise exception 'Título aguardando aprovação não aceita baixa'; end if;
    if v_conta.business_entity_id is not null and r.business_entity_id is not null
       and v_conta.business_entity_id <> r.business_entity_id then
      raise exception 'Conta financeira de outra empresa';
    end if;
    if (e->>'valor_cents')::bigint is null or (e->>'valor_cents')::bigint <= 0 then raise exception 'Alocação com valor inválido'; end if;
    v_soma := v_soma + (e->>'valor_cents')::bigint;
  end loop;
  if v_soma <= 0 then raise exception 'Informe ao menos uma parcela para alocar'; end if;
  if v_soma > v_valor then raise exception 'Alocação (%) maior que o valor da baixa (%)', v_soma, v_valor; end if;

  insert into financial_settlements (direction, financial_account_id, data, valor_cents, payment_method_id,
      referencia, observacao, idempotency_key, payload_fingerprint, created_by)
  values (v_dir, v_conta.id, coalesce(nullif(_payload->>'data','')::date, current_date),
      v_valor, nullif(_payload->>'payment_method_id','')::uuid, nullif(_payload->>'referencia',''),
      nullif(_payload->>'observacao',''), v_key, v_fp, auth.uid())
  returning id into v_id;

  for e in select * from jsonb_array_elements(_payload->'alocacoes') loop
    v_inst := (e->>'installment_id')::uuid;
    insert into financial_allocations (settlement_id, installment_id, valor_cents)
    values (v_id, v_inst, (e->>'valor_cents')::bigint);
    perform fin_installment_refresh(v_inst);
    insert into financial_title_events (title_id, evento, payload, actor_id)
    select i.title_id, case when v_dir='payable' then 'pagamento' else 'recebimento' end,
           jsonb_build_object('settlement_id', v_id, 'valor_cents', (e->>'valor_cents')::bigint), auth.uid()
    from financial_installments i where i.id = v_inst;
  end loop;

  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao, created_by)
  values (v_conta.id, (case when v_dir='payable' then 'saida' else 'entrada' end)::fin_movement_kind,
      coalesce(nullif(_payload->>'data','')::date, current_date),
      case when v_dir='payable' then -v_valor else v_valor end, v_id,
      nullif(_payload->>'referencia',''), auth.uid());

  return jsonb_build_object('id', v_id, 'repetido', false, 'nao_alocado_cents', v_valor - v_soma);
end $fn$;

-- ===== B. ajustes: tarifa é despesa da conta, não dívida da consultora =====
CREATE OR REPLACE FUNCTION public.fin_settlement_create_ajustes(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare v_set jsonb; v_alvo uuid;
  v_tarifa bigint := coalesce((_payload->>'tarifa_cents')::bigint,0);
  v_juros bigint := coalesce((_payload->>'juros_cents')::bigint,0);
  v_desc bigint := coalesce((_payload->>'desconto_cents')::bigint,0);
begin
  if v_tarifa < 0 or v_juros < 0 or v_desc < 0 then raise exception 'Tarifa, juros e desconto não podem ser negativos'; end if;
  v_set := fin_settlement_create(_payload);  -- encargos entram na identidade
  if coalesce((v_set->>'repetido')::boolean,false) or v_tarifa + v_juros + v_desc = 0 then return v_set; end if;
  select (x->>'installment_id')::uuid into v_alvo from jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb)) x limit 1;
  if v_alvo is null then return v_set; end if;
  if v_tarifa > 0 then
    -- despesa de processamento: sai da conta, não altera o devido do título
    insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao, created_by)
    values ((_payload->>'financial_account_id')::uuid, 'ajuste', coalesce(nullif(_payload->>'data','')::date, current_date),
      -v_tarifa, (v_set->>'id')::uuid, 'Tarifa de processamento', auth.uid());
  end if;
  if v_juros > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
    values (v_alvo, (v_set->>'id')::uuid, 'juros', v_juros, 'Juros informados na baixa manual', auth.uid()); end if;
  if v_desc > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
    values (v_alvo, (v_set->>'id')::uuid, 'desconto', v_desc, 'Desconto informado na baixa manual', auth.uid()); end if;
  perform fin_installment_refresh(v_alvo);
  return v_set;
end $fn$;

-- ===== C. devido: tarifa não soma à dívida (nenhum registro histórico de tarifa existe) =====
CREATE OR REPLACE FUNCTION public.fin_installment_refresh(_installment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare v_valor bigint; v_ajuste bigint; v_aloc bigint; v_devido bigint; v_st fin_settlement_status;
begin
  select valor_cents into v_valor from financial_installments where id = _installment;
  if v_valor is null then return; end if;
  select coalesce(sum(case when kind in ('juros','multa') then valor_cents
                           when kind in ('desconto','abatimento') then -valor_cents
                           else 0 end),0)
    into v_ajuste from financial_adjustments where installment_id = _installment;
  select coalesce(sum(valor_cents),0) into v_aloc from financial_allocations where installment_id = _installment;
  v_devido := v_valor + v_ajuste;
  v_st := case when v_aloc <= 0 then 'nao_liquidado'
               when v_aloc < v_devido then 'parcial'
               when v_aloc = v_devido then 'liquidado'
               else 'excedente' end;
  update financial_installments set settlement_status = v_st, updated_at = now() where id = _installment;
end $fn$;

-- ===== D. estorno: compensa todos os efeitos da própria baixa =====
CREATE OR REPLACE FUNCTION public.fin_settlement_reverse(_settlement uuid, _motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare s financial_settlements%rowtype; v_new uuid; a record; m record;
begin
  if not has_capability(auth.uid(),'finance.settlement.reverse') then raise exception 'Sem permissão para estornar'; end if;
  if coalesce(_motivo,'') = '' then raise exception 'Estorno exige motivo'; end if;
  select * into s from financial_settlements where id = _settlement for update;
  if s.id is null then raise exception 'Baixa não encontrada'; end if;
  if s.is_reversal then raise exception 'Um estorno não pode ser estornado'; end if;
  if exists (select 1 from financial_settlements where reversed_of = _settlement) then
    raise exception 'Esta baixa já foi estornada';
  end if;
  insert into financial_settlements (direction, financial_account_id, data, valor_cents, payment_method_id,
      referencia, observacao, reversed_of, is_reversal, reversal_reason, created_by)
  values (s.direction, s.financial_account_id, current_date, -s.valor_cents, s.payment_method_id,
      s.referencia, s.observacao, s.id, true, _motivo, auth.uid())
  returning id into v_new;

  -- ajustes ligados a esta baixa: compensação (ajustes independentes ficam)
  insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
  select installment_id, v_new, kind, -valor_cents, 'Estorno: ' || _motivo, auth.uid()
    from financial_adjustments where settlement_id = s.id;

  for a in select * from financial_allocations where settlement_id = s.id loop
    insert into financial_allocations (settlement_id, installment_id, valor_cents)
    values (v_new, a.installment_id, -a.valor_cents);
    insert into financial_title_events (title_id, evento, motivo, payload, actor_id)
    select i.title_id, 'estorno', _motivo, jsonb_build_object('settlement_id', s.id, 'estorno_id', v_new), auth.uid()
    from financial_installments i where i.id = a.installment_id;
  end loop;
  for a in select distinct installment_id from financial_adjustments where settlement_id in (s.id, v_new)
           union select installment_id from financial_allocations where settlement_id = s.id loop
    perform fin_installment_refresh(a.installment_id);
  end loop;

  -- movimentos da conta ligados à baixa (valor e tarifa): compensação exata
  for m in select * from financial_account_movements where settlement_id = s.id loop
    insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao, created_by)
    values (m.financial_account_id, 'ajuste', current_date, -m.valor_cents, v_new,
      'Estorno: ' || _motivo || coalesce(' · ' || m.descricao, ''), auth.uid());
  end loop;
  return v_new;
end $fn$;

-- ===== E. webhook: informa se o evento salvo ainda está pendente =====
CREATE OR REPLACE FUNCTION public.asaas_evento_registrar(_payload jsonb, _origem text, _actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE conta record; v_id uuid; novo boolean := true; tipo record; ev record;
BEGIN
  IF _payload IS NULL THEN RAISE EXCEPTION 'Evento vazio.'; END IF;
  SELECT * INTO conta FROM public.asaas_accounts WHERE id = nullif(_payload->>'account_id','')::uuid;
  IF conta.id IS NULL THEN RAISE EXCEPTION 'Evento sem conta identificada.'; END IF;
  IF _origem = 'simulacao' THEN
    IF conta.modo_execucao <> 'simulado' THEN RAISE EXCEPTION 'Evento simulado não entra em conta conectada.'; END IF;
    IF NOT public.asaas_ator_pode(_actor, 'finance.reconcile') THEN RAISE EXCEPTION 'Sem permissão para gerar evento de demonstração.'; END IF;
  ELSIF _origem = 'provedor' THEN
    IF conta.modo_execucao <> 'conectado' THEN RAISE EXCEPTION 'Conta sem conexão: evento do provedor recusado.'; END IF;
  ELSE
    RAISE EXCEPTION 'Origem de evento inválida.';
  END IF;
  IF coalesce(_payload->>'external_id','') = '' THEN RAISE EXCEPTION 'Evento sem identificador.'; END IF;
  IF coalesce(_payload->>'event','') = '' THEN RAISE EXCEPTION 'Evento sem tipo.'; END IF;
  IF length(_payload::text) > 200000 THEN RAISE EXCEPTION 'Mensagem grande demais.'; END IF;
  SELECT * INTO tipo FROM public.asaas_event_types WHERE event = _payload->>'event';
  INSERT INTO public.asaas_events
    (account_id, external_id, event, charge_external_id, event_at, received_at, status, classification, payload)
  VALUES (conta.id, _payload->>'external_id', _payload->>'event', _payload->>'charge_external_id',
          coalesce(nullif(_payload->>'event_at','')::timestamptz, now()), now(), 'na_fila',
          CASE WHEN tipo.event IS NULL THEN 'desconhecido' ELSE 'conhecido' END,
          coalesce(_payload->'payload','{}'::jsonb) || jsonb_build_object('_origem', _origem))
  ON CONFLICT (account_id, external_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN novo := false; END IF;
  SELECT id, processed_at, status INTO ev FROM public.asaas_events
   WHERE account_id = conta.id AND external_id = _payload->>'external_id';
  RETURN jsonb_build_object('id', ev.id, 'novo', novo, 'conhecido', tipo.event IS NOT NULL,
    'pendente', ev.processed_at IS NULL, 'status', ev.status);
END $fn$;

-- ===== F. extrato: arquivo registrado ≠ concluído; data inválida vira linha inválida =====
CREATE OR REPLACE FUNCTION public.fin_statement_file_register(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare v_file uuid; v_imp uuid; v_ex record;
begin
  if not has_capability(auth.uid(),'finance.statement.import') then raise exception 'Sem permissão para importar extratos'; end if;
  select f.id as file_id, i.id as import_id, coalesce(i.total_linhas,0) as total into v_ex
    from financial_statement_files f left join financial_statement_imports i on i.file_id = f.id
   where f.sha256 = _payload->>'sha256' limit 1;
  if found then
    return jsonb_build_object('file_id', v_ex.file_id, 'import_id', v_ex.import_id, 'repetido', true,
      'concluido', v_ex.total > 0);
  end if;
  insert into financial_statement_files (financial_account_id, storage_path, original_name, format, size_bytes, sha256, created_by)
  values ((_payload->>'financial_account_id')::uuid, _payload->>'storage_path', _payload->>'original_name',
          (_payload->>'format')::fin_statement_format, coalesce((_payload->>'size_bytes')::bigint,0),
          _payload->>'sha256', auth.uid())
  returning id into v_file;
  insert into financial_statement_imports (file_id, financial_account_id, created_by)
  values (v_file, (_payload->>'financial_account_id')::uuid, auth.uid())
  returning id into v_imp;
  insert into financial_reconciliation_events (import_id, evento, payload, actor_id)
  values (v_imp, 'arquivo_registrado', jsonb_build_object('sha256', _payload->>'sha256', 'nome', _payload->>'original_name'), auth.uid());
  return jsonb_build_object('file_id', v_file, 'import_id', v_imp, 'repetido', false, 'concluido', false);
end $fn$;

CREATE OR REPLACE FUNCTION public.fin_safe_date(_t text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $fn$
begin
  if _t is null or _t !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return _t::date;
exception when others then return null;
end $fn$;

DO $do$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('public.fin_statement_lines_stage(uuid,jsonb)'::regprocedure) INTO src;
  src := replace(src, 'v_data := nullif(e->>''data'','''')::date;', 'v_data := fin_safe_date(nullif(e->>''data'',''''));');
  EXECUTE src;
END $do$;

-- ===== G. conta Asaas → conta financeira explícita =====
ALTER TABLE public.asaas_accounts ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES public.financial_accounts(id);
DO $do$ BEGIN
  PERFORM set_config('lardann.asaas_account_config','on',true);
  UPDATE public.asaas_accounts SET financial_account_id='ae0cbcbd-81e1-4fcf-9b4c-ba5c4d1cfd14'
   WHERE id='c5362598-6dc8-41ae-b32b-65bd7b3208c3' AND financial_account_id IS NULL;
  PERFORM set_config('lardann.asaas_account_config','off',true);
END $do$;

-- ===== H. leitor de entrada: não recebe peça de ciclo controlado =====
DO $do$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('public.kit_entrada_bipar(uuid,text,text)'::regprocedure) INTO src;
  src := replace(src, '  mov := public.register_stock_movement(''entrada''',
'  IF EXISTS (SELECT 1 FROM public.kit_balances b JOIN public.kit_cycles c ON c.id = b.cycle_id
              WHERE c.consultora_party_id = e.consultora_party_id
                AND c.status IN (''expedida'',''transito'',''recebida'',''operacao'',''acerto'')
                AND b.variant_id = (achado->>''variant_id'')::uuid
                AND coalesce(b.qty_accepted,0) + coalesce(b.qty_allocated,0) * 0
                    - coalesce(b.qty_sold,0) - coalesce(b.qty_returned,0) - coalesce(b.qty_return_transit,0)
                    - coalesce(b.qty_lost,0) > 0) THEN
    RAISE EXCEPTION ''Esta peça pertence a uma maleta em ciclo desta consultora. Registre pelo retorno da maleta, não pelo leitor de entrada.'';
  END IF;
  mov := public.register_stock_movement(''entrada''');
  IF position('pelo retorno da maleta' in src) = 0 THEN RAISE EXCEPTION 'patch kit_entrada_bipar falhou'; END IF;
  EXECUTE src;
END $do$;