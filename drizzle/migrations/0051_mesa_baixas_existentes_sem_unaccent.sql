create or replace function public.fin_mesa_baixas_existentes(_line_id uuid, _busca text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l financial_statement_lines%rowtype; v_dir fin_direction; v_res jsonb;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  select * into l from financial_statement_lines where id = _line_id;
  if l.id is null then raise exception 'Linha não encontrada'; end if;
  v_dir := case when l.kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;
  with base as (
    select s.id, s.data, s.valor_cents,
      abs(coalesce((select sum(m.valor_cents) from financial_account_movements m where m.settlement_id = s.id),0)) liquido,
      (select string_agg(distinct coalesce(t.numero,'') || ' ' || coalesce(t.descricao,'') || coalesce(' · ' || p.display_name,''), ' | ')
         from financial_allocations a join financial_installments i on i.id = a.installment_id
         join financial_titles t on t.id = i.title_id left join parties p on p.id = t.party_id
        where a.settlement_id = s.id) titulos
    from financial_settlements s
    where s.financial_account_id = l.financial_account_id and s.direction = v_dir
      and not s.is_reversal
      and s.data between l.data - 60 and l.data + 60
      and not exists (select 1 from financial_settlements r where r.reversed_of = s.id)
      and not exists (select 1 from financial_reconciliations rc where rc.settlement_id = s.id and not rc.is_reversal
                        and not exists (select 1 from financial_reconciliations rr where rr.reversed_of = rc.id))
  )
  select coalesce(jsonb_agg(to_jsonb(b) order by abs(b.liquido - (l.valor_cents - l.conciliado_cents)), abs(b.data - l.data)), '[]'::jsonb)
    into v_res
  from (select * from base
         where _busca is null or btrim(_busca) = '' or coalesce(titulos,'') ilike '%' || btrim(_busca) || '%'
         order by abs(liquido - (l.valor_cents - l.conciliado_cents)), abs(data - l.data) limit 30) b;
  return v_res;
end $$;