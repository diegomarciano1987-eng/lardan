-- ============ Consulta de classificações ============
CREATE OR REPLACE FUNCTION public.fin_classificacoes(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_busca text := nullif(_filtros->>'busca','');
        v_ent uuid := nullif(_filtros->>'entidade_id','')::uuid;
        v_dir text := nullif(_filtros->>'direction','');
        v_lim int := least(coalesce((_filtros->>'limit')::int, 20), 50);
        v_naturezas text[];
begin
  if not has_capability(auth.uid(),'finance.view')
     and not has_capability(auth.uid(),'finance.dashboard.view') then
    raise exception 'Sem permissão';
  end if;
  v_naturezas := case v_dir
    when 'receivable' then array['receita','deducao','ativo','resultado']
    when 'payable' then array['custo','despesa','passivo','resultado']
    else array['receita','deducao','custo','despesa','ativo','passivo','resultado'] end;

  return jsonb_build_object(
    'planos', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'codigo',c.codigo,'nome',c.nome,
        'natureza',c.natureza::text,'entidade',c.business_entity_id) order by c.codigo)
      from (select * from chart_of_accounts c where c.is_active and c.aceita_lancamento
              and c.natureza::text = any(v_naturezas)
              and (c.vigencia_inicio is null or c.vigencia_inicio <= current_date)
              and (c.vigencia_fim is null or c.vigencia_fim >= current_date)
              and (v_ent is null or c.business_entity_id is null or c.business_entity_id = v_ent)
              and (v_busca is null or c.nome ilike '%'||v_busca||'%' or c.codigo ilike '%'||v_busca||'%')
            order by c.codigo limit v_lim) c), '[]'::jsonb),
    'centros', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'codigo',c.codigo,'nome',c.nome,
        'entidade',c.business_entity_id) order by c.codigo)
      from (select * from cost_centers c where c.is_active
              and (c.vigencia_inicio is null or c.vigencia_inicio <= current_date)
              and (c.vigencia_fim is null or c.vigencia_fim >= current_date)
              and (v_ent is null or c.business_entity_id is null or c.business_entity_id = v_ent)
              and (v_busca is null or c.nome ilike '%'||v_busca||'%' or c.codigo ilike '%'||v_busca||'%')
            order by c.codigo limit v_lim) c), '[]'::jsonb),
    'entidades', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,
        'nome',coalesce(e.trade_name,e.legal_name)) order by coalesce(e.trade_name,e.legal_name))
      from (select * from business_entities e where e.is_active
              and (v_busca is null or coalesce(e.trade_name,'') ilike '%'||v_busca||'%'
                   or e.legal_name ilike '%'||v_busca||'%')
            order by 1 limit v_lim) e), '[]'::jsonb),
    'formas', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'codigo',f.codigo,'nome',f.nome)
        order by f.nome)
      from (select * from payment_methods f where f.is_active
              and (v_busca is null or f.nome ilike '%'||v_busca||'%')
            order by f.nome limit v_lim) f), '[]'::jsonb),
    'contas', coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'nome',a.nome,'kind',a.kind::text)
        order by a.nome)
      from (select * from financial_accounts a where a.is_active and not a.is_homologacao
              and (v_ent is null or a.business_entity_id is null or a.business_entity_id = v_ent)
              and (v_busca is null or a.nome ilike '%'||v_busca||'%')
            order by a.nome limit v_lim) a), '[]'::jsonb)
  );
