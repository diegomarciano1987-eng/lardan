CREATE OR REPLACE FUNCTION public.rep_lead_reprovar(_rep uuid, _lead uuid, _motivo uuid, _nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE le leads; v_label text; v_req boolean; v_nome text; v_nota text := nullif(btrim(coalesce(_nota, '')), ''); v_em timestamptz := now();
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
         lost_at = v_em, lost_by = auth.uid(), status = 'recusado', updated_at = now()
   WHERE id = _lead;
  PERFORM public.crm_log(_lead, 'perda', 'Reprovada pelo representante ' || coalesce(v_nome, '') || ': ' || v_label, v_nota,
    jsonb_build_object('motivo', v_label, 'representante', _rep, 'origem', 'app_representante'));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'candidatura.reprovada_representante', 'leads', _lead::text,
          jsonb_build_object('representante', _rep, 'motivo', v_label, 'motivo_id', _motivo, 'nota', v_nota,
                             'status_anterior', le.status::text, 'lost_at', v_em));
  RETURN jsonb_build_object('ok', true, 'ja_estava', false);
END $$;
REVOKE ALL ON FUNCTION public.rep_lead_reprovar(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_lead_reprovar(uuid, uuid, uuid, text) TO authenticated, service_role;

-- Reprovação "dele" = registro de auditoria com o mesmo instante gravado em leads.lost_at.
CREATE OR REPLACE FUNCTION public.rep_lead_reprovado_pelo_rep(_lead uuid, _lost_at timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(a.payload->>'status_anterior', 'em_analise') FROM audit_logs a
   WHERE _lost_at IS NOT NULL AND a.entity = 'leads' AND a.entity_id = _lead::text
     AND a.action = 'candidatura.reprovada_representante' AND a.created_at >= _lost_at - interval '1 minute'
     AND (a.payload->>'lost_at')::timestamptz = _lost_at
   ORDER BY a.created_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.rep_lead_reprovado_pelo_rep(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rep_lead_reprovado_pelo_rep(uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.rep_lead_reabrir(_rep uuid, _lead uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE le leads; v_ant text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  SELECT * INTO le FROM leads WHERE id = _lead FOR UPDATE;
  IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não está com você.'; END IF;
  IF NOT (le.status::text = 'recusado' OR le.outcome = 'perdida') THEN RETURN jsonb_build_object('ok', true, 'ja_estava', true); END IF;
  v_ant := public.rep_lead_reprovado_pelo_rep(_lead, le.lost_at);
  IF v_ant IS NULL THEN RAISE EXCEPTION 'Esta candidata foi recusada pela equipe da Lardan; só a equipe pode reabrir.'; END IF;
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

CREATE OR REPLACE FUNCTION public.rep_crm(_rep uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r jsonb; primeira uuid;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  PERFORM public.rep_crm_etapas_garantir(_rep);
  SELECT id INTO primeira FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema IS NULL ORDER BY ordem LIMIT 1;
  SELECT jsonb_build_object(
    'codigo', (SELECT lower(code) FROM parties WHERE id = _rep),
    'etapas', (SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'sistema', sistema) ORDER BY ordem) FROM rep_crm_etapas WHERE rep_party_id = _rep),
    'cards', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'lead_id', l.id, 'protocolo', l.protocol, 'nome', l.full_name, 'whatsapp', l.whatsapp, 'cidade', l.city || '/' || l.uf,
        'status_lardan', l.status::text, 'origem', l.representante_origem, 'criado', l.created_at, 'nota', c.nota,
        'travado', s.col IS NOT NULL, 'sistema', s.col,
        'party_id', l.party_id, 'tem_cpf', coalesce(length(l.cpf_digits), 0) = 11,
        'movido_em', c.updated_at,
        'reprovacao', CASE WHEN s.col = 'nao_aprovada' THEN jsonb_build_object(
            'motivo', lr.label, 'nota', l.lost_notes, 'em', l.lost_at,
            'pelo_representante', public.rep_lead_reprovado_pelo_rep(l.id, l.lost_at) IS NOT NULL) END,
        'etapa_id', CASE WHEN s.col IS NOT NULL THEN (SELECT id FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema = s.col)
                         WHEN ce.sistema IS NULL AND ce.id IS NOT NULL THEN ce.id ELSE primeira END)
        ORDER BY l.created_at DESC)
      FROM leads l LEFT JOIN rep_crm_cards c ON c.lead_id = l.id LEFT JOIN rep_crm_etapas ce ON ce.id = c.etapa_id
      LEFT JOIN candidatura_lost_reasons lr ON lr.id = l.lost_reason_id
      CROSS JOIN LATERAL (SELECT public.rep_crm_coluna_sistema(l) AS col) s
      WHERE l.representante_party_id = _rep AND l.status::text NOT IN ('arquivado')), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $function$;