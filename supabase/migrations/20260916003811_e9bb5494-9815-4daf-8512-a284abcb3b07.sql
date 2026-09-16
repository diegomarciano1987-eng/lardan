create or replace function public.fin_statement_suggest(_line uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l financial_statement_lines%rowtype; v_dir fin_direction; v_res jsonb;
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  select * into l from financial_statement_lines where id = _line;
  if l.id is null then raise exception 'Linha não encontrada'; end if;
  v_dir := case when l.kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;
  delete from financial_match_suggestions where line_id = _line;

  insert into financial_match_suggestions (line_id, installment_id, score, reasons)
  select _line, c.id, c.score, c.reasons from (
    select i.id,
      (case when i.valor_cents - i.pago = l.valor_cents then 50
            when i.valor_cents = l.valor_cents then 30 else 0 end)
      + (case when abs(i.vencimento - l.data) = 0 then 20
              when abs(i.vencimento - l.data) <= 3 then 12
              when abs(i.vencimento - l.data) <= 7 then 6
              when abs(i.vencimento - l.data) <= 15 then 2 else 0 end)
      + (case when coalesce(t.documento,'') <> '' and coalesce(l.documento,'') <> ''
               and upper(t.documento) = upper(l.documento) then 25 else 0 end)
      + (case when p.display_name is not null and coalesce(l.historico,'') <> ''
               and fin_unaccent_lower(l.historico) like '%' || fin_unaccent_lower(split_part(p.display_name,' ',1)) || '%' then 20 else 0 end)
      as score,
      jsonb_build_object('valor_exato', i.valor_cents - i.pago = l.valor_cents,
                         'dias', abs(i.vencimento - l.data),
                         'documento', coalesce(t.documento,''),
                         'contraparte', coalesce(p.display_name,'')) as reasons
    from (
      select i.*, coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id = i.id),0) as pago
      from financial_installments i) i
    join financial_titles t on t.id = i.title_id
    left join parties p on p.id = t.party_id
    where t.direction = v_dir and t.status in ('ativo','aprovado','submetido')
      and i.settlement_status in ('nao_liquidado','parcial')
      and i.valor_cents - i.pago > 0
  ) c
  where c.score >= 20
  order by c.score desc limit 10;

  select coalesce(jsonb_agg(jsonb_build_object('installment_id', s.installment_id, 'score', s.score,
           'reasons', s.reasons, 'vencimento', i.vencimento, 'valor_cents', i.valor_cents,
           'aberto_cents', i.valor_cents - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id=i.id),0),
           'titulo', t.descricao, 'contraparte', p.display_name) order by s.score desc), '[]'::jsonb)
    into v_res
  from financial_match_suggestions s
  join financial_installments i on i.id = s.installment_id
  join financial_titles t on t.id = i.title_id
  left join parties p on p.id = t.party_id
  where s.line_id = _line;
  return v_res;
end $$;