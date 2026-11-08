-- 0272: retorno honesto do botão Reativar (true só se ativou de fato).
CREATE OR REPLACE FUNCTION public.rep_reativar_manual(_party uuid, _actor uuid, _motivo text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d bigint; a boolean; b boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id = _party AND status::text = 'inativo') THEN RETURN public.rep_reativar_interno(_party, _actor, _motivo); END IF;
  d := public.party_divida_aberta(_party);
  IF d > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (_actor, 'consultora.reativacao_bloqueada_divida', 'parties', _party::text, jsonb_build_object('motivo', _motivo, 'divida_cents', d));
    RETURN false;
  END IF;
  a := public.rep_reativar_interno(_party, _actor, _motivo);
  b := public.consultora_ativar_por_movimento(_party, _actor, _motivo);
  RETURN a OR b;
END $$;
REVOKE ALL ON FUNCTION public.rep_reativar_manual(uuid, uuid, text) FROM PUBLIC, anon, authenticated;