create table public.asaas_charge_matches (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.asaas_charges(id),
  installment_id uuid not null references public.financial_installments(id),
  title_id uuid not null references public.financial_titles(id),
  regra text not null,
  status text not null check (status in ('confirmado','sugerido','recusado')),
  evidencia jsonb not null default '{}'::jsonb,
  decidido_por uuid,
  decidido_em timestamptz,
  motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (charge_id, installment_id)
);
create unique index asaas_charge_matches_charge_conf on public.asaas_charge_matches(charge_id) where status='confirmado';
create unique index asaas_charge_matches_inst_conf on public.asaas_charge_matches(installment_id) where status='confirmado';
grant select on public.asaas_charge_matches to authenticated;
grant all on public.asaas_charge_matches to service_role;
alter table public.asaas_charge_matches enable row level security;
create policy "Ver conferência Asaas com permissão de recebíveis" on public.asaas_charge_matches
  for select to authenticated using (public.has_capability(auth.uid(),'finance.receivable.view'));

-- Gera conferência: confirma só o certo (nº da fatura no título importado, 1:1, mesmo valor); o resto vira sugestão.
create or replace function public.asaas_conferencia_gerar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_conf int := 0; v_sug int := 0;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão'; end if;
  with c as (
    select c.id, c.value_cents, c.due_date, c.payment_date, c.raw->>'invoiceNumber' nf
    from asaas_charges c join asaas_accounts ac on ac.id=c.account_id and ac.environment='producao'
    where c.title_id is null and coalesce(c.external_status,'') not in ('DELETED','REFUNDED')
      and not exists (select 1 from asaas_charge_matches m where m.charge_id=c.id and m.status='confirmado')),
  t as (
    select i.id iid, t.id tid, i.valor_cents, substring(t.descricao from 'fatura nr\.? ?([0-9]+)') nf
    from financial_titles t join financial_installments i on i.title_id=t.id
    where t.direction='receivable' and t.status not in ('cancelado','rascunho') and t.descricao ~* 'fatura nr'
      and not exists (select 1 from asaas_charge_matches m where m.installment_id=i.id and m.status='confirmado')),
  m as (
    select c.id cid, t.iid, t.tid, c.nf, c.value_cents, t.valor_cents iv,
           count(*) over (partition by c.id) nc, count(*) over (partition by t.iid) ni
    from c join t on t.nf = c.nf),
  ins as (
    insert into asaas_charge_matches(charge_id, installment_id, title_id, regra, status, evidencia, decidido_em)
    select cid, iid, tid, 'numero_fatura',
           case when nc=1 and ni=1 and iv=value_cents then 'confirmado' else 'sugerido' end,
           jsonb_build_object('numero_fatura', nf, 'valor_cobranca_cents', value_cents, 'valor_parcela_cents', iv, 'candidatos_cobranca', nc, 'candidatos_parcela', ni),
           case when nc=1 and ni=1 and iv=value_cents then now() end
    from m
    on conflict (charge_id, installment_id) do nothing
    returning status)
  select count(*) filter (where status='confirmado'), count(*) filter (where status='sugerido') into v_conf, v_sug from ins;

  -- sugestões por valor + data de pagamento (±3 dias), só quando há um único candidato dos dois lados
  with c as (
    select c.id, c.value_cents, coalesce(c.payment_date, c.due_date) d
    from asaas_charges c join asaas_accounts ac on ac.id=c.account_id and ac.environment='producao'
    where c.title_id is null and c.external_status in ('RECEIVED','RECEIVED_IN_CASH','CONFIRMED')
      and not exists (select 1 from asaas_charge_matches m where m.charge_id=c.id and m.status in ('confirmado','sugerido'))),
  m as (
    select c.id cid, i.id iid, t.id tid, c.value_cents, c.d, i.vencimento,
           count(*) over (partition by c.id) nc, count(*) over (partition by i.id) ni
    from c join financial_installments i on i.valor_cents=c.value_cents and abs(i.vencimento - c.d) <= 3
    join financial_titles t on t.id=i.title_id and t.direction='receivable' and t.status not in ('cancelado','rascunho')
    where i.settlement_status='liquidado'
      and not exists (select 1 from asaas_charge_matches x where x.installment_id=i.id and x.status='confirmado')),
  ins as (
    insert into asaas_charge_matches(charge_id, installment_id, title_id, regra, status, evidencia)
    select cid, iid, tid, 'valor_data', 'sugerido',
           jsonb_build_object('valor_cents', value_cents, 'data_pagamento', d, 'vencimento_parcela', vencimento)
    from m where nc=1 and ni=1
    on conflict (charge_id, installment_id) do nothing
    returning 1)
  select v_sug + count(*) into v_sug from ins;

  insert into audit_logs(actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'asaas.conferencia.gerar', 'asaas_charge_matches', null, jsonb_build_object('confirmados', v_conf, 'sugeridos', v_sug));
  return jsonb_build_object('confirmados', v_conf, 'sugeridos', v_sug);
