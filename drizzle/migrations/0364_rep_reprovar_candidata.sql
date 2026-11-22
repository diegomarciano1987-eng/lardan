-- Ordem da coluna: maleta > recusada > aprovada (antes "aprovada" vencia a recusa quando já havia cadastro).
CREATE OR REPLACE FUNCTION public.rep_crm_coluna_sistema(_l leads)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _l.party_id IS NOT NULL AND EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id = _l.party_id AND c.status NOT IN ('cancelada', 'rascunho')) THEN 'primeira_maleta'
    WHEN _l.status::text = 'recusado' OR _l.outcome = 'perdida' THEN 'nao_aprovada'
    WHEN _l.status::text = 'aprovado' OR _l.outcome = 'ganha' OR _l.party_id IS NOT NULL THEN 'aprovada'
    ELSE NULL END
$$;

-- Motivos de reprovação (os mesmos do CRM) para o app do representante.
CREATE OR REPLACE FUNCTION public.rep_lead_motivos()
RETURNS TABLE(id uuid, label text, requires_note boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.id, r.label, r.requires_note FROM public.candidatura_lost_reasons r
  WHERE r.is_active AND auth.uid() IS NOT NULL
  ORDER BY (r.label = 'Outro'), r.sort_order, r.label
$$;
REVOKE ALL ON FUNCTION public.rep_lead_motivos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_lead_motivos() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_lead_reprovar(_rep uuid, _lead uuid, _motivo uuid, _nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE le leads; v_label text; v_req boolean; v_nome text; v_nota text := nullif(btrim(coalesce(_nota, '')), '');
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  SELECT label, requires_note INTO v_label, v_req FROM candidatura_lost_reasons WHERE id = _motivo AND is_active;
  IF v_label IS NULL THEN RAISE EXCEPTION 'Escolha o motivo da reprovação.'; END IF;
  IF v_req AND length(coalesce(v_nota, '')) < 3 THEN RAISE EXCEPTION 'Escreva o motivo em poucas palavras.'; END IF;
  SELECT * INTO le FROM leads WHERE id = _lead FOR UPDATE;
  IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não está com você.'; END IF;
  IF le.status::text = 'recusado' OR le.outcome = 'perdida' THEN
    RETURN jsonb_build_object('ok', true, 'ja_estava', true);
  END IF;
  IF public.rep_crm_coluna_sistema(le) = 'primeira_maleta' THEN
    RAISE EXCEPTION 'Ela já recebeu maleta: não dá para reprovar a candidatura.';
  END IF;
  SELECT display_name INTO v_nome FROM parties WHERE id = _rep;
  UPDATE leads SET outcome = 'perdida', lost_reason_id = _motivo, lost_notes = v_nota,
         lost_at = now(), lost_by = auth.uid(), status = 'recusado', updated_at = now()
   WHERE id = _lead;
  PERFORM public.crm_log(_lead, 'perda', 'Reprovada pelo representante ' || coalesce(v_nome, '') || ': ' || v_label, v_nota,
    jsonb_build_object('motivo', v_label, 'representante', _rep, 'origem', 'app_representante'));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'candidatura.reprovada_representante', 'leads', _lead::text,
          jsonb_build_object('representante', _rep, 'motivo', v_label, 'motivo_id', _motivo, 'nota', v_nota, 'status_anterior', le.status::text));
  RETURN jsonb_build_object('ok', true, 'ja_estava', false);
END $$;
REVOKE ALL ON FUNCTION public.rep_lead_reprovar(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_lead_reprovar(uuid, uuid, uuid, text) TO authenticated, service_role;

-- Desfazer: só a reprovação feita pelo app do representante (recusa da equipe da Lardan só a equipe reabre).
CREATE OR REPLACE FUNCTION public.rep_lead_reabrir(_rep uuid, _lead uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE le leads; v_ant text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  SELECT * INTO le FROM leads WHERE id = _lead FOR UPDATE;
  IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não está com você.'; END IF;
  IF NOT (le.status::text = 'recusado' OR le.outcome = 'perdida') THEN RETURN jsonb_build_object('ok', true, 'ja_estava', true); END IF;
  SELECT a.payload->>'status_anterior' INTO v_ant FROM audit_logs a
   WHERE a.action = 'candidatura.reprovada_representante' AND a.entity_id = _lead::text
     AND a.created_at >= coalesce(le.lost_at, now()) - interval '5 seconds'
   ORDER BY a.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta candidata foi recusada pela equipe da Lardan; só a equipe pode reabrir.'; END IF;
  UPDATE leads SET outcome = 'aberta', status = (CASE WHEN v_ant IN ('novo','em_analise','qualificado','aprovado') THEN v_ant ELSE 'em_analise' END)::lead_status,
         lost_reason_id = NULL, lost_notes = NULL, lost_at = NULL, lost_by = NULL, updated_at = now()
   WHERE id = _lead;
  PERFORM public.crm_log(_lead, 'reabertura', 'Reprovação desfeita pelo representante', NULL, jsonb_build_object('representante', _rep));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'candidatura.reaberta_representante', 'leads', _lead::text, jsonb_build_object('representante', _rep, 'status', v_ant));
  RETURN jsonb_build_object('ok', true, 'ja_estava', false);
END $$;
REVOKE ALL ON FUNCTION public.rep_lead_reabrir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_lead_reabrir(uuid, uuid) TO authenticated, service_role;