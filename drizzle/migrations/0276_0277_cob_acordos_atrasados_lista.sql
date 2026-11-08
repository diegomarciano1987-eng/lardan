-- 0277: lista nominal de quem está com acordo em atraso. Mesmo critério do indicador
-- "Acordos atrasados" (cob_acordos_situacao, dias_atraso > 0). Só leitura.
CREATE OR REPLACE FUNCTION public.cob_acordos_atrasados_lista()
RETURNS TABLE(party_id uuid, simulacao_id uuid, nome text, codigo text, documento text, judicial boolean, origem text,
  total_cents bigint, pago_cents bigint, dias_atraso int, parcelas_atrasadas int, atrasado_cents bigint,
  vencimento_mais_antigo date, fatura_url text, prorrogado boolean, prorrogacao_motivo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
#variable_conflict use_column
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN QUERY
  WITH sit AS (
    SELECT x.party_id AS pid, x.simulacao_id AS sid, x.total_cents AS tot, x.pago_cents AS pago, x.dias_atraso AS dias, x.prorrogado AS prorr
    FROM public.cob_acordos_situacao() x WHERE x.dias_atraso > 0
  ), venc AS (
    SELECT i.acordo_simulacao_id AS sid, count(*)::int AS n, coalesce(sum(c.value_cents),0)::bigint AS v, min(c.due_date) AS d,
      (array_agg(c.invoice_url ORDER BY c.due_date))[1]::text AS url
    FROM public.asaas_charge_intents i JOIN public.asaas_charges c ON c.id = i.charge_id
    WHERE i.acordo_simulacao_id IN (SELECT sit.sid FROM sit)
      AND c.due_date < hoje AND c.external_status IN ('PENDING','OVERDUE','DUNNING_REQUESTED')
    GROUP BY i.acordo_simulacao_id
  )
  SELECT s.pid, s.sid, p.display_name::text, p.code::text, p.doc_masked::text, (cs.judicial_acordo_id IS NOT NULL), cs.origem::text,
    s.tot, s.pago, s.dias, coalesce(v.n,0), coalesce(v.v,0)::bigint, v.d, v.url, s.prorr, cc.prorrogacao_motivo::text
  FROM sit s
  JOIN public.cob_simulacoes cs ON cs.id = s.sid
  LEFT JOIN public.parties p ON p.id = s.pid
  LEFT JOIN venc v ON v.sid = s.sid
  LEFT JOIN public.cob_casos cc ON cc.party_id = s.pid
  ORDER BY s.dias DESC, coalesce(v.v,0) DESC;
END $$;
REVOKE ALL ON FUNCTION public.cob_acordos_atrasados_lista() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_acordos_atrasados_lista() TO authenticated;