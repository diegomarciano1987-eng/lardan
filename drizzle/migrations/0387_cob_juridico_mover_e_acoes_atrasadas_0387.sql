CREATE OR REPLACE FUNCTION public.cob_mover_etapa(_party uuid, _etapa text, _responsavel uuid DEFAULT NULL::uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE escrita boolean := public.cob_pode(auth.uid());
BEGIN
  IF NOT escrita THEN
    -- 0387: jurídico só move o card entre as colunas do Kanban; nada mais.
    IF NOT public.has_role(auth.uid(), 'juridico'::app_role) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
    IF _responsavel IS NOT NULL OR _etapa NOT IN ('em_contato','em_negociacao','acompanhamento') THEN
      RAISE EXCEPTION 'O jurídico só move o card entre Em negociação, Acordo em andamento e Judicial';
    END IF;
  END IF;
  INSERT INTO cob_casos(party_id,etapa,responsavel_id,updated_by) VALUES(_party,_etapa,_responsavel,auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET etapa=_etapa, responsavel_id=coalesce(_responsavel,cob_casos.responsavel_id), updated_at=now(), updated_by=auth.uid();
  INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id) VALUES(_party,'etapa','Etapa: '||_etapa,auth.uid());
  IF NOT escrita THEN
    INSERT INTO audit_logs(actor_id,action,entity,entity_id,diff) VALUES(auth.uid(),'cob_mover_etapa_juridico','cob_casos',_party,jsonb_build_object('etapa',_etapa));
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.cob_acoes_atrasadas_lista()
RETURNS TABLE(party_id uuid, nome text, codigo_legado text, praca_nome text, representante_nome text, etapa text,
  vencido_cents bigint, proxima_acao date, dias int, titulo text, tarefas_vencidas int, da_regua int, manuais int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
#variable_conflict use_column
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.cob_pode_ler(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN QUERY
  SELECT c.party_id, c.nome, c.codigo_legado, c.praca_nome, c.representante_nome, c.etapa, c.vencido_cents,
    c.proxima_acao, (hoje - c.proxima_acao)::int, c.proxima_acao_titulo,
    t.n, t.r, t.m
  FROM public.cob_carteira2() c
  CROSS JOIN LATERAL (
    SELECT count(*)::int n, count(*) FILTER (WHERE x.origem='regua')::int r, count(*) FILTER (WHERE x.origem IS DISTINCT FROM 'regua')::int m
    FROM cob_tarefas x WHERE x.party_id=c.party_id AND x.status='aberta' AND x.vence_em < hoje) t
  WHERE c.proxima_acao < hoje
  ORDER BY c.proxima_acao, c.vencido_cents DESC;
END $$;
REVOKE ALL ON FUNCTION public.cob_acoes_atrasadas_lista() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_acoes_atrasadas_lista() TO authenticated;