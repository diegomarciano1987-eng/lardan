ALTER TABLE public.cob_casos ADD COLUMN IF NOT EXISTS prorrogacao_em timestamptz, ADD COLUMN IF NOT EXISTS prorrogacao_motivo text, ADD COLUMN IF NOT EXISTS prorrogacao_por uuid;

CREATE OR REPLACE FUNCTION public.cob_acordos_situacao()
RETURNS TABLE(party_id uuid, simulacao_id uuid, total_cents bigint, pago_cents bigint, dias_atraso int, prorrogado boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN QUERY
  SELECT s.party_id, s.id, s.total_cents::bigint,
    coalesce(sum(c.received_cents) FILTER (WHERE c.external_status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')),0)::bigint,
    coalesce(max(hoje - c.due_date) FILTER (WHERE c.due_date < hoje AND c.external_status IN ('PENDING','OVERDUE','DUNNING_REQUESTED')),0)::int,
    (cc.prorrogacao_em IS NOT NULL)
  FROM cob_simulacoes s
  LEFT JOIN asaas_charge_intents i ON i.acordo_simulacao_id = s.id
  LEFT JOIN asaas_charges c ON c.id = i.charge_id
  LEFT JOIN cob_casos cc ON cc.party_id = s.party_id
  WHERE s.status IN ('efetivada','aguardando_entrada')
  GROUP BY s.party_id, s.id, s.total_cents, cc.prorrogacao_em;
END $$;
REVOKE ALL ON FUNCTION public.cob_acordos_situacao() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_acordos_situacao() TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_kpis_periodo(_de date, _ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb; a jsonb;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF _de IS NULL OR _ate IS NULL OR _ate < _de THEN RAISE EXCEPTION 'Período inválido'; END IF;
  SELECT jsonb_build_object('devedoras', count(*), 'vencido_cents', coalesce(sum(vencido_cents),0),
    'hoje', count(*) FILTER (WHERE proxima_acao = hoje), 'atrasadas', count(*) FILTER (WHERE proxima_acao < hoje))
  INTO r FROM public.cob_carteira2();
  SELECT jsonb_build_object(
    'acordos_gerados', (SELECT count(*) FROM cob_simulacoes WHERE status IN ('efetivada','aguardando_entrada') AND (created_at at time zone 'America/Sao_Paulo')::date BETWEEN _de AND _ate),
    'acordos_atrasados', (SELECT count(*) FROM public.cob_acordos_situacao() x WHERE x.dias_atraso > 0),
    'saldo_acordo_cents', (SELECT coalesce(sum(greatest(x.total_cents - x.pago_cents,0)),0) FROM public.cob_acordos_situacao() x),
    'previsto_cents', (SELECT coalesce(sum(c.value_cents),0) FROM cob_simulacoes s JOIN asaas_charge_intents i ON i.acordo_simulacao_id=s.id JOIN asaas_charges c ON c.id=i.charge_id
       WHERE s.status IN ('efetivada','aguardando_entrada') AND c.external_status <> 'DELETED' AND c.due_date BETWEEN _de AND _ate),
    'realizado_cents', (SELECT coalesce(sum(c.received_cents),0) FROM asaas_charge_intents i JOIN asaas_charges c ON c.id=i.charge_id
       WHERE i.acordo_simulacao_id IS NOT NULL AND c.external_status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH') AND coalesce(c.payment_date,c.confirmed_date) BETWEEN _de AND _ate))
  INTO a;
  RETURN r || a;
END $$;
REVOKE ALL ON FUNCTION public.cob_kpis_periodo(date,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_kpis_periodo(date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_acordo_prorrogar(_party uuid, _motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF nullif(trim(_motivo),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo e a nova data combinada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cob_simulacoes WHERE party_id=_party AND status IN ('efetivada','aguardando_entrada')) THEN RAISE EXCEPTION 'Sem acordo ativo'; END IF;
  IF EXISTS (SELECT 1 FROM cob_casos WHERE party_id=_party AND prorrogacao_em IS NOT NULL) THEN RAISE EXCEPTION 'A única prorrogação deste acordo já foi usada'; END IF;
  INSERT INTO cob_casos(party_id,etapa,updated_by,prorrogacao_em,prorrogacao_motivo,prorrogacao_por) VALUES(_party,'em_negociacao',auth.uid(),now(),left(_motivo,500),auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET prorrogacao_em=now(), prorrogacao_motivo=left(_motivo,500), prorrogacao_por=auth.uid(), updated_at=now(), updated_by=auth.uid();
  INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id) VALUES(_party,'anotacao','Prorrogação única do acordo: '||left(_motivo,500),auth.uid());
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,diff) VALUES(auth.uid(),'cob_acordo_prorrogar','cob_casos',_party,jsonb_build_object('motivo',_motivo));
END $$;
REVOKE ALL ON FUNCTION public.cob_acordo_prorrogar(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_acordo_prorrogar(uuid,text) TO authenticated;