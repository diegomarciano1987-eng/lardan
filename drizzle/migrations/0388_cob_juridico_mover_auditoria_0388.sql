CREATE OR REPLACE FUNCTION public.cob_mover_etapa(_party uuid, _etapa text, _responsavel uuid DEFAULT NULL::uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE escrita boolean := public.cob_pode(auth.uid());
BEGIN
  IF NOT escrita THEN
    IF NOT public.has_role(auth.uid(), 'juridico'::app_role) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
    IF _responsavel IS NOT NULL OR _etapa NOT IN ('em_contato','em_negociacao','acompanhamento') THEN
      RAISE EXCEPTION 'O jurídico só move o card entre Em negociação, Acordo em andamento e Judicial';
    END IF;
  END IF;
  INSERT INTO cob_casos(party_id,etapa,responsavel_id,updated_by) VALUES(_party,_etapa,_responsavel,auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET etapa=_etapa, responsavel_id=coalesce(_responsavel,cob_casos.responsavel_id), updated_at=now(), updated_by=auth.uid();
  INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id) VALUES(_party,'etapa','Etapa: '||_etapa,auth.uid());
  IF NOT escrita THEN
    INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'cob_mover_etapa_juridico','cob_casos',_party,jsonb_build_object('etapa',_etapa));
  END IF;
END $function$;