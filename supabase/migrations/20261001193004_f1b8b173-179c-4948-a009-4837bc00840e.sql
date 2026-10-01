alter table public.financial_accounts
  add column if not exists excluida_em timestamptz,
  add column if not exists excluida_por uuid,
  add column if not exists excluida_motivo text;

create or replace function public.fin_account_excluir(_id uuid, _motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a financial_accounts; v_soma bigint; v_vinc int; v_modo text;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão'; end if;
  if coalesce(length(trim(_motivo)),0) < 3 then raise exception 'Informe o motivo da exclusão.'; end if;
  select * into a from financial_accounts where id=_id for update;
  if not found or a.excluida_em is not null then raise exception 'Conta não encontrada.'; end if;
  if exists(select 1 from asaas_accounts where financial_account_id=_id) then
    raise exception 'Esta conta está ligada ao Asaas e não pode ser excluída.'; end if;
  select coalesce(sum(valor_cents),0) into v_soma from financial_account_movements where financial_account_id=_id;
  if v_soma <> 0 then
    raise exception 'A conta ainda tem saldo (incluindo lançamentos futuros). Transfira o saldo antes de excluir.'; end if;
  select (select count(*) from financial_titles where financial_account_id=_id)
       + (select count(*) from financial_settlements where financial_account_id=_id)
       + (select count(*) from financial_transfers where from_account_id=_id or to_account_id=_id)
       + (select count(*) from financial_account_movements where financial_account_id=_id)
       + (select count(*) from financial_statement_files where financial_account_id=_id)
       + (select count(*) from financial_statement_imports where financial_account_id=_id)
       + (select count(*) from financial_statement_lines where financial_account_id=_id)
       + (select count(*) from financial_reconciliations where financial_account_id=_id)
    into v_vinc;
  if v_vinc = 0 then
    delete from financial_accounts where id=_id; v_modo := 'apagada';
  else
    update financial_accounts set excluida_em=now(), excluida_por=auth.uid(), excluida_motivo=trim(_motivo), is_active=false where id=_id;
    v_modo := 'oculta_com_vinculos';
  end if;
  insert into audit_logs(actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'conta_excluida', 'financial_accounts', _id::text,
          jsonb_build_object('nome',a.nome,'banco',a.banco,'motivo',trim(_motivo),'modo',v_modo,'vinculos',v_vinc));
  return jsonb_build_object('modo',v_modo,'vinculos',v_vinc);
end $$;
revoke all on function public.fin_account_excluir(uuid,text) from public, anon;
grant execute on function public.fin_account_excluir(uuid,text) to authenticated;

create or replace function public.fin_accounts_overview()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare r jsonb; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', a.id, 'nome', a.nome, 'kind', a.kind, 'banco', a.banco, 'is_active', a.is_active,
      'saldo_cents', fin_saldo_conta(a.id, v_hoje),
      'previsto_futuro_cents', coalesce((select sum(m.valor_cents) from financial_account_movements m
                                  where m.financial_account_id = a.id and m.data > v_hoje),0),
      'data_corte', v_hoje,
      'ultimo_movimento', (select max(m.data)::text from financial_account_movements m
                            where m.financial_account_id = a.id and m.data <= v_hoje)
    ) as x
    from financial_accounts a where not a.is_homologacao and a.excluida_em is null
  ) s;
  return r;
end $function$;