create or replace function public.fin_settlement_create_ajustes(_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_set jsonb; v_alvo uuid;
  v_tarifa bigint := greatest(coalesce((_payload->>'tarifa_cents')::bigint,0),0);
  v_juros bigint := greatest(coalesce((_payload->>'juros_cents')::bigint,0),0);
  v_desc bigint := greatest(coalesce((_payload->>'desconto_cents')::bigint,0),0);
begin
  v_set := fin_settlement_create(_payload - 'tarifa_cents' - 'juros_cents' - 'desconto_cents');
  if coalesce((v_set->>'repetido')::boolean,false) or v_tarifa + v_juros + v_desc = 0 then return v_set; end if;
  select (x->>'installment_id')::uuid into v_alvo from jsonb_array_elements(coalesce(_payload->'alocacoes','[]'::jsonb)) x limit 1;
  if v_alvo is null then return v_set; end if;
  if v_tarifa > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
    values (v_alvo, (v_set->>'id')::uuid, 'tarifa', v_tarifa, 'Tarifa informada na baixa manual', auth.uid()); end if;
  if v_juros > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
    values (v_alvo, (v_set->>'id')::uuid, 'juros', v_juros, 'Juros informados na baixa manual', auth.uid()); end if;
  if v_desc > 0 then insert into financial_adjustments (installment_id, settlement_id, kind, valor_cents, motivo, created_by)
    values (v_alvo, (v_set->>'id')::uuid, 'desconto', v_desc, 'Desconto informado na baixa manual', auth.uid()); end if;
  perform fin_installment_refresh(v_alvo);
  return v_set;
end $$;
revoke all on function public.fin_settlement_create_ajustes(jsonb) from public, anon;
grant execute on function public.fin_settlement_create_ajustes(jsonb) to authenticated, service_role;