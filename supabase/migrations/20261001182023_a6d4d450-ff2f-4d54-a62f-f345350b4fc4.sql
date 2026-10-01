CREATE OR REPLACE FUNCTION public.fin_installment_competencia_set(_installment uuid, _competencia date, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_i financial_installments; v_t financial_titles; v_cap text;
begin
  -- permissão conferida antes de qualquer leitura: quem não tem acesso financeiro não descobre se a parcela existe
  if auth.uid() is not null and not (has_capability(auth.uid(),'finance.payable.manage') or has_capability(auth.uid(),'finance.receivable.manage')) then
    raise exception 'Sem permissão'; end if;
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
end $function$;
REVOKE EXECUTE ON FUNCTION public.fin_installment_competencia_set(uuid,date,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fin_installments_list(text,date,date,text,text,integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fin_transfers_list(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_installment_competencia_set(uuid,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fin_installments_list(text,date,date,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fin_transfers_list(date,date) TO authenticated;