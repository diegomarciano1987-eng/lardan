CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Vínculo Asaas -> parcela de fiado: só casamento exato e único dos dois lados (pessoa + valor + vencimento)
CREATE OR REPLACE FUNCTION public.cob_vincular_asaas_fiado(_actor uuid, _desde date DEFAULT '2026-01-01')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; vinc int := 0; baixas jsonb := '[]'::jsonb; amb int; res jsonb;
BEGIN
  FOR r IN
    with ch as (select c.id, c.party_id, c.value_cents, c.due_date, c.external_status from asaas_charges c
      where c.due_date >= _desde and c.title_id is null and c.party_id is not null and c.external_status <> 'DELETED'),
    fi as (select i.id inst, i.title_id, t.party_id, i.valor_cents, i.vencimento from financial_installments i
      join financial_titles t on t.id=i.title_id
      where t.sistema_origem='fiado_historico' and t.status<>'cancelado'
        and not exists(select 1 from asaas_charges x where x.installment_id=i.id)),
    m as (select ch.*, fi.inst, fi.title_id from ch join fi on fi.party_id=ch.party_id and fi.valor_cents=ch.value_cents and fi.vencimento=ch.due_date)
    select * from m where (select count(*) from m m2 where m2.id=m.id)=1 and (select count(*) from m m3 where m3.inst=m.inst)=1
  LOOP
    PERFORM public.asaas_vincular_interno(r.id, r.title_id, r.inst,
      'Vínculo fiado histórico: mesma pessoa, valor e vencimento (casamento único)', _actor);
    vinc := vinc + 1;
    IF r.external_status IN ('RECEIVED','CONFIRMED') THEN
      res := public.asaas_baixa_automatica(r.id);
      baixas := baixas || jsonb_build_object('charge', r.id, 'resultado', res);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('vinculadas', vinc, 'baixas', baixas);
END $$;
REVOKE ALL ON FUNCTION public.cob_vincular_asaas_fiado(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cob_vincular_asaas_fiado(uuid, date) TO service_role;

-- Indicadores da cobrança calculados no banco (sem depender de baixar a lista)
CREATE OR REPLACE FUNCTION public.cob_kpis()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  select jsonb_build_object(
    'devedoras', count(*), 'vencido_cents', coalesce(sum(vencido_cents),0),
    'hoje', count(*) filter (where proxima_acao = hoje),
    'atrasadas', count(*) filter (where proxima_acao < hoje),
    'vencendo', count(*) filter (where promessa_status='vigente' and promessa_data <= hoje + 2),
    'descumpridas', count(*) filter (where promessa_status='descumprida'))
  into r from public.cob_carteira2();
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.cob_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_kpis() TO authenticated, service_role;

-- Régua de cobrança roda todo dia às 06:00 de Brasília (09:00 UTC)
DO $$ BEGIN
  PERFORM cron.unschedule('cob-regua-diaria') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cob-regua-diaria');
  PERFORM cron.schedule('cob-regua-diaria', '0 9 * * *', 'select public.cob_regua_executar()');
END $$;