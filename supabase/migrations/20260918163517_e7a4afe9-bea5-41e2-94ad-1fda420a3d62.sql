create or replace function public.fin_import_ap_slug(_t text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(lower(coalesce(_t,'')), '[^a-z0-9]+', '_', 'g')
$$;

create or replace function public.fin_import_ap_refs(_lote text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_party uuid; v_cod text; v_nome text; v_nat fin_account_nature; v_kind fin_account_kind;
begin
  -- Fornecedores (contrapartes)
  for r in
    select distinct coalesce(nullif(btrim(fornecedor),''), 'Não identificado') as nome
    from financial_import_ap_stage where lote = _lote
  loop
    select id into v_party from parties
     where upper(btrim(coalesce(display_name, legal_name, ''))) = upper(r.nome) limit 1;
    if v_party is null then
      insert into parties (kind, display_name, legal_name, notes)
      values ('organizacao', r.nome, r.nome, 'Criado pela importação de contas a pagar')
      returning id into v_party;
    end if;
    if not exists (select 1 from party_roles where party_id = v_party and role = 'fornecedor') then
      insert into party_roles (party_id, role) values (v_party, 'fornecedor');
    end if;
  end loop;

  -- Formas de pagamento
  for r in
    select distinct btrim(forma) as nome from financial_import_ap_stage
     where lote = _lote and nullif(btrim(forma),'') is not null
  loop
    if not exists (select 1 from payment_methods where upper(btrim(nome)) = upper(r.nome)) then
      insert into payment_methods (codigo, nome) values (fin_import_ap_slug(r.nome), r.nome);
    end if;
  end loop;

  -- Contas bancárias e caixas
  for r in
    select distinct coalesce(nullif(btrim(conta),''), 'Conta não informada') as nome
    from financial_import_ap_stage where lote = _lote
  loop
    if not exists (select 1 from financial_accounts where upper(btrim(nome)) = upper(r.nome)) then
      v_kind := case
        when upper(r.nome) like '%DINHEIRO%' then 'caixa'
        when upper(r.nome) like '%CHEQUE%' then 'compensacao'
        when upper(r.nome) = 'CONTA NÃO INFORMADA' then 'compensacao'
        when upper(r.nome) like '%ASAAS%' or upper(r.nome) like '%EFI%' or upper(r.nome) like '%REDE%'
          or upper(r.nome) like '%INFINITY%' or upper(r.nome) like '%CORA%' or upper(r.nome) like '%CONTA AZUL%'
          or upper(r.nome) like '%COMISS%' then 'provedor'
        when upper(r.nome) like '%CART%' then 'compensacao'
        when upper(r.nome) like '%APLICA%' then 'investimento'
        else 'conta_corrente' end::fin_account_kind;
      insert into financial_accounts (nome, kind, banco, notes)
      values (r.nome, v_kind, nullif(split_part(r.nome, ' - ', 1), r.nome),
              'Criada pela importação de contas a pagar');
    end if;
  end loop;

  -- Categorias (plano de contas)
  for r in
    select distinct btrim(categoria) as cat from financial_import_ap_stage
     where lote = _lote and nullif(btrim(categoria),'') is not null
  loop
    v_cod := substring(r.cat from '^[0-9][0-9\.]*');
    if v_cod is null then
      v_cod := fin_import_ap_slug(r.cat);
      v_nome := r.cat;
    else
      v_cod := rtrim(v_cod, '.');
      v_nome := btrim(substring(r.cat from length(v_cod) + 1));
      if v_nome = '' then v_nome := r.cat; end if;
    end if;
    v_nat := case
      when left(v_cod,1) = '4' then 'custo'
      when left(v_cod,1) = '5' then 'despesa'
      when left(v_cod,1) = '6' then 'passivo'
      when left(v_cod,1) = '7' and r.cat ilike '%juros%' then 'despesa'
      when left(v_cod,1) = '7' then 'passivo'
      else 'despesa' end::fin_account_nature;
    if not exists (select 1 from chart_of_accounts where codigo = v_cod) then
      insert into chart_of_accounts (codigo, nome, natureza, aceita_lancamento)
      values (v_cod, v_nome, v_nat, true);
    end if;
  end loop;

  -- Centros de custo
  for r in
    select distinct btrim(centro) as nome from financial_import_ap_stage
     where lote = _lote and nullif(btrim(centro),'') is not null
  loop
    if not exists (select 1 from cost_centers where upper(btrim(nome)) = upper(r.nome)) then
      insert into cost_centers (codigo, nome) values (fin_import_ap_slug(r.nome), r.nome);
    end if;
  end loop;
end $$;

create or replace function public.fin_import_ap_apply(_lote text, _limite integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record; l record;
  v_title uuid; v_party uuid; v_total bigint; v_n int; v_distintos int; v_qtd int;
  v_chart uuid; v_cc uuid; v_pm uuid; v_conta uuid; v_inst uuid; v_set uuid;
  v_grupos int := 0; v_titulos int := 0; v_baixas int := 0; v_ext text; v_num int;
begin
  perform fin_import_ap_refs(_lote);

  for g in
    select grupo, min(linha) as ordem
      from financial_import_ap_stage
     where lote = _lote and processed_at is null
     group by grupo order by min(linha)
     limit _limite
  loop
    v_grupos := v_grupos + 1;
    v_ext := _lote || ':' || g.grupo;

    select id into v_title from financial_titles
     where origem = 'importacao' and sistema_origem = 'planilha_contas_a_pagar' and id_externo = v_ext;

    if v_title is null then
      select s.* into l from financial_import_ap_stage s
       where s.lote = _lote and s.grupo = g.grupo order by s.parcela_num, s.linha limit 1;

      select id into v_party from parties
       where upper(btrim(coalesce(display_name, legal_name, ''))) =
             upper(coalesce(nullif(btrim(l.fornecedor),''), 'Não identificado')) limit 1;

      select sum(valor_cents), count(*), count(distinct parcela_num), max(parcela_total)
        into v_total, v_qtd, v_distintos, v_n
        from financial_import_ap_stage where lote = _lote and grupo = g.grupo;

      select id into v_chart from chart_of_accounts
       where codigo = coalesce(rtrim(substring(btrim(l.categoria) from '^[0-9][0-9\.]*'), '.'),
                               fin_import_ap_slug(l.categoria));
      select id into v_cc from cost_centers where upper(btrim(nome)) = upper(btrim(coalesce(l.centro,'')));
      select id into v_pm from payment_methods where upper(btrim(nome)) = upper(btrim(coalesce(l.forma,'')));
      select id into v_conta from financial_accounts
       where upper(btrim(nome)) = upper(coalesce(nullif(btrim(l.conta),''), 'Conta não informada'));

      insert into financial_titles (direction, party_id, descricao, emissao, competencia, valor_cents,
        chart_account_id, cost_center_id, payment_method_id, financial_account_id,
        origem, sistema_origem, id_externo, status, observacao)
      select 'payable', v_party, l.descricao,
             coalesce(min(s.competencia), min(s.vencimento)), min(s.competencia),
             v_total, v_chart, v_cc, v_pm, v_conta,
             'importacao', 'planilha_contas_a_pagar', v_ext, 'ativo',
             case when bool_or(s.recorrente) then 'Importado da planilha de contas a pagar (série recorrente)'
                  else 'Importado da planilha de contas a pagar' end
        from financial_import_ap_stage s where s.lote = _lote and s.grupo = g.grupo
      returning id into v_title;

      v_titulos := v_titulos + 1;

      insert into financial_title_events (title_id, evento, payload)
      values (v_title, 'criado', jsonb_build_object('valor_cents', v_total, 'origem', 'importacao', 'lote', _lote));

      v_num := 0;
      for l in
        select * from financial_import_ap_stage
         where lote = _lote and grupo = g.grupo order by parcela_num, linha
      loop
        v_num := v_num + 1;
        insert into financial_installments (title_id, numero, total_parcelas, vencimento, valor_cents)
        values (v_title,
                case when v_distintos = v_qtd then l.parcela_num else v_num end,
                greatest(coalesce(v_n, 1), v_qtd), l.vencimento, l.valor_cents)
        returning id into v_inst;

        update financial_import_ap_stage set title_id = v_title, installment_id = v_inst where id = l.id;

        if coalesce(l.pago_cents, 0) > 0 then
          select id into v_conta from financial_accounts
           where upper(btrim(nome)) = upper(coalesce(nullif(btrim(l.conta),''), 'Conta não informada'));
          select id into v_pm from payment_methods where upper(btrim(nome)) = upper(btrim(coalesce(l.forma,'')));

          insert into financial_settlements (direction, financial_account_id, data, valor_cents,
            payment_method_id, referencia, observacao, idempotency_key)
          values ('payable', v_conta, l.vencimento, l.pago_cents, v_pm,
                  'Importação ' || _lote || ' linha ' || l.linha,
                  'Pagamento importado da planilha de contas a pagar',
                  'impap:' || _lote || ':' || l.linha)
          returning id into v_set;

          insert into financial_allocations (settlement_id, installment_id, valor_cents)
          values (v_set, v_inst, least(l.pago_cents, l.valor_cents));

          insert into financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao)
          values (v_conta, 'saida', l.vencimento, -l.pago_cents, v_set,
                  'Pagamento importado — ' || l.descricao);

          perform fin_installment_refresh(v_inst);

          insert into financial_title_events (title_id, evento, payload)
          values (v_title, 'pagamento',
                  jsonb_build_object('settlement_id', v_set, 'valor_cents', l.pago_cents, 'origem', 'importacao'));

          v_baixas := v_baixas + 1;
        end if;
      end loop;
    end if;

    update financial_import_ap_stage
       set processed_at = now(), title_id = coalesce(title_id, v_title)
     where lote = _lote and grupo = g.grupo and processed_at is null;
  end loop;

  return jsonb_build_object(
    'grupos', v_grupos, 'titulos', v_titulos, 'baixas', v_baixas,
    'pendentes', (select count(*) from financial_import_ap_stage where lote = _lote and processed_at is null));
end $$;

revoke all on function public.fin_import_ap_slug(text) from public, anon, authenticated;
revoke all on function public.fin_import_ap_refs(text) from public, anon, authenticated;
revoke all on function public.fin_import_ap_apply(text, integer) from public, anon, authenticated;
grant execute on function public.fin_import_ap_slug(text) to service_role;
grant execute on function public.fin_import_ap_refs(text) to service_role;
grant execute on function public.fin_import_ap_apply(text, integer) to service_role;