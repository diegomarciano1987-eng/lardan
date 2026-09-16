-- 1) SALDO INICIAL COMO MOVIMENTO REAL --------------------------------------
create or replace function public.fin_account_create(_payload jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; v_saldo bigint;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para cadastrar contas'; end if;
  if coalesce(nullif(_payload->>'nome',''),'') = '' then raise exception 'Informe o nome da conta'; end if;
  v_saldo := coalesce((_payload->>'saldo_inicial_cents')::bigint, 0);
  insert into financial_accounts (nome, apelido, kind, banco, agencia_masked, conta_masked,
      business_entity_id, saldo_inicial_cents, data_corte, notes, created_by)
  values (_payload->>'nome', nullif(_payload->>'apelido',''),
          coalesce(nullif(_payload->>'kind','')::fin_account_kind,'conta_corrente'),
          nullif(_payload->>'banco',''), nullif(_payload->>'agencia_masked',''), nullif(_payload->>'conta_masked',''),
          nullif(_payload->>'business_entity_id','')::uuid,
          v_saldo, coalesce(nullif(_payload->>'data_corte','')::date, current_date),
          nullif(_payload->>'notes',''), auth.uid())
  returning id into v_id;
  if v_saldo <> 0 then
    insert into financial_account_movements (financial_account_id, kind, data, valor_cents, descricao, created_by)
    values (v_id, 'saldo_inicial', coalesce(nullif(_payload->>'data_corte','')::date, current_date), v_saldo,
            'Saldo inicial registrado na criação da conta', auth.uid());
  end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.conta.criar','financial_accounts',v_id,
          jsonb_build_object('saldo_inicial_cents', v_saldo));
  return v_id;
end $function$;

-- contas já existentes sem o marco no razão (idempotente)
insert into financial_account_movements (financial_account_id, kind, data, valor_cents, descricao)
select a.id, 'saldo_inicial', coalesce(a.data_corte, a.created_at::date), a.saldo_inicial_cents,
       'Saldo inicial regularizado'
from financial_accounts a
where a.saldo_inicial_cents <> 0
  and not exists (select 1 from financial_account_movements m
                  where m.financial_account_id = a.id and m.kind = 'saldo_inicial');

-- saldo calculado exclusivamente pelo razão
create or replace function public.fin_accounts_overview()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', a.id, 'nome', a.nome, 'apelido', a.apelido, 'kind', a.kind, 'banco', a.banco,
      'agencia_masked', a.agencia_masked, 'conta_masked', a.conta_masked,
      'entidade', (select coalesce(b.trade_name, b.legal_name) from business_entities b where b.id = a.business_entity_id),
      'is_active', a.is_active,
      'saldo_cents', coalesce((select sum(m.valor_cents) from financial_account_movements m where m.financial_account_id = a.id),0),
      'saldo_inicial_cents', a.saldo_inicial_cents,
      'ultimo_movimento', (select max(m.data) from financial_account_movements m where m.financial_account_id = a.id),
      'extratos', (select count(*) from financial_statement_imports i where i.financial_account_id = a.id),
      'divergencias', (select count(*) from financial_statement_lines l
                       join financial_statement_imports i on i.id = l.import_id
                       where i.financial_account_id = a.id and l.status = 'divergente')
    ) as x
    from financial_accounts a
    where has_capability(auth.uid(),'finance.bank.view')
  ) s;
$function$;

create or replace function public.fin_account_detail(_account uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
    'extratos', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'competencia_inicio',i.competencia_inicio,
        'competencia_fim',i.competencia_fim,'status',i.status,'created_at',i.created_at) order by i.created_at desc)
      from financial_statement_imports i where i.financial_account_id=a.id),'[]'::jsonb)
  ) into r from financial_accounts a where a.id = _account;
  if r is null then raise exception 'Conta não encontrada'; end if;
  return r;
end $function$;

