create table if not exists public.financial_import_ar_stage (
  id uuid primary key default gen_random_uuid(),
  lote text not null,
  linha integer not null,
  chave text not null unique,
  contraparte text,
  descricao text not null,
  competencia date,
  vencimento date not null,
  situacao text,
  valor_cents bigint not null,
  forma text,
  recebido_cents bigint,
  conta text,
  pago_em date,
  categoria text,
  centro text,
  title_id uuid references public.financial_titles(id),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists fin_import_ar_stage_pend on public.financial_import_ar_stage (lote) where processed_at is null;
grant all on public.financial_import_ar_stage to service_role;
grant select on public.financial_import_ar_stage to authenticated;
alter table public.financial_import_ar_stage enable row level security;
create policy "import ar stage master read" on public.financial_import_ar_stage for select to authenticated
using (public.has_role(auth.uid(), 'master'::app_role));

create or replace function public.fin_import_ar_refs(_lote text)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_cod text; v_nome text; v_nat fin_account_nature; v_kind fin_account_kind;
begin
  for r in select distinct btrim(forma) nome from financial_import_ar_stage where lote=_lote and nullif(btrim(forma),'') is not null loop
    if not exists (select 1 from payment_methods where upper(btrim(nome))=upper(r.nome)) then
      insert into payment_methods (codigo, nome) values (fin_import_ap_slug(r.nome), r.nome);
    end if;
  end loop;
  for r in select distinct coalesce(nullif(btrim(conta),''),'Conta não informada') nome from financial_import_ar_stage where lote=_lote loop
    if not exists (select 1 from financial_accounts where upper(btrim(nome))=upper(r.nome)) then
      v_kind := case when upper(r.nome) like '%DINHEIRO%' then 'caixa'
        when upper(r.nome) like '%CHEQUE%' then 'compensacao'
        when upper(r.nome) like '%ASAAS%' or upper(r.nome) like '%EFI%' or upper(r.nome) like '%REDE%' or upper(r.nome) like '%INFINITY%' then 'provedor'
        else 'conta_corrente' end::fin_account_kind;
      insert into financial_accounts (nome, kind, notes) values (r.nome, v_kind, 'Criada pela importação de contas a receber');
    end if;
  end loop;
  for r in select distinct btrim(categoria) cat from financial_import_ar_stage where lote=_lote and nullif(btrim(categoria),'') is not null loop
    v_cod := substring(r.cat from '^[0-9][0-9\.]*');
    if v_cod is null then v_cod := fin_import_ap_slug(r.cat); v_nome := r.cat;
    else v_cod := rtrim(v_cod,'.'); v_nome := btrim(substring(r.cat from length(v_cod)+1)); if v_nome='' then v_nome:=r.cat; end if; end if;
    v_nat := case when v_cod like '7.1.1%' then 'passivo' else 'receita' end::fin_account_nature;
    if not exists (select 1 from chart_of_accounts where codigo=v_cod) then
      insert into chart_of_accounts (codigo, nome, natureza, aceita_lancamento) values (v_cod, v_nome, v_nat, true);
    end if;
  end loop;
  for r in select distinct btrim(centro) nome from financial_import_ar_stage where lote=_lote and nullif(btrim(centro),'') is not null loop
    if not exists (select 1 from cost_centers where upper(btrim(nome))=upper(r.nome)) then
      insert into cost_centers (codigo, nome) values (fin_import_ap_slug(r.nome), r.nome);
    end if;
  end loop;
end $$;

create or replace function public.fin_import_ar_apply(_lote text, _limite integer default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; v_title uuid; v_party uuid; v_ni uuid; v_chart uuid; v_cc uuid; v_pm uuid; v_conta uuid; v_inst uuid; v_set uuid;
  v_t int:=0; v_b int:=0; v_ja int:=0;
begin
  perform fin_import_ar_refs(_lote);
  select id into v_ni from parties where display_name='Não identificado' order by created_at limit 1;
  for l in select * from financial_import_ar_stage where lote=_lote and processed_at is null order by linha limit _limite loop
    select id into v_title from financial_titles where sistema_origem='planilha_contas_a_receber' and id_externo=l.chave;
    if v_title is not null then
      v_ja := v_ja + 1;
    else
      v_party := null;
      if nullif(btrim(l.contraparte),'') is not null then
        select id into v_party from parties where upper(btrim(coalesce(display_name,legal_name,'')))=upper(btrim(l.contraparte)) order by created_at limit 1;
      end if;
      v_party := coalesce(v_party, v_ni);
      select id into v_chart from chart_of_accounts where codigo=coalesce(rtrim(substring(btrim(l.categoria) from '^[0-9][0-9\.]*'),'.'), fin_import_ap_slug(l.categoria));
      select id into v_cc from cost_centers where upper(btrim(nome))=upper(btrim(coalesce(l.centro,'')));
      select id into v_pm from payment_methods where upper(btrim(nome))=upper(btrim(coalesce(l.forma,'')));
      select id into v_conta from financial_accounts where upper(btrim(nome))=upper(coalesce(nullif(btrim(l.conta),''),'Conta não informada'));

      insert into financial_titles (direction, party_id, descricao, emissao, competencia, valor_cents, chart_account_id, cost_center_id,
        payment_method_id, financial_account_id, origem, sistema_origem, id_externo, status, cancel_reason, observacao)
      values ('receivable', v_party, l.descricao, coalesce(l.competencia,l.vencimento), l.competencia, l.valor_cents, v_chart, v_cc,
        v_pm, v_conta, 'importacao', 'planilha_contas_a_receber', l.chave,
        case when l.situacao ilike 'Perdido%' then 'cancelado' else 'ativo' end::fin_title_status,
        case when l.situacao ilike 'Perdido%' then 'Perdido/Desconsiderado na planilha de origem' end,
        'Importado da planilha de contas a receber')
      returning id into v_title;
      v_t := v_t + 1;
      insert into financial_title_events (title_id, evento, payload)
      values (v_title,'criado', jsonb_build_object('valor_cents',l.valor_cents,'origem','importacao','lote',_lote,'linha',l.linha));
      insert into financial_installments (title_id, numero, total_parcelas, vencimento, valor_cents)
      values (v_title,1,1,l.vencimento,l.valor_cents) returning id into v_inst;

      if coalesce(l.recebido_cents,0) > 0 then
        insert into financial_settlements (direction, financial_account_id, data, valor_cents, payment_method_id, referencia, observacao, idempotency_key)
        values ('receivable', v_conta, coalesce(l.pago_em,l.vencimento), l.recebido_cents, v_pm,
          'Importação '||_lote||' linha '||l.linha, 'Recebimento importado da planilha de contas a receber', 'impar:'||l.chave)
        returning id into v_set;
        insert into financial_allocations (settlement_id, installment_id, valor_cents) values (v_set, v_inst, least(l.recebido_cents,l.valor_cents));
        insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao)
        values (v_conta,'entrada',coalesce(l.pago_em,l.vencimento), l.recebido_cents, v_set, 'Recebimento importado — '||l.descricao);
        perform fin_installment_refresh(v_inst);
        insert into financial_title_events (title_id, evento, payload)
        values (v_title,'recebimento', jsonb_build_object('settlement_id',v_set,'valor_cents',l.recebido_cents,'origem','importacao'));
        v_b := v_b + 1;
      end if;
    end if;
    update financial_import_ar_stage set processed_at=now(), title_id=v_title where id=l.id;
  end loop;
  return jsonb_build_object('titulos',v_t,'recebimentos',v_b,'ja_existiam',v_ja,
    'pendentes',(select count(*) from financial_import_ar_stage where lote=_lote and processed_at is null));
end $$;

revoke all on function public.fin_import_ar_refs(text) from public, anon, authenticated;
revoke all on function public.fin_import_ar_apply(text, integer) from public, anon, authenticated;
grant execute on function public.fin_import_ar_refs(text) to service_role;
grant execute on function public.fin_import_ar_apply(text, integer) to service_role;