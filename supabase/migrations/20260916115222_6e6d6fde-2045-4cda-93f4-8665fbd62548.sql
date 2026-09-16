
-- 1. Ficha da conta: extratos importados usam as colunas reais da tabela
CREATE OR REPLACE FUNCTION public.fin_account_detail(_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'conta', jsonb_build_object('id', a.id, 'nome', a.nome, 'apelido', a.apelido, 'kind', a.kind,
      'banco', a.banco, 'agencia_masked', a.agencia_masked, 'conta_masked', a.conta_masked,
      'is_active', a.is_active, 'moeda', a.moeda, 'data_corte', a.data_corte,
      'entidade', (select coalesce(b.trade_name, b.legal_name) from business_entities b where b.id = a.business_entity_id),
      'saldo_inicial_cents', a.saldo_inicial_cents,
      'saldo_cents', coalesce((select sum(m.valor_cents) from financial_account_movements m where m.financial_account_id=a.id),0)),
    'movimentos', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'data',m.data,'kind',m.kind,
        'valor_cents',m.valor_cents,'descricao',m.descricao,'created_at',m.created_at) order by m.data desc, m.created_at desc)
      from (select * from financial_account_movements where financial_account_id=a.id order by data desc, created_at desc limit 200) m),'[]'::jsonb),
    'extratos', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,
        'total_linhas',i.total_linhas,'validas',i.validas,'invalidas',i.invalidas,'repetidas',i.repetidas,
        'pendentes',i.pendentes,'created_at',i.created_at) order by i.created_at desc)
      from financial_statement_imports i where i.financial_account_id=a.id),'[]'::jsonb)
  ) into r from financial_accounts a where a.id = _account;
  if r is null then raise exception 'Conta não encontrada'; end if;
  return r;
end $function$;

-- 2. Parâmetro de aprovação (desligado por padrão, não muda o comportamento atual)
CREATE OR REPLACE FUNCTION public.fin_approval_rule()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select value from site_settings where key = 'financeiro.aprovacao'),
    jsonb_build_object('exigir', false, 'valor_minimo_cents', 0)
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.fin_approval_rule() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fin_approval_rule() TO authenticated;

-- 3. Criação de título respeita rascunho e a regra de aprovação
CREATE OR REPLACE FUNCTION public.fin_title_create(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

-- 4. Configurações mostram a regra real
CREATE OR REPLACE FUNCTION public.fin_settings_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb; v_regra jsonb;
begin
  if not has_capability(auth.uid(),'finance.view') then raise exception 'Sem permissão'; end if;
  v_regra := fin_approval_rule();
  select jsonb_build_object(
    'pode_gerenciar', has_capability(auth.uid(),'finance.settings.manage'),
    'formas_pagamento', coalesce((select jsonb_agg(jsonb_build_object('id',id,'codigo',codigo,'nome',nome,'is_active',is_active) order by nome)
       from payment_methods),'[]'::jsonb),
    'aprovacao', jsonb_build_object(
      'regra', case when coalesce((v_regra->>'exigir')::boolean,false)
                 then 'Títulos nascem em rascunho e dependem de aprovação'
                 else 'Aprovação sob demanda: o título pode ser enviado para aprovação quando necessário' end,
      'exigir', coalesce((v_regra->>'exigir')::boolean,false),
      'valor_minimo_cents', coalesce((v_regra->>'valor_minimo_cents')::bigint,0),
      'parametrizacao_por_valor', true),
    'integracoes', jsonb_build_array(
      jsonb_build_object('nome','Asaas','status','nao_configurado','observacao','Sem credencial, sem chamada externa, sem cobrança emitida'),
      jsonb_build_object('nome','CNAB','status','nao_configurado','observacao','Retorno bancário CNAB ainda não implementado'))
  ) into r;
  return r;
end $function$;
