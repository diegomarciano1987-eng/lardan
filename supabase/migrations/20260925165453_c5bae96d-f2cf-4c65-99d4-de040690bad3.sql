CREATE OR REPLACE FUNCTION public.painel_visao_geral()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  select jsonb_build_object(
    'fluxo', (select coalesce(jsonb_agg(x order by x->>'mes'),'[]') from (
       select jsonb_build_object('mes', to_char(m,'YYYY-MM'),
         'entradas', coalesce((select sum(valor_cents) from financial_settlements s where s.direction='receivable' and not s.is_reversal and s.reversed_of is null and date_trunc('month',s.data)=m),0),
         'saidas', coalesce((select sum(valor_cents) from financial_settlements s where s.direction='payable' and not s.is_reversal and s.reversed_of is null and date_trunc('month',s.data)=m),0)) x
       from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m) q),
    'agenda', (select coalesce(jsonb_agg(x order by x->>'mes'),'[]') from (
       select jsonb_build_object('mes', to_char(m,'YYYY-MM'),
         'receber', coalesce((select sum(i.valor_cents) from financial_installments i join financial_titles t on t.id=i.title_id where t.direction='receivable' and t.status='ativo' and i.settlement_status<>'liquidado' and date_trunc('month',i.vencimento)=m),0),
         'pagar', coalesce((select sum(i.valor_cents) from financial_installments i join financial_titles t on t.id=i.title_id where t.direction='payable' and t.status='ativo' and i.settlement_status<>'liquidado' and date_trunc('month',i.vencimento)=m),0)) x
       from generate_series(date_trunc('month', current_date), date_trunc('month', current_date) + interval '5 months', interval '1 month') m) q),
    'despesas_categoria', (select coalesce(jsonb_agg(x),'[]') from (
       select jsonb_build_object('nome', coalesce(c.nome,'Sem categoria'), 'valor', sum(t.valor_cents)) x
       from financial_titles t left join chart_of_accounts c on c.id=t.chart_account_id
       where t.direction='payable' and t.status='ativo' and t.competencia >= date_trunc('year', current_date)
       group by c.nome order by sum(t.valor_cents) desc limit 7) q),
    'estoque', jsonb_build_object(
       'unidades', (select coalesce(sum(quantity),0) from stock_balances),
       'skus_com_saldo', (select count(distinct variant_id) from stock_balances where quantity>0),
       'produtos', (select count(*) from products),
       'publicados', (select count(*) from products where status::text in ('publicado','ativo')),
       'movimentos_30d', (select count(*) from stock_movements where created_at > now() - interval '30 days')),
    'maletas', (select coalesce(jsonb_object_agg(status, n),'{}') from (select status::text, count(*) n from kit_cycles group by 1) q),
    'asaas', jsonb_build_object(
       'dias', (select coalesce(jsonb_agg(x order by x->>'dia'),'[]') from (
          select jsonb_build_object('dia', to_char(d,'YYYY-MM-DD'),
            'entradas', coalesce(sum(abs(l.valor_cents)) filter (where l.kind='entrada'),0),
            'saidas', coalesce(sum(abs(l.valor_cents)) filter (where l.kind='saida'),0)) x
          from generate_series(current_date - 29, current_date, interval '1 day') d
          left join financial_statement_lines l on l.data = d::date and l.financial_account_id in (select id from financial_accounts where nome ilike '%asaas%')
          group by d) q),
       'cobrancas', (select coalesce(jsonb_object_agg(st, jsonb_build_object('n', n, 'valor', v)),'{}') from (
          select payload->>'status' st, count(*) n, sum((payload->>'valueCents')::bigint) v from asaas_import_stage where tipo='cobranca' group by 1) q)),
    'rede', (select jsonb_build_object('total', count(*), 'ativas', count(*) filter (where status='ativo')) from v_network_consultants)
  );
$$;
GRANT EXECUTE ON FUNCTION public.painel_visao_geral() TO authenticated;

CREATE OR REPLACE FUNCTION public.network_geo_municipio_consultoras(_ibge text, _filtros jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(party_id uuid, nome text, codigo text, status text, lat numeric, lng numeric, precisao text, bairro text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare s jsonb; escopo uuid;
begin
  s := public.network_scope();
  if s->>'modo' = 'agregado' or s->>'modo' is null then return; end if;
  escopo := case when s->>'modo' in ('representante','proprio') then (s->>'party_id')::uuid end;
  return query
  select c.party_id, c.display_name, c.code, c.status::text, c.latitude::numeric, c.longitude::numeric, c.geo_precision,
    (select a.district from party_addresses a where a.party_id=c.party_id order by a.is_primary desc nulls last limit 1)
  from v_network_consultants c
  where c.ibge_city_code = _ibge
    and (escopo is null or c.representative_party_id = escopo)
    and (coalesce(_filtros->>'situacao','todas')='todas'
      or (_filtros->>'situacao'='ativa' and c.status='ativo')
      or (_filtros->>'situacao'='inativa' and c.status<>'ativo'))
  order by c.display_name
  limit 5000;
end $$;
REVOKE ALL ON FUNCTION public.network_geo_municipio_consultoras(text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.network_geo_municipio_consultoras(text, jsonb) TO authenticated;