-- 2) MÁQUINA DE ESTADOS DOS TÍTULOS ------------------------------------------
create or replace function public.fin_title_submit(_title uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare t financial_titles%rowtype; v_cap text;
begin
  select * into t from financial_titles where id = _title for update;
  if not found then raise exception 'Título não encontrado'; end if;
  v_cap := case when t.direction='payable' then 'finance.payable.manage' else 'finance.receivable.manage' end;
  if not has_capability(auth.uid(), v_cap) then raise exception 'Sem permissão para submeter este título'; end if;
  if t.status = 'cancelado' then raise exception 'Título cancelado não pode ser submetido'; end if;
  if t.status = 'ativo' then raise exception 'Título já ativo não volta para submetido'; end if;
  if t.status = 'aprovado' then raise exception 'Título já aprovado não volta para submetido'; end if;
  if t.status = 'submetido' then return; end if;
  update financial_titles set status='submetido', approval_status='pendente', updated_at=now() where id=_title;
  insert into financial_title_events (title_id, evento, actor_id) values (_title,'submetido',auth.uid());
end $function$;

create or replace function public.fin_title_approve(_title uuid, _motivo text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare t financial_titles%rowtype;
begin
  if not has_capability(auth.uid(),'finance.title.approve') then raise exception 'Sem permissão para aprovar'; end if;
  select * into t from financial_titles where id = _title for update;
  if not found then raise exception 'Título não encontrado'; end if;
  if t.status = 'cancelado' then raise exception 'Título cancelado não pode ser aprovado'; end if;
  if t.status in ('ativo','aprovado') and t.approval_status = 'aprovada' then return; end if;
  if t.status <> 'submetido' then raise exception 'Somente título submetido pode ser aprovado'; end if;
  update financial_titles set status='ativo', approval_status='aprovada', updated_at=now() where id=_title;
  insert into financial_title_events (title_id, evento, motivo, actor_id) values (_title,'aprovado',_motivo,auth.uid());
end $function$;

create or replace function public.fin_title_reject(_title uuid, _motivo text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare t financial_titles%rowtype;
begin
  if not has_capability(auth.uid(),'finance.title.approve') then raise exception 'Sem permissão para recusar'; end if;
  if coalesce(trim(_motivo),'') = '' then raise exception 'Recusa exige motivo'; end if;
  select * into t from financial_titles where id = _title for update;
  if not found then raise exception 'Título não encontrado'; end if;
  if t.status = 'cancelado' then raise exception 'Título cancelado não pode ser recusado'; end if;
  if t.status <> 'submetido' then raise exception 'Somente título submetido pode ser recusado'; end if;
  update financial_titles set approval_status='recusada', status='rascunho', updated_at=now() where id=_title;
  insert into financial_title_events (title_id, evento, motivo, actor_id) values (_title,'recusado',_motivo,auth.uid());
end $function$;

create or replace function public.fin_titles_pending(_limit integer default 50, _offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare r jsonb;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'total', (select count(*) from financial_titles where status='submetido'),
    'pode_decidir', has_capability(auth.uid(),'finance.title.approve'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'descricao', t.descricao, 'direction', t.direction, 'documento', t.documento,
        'valor_cents', t.valor_cents, 'emissao', t.emissao, 'status', t.status,
        'contraparte', coalesce((select coalesce(p.display_name,p.legal_name,p.code) from parties p where p.id=t.party_id),'—'),
        'submetido_em', (select max(e.created_at) from financial_title_events e where e.title_id=t.id and e.evento='submetido')
      ) order by t.created_at)
      from (select * from financial_titles where status='submetido' order by created_at limit coalesce(_limit,50) offset coalesce(_offset,0)) t),'[]'::jsonb)
  ) into r;
  return r;
end $function$;

-- 3) PLANO DE CONTAS ----------------------------------------------------------
create or replace function public.fin_chart_list(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_busca text := fin_unaccent_lower(nullif(_filtros->>'busca',''));
        v_limit int := least(coalesce((_filtros->>'limit')::int, 50), 200);
        v_offset int := coalesce((_filtros->>'offset')::int, 0);
        v_ativo text := coalesce(_filtros->>'situacao','todos');
        r jsonb;
begin
  if not has_capability(auth.uid(),'finance.view') then raise exception 'Sem permissão'; end if;
  with base as (
    select c.* from chart_of_accounts c
    where (v_busca is null or fin_unaccent_lower(c.nome || ' ' || c.codigo) like '%'||v_busca||'%')
      and (v_ativo = 'todos' or (v_ativo='ativos') = c.is_active)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'pode_gerenciar', has_capability(auth.uid(),'finance.settings.manage'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'codigo', b.codigo, 'nome', b.nome, 'natureza', b.natureza,
        'parent_id', b.parent_id,
        'parent_label', (select p.codigo||' · '||p.nome from chart_of_accounts p where p.id=b.parent_id),
        'aceita_lancamento', b.aceita_lancamento, 'is_active', b.is_active,
        'vigencia_inicio', b.vigencia_inicio, 'vigencia_fim', b.vigencia_fim,
        'em_uso', exists (select 1 from financial_titles t where t.chart_account_id = b.id)
      ) order by b.codigo)
      from (select * from base order by codigo limit v_limit offset v_offset) b),'[]'::jsonb)
  ) into r;
  return r;
