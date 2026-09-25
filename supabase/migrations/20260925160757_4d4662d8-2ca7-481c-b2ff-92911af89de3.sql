alter table public.financial_accounts
  add column if not exists banco_codigo text,
  add column if not exists conta_digito text,
  add column if not exists titular text,
  add column if not exists titular_documento text,
  add column if not exists pix_chave text,
  add column if not exists agencia_endereco text,
  add column if not exists agencia_cidade text,
  add column if not exists gerente text,
  add column if not exists gerente_contato text;

create or replace function public.fin_account_update(_account uuid, _payload jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_old jsonb; v_new jsonb; k text;
  campos text[] := array['nome','apelido','banco','banco_codigo','agencia_masked','conta_masked','conta_digito','titular',
    'titular_documento','pix_chave','agencia_endereco','agencia_cidade','gerente','gerente_contato','notes'];
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para editar contas'; end if;
  select to_jsonb(a) into v_old from financial_accounts a where id=_account for update;
  if v_old is null then raise exception 'Conta não encontrada'; end if;
  if _payload ? 'nome' and coalesce(trim(_payload->>'nome'),'') = '' then raise exception 'Informe o nome da conta'; end if;
  update financial_accounts a set
    nome = case when _payload ? 'nome' then trim(_payload->>'nome') else a.nome end,
    apelido = case when _payload ? 'apelido' then nullif(trim(_payload->>'apelido'),'') else a.apelido end,
    banco = case when _payload ? 'banco' then nullif(trim(_payload->>'banco'),'') else a.banco end,
    banco_codigo = case when _payload ? 'banco_codigo' then nullif(trim(_payload->>'banco_codigo'),'') else a.banco_codigo end,
    agencia_masked = case when _payload ? 'agencia_masked' then nullif(trim(_payload->>'agencia_masked'),'') else a.agencia_masked end,
    conta_masked = case when _payload ? 'conta_masked' then nullif(trim(_payload->>'conta_masked'),'') else a.conta_masked end,
    conta_digito = case when _payload ? 'conta_digito' then nullif(trim(_payload->>'conta_digito'),'') else a.conta_digito end,
    titular = case when _payload ? 'titular' then nullif(trim(_payload->>'titular'),'') else a.titular end,
    titular_documento = case when _payload ? 'titular_documento' then nullif(trim(_payload->>'titular_documento'),'') else a.titular_documento end,
    pix_chave = case when _payload ? 'pix_chave' then nullif(trim(_payload->>'pix_chave'),'') else a.pix_chave end,
    agencia_endereco = case when _payload ? 'agencia_endereco' then nullif(trim(_payload->>'agencia_endereco'),'') else a.agencia_endereco end,
    agencia_cidade = case when _payload ? 'agencia_cidade' then nullif(trim(_payload->>'agencia_cidade'),'') else a.agencia_cidade end,
    gerente = case when _payload ? 'gerente' then nullif(trim(_payload->>'gerente'),'') else a.gerente end,
    gerente_contato = case when _payload ? 'gerente_contato' then nullif(trim(_payload->>'gerente_contato'),'') else a.gerente_contato end,
    notes = case when _payload ? 'notes' then nullif(trim(_payload->>'notes'),'') else a.notes end,
    is_active = case when _payload ? 'is_active' then (_payload->>'is_active')::boolean else a.is_active end
  where id=_account;
  select to_jsonb(a) into v_new from financial_accounts a where id=_account;
  insert into audit_logs(actor_id,action,entity,entity_id,payload)
  select auth.uid(),'finance.account.update','financial_accounts',_account::text,
    jsonb_build_object('alteracoes', coalesce(jsonb_object_agg(c, jsonb_build_object('de',v_old->c,'para',v_new->c)),'{}'::jsonb))
  from unnest(campos || array['is_active']) c where v_old->c is distinct from v_new->c
  having count(*) > 0;
end $$;

create or replace function public.fin_account_cockpit(_account uuid, _de date, _ate date, _q text default null, _limit int default 50, _offset int default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare r jsonb; v_q text := nullif(trim(coalesce(_q,'')),'');
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  if not exists (select 1 from financial_accounts where id=_account) then raise exception 'Conta não encontrada'; end if;
  with mv as (
    select m.*,
      case when m.transfer_id is not null then
        (select case when t.from_account_id=m.financial_account_id then 'Para ' else 'De ' end || o.nome
           from financial_transfers t join financial_accounts o on o.id = case when t.from_account_id=m.financial_account_id then t.to_account_id else t.from_account_id end
          where t.id=m.transfer_id)
      end as contraparte_conta,
      (select string_agg(distinct coalesce(p.display_name, p.legal_name), ', ')
         from financial_allocations al join financial_installments i on i.id=al.installment_id
         join financial_titles ti on ti.id=i.title_id left join parties p on p.id=ti.party_id
        where al.settlement_id=m.settlement_id) as pessoas,
      (select jsonb_agg(distinct jsonb_build_object('id',ti.id,'numero',ti.numero,'descricao',ti.descricao,'direction',ti.direction))
         from financial_allocations al join financial_installments i on i.id=al.installment_id
         join financial_titles ti on ti.id=i.title_id where al.settlement_id=m.settlement_id) as titulos,
      (select coalesce(pr.full_name, pr.email) from profiles pr where pr.id=m.created_by) as autor
    from financial_account_movements m
    where m.financial_account_id=_account and m.data between _de and _ate
  ), f as (
    select * from mv where v_q is null or concat_ws(' ',descricao,contraparte_conta,pessoas,titulos::text) ilike '%'||v_q||'%'
  )
  select jsonb_build_object(
    'saldo_anterior_cents', coalesce((select sum(valor_cents) from financial_account_movements where financial_account_id=_account and data < _de),0),
    'saldo_final_cents', coalesce((select sum(valor_cents) from financial_account_movements where financial_account_id=_account and data <= _ate),0),
    'entradas_cents', coalesce((select sum(valor_cents) from mv where valor_cents>0 and kind <> 'saldo_inicial'),0),
    'saidas_cents', coalesce((select -sum(valor_cents) from mv where valor_cents<0),0),
    'transf_entrada_cents', coalesce((select sum(valor_cents) from mv where kind='transferencia_entrada'),0),
    'transf_saida_cents', coalesce((select -sum(valor_cents) from mv where kind='transferencia_saida'),0),
    'total', (select count(*) from f),
    'linhas', coalesce((select jsonb_agg(to_jsonb(x) - 'created_by' order by x.data desc, x.created_at desc) from
       (select id,data,kind,valor_cents,descricao,settlement_id,transfer_id,contraparte_conta,pessoas,titulos,autor,created_at,created_by
          from f order by data desc, created_at desc limit greatest(least(_limit,200),1) offset greatest(_offset,0)) x),'[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function public.fin_account_auditoria(_account uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(x order by x.quando desc) from (
    select l.created_at quando, l.action acao, l.payload detalhe, (select coalesce(pr.full_name, pr.email) from profiles pr where pr.id=l.actor_id) autor
      from audit_logs l where l.entity='financial_accounts' and l.entity_id=_account::text
    union all
    select t.created_at, case when t.is_reversal then 'transferencia.estorno' else 'transferencia' end,
      jsonb_build_object('valor_cents',t.valor_cents,'data',t.data,'motivo',t.motivo,
        'de',(select nome from financial_accounts where id=t.from_account_id),'para',(select nome from financial_accounts where id=t.to_account_id)),
      (select coalesce(pr.full_name, pr.email) from profiles pr where pr.id=t.created_by)
      from financial_transfers t where _account in (t.from_account_id,t.to_account_id)
    order by 1 desc limit 300) x),'[]'::jsonb);
end $$;

revoke all on function public.fin_account_update(uuid,jsonb), public.fin_account_cockpit(uuid,date,date,text,int,int), public.fin_account_auditoria(uuid) from public, anon;
grant execute on function public.fin_account_update(uuid,jsonb), public.fin_account_cockpit(uuid,date,date,text,int,int), public.fin_account_auditoria(uuid) to authenticated, service_role;