-- Microtarifas de notificação do Asaas (WhatsApp e robô de voz): conciliação em lote,
-- um título por conta e mês, favorecido ASAAS, classificado como Tarifas Bancárias / Administrativo.
create or replace function public.fin_microtarifas_tipos() returns text[]
language sql immutable set search_path = public as $$
  select array['INSTANT_TEXT_MESSAGE_FEE','PHONE_CALL_NOTIFICATION_FEE']::text[]
$$;

create or replace function public.fin_microtarifas_previa(_conta uuid, _ate date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_ate date;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  v_ate := least(coalesce(_ate, v_hoje), v_hoje);
  return coalesce((
    select jsonb_agg(m order by m->>'mes') from (
      select jsonb_build_object(
        'mes', to_char(date_trunc('month', data),'YYYY-MM'),
        'qtd', count(*),
        'qtd_whatsapp', count(*) filter (where raw->>'type' = 'INSTANT_TEXT_MESSAGE_FEE'),
        'qtd_voz', count(*) filter (where raw->>'type' = 'PHONE_CALL_NOTIFICATION_FEE'),
        'total_cents', sum(valor_cents - conciliado_cents),
        'de', min(data), 'ate', max(data)) m
      from financial_statement_lines
      where financial_account_id = _conta and kind = 'saida'
        and raw->>'type' = any(fin_microtarifas_tipos())
        and status in ('pendente','parcial','divergente') and data <= v_ate
        and valor_cents - conciliado_cents > 0
      group by date_trunc('month', data)) s), '[]'::jsonb);
end $$;

create or replace function public.fin_microtarifas_conciliar(_conta uuid, _ate date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_ate date;
  v_party uuid; v_plano uuid; v_centro uuid; v_regra jsonb; m record;
  v_ids uuid[]; v_total bigint; v_hash text; v_ext text; v_title uuid; v_inst uuid; v_rec jsonb;
  v_res jsonb := '[]'::jsonb; v_mes_txt text;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  v_ate := least(coalesce(_ate, v_hoje), v_hoje);
  perform pg_advisory_xact_lock(hashtext('fin_microtarifas:' || _conta));

  select id into v_party from parties where upper(display_name) like 'ASAAS%' order by created_at limit 1;
  if v_party is null then raise exception 'Cadastro do favorecido ASAAS não encontrado'; end if;
  select id into v_plano from chart_of_accounts where codigo = '5.1.1' and is_active limit 1;
  select id into v_centro from cost_centers where codigo = 'administrativo' and is_active limit 1;
  v_regra := fin_approval_rule();

  for m in
    select date_trunc('month', data)::date mes
      from financial_statement_lines
     where financial_account_id = _conta and kind = 'saida'
       and raw->>'type' = any(fin_microtarifas_tipos())
       and status in ('pendente','parcial','divergente') and data <= v_ate
       and valor_cents - conciliado_cents > 0
     group by 1 order by 1
  loop
    select array_agg(id order by id), sum(valor_cents - conciliado_cents)
      into v_ids, v_total
      from financial_statement_lines
     where financial_account_id = _conta and kind = 'saida'
       and raw->>'type' = any(fin_microtarifas_tipos())
       and status in ('pendente','parcial','divergente') and data <= v_ate
       and valor_cents - conciliado_cents > 0
       and date_trunc('month', data)::date = m.mes;

    if coalesce((v_regra->>'exigir')::boolean,false) and v_total >= coalesce((v_regra->>'valor_minimo_cents')::bigint,0) then
      raise exception 'A regra de aprovação exige rascunho para R$ % — ajuste a regra ou concilie manualmente.', round(v_total/100.0,2);
    end if;

    v_hash := md5(array_to_string(v_ids, ','));
    v_ext := 'microtarifas:' || _conta || ':' || to_char(m.mes,'YYYY-MM') || ':' || v_hash;
    v_mes_txt := to_char(m.mes,'MM/YYYY');

    v_title := fin_title_create(jsonb_build_object(
      'direction','payable','party_id', v_party,
      'descricao', 'Tarifas de notificação Asaas (WhatsApp e robô de voz) - ' || v_mes_txt,
      'documento', array_length(v_ids,1) || ' disparos',
      'emissao', m.mes::text, 'competencia', m.mes::text,
      'observacao', 'Conciliação em lote de ' || array_length(v_ids,1) || ' linhas do extrato Asaas.',
      'cost_center_id', v_centro, 'chart_account_id', v_plano,
      'financial_account_id', _conta, 'valor_cents', v_total, 'status','ativo',
      'origem','conciliacao','sistema_origem','extrato','id_externo', v_ext,
      'parcelas', jsonb_build_array(jsonb_build_object(
        'vencimento', least((m.mes + interval '1 month - 1 day')::date, v_ate)::text, 'valor_cents', v_total))));
    select id into v_inst from financial_installments where title_id = v_title order by numero limit 1;

    v_rec := fin_reconcile(jsonb_build_object('line_ids', to_jsonb(v_ids),
      'alocacoes', jsonb_build_array(jsonb_build_object('installment_id', v_inst, 'valor_cents', v_total)),
      'observacao','Microtarifas Asaas ' || v_mes_txt, 'idempotency_key', v_ext));

    insert into audit_logs(actor_id, action, entity, payload)
    values (auth.uid(), 'fin.microtarifas.conciliar', 'financial_titles',
      jsonb_build_object('title_id', v_title, 'conta', _conta, 'mes', to_char(m.mes,'YYYY-MM'),
                         'linhas', array_length(v_ids,1), 'total_cents', v_total));

    v_res := v_res || jsonb_build_object('mes', to_char(m.mes,'YYYY-MM'), 'title_id', v_title,
      'linhas', array_length(v_ids,1), 'total_cents', v_total, 'reconciliation_id', v_rec->>'id');
  end loop;
  return jsonb_build_object('meses', v_res);
end $$;

revoke all on function public.fin_microtarifas_previa(uuid, date) from public, anon;
revoke all on function public.fin_microtarifas_conciliar(uuid, date) from public, anon;
grant execute on function public.fin_microtarifas_previa(uuid, date) to authenticated;
grant execute on function public.fin_microtarifas_conciliar(uuid, date) to authenticated;