end $function$;

create or replace function public.fin_chart_save(_payload jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid := nullif(_payload->>'id','')::uuid;
        v_parent uuid := nullif(_payload->>'parent_id','')::uuid;
        v_codigo text := trim(coalesce(_payload->>'codigo',''));
        v_nome text := trim(coalesce(_payload->>'nome',''));
        v_cursor uuid; v_guard int := 0;
begin
  if not has_capability(auth.uid(),'finance.settings.manage') then raise exception 'Sem permissão para manter o plano de contas'; end if;
  if v_codigo = '' then raise exception 'Informe o código da conta contábil'; end if;
  if v_nome = '' then raise exception 'Informe o nome da conta contábil'; end if;
  if exists (select 1 from chart_of_accounts where lower(codigo)=lower(v_codigo) and (v_id is null or id <> v_id)) then
    raise exception 'Já existe uma conta contábil com o código %', v_codigo;
  end if;
  if v_parent is not null and v_parent = v_id then raise exception 'Uma conta não pode ser filha dela mesma'; end if;
  v_cursor := v_parent;
  while v_cursor is not null loop
    v_guard := v_guard + 1;
    if v_guard > 50 then raise exception 'Hierarquia inválida no plano de contas'; end if;
    if v_id is not null and v_cursor = v_id then raise exception 'Hierarquia circular no plano de contas'; end if;
    select parent_id into v_cursor from chart_of_accounts where id = v_cursor;
  end loop;

  if v_id is null then
    insert into chart_of_accounts (codigo, nome, natureza, parent_id, aceita_lancamento, business_entity_id,
        vigencia_inicio, vigencia_fim, is_active)
    values (v_codigo, v_nome, coalesce(nullif(_payload->>'natureza','')::fin_account_nature,'despesa'), v_parent,
        coalesce((_payload->>'aceita_lancamento')::boolean, true), nullif(_payload->>'business_entity_id','')::uuid,
        nullif(_payload->>'vigencia_inicio','')::date, nullif(_payload->>'vigencia_fim','')::date,
        coalesce((_payload->>'is_active')::boolean, true))
    returning id into v_id;
  else
    update chart_of_accounts set codigo=v_codigo, nome=v_nome,
      natureza=coalesce(nullif(_payload->>'natureza','')::fin_account_nature, natureza),
      parent_id=v_parent, aceita_lancamento=coalesce((_payload->>'aceita_lancamento')::boolean, aceita_lancamento),
      business_entity_id=nullif(_payload->>'business_entity_id','')::uuid,
      vigencia_inicio=nullif(_payload->>'vigencia_inicio','')::date,
      vigencia_fim=nullif(_payload->>'vigencia_fim','')::date,
      updated_at=now()
    where id=v_id;
  end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.plano_contas.salvar','chart_of_accounts',v_id,_payload);
  return v_id;
end $function$;

create or replace function public.fin_chart_toggle(_id uuid, _ativo boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not has_capability(auth.uid(),'finance.settings.manage') then raise exception 'Sem permissão'; end if;
  if _ativo is false and exists (select 1 from chart_of_accounts where parent_id = _id and is_active) then
    raise exception 'Inative primeiro as contas filhas desta conta';
  end if;
  update chart_of_accounts set is_active = _ativo, updated_at = now() where id = _id;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), case when _ativo then 'financeiro.plano_contas.ativar' else 'financeiro.plano_contas.inativar' end,
          'chart_of_accounts', _id, jsonb_build_object('is_active', _ativo));
end $function$;

