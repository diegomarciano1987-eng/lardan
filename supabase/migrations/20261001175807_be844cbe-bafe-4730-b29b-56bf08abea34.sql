
alter table public.financial_installments add column if not exists competencia date;
alter table public.financial_accounts add column if not exists is_implantacao boolean not null default false;
update public.financial_accounts set is_implantacao = true where nome ilike 'AJUSTE DE IMPLANTA%';

-- Competência por parcela: só pela rotina oficial, com motivo e histórico
create or replace function public.fin_installment_competencia_set(_installment uuid, _competencia date, _motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_i financial_installments; v_t financial_titles; v_cap text;
begin
  select * into v_i from financial_installments where id = _installment for update;
  if not found then raise exception 'Parcela não encontrada'; end if;
  select * into v_t from financial_titles where id = v_i.title_id;
  v_cap := case when v_t.direction='payable' then 'finance.payable.manage' else 'finance.receivable.manage' end;
  if auth.uid() is not null and not has_capability(auth.uid(), v_cap) then raise exception 'Sem permissão'; end if;
  if coalesce(trim(_motivo),'') = '' then raise exception 'Informe o motivo'; end if;
  if v_t.status = 'cancelado' then raise exception 'Título cancelado'; end if;
  if v_i.competencia is not distinct from _competencia then return jsonb_build_object('ok', true, 'alterado', false); end if;
  update financial_installments set competencia = _competencia where id = _installment;
  insert into financial_title_events(title_id, evento, motivo, payload, actor_id)
  values (v_t.id, 'competencia_parcela', _motivo, jsonb_build_object('installment_id', v_i.id, 'numero', v_i.numero,
          'antes', coalesce(v_i.competencia, v_t.competencia, v_t.emissao), 'antes_proprio', v_i.competencia, 'depois', _competencia), auth.uid());
  return jsonb_build_object('ok', true, 'alterado', true);
end $$;
revoke all on function public.fin_installment_competencia_set(uuid, date, text) from public, anon;
grant execute on function public.fin_installment_competencia_set(uuid, date, text) to authenticated;

-- Lista por parcela
create or replace function public.fin_installments_list(_direction text, _de date default null, _ate date default null,
  _search text default null, _situacao text default null, _limit int default 50, _offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_dir fin_direction := _direction::fin_direction; v_rows jsonb; v_total bigint; v_saldo bigint; v_valor bigint;
begin
  if not has_capability(auth.uid(), case when v_dir='payable' then 'finance.payable.view' else 'finance.receivable.view' end) then
    raise exception 'Sem permissão'; end if;
  with base as (
    select i.id, i.title_id, i.numero, i.total_parcelas, i.vencimento, i.valor_cents,
           coalesce(i.competencia, t.competencia, t.emissao) as competencia, (i.competencia is not null) as competencia_propria,
           greatest(i.valor_cents
             + coalesce((select sum(case when j.kind in ('juros','multa','tarifa') then j.valor_cents
                                         when j.kind in ('desconto','abatimento') then -j.valor_cents else 0 end)
                         from financial_adjustments j where j.installment_id = i.id),0)
             - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0), 0) as saldo_cents,
           i.settlement_status::text as situacao_baixa,
           t.descricao, t.numero as titulo_numero, t.valor_cents as total_contrato_cents, t.status::text as titulo_status,
           coalesce(p.display_name, p.legal_name, p.code) as contraparte,
           case when ca.id is null then null else ca.codigo||' · '||ca.nome end as plano_label, ca.natureza::text as natureza
    from financial_installments i join financial_titles t on t.id = i.title_id
    join parties p on p.id = t.party_id left join chart_of_accounts ca on ca.id = t.chart_account_id
    where t.direction = v_dir and t.status <> 'cancelado'
      and (_de is null or i.vencimento >= _de) and (_ate is null or i.vencimento <= _ate)
      and (coalesce(_search,'') = '' or t.descricao ilike '%'||_search||'%' or coalesce(t.numero,'') ilike '%'||_search||'%'
           or coalesce(p.display_name,'') ilike '%'||_search||'%' or coalesce(p.legal_name,'') ilike '%'||_search||'%')
  ), f as (
    select * from base where coalesce(_situacao,'') in ('','todos')
      or (_situacao='aberto' and saldo_cents > 0)
      or (_situacao='vencido' and saldo_cents > 0 and vencimento < (now() at time zone 'America/Sao_Paulo')::date)
      or (_situacao in ('liquidado','quitado') and saldo_cents = 0)
  )
  select coalesce((select jsonb_agg(to_jsonb(x) order by x.vencimento, x.descricao) from
           (select * from f order by vencimento, descricao limit greatest(_limit,1) offset greatest(_offset,0)) x),'[]'::jsonb),
         (select count(*) from f), (select coalesce(sum(saldo_cents),0) from f), (select coalesce(sum(valor_cents),0) from f)
    into v_rows, v_total, v_saldo, v_valor;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'saldo_cents', v_saldo, 'valor_parcelas_cents', v_valor,
    'criterio', 'Cada parcela uma vez, com vencimento, saldo e competência próprios. O total do contrato aparece só como referência.');
end $$;
revoke all on function public.fin_installments_list(text, date, date, text, text, int, int) from public, anon;
grant execute on function public.fin_installments_list(text, date, date, text, text, int, int) to authenticated;

-- Lista de transferências: uma linha por operação, com as duas movimentações
create or replace function public.fin_transfers_list(_de date, _ate date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_capability(auth.uid(),'finance.dashboard.view') then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object('id', ft.id, 'data', ft.data, 'valor_cents', ft.valor_cents,
        'de', fa.nome, 'para', ta.nome, 'motivo', ft.motivo, 'estorno', ft.is_reversal,
        'implantacao', (fa.is_implantacao or ta.is_implantacao),
        'movimentos', (select jsonb_agg(jsonb_build_object('id', m.id, 'conta', a.nome, 'valor_cents', m.valor_cents, 'kind', m.kind) order by m.valor_cents)
                       from financial_account_movements m join financial_accounts a on a.id = m.financial_account_id where m.transfer_id = ft.id))
      order by ft.data, ft.valor_cents desc), '[]'::jsonb),
    'operacional_cents', coalesce(sum(ft.valor_cents) filter (where not (fa.is_implantacao or ta.is_implantacao)),0),
    'implantacao_cents', coalesce(sum(ft.valor_cents) filter (where fa.is_implantacao or ta.is_implantacao),0),
    'criterio', 'Cada transferência conta uma vez pelo valor da operação. As duas movimentações seguem visíveis para conciliação.')
  into r
  from financial_transfers ft join financial_accounts fa on fa.id = ft.from_account_id join financial_accounts ta on ta.id = ft.to_account_id
  where ft.data between _de and _ate and not fa.is_homologacao and not ta.is_homologacao;
  return r;
end $$;
revoke all on function public.fin_transfers_list(date, date) from public, anon;
grant execute on function public.fin_transfers_list(date, date) to authenticated;