end $function$;
REVOKE EXECUTE ON FUNCTION public.fin_classificacoes(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fin_classificacoes(jsonb) TO authenticated;

-- ============ Validação de vínculos ============
CREATE OR REPLACE FUNCTION public.fin_validar_classificacao(
  _dir fin_direction, _entidade uuid, _chart uuid, _cc uuid, _pm uuid, _conta uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_nat text; v_ent uuid; v_ok boolean;
begin
  if _entidade is not null then
    select is_active into v_ok from business_entities where id = _entidade;
    if v_ok is null then raise exception 'Entidade inexistente'; end if;
    if not v_ok then raise exception 'Entidade inativa não aceita lançamento'; end if;
  end if;

  if _chart is not null then
    select natureza::text, business_entity_id into v_nat, v_ent
    from chart_of_accounts
    where id = _chart and is_active and aceita_lancamento
      and (vigencia_inicio is null or vigencia_inicio <= current_date)
      and (vigencia_fim is null or vigencia_fim >= current_date);
    if v_nat is null then
      raise exception 'Conta contábil inexistente, inativa, fora de vigência ou que não aceita lançamento';
    end if;
    if _entidade is not null and v_ent is not null and v_ent <> _entidade then
      raise exception 'Conta contábil pertence a outra entidade';
    end if;
    if _dir = 'receivable' and v_nat not in ('receita','deducao','ativo','resultado') then
      raise exception 'Natureza % não é compatível com título a receber', v_nat;
    end if;
    if _dir = 'payable' and v_nat not in ('custo','despesa','passivo','resultado') then
      raise exception 'Natureza % não é compatível com título a pagar', v_nat;
    end if;
  end if;

  if _cc is not null then
    select business_entity_id, is_active into v_ent, v_ok from cost_centers where id = _cc;
    if v_ok is null then raise exception 'Centro de custo inexistente'; end if;
    if not v_ok then raise exception 'Centro de custo inativo'; end if;
    if _entidade is not null and v_ent is not null and v_ent <> _entidade then
      raise exception 'Centro de custo pertence a outra entidade';
    end if;
  end if;

  if _pm is not null then
    select is_active into v_ok from payment_methods where id = _pm;
    if v_ok is null then raise exception 'Forma de pagamento inexistente'; end if;
    if not v_ok then raise exception 'Forma de pagamento inativa'; end if;
  end if;

  if _conta is not null then
    select is_active and not is_homologacao into v_ok from financial_accounts where id = _conta;
    if v_ok is null then raise exception 'Conta financeira inexistente'; end if;
    if not v_ok then raise exception 'Conta financeira inativa'; end if;
  end if;
end $function$;
REVOKE EXECUTE ON FUNCTION public.fin_validar_classificacao(fin_direction,uuid,uuid,uuid,uuid,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fin_validar_classificacao(fin_direction,uuid,uuid,uuid,uuid,uuid) TO authenticated;

-- ============ Criação de título com classificação conferida ============
CREATE OR REPLACE FUNCTION public.fin_title_create(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_dir fin_direction; v_id uuid; v_total bigint; v_soma bigint := 0; p jsonb; v_cap text;
        v_status fin_title_status; v_regra jsonb; v_pedido text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_dir := (_payload->>'direction')::fin_direction;
  v_cap := case when v_dir = 'payable' then 'finance.payable.manage' else 'finance.receivable.manage' end;
  if not has_capability(auth.uid(), v_cap) then raise exception 'Sem permissão para este tipo de título'; end if;
  v_total := (_payload->>'valor_cents')::bigint;
  if v_total is null or v_total <= 0 then raise exception 'Valor do título deve ser maior que zero'; end if;
  if jsonb_typeof(_payload->'parcelas') <> 'array' or jsonb_array_length(_payload->'parcelas') = 0 then
    raise exception 'Informe ao menos uma parcela';
  end if;
  for p in select * from jsonb_array_elements(_payload->'parcelas') loop
    if (p->>'valor_cents')::bigint <= 0 then raise exception 'Parcela com valor inválido'; end if;
    if (p->>'vencimento') is null then raise exception 'Parcela sem vencimento'; end if;
    v_soma := v_soma + (p->>'valor_cents')::bigint;
  end loop;
  if v_soma <> v_total then raise exception 'Soma das parcelas (%) difere do total do título (%)', v_soma, v_total; end if;

  perform fin_validar_classificacao(v_dir,
    nullif(_payload->>'business_entity_id','')::uuid,
    nullif(_payload->>'chart_account_id','')::uuid,
    nullif(_payload->>'cost_center_id','')::uuid,
    nullif(_payload->>'payment_method_id','')::uuid,
    nullif(_payload->>'financial_account_id','')::uuid);

  v_pedido := nullif(_payload->>'status','');
  if v_pedido is not null and v_pedido not in ('rascunho','ativo') then
    raise exception 'Título só pode nascer como rascunho ou ativo';
  end if;
  v_regra := fin_approval_rule();
  if coalesce((v_regra->>'exigir')::boolean, false)
     and v_total >= coalesce((v_regra->>'valor_minimo_cents')::bigint, 0) then
    v_status := 'rascunho';
  else
    v_status := coalesce(v_pedido, 'ativo')::fin_title_status;
  end if;

  insert into financial_titles (direction, business_entity_id, party_id, pagador_party_id, descricao, documento,
      emissao, competencia, valor_cents, chart_account_id, cost_center_id, payment_method_id, financial_account_id,
      origem, sistema_origem, id_externo, observacao, status, created_by)
  values (v_dir, nullif(_payload->>'business_entity_id','')::uuid, (_payload->>'party_id')::uuid,
      nullif(_payload->>'pagador_party_id','')::uuid, _payload->>'descricao', nullif(_payload->>'documento',''),
      coalesce(nullif(_payload->>'emissao','')::date, current_date), nullif(_payload->>'competencia','')::date,
      v_total, nullif(_payload->>'chart_account_id','')::uuid, nullif(_payload->>'cost_center_id','')::uuid,
      nullif(_payload->>'payment_method_id','')::uuid, nullif(_payload->>'financial_account_id','')::uuid,
      coalesce(nullif(_payload->>'origem',''),'manual'), nullif(_payload->>'sistema_origem',''),
      nullif(_payload->>'id_externo',''), nullif(_payload->>'observacao',''),
      v_status, auth.uid())
  returning id into v_id;

  insert into financial_installments (title_id, numero, total_parcelas, vencimento, valor_cents)
  select v_id, (row_number() over ())::int, jsonb_array_length(_payload->'parcelas'),
         (e->>'vencimento')::date, (e->>'valor_cents')::bigint
  from jsonb_array_elements(_payload->'parcelas') e;

  insert into financial_title_events (title_id, evento, payload, actor_id)
  values (v_id, 'criado', jsonb_build_object('valor_cents', v_total, 'status', v_status), auth.uid());
  return v_id;
end $function$;

-- ============ Classificar título existente ============
CREATE OR REPLACE FUNCTION public.fin_title_classify(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_id uuid := (_payload->>'title_id')::uuid;
        t financial_titles%rowtype; v_cap text; v_baixas int; v_motivo text := nullif(_payload->>'motivo','');
        v_esperado timestamptz := nullif(_payload->>'esperado_updated_at','')::timestamptz;
        v_chart uuid; v_cc uuid; v_pm uuid; v_ent uuid; v_conta uuid; v_antes jsonb;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into t from financial_titles where id = v_id for update;
  if t.id is null then raise exception 'Título não encontrado'; end if;
  v_cap := case when t.direction='payable' then 'finance.payable.manage' else 'finance.receivable.manage' end;
  if not has_capability(auth.uid(), v_cap) then raise exception 'Sem permissão para classificar este título'; end if;
  if t.status = 'cancelado' then raise exception 'Título cancelado não pode ser reclassificado'; end if;
  if v_esperado is not null and date_trunc('milliseconds', v_esperado) <> date_trunc('milliseconds', t.updated_at) then
    raise exception 'O título foi alterado por outra pessoa. Recarregue antes de classificar.';
  end if;

  select count(*) into v_baixas
  from financial_allocations a join financial_installments i on i.id = a.installment_id
  where i.title_id = v_id;
  if v_baixas > 0 and v_motivo is null then
    raise exception 'Título já tem baixa: informe o motivo da reclassificação';
  end if;

  v_ent   := case when _payload ? 'business_entity_id' then nullif(_payload->>'business_entity_id','')::uuid else t.business_entity_id end;
  v_chart := case when _payload ? 'chart_account_id'   then nullif(_payload->>'chart_account_id','')::uuid   else t.chart_account_id end;
  v_cc    := case when _payload ? 'cost_center_id'     then nullif(_payload->>'cost_center_id','')::uuid     else t.cost_center_id end;
  v_pm    := case when _payload ? 'payment_method_id'  then nullif(_payload->>'payment_method_id','')::uuid  else t.payment_method_id end;
  v_conta := case when _payload ? 'financial_account_id' then nullif(_payload->>'financial_account_id','')::uuid else t.financial_account_id end;

  perform fin_validar_classificacao(t.direction, v_ent, v_chart, v_cc, v_pm, v_conta);

  v_antes := jsonb_build_object('business_entity_id', t.business_entity_id, 'chart_account_id', t.chart_account_id,
      'cost_center_id', t.cost_center_id, 'payment_method_id', t.payment_method_id,
      'financial_account_id', t.financial_account_id);

  update financial_titles
     set business_entity_id = v_ent, chart_account_id = v_chart, cost_center_id = v_cc,
         payment_method_id = v_pm, financial_account_id = v_conta, updated_at = now()
   where id = v_id;

  insert into financial_title_events (title_id, evento, payload, actor_id)
  values (v_id, 'classificado', jsonb_build_object('antes', v_antes,
      'depois', jsonb_build_object('business_entity_id', v_ent, 'chart_account_id', v_chart,
        'cost_center_id', v_cc, 'payment_method_id', v_pm, 'financial_account_id', v_conta),
      'motivo', v_motivo, 'tinha_baixa', v_baixas > 0), auth.uid());

  insert into audit_logs (entity, entity_id, action, actor_id, payload)
  values ('financial_titles', v_id, 'fin.titulo.classificar', auth.uid(),
          jsonb_build_object('antes', v_antes, 'motivo', v_motivo));

  return (select jsonb_build_object('id', v_id, 'updated_at', updated_at) from financial_titles where id = v_id);
end $function$;
REVOKE EXECUTE ON FUNCTION public.fin_title_classify(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fin_title_classify(jsonb) TO authenticated;

-- ============ Listagem com classificação ============
CREATE OR REPLACE FUNCTION public.fin_titles_list(_direction text, _search text DEFAULT NULL::text,
  _status text DEFAULT NULL::text, _situacao text DEFAULT NULL::text,
  _limit integer DEFAULT 50, _offset integer DEFAULT 0,
  _chart uuid DEFAULT NULL, _cc uuid DEFAULT NULL, _entidade uuid DEFAULT NULL,
  _sem_classificacao boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_dir fin_direction := _direction::fin_direction; v_cap text; v_rows jsonb; v_total bigint; v_soma bigint;
begin
  v_cap := case when v_dir='payable' then 'finance.payable.view' else 'finance.receivable.view' end;
  if not has_capability(auth.uid(), v_cap) then raise exception 'Sem permissão'; end if;

  with base as (
    select t.id, t.descricao, t.documento, t.status, t.emissao, t.competencia, t.valor_cents,
           coalesce(p.display_name, p.legal_name, p.code) as contraparte,
           t.chart_account_id, t.cost_center_id, t.business_entity_id,
           case when ca.id is null then null else ca.codigo||' · '||ca.nome end as plano_label,
           case when cc.id is null then null else cc.codigo||' · '||cc.nome end as centro_label,
           coalesce(be.trade_name, be.legal_name) as entidade_label,
           (t.chart_account_id is null or t.cost_center_id is null) as pendente_classificacao,
           (select min(i.vencimento) from financial_installments i where i.title_id = t.id
              and i.settlement_status in ('nao_liquidado','parcial')) as proximo_vencimento,
           coalesce((select sum(a.valor_cents) from financial_allocations a
                     join financial_installments i on i.id = a.installment_id where i.title_id = t.id),0) as pago_cents,
           (select count(*) from financial_installments i where i.title_id = t.id) as parcelas
    from financial_titles t
    join parties p on p.id = t.party_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    left join cost_centers cc on cc.id = t.cost_center_id
    left join business_entities be on be.id = t.business_entity_id
    where t.direction = v_dir
      and (_status is null or t.status::text = _status)
      and (_chart is null or t.chart_account_id = _chart)
      and (_cc is null or t.cost_center_id = _cc)
      and (_entidade is null or t.business_entity_id = _entidade)
      and (not coalesce(_sem_classificacao,false)
           or t.chart_account_id is null or t.cost_center_id is null)
      and (_search is null or _search = '' or
           t.descricao ilike '%'||_search||'%' or coalesce(t.documento,'') ilike '%'||_search||'%'
           or coalesce(p.display_name,'') ilike '%'||_search||'%' or coalesce(p.legal_name,'') ilike '%'||_search||'%')
  ), filtrado as (
    select * from base
    where _situacao is null or _situacao = ''
       or (_situacao = 'aberto' and pago_cents < valor_cents and status <> 'cancelado')
       or (_situacao = 'vencido' and proximo_vencimento < current_date and status <> 'cancelado')
       or (_situacao = 'liquidado' and pago_cents >= valor_cents)
  )
  select coalesce(jsonb_agg(to_jsonb(f) order by f.proximo_vencimento nulls last, f.emissao desc), '[]'::jsonb),
         (select count(*) from filtrado), (select coalesce(sum(valor_cents),0) from filtrado)
    into v_rows, v_total, v_soma
  from (select * from filtrado order by proximo_vencimento nulls last, emissao desc
        limit greatest(_limit,1) offset greatest(_offset,0)) f;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'soma_cents', v_soma);
end $function$;
REVOKE EXECUTE ON FUNCTION public.fin_titles_list(text,text,text,text,integer,integer,uuid,uuid,uuid,boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fin_titles_list(text,text,text,text,integer,integer,uuid,uuid,uuid,boolean) TO authenticated;

-- ============ Ficha com classificação ============
CREATE OR REPLACE FUNCTION public.fin_title_detail(_title uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_dir fin_direction; r jsonb;
begin
  select direction into v_dir from financial_titles where id = _title;
  if v_dir is null then raise exception 'Título não encontrado'; end if;
  if not has_capability(auth.uid(), case when v_dir='payable' then 'finance.payable.view' else 'finance.receivable.view' end)
    then raise exception 'Sem permissão'; end if;

  select jsonb_build_object(
    'titulo', to_jsonb(t) || jsonb_build_object(
        'contraparte', coalesce(p.display_name,p.legal_name,p.code),
        'plano_label', case when ca.id is null then null else ca.codigo||' · '||ca.nome end,
        'centro_label', case when cc.id is null then null else cc.codigo||' · '||cc.nome end,
        'entidade_label', coalesce(be.trade_name, be.legal_name),
        'forma_label', pm.nome,
        'conta_label', fa.nome,
        'pendente_classificacao', (t.chart_account_id is null or t.cost_center_id is null)),
    'pode_classificar', has_capability(auth.uid(),
        case when v_dir='payable' then 'finance.payable.manage' else 'finance.receivable.manage' end),
    'parcelas', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object(
        'pago_cents', coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id=i.id),0),
        'ajustes_cents', coalesce((select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                                                   when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end)
                                   from financial_adjustments j where j.installment_id=i.id),0))
        order by i.numero) from financial_installments i where i.title_id = t.id), '[]'::jsonb),
    'baixas', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'data', s.data, 'valor_cents', a.valor_cents,
        'conta', ac.nome, 'estorno', s.is_reversal, 'parcela', i.numero, 'settlement_id', s.id) order by s.created_at)
        from financial_allocations a join financial_settlements s on s.id = a.settlement_id
        join financial_installments i on i.id = a.installment_id
        left join financial_accounts ac on ac.id = s.financial_account_id
        where i.title_id = t.id), '[]'::jsonb),
    'reconhecimentos', coalesce((select jsonb_agg(to_jsonb(k) order by k.created_at)
        from financial_acknowledgements k where k.title_id = t.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(to_jsonb(ev) order by ev.created_at desc)
        from financial_title_events ev where ev.title_id = t.id), '[]'::jsonb)
  ) into r
  from financial_titles t
  join parties p on p.id = t.party_id
  left join chart_of_accounts ca on ca.id = t.chart_account_id
  left join cost_centers cc on cc.id = t.cost_center_id
  left join business_entities be on be.id = t.business_entity_id
  left join payment_methods pm on pm.id = t.payment_method_id
  left join financial_accounts fa on fa.id = t.financial_account_id
  where t.id = _title;
  return r;
