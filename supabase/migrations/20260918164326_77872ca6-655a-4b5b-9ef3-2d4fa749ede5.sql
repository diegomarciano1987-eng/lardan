CREATE OR REPLACE FUNCTION public.fin_titles_list(_direction text, _search text DEFAULT NULL::text, _status text DEFAULT NULL::text, _situacao text DEFAULT NULL::text, _limit integer DEFAULT 50, _offset integer DEFAULT 0, _chart uuid DEFAULT NULL::uuid, _cc uuid DEFAULT NULL::uuid, _entidade uuid DEFAULT NULL::uuid, _sem_classificacao boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_dir fin_direction := _direction::fin_direction; v_cap text; v_rows jsonb; v_total bigint; v_soma bigint;
begin
  v_cap := case when v_dir='payable' then 'finance.payable.view' else 'finance.receivable.view' end;
  if not has_capability(auth.uid(), v_cap) then raise exception 'Sem permissão'; end if;

  with base as (
    select t.id, t.numero, t.descricao, t.documento, t.status, t.emissao, t.competencia, t.valor_cents,
           coalesce(p.display_name, p.legal_name, p.code) as contraparte,
           t.chart_account_id, t.cost_center_id, t.business_entity_id,
           case when ca.id is null then null else ca.codigo||' · '||ca.nome end as plano_label,
           case when cc.id is null then null else cc.codigo||' · '||cc.nome end as centro_label,
           coalesce(be.trade_name, be.legal_name) as entidade_label,
           (t.chart_account_id is null or t.cost_center_id is null) as pendente_classificacao,
           (select min(i.vencimento) from financial_installments i where i.title_id = t.id
              and i.settlement_status in ('nao_liquidado','parcial')) as proximo_vencimento,
           coalesce((select sum(a.valor_cents) from financial_allocations a
                     join financial_installments i on i.id = a.installment_id where i.title_id = t.id),0) as pago_cents,
           (select count(*) from financial_installments i where i.title_id = t.id) as parcelas
    from financial_titles t
    join parties p on p.id = t.party_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    left join cost_centers cc on cc.id = t.cost_center_id
    left join business_entities be on be.id = t.business_entity_id
    where t.direction = v_dir
      and (_status is null or t.status::text = _status)
      and (_chart is null or t.chart_account_id = _chart)
      and (_cc is null or t.cost_center_id = _cc)
      and (_entidade is null or t.business_entity_id = _entidade)
      and (not coalesce(_sem_classificacao,false)
           or t.chart_account_id is null or t.cost_center_id is null)
      and (_search is null or _search = '' or
           t.descricao ilike '%'||_search||'%' or coalesce(t.documento,'') ilike '%'||_search||'%'
           or coalesce(t.numero,'') ilike '%'||_search||'%'
           or coalesce(p.display_name,'') ilike '%'||_search||'%' or coalesce(p.legal_name,'') ilike '%'||_search||'%')
  ), filtrado as (
    select * from base
    where _situacao is null or _situacao = ''
       or (_situacao = 'aberto' and pago_cents < valor_cents and status <> 'cancelado')
       or (_situacao = 'vencido' and proximo_vencimento < current_date and status <> 'cancelado')
       or (_situacao = 'liquidado' and pago_cents >= valor_cents)
  )
  select coalesce(jsonb_agg(to_jsonb(f) order by f.proximo_vencimento nulls last, f.emissao desc), '[]'::jsonb),
         (select count(*) from filtrado), (select coalesce(sum(valor_cents),0) from filtrado)
    into v_rows, v_total, v_soma
  from (select * from filtrado order by proximo_vencimento nulls last, emissao desc
        limit greatest(_limit,1) offset greatest(_offset,0)) f;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'soma_cents', v_soma);
end $function$;