-- 4) CENTROS DE CUSTO ---------------------------------------------------------
create or replace function public.fin_cost_center_list(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_busca text := fin_unaccent_lower(nullif(_filtros->>'busca',''));
        v_limit int := least(coalesce((_filtros->>'limit')::int, 50), 200);
        v_offset int := coalesce((_filtros->>'offset')::int, 0);
        v_ativo text := coalesce(_filtros->>'situacao','todos');
        r jsonb;
begin
  if not has_capability(auth.uid(),'finance.view') then raise exception 'Sem permissão'; end if;
  with base as (
    select c.* from cost_centers c
    where (v_busca is null or fin_unaccent_lower(c.nome || ' ' || c.codigo) like '%'||v_busca||'%')
      and (v_ativo = 'todos' or (v_ativo='ativos') = c.is_active)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'pode_gerenciar', has_capability(auth.uid(),'finance.settings.manage'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'codigo', b.codigo, 'nome', b.nome, 'parent_id', b.parent_id,
        'parent_label', (select p.codigo||' · '||p.nome from cost_centers p where p.id=b.parent_id),
        'entidade', (select coalesce(e.trade_name, e.legal_name) from business_entities e where e.id=b.business_entity_id),
        'responsavel', (select coalesce(p.display_name,p.legal_name,p.code) from parties p where p.id=b.responsavel_party_id),
        'is_active', b.is_active,
        'em_uso', exists (select 1 from financial_titles t where t.cost_center_id = b.id)
      ) order by b.codigo)
      from (select * from base order by codigo limit v_limit offset v_offset) b),'[]'::jsonb)
  ) into r;
  return r;
end $function$;

create or replace function public.fin_cost_center_save(_payload jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid := nullif(_payload->>'id','')::uuid;
        v_parent uuid := nullif(_payload->>'parent_id','')::uuid;
        v_codigo text := trim(coalesce(_payload->>'codigo',''));
        v_nome text := trim(coalesce(_payload->>'nome',''));
        v_cursor uuid; v_guard int := 0;
begin
  if not has_capability(auth.uid(),'finance.settings.manage') then raise exception 'Sem permissão para manter centros de custo'; end if;
  if v_codigo = '' then raise exception 'Informe o código do centro de custo'; end if;
  if v_nome = '' then raise exception 'Informe o nome do centro de custo'; end if;
  if exists (select 1 from cost_centers where lower(codigo)=lower(v_codigo) and (v_id is null or id <> v_id)) then
    raise exception 'Já existe um centro de custo com o código %', v_codigo;
  end if;
  if v_parent is not null and v_parent = v_id then raise exception 'Um centro não pode ser filho dele mesmo'; end if;
  v_cursor := v_parent;
  while v_cursor is not null loop
    v_guard := v_guard + 1;
    if v_guard > 50 then raise exception 'Hierarquia inválida nos centros de custo'; end if;
    if v_id is not null and v_cursor = v_id then raise exception 'Hierarquia circular nos centros de custo'; end if;
    select parent_id into v_cursor from cost_centers where id = v_cursor;
  end loop;

  if v_id is null then
    insert into cost_centers (codigo, nome, parent_id, business_entity_id, responsavel_party_id,
        vigencia_inicio, vigencia_fim, is_active)
    values (v_codigo, v_nome, v_parent, nullif(_payload->>'business_entity_id','')::uuid,
        nullif(_payload->>'responsavel_party_id','')::uuid,
        nullif(_payload->>'vigencia_inicio','')::date, nullif(_payload->>'vigencia_fim','')::date,
        coalesce((_payload->>'is_active')::boolean, true))
    returning id into v_id;
  else
    update cost_centers set codigo=v_codigo, nome=v_nome, parent_id=v_parent,
      business_entity_id=nullif(_payload->>'business_entity_id','')::uuid,
      responsavel_party_id=nullif(_payload->>'responsavel_party_id','')::uuid,
      vigencia_inicio=nullif(_payload->>'vigencia_inicio','')::date,
      vigencia_fim=nullif(_payload->>'vigencia_fim','')::date,
      updated_at=now()
    where id=v_id;
  end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.centro_custo.salvar','cost_centers',v_id,_payload);
  return v_id;
end $function$;

create or replace function public.fin_cost_center_toggle(_id uuid, _ativo boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not has_capability(auth.uid(),'finance.settings.manage') then raise exception 'Sem permissão'; end if;
  if _ativo is false and exists (select 1 from cost_centers where parent_id = _id and is_active) then
    raise exception 'Inative primeiro os centros filhos deste centro';
  end if;
  update cost_centers set is_active = _ativo, updated_at = now() where id = _id;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), case when _ativo then 'financeiro.centro_custo.ativar' else 'financeiro.centro_custo.inativar' end,
          'cost_centers', _id, jsonb_build_object('is_active', _ativo));
end $function$;