end $function$;

-- ============ Fluxo de caixa correto ============
CREATE OR REPLACE FUNCTION public.fin_cashflow(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_de date := coalesce(nullif(_filtros->>'de','')::date, current_date);
        v_ate date := coalesce(nullif(_filtros->>'ate','')::date, current_date + 30);
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

  -- Abertura: tudo antes do período + marcos de saldo inicial dentro do período.
  select coalesce(sum(m.valor_cents),0) into v_abertura
  from financial_account_movements m
  join financial_accounts a on a.id = m.financial_account_id
  where not a.is_homologacao
    and (v_conta is null or m.financial_account_id = v_conta)
    and (m.data < v_de or (m.data <= v_ate and m.kind = 'saldo_inicial'));

  with mov as (
    select m.id, m.data, m.valor_cents, m.kind,
           (m.kind in ('transferencia_entrada','transferencia_saida') or m.transfer_id is not null) as e_transferencia,
           exists (
             select 1 from financial_allocations al
             join financial_installments i on i.id = al.installment_id
             join financial_titles t on t.id = i.title_id
             where al.settlement_id = m.settlement_id
               and (v_cc is null or t.cost_center_id = v_cc)
               and (v_ent is null or t.business_entity_id = v_ent)
           ) as bate_filtro
    from financial_account_movements m
    join financial_accounts a on a.id = m.financial_account_id
    where not a.is_homologacao
      and m.data between v_de and v_ate
      and m.kind <> 'saldo_inicial'
      and (v_conta is null or m.financial_account_id = v_conta)
  ), classificado as (
    select *,
      case
        when e_transferencia and v_conta is null then 'transferencia'
        when v_class and not bate_filtro then 'nao_classificado'
        else 'operacional' end as faixa
    from mov
  ), realizado as (
    select case v_grupo when 'mes' then date_trunc('month', data)::date
                        when 'semana' then date_trunc('week', data)::date
                        else data end as bucket,
           sum(case when faixa='operacional' and valor_cents > 0 then valor_cents else 0 end) as entradas,
           sum(case when faixa='operacional' and valor_cents < 0 then -valor_cents else 0 end) as saidas,
           sum(case when faixa='transferencia' then abs(valor_cents) else 0 end) as transferencias,
           sum(case when faixa='nao_classificado' and valor_cents > 0 then valor_cents else 0 end) as nc_entradas,
           sum(case when faixa='nao_classificado' and valor_cents < 0 then -valor_cents else 0 end) as nc_saidas
    from classificado group by 1
  ), previsto as (
    select case v_grupo when 'mes' then date_trunc('month', i.vencimento)::date
                        when 'semana' then date_trunc('week', i.vencimento)::date
                        else i.vencimento end as bucket,
           sum(case when t.direction='receivable' then s.saldo else 0 end) as entradas,
           sum(case when t.direction='payable' then s.saldo else 0 end) as saidas
    from financial_installments i
    join financial_titles t on t.id = i.title_id
    cross join lateral (select greatest(i.valor_cents
           + coalesce((select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                                       when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end)
                       from financial_adjustments j where j.installment_id = i.id),0)
           - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0), 0) as saldo) s
    where i.vencimento between v_de and v_ate
      and t.status in ('ativo','aprovado')
      and s.saldo > 0
      and (v_cc is null or t.cost_center_id = v_cc)
      and (v_ent is null or t.business_entity_id = v_ent)
      and (v_conta is null or t.financial_account_id = v_conta)
    group by 1
  ), buckets as (
    select bucket from realizado union select bucket from previsto
  ), joined as (
    select b.bucket,
           coalesce(r.entradas,0) as entradas_realizadas, coalesce(r.saidas,0) as saidas_realizadas,
           coalesce(r.transferencias,0) as transferencias_cents,
           coalesce(r.nc_entradas,0) as nao_classificado_entradas_cents,
           coalesce(r.nc_saidas,0) as nao_classificado_saidas_cents,
           coalesce(p.entradas,0) as entradas_previstas, coalesce(p.saidas,0) as saidas_previstas
    from buckets b
    left join realizado r on r.bucket = b.bucket
    left join previsto p on p.bucket = b.bucket
  ), acumulado as (
    select j.*,
      v_abertura + sum(j.entradas_realizadas - j.saidas_realizadas
                       + j.nao_classificado_entradas_cents - j.nao_classificado_saidas_cents)
        over (order by j.bucket) as saldo_realizado,
      v_abertura + sum((j.entradas_realizadas + j.nao_classificado_entradas_cents + j.entradas_previstas)
                     - (j.saidas_realizadas + j.nao_classificado_saidas_cents + j.saidas_previstas))
        over (order by j.bucket) as saldo_projetado
    from joined j
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate, 'agrupamento', v_grupo),
    'saldo_abertura_cents', v_abertura,
    'saldo_inicial_cents', v_abertura,
    'filtros', jsonb_build_object('conta_id', v_conta, 'centro_custo_id', v_cc, 'entidade_id', v_ent,
        'classificacao_aplicada', v_class),
    'totais', jsonb_build_object(
      'entradas_realizadas_cents', coalesce((select sum(entradas_realizadas) from acumulado),0),
      'saidas_realizadas_cents', coalesce((select sum(saidas_realizadas) from acumulado),0),
      'transferencias_cents', coalesce((select sum(transferencias_cents) from acumulado),0),
      'nao_classificado_entradas_cents', coalesce((select sum(nao_classificado_entradas_cents) from acumulado),0),
      'nao_classificado_saidas_cents', coalesce((select sum(nao_classificado_saidas_cents) from acumulado),0),
      'entradas_previstas_cents', coalesce((select sum(entradas_previstas) from acumulado),0),
      'saidas_previstas_cents', coalesce((select sum(saidas_previstas) from acumulado),0),
      'saldo_final_realizado_cents', coalesce((select saldo_realizado from acumulado order by bucket desc limit 1), v_abertura),
      'saldo_final_projetado_cents', coalesce((select saldo_projetado from acumulado order by bucket desc limit 1), v_abertura)
    ),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object(
        'bucket', bucket, 'entradas_realizadas_cents', entradas_realizadas,
        'saidas_realizadas_cents', saidas_realizadas, 'transferencias_cents', transferencias_cents,
        'nao_classificado_entradas_cents', nao_classificado_entradas_cents,
        'nao_classificado_saidas_cents', nao_classificado_saidas_cents,
        'entradas_previstas_cents', entradas_previstas, 'saidas_previstas_cents', saidas_previstas,
        'saldo_realizado_cents', saldo_realizado, 'saldo_projetado_cents', saldo_projetado)
        order by bucket) from acumulado),'[]'::jsonb)
  ) into r;
  return r;