end $$;
revoke all on function public.asaas_conferencia_gerar() from public, anon;
grant execute on function public.asaas_conferencia_gerar() to authenticated;

create or replace function public.asaas_conferencia_decidir(_match uuid, _aceitar boolean, _motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão'; end if;
  select * into m from asaas_charge_matches where id=_match for update;
  if m.id is null then raise exception 'Sugestão não encontrada.'; end if;
  if m.status <> 'sugerido' then raise exception 'Esta sugestão já foi decidida.'; end if;
  if not _aceitar and coalesce(trim(_motivo),'') = '' then raise exception 'Recusar exige motivo.'; end if;
  if _aceitar and exists (select 1 from asaas_charge_matches where status='confirmado' and (charge_id=m.charge_id or installment_id=m.installment_id)) then
    raise exception 'Esta cobrança ou parcela já está conferida com outro item.';
  end if;
  update asaas_charge_matches set status = case when _aceitar then 'confirmado' else 'recusado' end,
    decidido_por = auth.uid(), decidido_em = now(), motivo = nullif(trim(_motivo),''), updated_at = now()
  where id = _match;
  if _aceitar then
    update asaas_charge_matches set status='recusado', motivo='Outra sugestão aceita', decidido_por=auth.uid(), decidido_em=now(), updated_at=now()
    where status='sugerido' and id<>_match and (charge_id=m.charge_id or installment_id=m.installment_id);
  end if;
  insert into audit_logs(actor_id, action, entity, entity_id, payload)
  values (auth.uid(), case when _aceitar then 'asaas.conferencia.aceitar' else 'asaas.conferencia.recusar' end,
          'asaas_charge_matches', _match, jsonb_build_object('charge_id', m.charge_id, 'installment_id', m.installment_id, 'motivo', _motivo));
end $$;
revoke all on function public.asaas_conferencia_decidir(uuid,boolean,text) from public, anon;
grant execute on function public.asaas_conferencia_decidir(uuid,boolean,text) to authenticated;

create or replace function public.asaas_conferencia_lista(_status text default 'sugerido', _limit int default 50, _offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; n int;
begin
  if not has_capability(auth.uid(),'finance.receivable.view') then raise exception 'Sem permissão'; end if;
  select count(*) into n from asaas_charge_matches where status=_status;
  select coalesce(jsonb_agg(x order by x.vencimento_cobranca desc), '[]'::jsonb) into v from (
    select m.id, m.regra, m.status, m.evidencia, m.motivo, m.decidido_em,
           c.external_id, c.value_cents, c.due_date as vencimento_cobranca, c.payment_date, c.external_status,
           coalesce(c.raw->>'description','') as descricao_cobranca,
           coalesce(pa.display_name, cu.name, c.customer_external_id) as cliente,
           t.descricao as descricao_titulo, t.numero as titulo_numero, i.numero, i.total_parcelas, i.vencimento as vencimento_parcela, i.valor_cents as valor_parcela_cents,
           m.title_id
    from asaas_charge_matches m
    join asaas_charges c on c.id=m.charge_id
    join financial_installments i on i.id=m.installment_id
    join financial_titles t on t.id=m.title_id
    left join asaas_customers cu on cu.account_id=c.account_id and cu.external_id=c.customer_external_id
    left join parties pa on pa.id=coalesce(c.party_id, cu.party_id)
    where m.status=_status
    order by c.due_date desc limit greatest(least(_limit,200),1) offset greatest(_offset,0)) x;
  return jsonb_build_object('rows', v, 'total', n,
    'resumo', (select jsonb_object_agg(status, q) from (select status, count(*) q from asaas_charge_matches group by status) s));
end $$;
revoke all on function public.asaas_conferencia_lista(text,int,int) from public, anon;
grant execute on function public.asaas_conferencia_lista(text,int,int) to authenticated;