-- 5) FLUXO DE CAIXA -----------------------------------------------------------
create or replace function public.fin_cashflow(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_de date := coalesce(nullif(_filtros->>'de','')::date, current_date);
        v_ate date := coalesce(nullif(_filtros->>'ate','')::date, current_date + 30);
        v_conta uuid := nullif(_filtros->>'conta_id','')::uuid;
        v_cc uuid := nullif(_filtros->>'centro_custo_id','')::uuid;
        v_entidade uuid := nullif(_filtros->>'entidade_id','')::uuid;
        v_grupo text := coalesce(_filtros->>'agrupamento','dia');
        v_saldo_inicial bigint; r jsonb;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;

  select coalesce(sum(m.valor_cents),0) into v_saldo_inicial
  from financial_account_movements m
  where m.data < v_de and (v_conta is null or m.financial_account_id = v_conta);

  with realizado as (
    select case v_grupo when 'mes' then date_trunc('month', m.data)::date
                        when 'semana' then date_trunc('week', m.data)::date
                        else m.data end as bucket,
           sum(case when m.valor_cents > 0 then m.valor_cents else 0 end) as entradas,
           sum(case when m.valor_cents < 0 then -m.valor_cents else 0 end) as saidas
    from financial_account_movements m
    where m.data between v_de and v_ate
      and (v_conta is null or m.financial_account_id = v_conta)
    group by 1
  ), previsto as (
    select case v_grupo when 'mes' then date_trunc('month', i.vencimento)::date
                        when 'semana' then date_trunc('week', i.vencimento)::date
                        else i.vencimento end as bucket,
           sum(case when t.direction='receivable' then greatest(i.valor_cents
                 - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id=i.id),0),0) else 0 end) as entradas,
           sum(case when t.direction='payable' then greatest(i.valor_cents
                 - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id=i.id),0),0) else 0 end) as saidas
    from financial_installments i
    join financial_titles t on t.id = i.title_id
    where i.vencimento between v_de and v_ate
      and t.status in ('ativo','aprovado')
      and (v_cc is null or t.cost_center_id = v_cc)
      and (v_entidade is null or t.business_entity_id = v_entidade)
      and (v_conta is null or t.financial_account_id = v_conta or t.financial_account_id is null)
    group by 1
  ), buckets as (
    select bucket from realizado union select bucket from previsto
  ), joined as (
    select b.bucket,
           coalesce(r.entradas,0) as entradas_realizadas,
           coalesce(r.saidas,0) as saidas_realizadas,
           coalesce(p.entradas,0) as entradas_previstas,
           coalesce(p.saidas,0) as saidas_previstas
    from buckets b
    left join realizado r on r.bucket = b.bucket
    left join previsto p on p.bucket = b.bucket
  ), acumulado as (
    select j.*,
      v_saldo_inicial + sum(j.entradas_realizadas - j.saidas_realizadas) over (order by j.bucket) as saldo_realizado,
      v_saldo_inicial + sum((j.entradas_realizadas + j.entradas_previstas) - (j.saidas_realizadas + j.saidas_previstas))
        over (order by j.bucket) as saldo_projetado
    from joined j
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate, 'agrupamento', v_grupo),
    'saldo_inicial_cents', v_saldo_inicial,
    'totais', jsonb_build_object(
      'entradas_realizadas_cents', coalesce((select sum(entradas_realizadas) from acumulado),0),
      'saidas_realizadas_cents', coalesce((select sum(saidas_realizadas) from acumulado),0),
      'entradas_previstas_cents', coalesce((select sum(entradas_previstas) from acumulado),0),
      'saidas_previstas_cents', coalesce((select sum(saidas_previstas) from acumulado),0),
      'saldo_final_realizado_cents', coalesce((select saldo_realizado from acumulado order by bucket desc limit 1), v_saldo_inicial),
      'saldo_final_projetado_cents', coalesce((select saldo_projetado from acumulado order by bucket desc limit 1), v_saldo_inicial)
    ),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object(
        'bucket', bucket, 'entradas_realizadas_cents', entradas_realizadas,
        'saidas_realizadas_cents', saidas_realizadas, 'entradas_previstas_cents', entradas_previstas,
        'saidas_previstas_cents', saidas_previstas, 'saldo_realizado_cents', saldo_realizado,
        'saldo_projetado_cents', saldo_projetado) order by bucket) from acumulado),'[]'::jsonb)
  ) into r;
  return r;
end $function$;

