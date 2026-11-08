-- 0271: o botão "Reativar" do representante (sem movimento nenhum) mantém a regra antiga: com dívida, pedido ao Master.
-- Cheque/cobrança (movimento) seguem ativando pelo 0269 via rep_reativar_checado.
CREATE OR REPLACE FUNCTION public.rep_reativar_manual(_party uuid, _actor uuid, _motivo text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id = _party AND status::text = 'inativo') THEN RETURN public.rep_reativar_interno(_party, _actor, _motivo); END IF;
  d := public.party_divida_aberta(_party);
  IF d > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (_actor, 'consultora.reativacao_bloqueada_divida', 'parties', _party::text, jsonb_build_object('motivo', _motivo, 'divida_cents', d));
    RETURN false;
  END IF;
  PERFORM public.consultora_ativar_por_movimento(_party, _actor, _motivo);
  RETURN public.rep_reativar_interno(_party, _actor, _motivo) OR true;
END $$;
REVOKE ALL ON FUNCTION public.rep_reativar_manual(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_consultora_reativar(_party uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.rep_dono_da_consultora(_party);
BEGIN
  IF eu IS NULL OR NOT public.rep_portal_pode(eu) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.'; END IF;
  RETURN public.rep_reativar_manual(_party, auth.uid(), 'reativada pelo representante');
END $$;
REVOKE ALL ON FUNCTION public.rep_consultora_reativar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_consultora_reativar(uuid) TO authenticated, service_role;