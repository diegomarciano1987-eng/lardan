-- Lote de microtarifas usa a conta configurada para notificações (asaas_auto_config.notificacao_chart_id), com 4.1.3 como reserva.
DO $$
declare v_def text;
begin
  select pg_get_functiondef('public.fin_microtarifas_conciliar(uuid,date)'::regprocedure) into v_def;
  v_def := replace(v_def,
    $r$select id into v_plano from chart_of_accounts where codigo = '5.1.1' and is_active limit 1;$r$,
    $r$select c.id into v_plano from asaas_auto_config a join chart_of_accounts c on c.id = a.notificacao_chart_id and c.is_active where a.notificacao_chart_id is not null limit 1;
  if v_plano is null then select id into v_plano from chart_of_accounts where codigo = '4.1.3' and is_active limit 1; end if;$r$);
  if position('5.1.1' in v_def) > 0 then raise exception 'substituição não aplicada'; end if;
  execute v_def;
end $$;