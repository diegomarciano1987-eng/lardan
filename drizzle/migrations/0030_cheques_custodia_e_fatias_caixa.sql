
create table public.fin_cheques (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  banco text,
  agencia text,
  conta text,
  emitente_nome text not null,
  emitente_doc text,
  recebido_de_party_id uuid references public.parties(id),
  valor_cents bigint not null check (valor_cents > 0),
  bom_para date not null,
  recebido_em date not null default (now() at time zone 'America/Sao_Paulo')::date,
  status text not null default 'em_maos' check (status in ('em_maos','repassado','depositado','compensado','devolvido','cancelado')),
  repassado_para_party_id uuid references public.parties(id),
  repassado_para_nome text,
  deposito_account_id uuid references public.financial_accounts(id),
  observacao text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index fin_cheques_unico on public.fin_cheques (coalesce(banco,''), coalesce(agencia,''), coalesce(conta,''), numero) where status <> 'cancelado';
create table public.fin_cheque_eventos (
  id uuid primary key default gen_random_uuid(),
  cheque_id uuid not null references public.fin_cheques(id),
  de text, para text not null, motivo text, detalhe jsonb,
  created_by uuid, created_at timestamptz not null default now()
);
create table public.fin_caixa_fatias (
  id uuid primary key default gen_random_uuid(),
  financial_account_id uuid not null references public.financial_accounts(id),
  party_id uuid not null references public.parties(id),
  valor_cents bigint not null check (valor_cents <> 0),
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  motivo text not null,
  created_by uuid, created_at timestamptz not null default now()
);
grant select on public.fin_cheques, public.fin_cheque_eventos, public.fin_caixa_fatias to authenticated;
grant all on public.fin_cheques, public.fin_cheque_eventos, public.fin_caixa_fatias to service_role;
alter table public.fin_cheques enable row level security;
alter table public.fin_cheque_eventos enable row level security;
alter table public.fin_caixa_fatias enable row level security;
create policy fin_cheques_ler on public.fin_cheques for select to authenticated using (public.has_capability(auth.uid(),'finance.bank.view'));
create policy fin_cheque_eventos_ler on public.fin_cheque_eventos for select to authenticated using (public.has_capability(auth.uid(),'finance.bank.view'));
create policy fin_caixa_fatias_ler on public.fin_caixa_fatias for select to authenticated using (public.has_capability(auth.uid(),'finance.bank.view'));

create or replace function public.fin_cheque_registrar(_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para registrar cheques'; end if;
  if coalesce(trim(_payload->>'numero'),'') = '' then raise exception 'Informe o número do cheque'; end if;
  if coalesce(trim(_payload->>'emitente_nome'),'') = '' then raise exception 'Informe quem emitiu o cheque'; end if;
  if coalesce((_payload->>'valor_cents')::bigint,0) <= 0 then raise exception 'Valor do cheque deve ser maior que zero'; end if;
  if nullif(_payload->>'bom_para','') is null then raise exception 'Informe a data "bom para"'; end if;
  insert into fin_cheques (numero,banco,agencia,conta,emitente_nome,emitente_doc,recebido_de_party_id,valor_cents,bom_para,recebido_em,observacao,created_by)
  values (trim(_payload->>'numero'), nullif(trim(_payload->>'banco'),''), nullif(trim(_payload->>'agencia'),''), nullif(trim(_payload->>'conta'),''),
    trim(_payload->>'emitente_nome'), nullif(regexp_replace(coalesce(_payload->>'emitente_doc',''),'\D','','g'),''),
    nullif(_payload->>'recebido_de_party_id','')::uuid, (_payload->>'valor_cents')::bigint, (_payload->>'bom_para')::date,
    coalesce(nullif(_payload->>'recebido_em','')::date,(now() at time zone 'America/Sao_Paulo')::date),
    nullif(trim(_payload->>'observacao'),''), auth.uid())
  returning id into v_id;
  insert into fin_cheque_eventos (cheque_id,de,para,motivo,created_by) values (v_id,null,'em_maos','Cheque recebido',auth.uid());
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
    values (auth.uid(),'cheque.registrado','fin_cheques',v_id::text,_payload - 'emitente_doc');
  return v_id;
exception when unique_violation then raise exception 'Este cheque já está registrado (mesmo banco, agência, conta e número)';
end $$;

create or replace function public.fin_cheque_mudar(_id uuid, _para text, _payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c fin_cheques%rowtype; ok boolean;
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
  update fin_cheques set status = _para, updated_at = now(),
    repassado_para_party_id = case when _para='repassado' then nullif(_payload->>'party_id','')::uuid else repassado_para_party_id end,
    repassado_para_nome = case when _para='repassado' then nullif(trim(_payload->>'nome'),'') else repassado_para_nome end,
    deposito_account_id = case when _para='depositado' then (_payload->>'account_id')::uuid else deposito_account_id end
  where id = _id;
  insert into fin_cheque_eventos (cheque_id,de,para,motivo,detalhe,created_by)
    values (_id,c.status,_para,nullif(trim(_payload->>'motivo'),''),_payload,auth.uid());
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
    values (auth.uid(),'cheque.'||_para,'fin_cheques',_id::text,jsonb_build_object('de',c.status,'para',_para,'detalhe',_payload));
end $$;

create or replace function public.fin_cheques_lista(_status text default null, _q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  return jsonb_build_object(
    'resumo', (select coalesce(jsonb_object_agg(status, jsonb_build_object('qtd',n,'total_cents',t)),'{}'::jsonb)
               from (select status, count(*) n, sum(valor_cents) t from fin_cheques group by status) s),
    'linhas', (select coalesce(jsonb_agg(x order by x->>'bom_para'),'[]'::jsonb) from (
      select jsonb_build_object('id',c.id,'numero',c.numero,'banco',c.banco,'agencia',c.agencia,'conta',c.conta,
        'emitente_nome',c.emitente_nome,
        'emitente_doc', case when c.emitente_doc is null then null else '•••'||right(c.emitente_doc,4) end,
        'recebido_de', coalesce(p1.display_name,p1.legal_name),
        'valor_cents',c.valor_cents,'bom_para',c.bom_para,'recebido_em',c.recebido_em,'status',c.status,
        'repassado_para', coalesce(p2.display_name,p2.legal_name,c.repassado_para_nome),
        'conta_deposito', a.nome, 'observacao', c.observacao,
        'eventos',(select coalesce(jsonb_agg(jsonb_build_object('de',e.de,'para',e.para,'motivo',e.motivo,'quando',e.created_at) order by e.created_at),'[]') from fin_cheque_eventos e where e.cheque_id=c.id)) x
      from fin_cheques c
      left join parties p1 on p1.id=c.recebido_de_party_id
      left join parties p2 on p2.id=c.repassado_para_party_id
      left join financial_accounts a on a.id=c.deposito_account_id
      where (_status is null or c.status=_status)
        and (_q is null or c.numero ilike '%'||_q||'%' or c.emitente_nome ilike '%'||_q||'%' or coalesce(p2.display_name,c.repassado_para_nome,'') ilike '%'||_q||'%')
      limit 500) q));
end $$;

create or replace function public.fin_fatia_lancar(_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_acc uuid; v_party uuid; v_val bigint; v_atual bigint; v_saldo bigint; v_reservado bigint;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão'; end if;
  v_acc := (_payload->>'account_id')::uuid; v_party := (_payload->>'party_id')::uuid; v_val := (_payload->>'valor_cents')::bigint;
  if v_acc is null or v_party is null then raise exception 'Informe a conta e a pessoa dona da fatia'; end if;
  if coalesce(v_val,0) = 0 then raise exception 'Informe um valor diferente de zero'; end if;
  if coalesce(trim(_payload->>'motivo'),'') = '' then raise exception 'Informe o motivo'; end if;
  perform 1 from financial_accounts where id = v_acc for update;
  select coalesce(sum(valor_cents),0) into v_atual from fin_caixa_fatias where financial_account_id=v_acc and party_id=v_party;
  if v_atual + v_val < 0 then raise exception 'A fatia desta pessoa ficaria negativa'; end if;
  if v_val > 0 then
    v_saldo := fin_saldo_conta(v_acc, (now() at time zone 'America/Sao_Paulo')::date);
    select coalesce(sum(valor_cents),0) into v_reservado from fin_caixa_fatias where financial_account_id=v_acc;
    if v_reservado + v_val > v_saldo then raise exception 'Não há dinheiro livre da Lardan suficiente nesta conta para separar esse valor'; end if;
  end if;
  insert into fin_caixa_fatias (financial_account_id,party_id,valor_cents,data,motivo,created_by)
  values (v_acc,v_party,v_val,coalesce(nullif(_payload->>'data','')::date,(now() at time zone 'America/Sao_Paulo')::date),trim(_payload->>'motivo'),auth.uid())
  returning id into v_id;
  insert into audit_logs (actor_id, action, entity, entity_id, payload) values (auth.uid(),'caixa.fatia','fin_caixa_fatias',v_id::text,_payload);
  return v_id;
end $$;

create or replace function public.fin_fatias_conta(_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_saldo bigint;
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  v_saldo := fin_saldo_conta(_account, (now() at time zone 'America/Sao_Paulo')::date);
  return jsonb_build_object('saldo_cents', v_saldo,
    'fatias', (select coalesce(jsonb_agg(jsonb_build_object('party_id',f.party_id,'nome',coalesce(p.display_name,p.legal_name),'valor_cents',f.t) order by f.t desc),'[]')
               from (select party_id, sum(valor_cents) t from fin_caixa_fatias where financial_account_id=_account group by party_id having sum(valor_cents)<>0) f
               join parties p on p.id=f.party_id),
    'reservado_cents', (select coalesce(sum(valor_cents),0) from fin_caixa_fatias where financial_account_id=_account),
    'historico', (select coalesce(jsonb_agg(jsonb_build_object('nome',coalesce(p.display_name,p.legal_name),'valor_cents',f.valor_cents,'data',f.data,'motivo',f.motivo,'quando',f.created_at) order by f.created_at desc),'[]')
               from (select * from fin_caixa_fatias where financial_account_id=_account order by created_at desc limit 50) f join parties p on p.id=f.party_id));
end $$;

revoke all on function public.fin_cheque_registrar(jsonb), public.fin_cheque_mudar(uuid,text,jsonb), public.fin_cheques_lista(text,text), public.fin_fatia_lancar(jsonb), public.fin_fatias_conta(uuid) from public, anon;
grant execute on function public.fin_cheque_registrar(jsonb), public.fin_cheque_mudar(uuid,text,jsonb), public.fin_cheques_lista(text,text), public.fin_fatia_lancar(jsonb), public.fin_fatias_conta(uuid) to authenticated;