end $function$;

-- ============ Detalhamento de um valor do fluxo ============
CREATE OR REPLACE FUNCTION public.fin_cashflow_detail(_filtros jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_de date := coalesce(nullif(_filtros->>'de','')::date, current_date);
        v_ate date := coalesce(nullif(_filtros->>'ate','')::date, current_date);
        v_conta uuid := nullif(_filtros->>'conta_id','')::uuid;
        v_cc uuid := nullif(_filtros->>'centro_custo_id','')::uuid;
        v_ent uuid := nullif(_filtros->>'entidade_id','')::uuid;
        v_tipo text := coalesce(_filtros->>'tipo','realizado');
        v_lim int := least(coalesce((_filtros->>'limit')::int, 200), 500);
        v_class boolean; v_rows jsonb; v_soma bigint;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  v_class := (v_cc is not null or v_ent is not null);

  if v_tipo in ('realizado','transferencia','nao_classificado') then
    with mov as (
      select m.id, m.data, m.valor_cents, m.kind::text as kind, m.descricao,
             a.nome as conta,
             (m.kind in ('transferencia_entrada','transferencia_saida') or m.transfer_id is not null) as e_transferencia,
             exists (
               select 1 from financial_allocations al
               join financial_installments i on i.id = al.installment_id
               join financial_titles t on t.id = i.title_id
               where al.settlement_id = m.settlement_id
                 and (v_cc is null or t.cost_center_id = v_cc)
                 and (v_ent is null or t.business_entity_id = v_ent)) as bate_filtro
      from financial_account_movements m
      join financial_accounts a on a.id = m.financial_account_id
      where not a.is_homologacao and m.data between v_de and v_ate and m.kind <> 'saldo_inicial'
        and (v_conta is null or m.financial_account_id = v_conta)
    ), faixa as (
      select *, case when e_transferencia and v_conta is null then 'transferencia'
                     when v_class and not bate_filtro then 'nao_classificado'
                     else 'realizado' end as f
      from mov
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'data', data, 'valor_cents', valor_cents,
             'kind', kind, 'descricao', descricao, 'conta', conta) order by data, id), '[]'::jsonb),
           coalesce(sum(valor_cents),0)
      into v_rows, v_soma
    from (select * from faixa where f = v_tipo order by data limit v_lim) x;
  else
    with parc as (
      select i.id, i.vencimento as data, t.direction::text as direction, t.descricao,
             coalesce(p.display_name,p.legal_name,p.code) as contraparte,
             greatest(i.valor_cents
               + coalesce((select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                                           when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end)
                           from financial_adjustments j where j.installment_id = i.id),0)
               - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0),0) as saldo
      from financial_installments i
      join financial_titles t on t.id = i.title_id
      join parties p on p.id = t.party_id
      where i.vencimento between v_de and v_ate and t.status in ('ativo','aprovado')
        and (v_cc is null or t.cost_center_id = v_cc)
        and (v_ent is null or t.business_entity_id = v_ent)
        and (v_conta is null or t.financial_account_id = v_conta)
        and (v_tipo <> 'previsto_entrada' or t.direction = 'receivable')
        and (v_tipo <> 'previsto_saida' or t.direction = 'payable')
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'data', data, 'valor_cents', saldo,
             'direction', direction, 'descricao', descricao, 'contraparte', contraparte) order by data, id), '[]'::jsonb),
           coalesce(sum(saldo),0)
      into v_rows, v_soma
    from (select * from parc where saldo > 0 order by data limit v_lim) y;
  end if;

  return jsonb_build_object('tipo', v_tipo, 'rows', v_rows, 'soma_cents', v_soma);
end $function$;
REVOKE EXECUTE ON FUNCTION public.fin_cashflow_detail(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fin_cashflow_detail(jsonb) TO authenticated;