-- 6) AUDITORIA FINANCEIRA -----------------------------------------------------
create or replace function public.fin_audit_list(_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_de date := nullif(_filtros->>'de','')::date;
        v_ate date := nullif(_filtros->>'ate','')::date;
        v_acao text := nullif(_filtros->>'acao','');
        v_autor uuid := nullif(_filtros->>'autor_id','')::uuid;
        v_busca text := fin_unaccent_lower(nullif(_filtros->>'busca',''));
        v_limit int := least(coalesce((_filtros->>'limit')::int, 50), 200);
        v_offset int := coalesce((_filtros->>'offset')::int, 0);
        r jsonb;
begin
  if not has_capability(auth.uid(),'finance.audit.view')
     and not has_capability(auth.uid(),'finance.statement.audit') then raise exception 'Sem permissão'; end if;
  with base as (
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, a.payload
    from audit_logs a
    where (a.action like 'financeiro.%' or a.entity like 'financial%'
           or a.entity in ('chart_of_accounts','cost_centers','payment_methods'))
      and (v_de is null or a.created_at >= v_de)
      and (v_ate is null or a.created_at < (v_ate + 1))
      and (v_acao is null or a.action = v_acao)
      and (v_autor is null or a.actor_id = v_autor)
      and (v_busca is null or fin_unaccent_lower(a.action || ' ' || coalesce(a.entity,'') || ' ' || coalesce(a.payload::text,'')) like '%'||v_busca||'%')
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'acoes', coalesce((select jsonb_agg(distinct action) from base),'[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'created_at', b.created_at, 'action', b.action, 'entity', b.entity,
        'entity_id', b.entity_id, 'payload', b.payload,
        'autor', coalesce((select pr.full_name from profiles pr where pr.id = b.actor_id), 'sistema')
      ) order by b.created_at desc)
      from (select * from base order by created_at desc limit v_limit offset v_offset) b),'[]'::jsonb)
  ) into r;
  return r;
end $function$;

-- 7) CONFIGURAÇÕES FINANCEIRAS ------------------------------------------------
create or replace function public.fin_settings_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare r jsonb;
begin
  if not has_capability(auth.uid(),'finance.view') then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'pode_gerenciar', has_capability(auth.uid(),'finance.settings.manage'),
    'formas_pagamento', coalesce((select jsonb_agg(jsonb_build_object('id',id,'codigo',codigo,'nome',nome,'is_active',is_active) order by nome)
       from payment_methods),'[]'::jsonb),
    'aprovacao', jsonb_build_object(
      'regra', 'Títulos submetidos dependem de perfil com permissão de aprovação',
      'parametrizacao_por_valor', false),
    'integracoes', jsonb_build_array(
      jsonb_build_object('nome','Asaas','status','nao_configurado','observacao','Sem credencial, sem chamada externa, sem cobrança emitida'),
      jsonb_build_object('nome','CNAB','status','nao_configurado','observacao','Retorno bancário CNAB ainda não implementado'))
  ) into r;
  return r;
end $function$;

create or replace function public.fin_payment_method_save(_payload jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid := nullif(_payload->>'id','')::uuid;
        v_codigo text := trim(coalesce(_payload->>'codigo',''));
        v_nome text := trim(coalesce(_payload->>'nome',''));
begin
  if not has_capability(auth.uid(),'finance.settings.manage') then raise exception 'Sem permissão'; end if;
  if v_codigo = '' or v_nome = '' then raise exception 'Informe código e nome da forma de pagamento'; end if;
  if exists (select 1 from payment_methods where lower(codigo)=lower(v_codigo) and (v_id is null or id <> v_id)) then
    raise exception 'Já existe uma forma de pagamento com o código %', v_codigo;
  end if;
  if v_id is null then
    insert into payment_methods (codigo, nome, is_active)
    values (v_codigo, v_nome, coalesce((_payload->>'is_active')::boolean, true)) returning id into v_id;
  else
    update payment_methods set codigo=v_codigo, nome=v_nome,
      is_active=coalesce((_payload->>'is_active')::boolean, is_active) where id=v_id;
  end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.forma_pagamento.salvar','payment_methods',v_id,_payload);
  return v_id;
end $function$;

create or replace function public.fin_payment_method_toggle(_id uuid, _ativo boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not has_capability(auth.uid(),'finance.settings.manage') then raise exception 'Sem permissão'; end if;
  update payment_methods set is_active = _ativo where id = _id;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.forma_pagamento.situacao','payment_methods',_id, jsonb_build_object('is_active',_ativo));
end $function$;