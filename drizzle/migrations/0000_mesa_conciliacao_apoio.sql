-- Apoio à mesa de conciliação: chave do histórico, palpite aprendido, contrapartes com papel e centros com responsável.
create or replace function public.fin_historico_chave(_h text)
returns text language sql immutable set search_path = public as $$
  select nullif(array_to_string((regexp_split_to_array(trim(regexp_replace(regexp_replace(lower(coalesce(_h,'')), '[0-9]+', ' ', 'g'), '[^a-zà-ú ]+', ' ', 'g')), '\s+'))[1:4], ' '), '')
$$;

create or replace function public.fin_mesa_palpite(_line uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_chave text; v_kind text; v_acc uuid; v_res jsonb;
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  select fin_historico_chave(historico), kind, financial_account_id into v_chave, v_kind, v_acc
    from financial_statement_lines where id = _line;
  if v_chave is null then return jsonb_build_object('chave', null, 'vezes', 0); end if;
  with base as (
    select t.party_id, t.cost_center_id, t.chart_account_id, t.payment_method_id
      from financial_statement_lines l
      join financial_reconciliation_allocations a on a.line_id = l.id
      join financial_reconciliations r on r.id = a.reconciliation_id and r.status = 'ativa'
      join financial_installments i on i.id = a.installment_id
      join financial_titles t on t.id = i.title_id
     where l.kind = v_kind and l.id <> _line and fin_historico_chave(l.historico) = v_chave
  ), moda as (
    select
      (select party_id from base where party_id is not null group by 1 order by count(*) desc limit 1) party_id,
      (select cost_center_id from base where cost_center_id is not null group by 1 order by count(*) desc limit 1) cost_center_id,
      (select chart_account_id from base where chart_account_id is not null group by 1 order by count(*) desc limit 1) chart_account_id,
      (select payment_method_id from base where payment_method_id is not null group by 1 order by count(*) desc limit 1) payment_method_id,
      (select count(*) from base) vezes
  )
  select jsonb_build_object('chave', v_chave, 'vezes', m.vezes,
      'party_id', m.party_id, 'party_nome', coalesce(p.display_name, p.legal_name),
      'cost_center_id', m.cost_center_id, 'chart_account_id', m.chart_account_id,
      'payment_method_id', m.payment_method_id)
    into v_res from moda m left join parties p on p.id = m.party_id;
  return v_res;
end $$;

create or replace function public.fin_mesa_contrapartes(_busca text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(x) from (
    select p.id, coalesce(p.display_name, p.legal_name, p.code) nome, p.code,
      coalesce((select array_agg(distinct r.role::text) from party_roles r where r.party_id = p.id and r.ended_at is null), '{}') papeis
      from parties p
     where p.is_active and (_busca is null or _busca = ''
        or coalesce(p.display_name,'') ilike '%'||_busca||'%' or coalesce(p.legal_name,'') ilike '%'||_busca||'%'
        or p.code ilike '%'||_busca||'%')
     order by coalesce(p.display_name, p.legal_name, p.code) limit 25) x), '[]'::jsonb);
end $$;

create or replace function public.fin_mesa_centros()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(x order by x.codigo) from (
    select c.id, c.codigo, c.nome, c.responsavel_party_id,
      coalesce(p.display_name, p.legal_name) responsavel_nome,
      coalesce((select array_agg(distinct r.role::text) from party_roles r where r.party_id = p.id and r.ended_at is null), '{}') papeis
      from cost_centers c left join parties p on p.id = c.responsavel_party_id
     where c.is_active) x), '[]'::jsonb);
end $$;

revoke all on function public.fin_mesa_palpite(uuid), public.fin_mesa_contrapartes(text), public.fin_mesa_centros() from public, anon;
grant execute on function public.fin_mesa_palpite(uuid), public.fin_mesa_contrapartes(text), public.fin_mesa_centros() to authenticated;