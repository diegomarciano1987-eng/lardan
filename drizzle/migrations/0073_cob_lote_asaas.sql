
CREATE OR REPLACE FUNCTION public.cob_lote_candidatos()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN jsonb_build_object(
    'acordos', coalesce((SELECT jsonb_agg(x ORDER BY x->>'nome') FROM (
      SELECT jsonb_build_object('id',s.id,'party_id',s.party_id,'nome',pt.display_name,'total_cents',s.total_cents,'entrada_cents',s.entrada_cents,
        'parcelas',jsonb_array_length(s.plano),'status',s.status,'criado',s.created_at,
        'ja_enviadas',(SELECT count(*) FROM asaas_charge_intents i WHERE i.acordo_simulacao_id=s.id AND i.state IN ('criada','preparada','processando','desconhecida','conciliacao','aguardando_retentativa'))) x
      FROM cob_simulacoes s JOIN parties pt ON pt.id=s.party_id
      WHERE s.status IN ('simulada','aguardando_entrada','efetivada') AND jsonb_array_length(s.plano)>0) q),'[]'),
    'parcelas', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id',p.installment_id,'party_id',p.party_id,'nome',pt.display_name,'saldo_cents',p.saldo_cents,'vencimento',p.vencimento,
        'etapa',coalesce(cc.etapa,'novo_atraso'),'em_acordo',EXISTS(SELECT 1 FROM cob_simulacoes s WHERE s.status IN ('simulada','aguardando_entrada','efetivada') AND p.installment_id=ANY(s.installment_ids))) x
      FROM public.cob_parcelas_abertas() p JOIN parties pt ON pt.id=p.party_id LEFT JOIN cob_casos cc ON cc.party_id=p.party_id
      WHERE p.saldo_cents>0
        AND NOT EXISTS (SELECT 1 FROM asaas_charges c WHERE c.installment_id=p.installment_id AND c.external_status IN ('PENDING','OVERDUE','AWAITING_RISK_ANALYSIS'))
        AND NOT EXISTS (SELECT 1 FROM asaas_charge_intents i WHERE i.installment_id=p.installment_id AND i.acordo_simulacao_id IS NULL AND i.state IN ('preparada','processando','aguardando_retentativa','desconhecida','conciliacao'))
      ORDER BY p.vencimento LIMIT 3000) q),'[]'));
END $$;
REVOKE ALL ON FUNCTION public.cob_lote_candidatos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_lote_candidatos() TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_lote_registrar(_forma text, _resultado jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  INSERT INTO audit_logs(actor_id,action,entity,payload) VALUES(auth.uid(),'cob.lote_asaas','asaas_charge_intents',
    jsonb_build_object('forma',_forma,'itens',jsonb_array_length(_resultado),'ok',(SELECT count(*) FROM jsonb_array_elements(_resultado) e WHERE (e->>'ok')::boolean),'resultado',_resultado));
END $$;
REVOKE ALL ON FUNCTION public.cob_lote_registrar(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_lote_registrar(text,jsonb) TO authenticated;
