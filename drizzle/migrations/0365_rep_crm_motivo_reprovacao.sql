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
            'pelo_representante', EXISTS (SELECT 1 FROM audit_logs a WHERE a.action = 'candidatura.reprovada_representante'
               AND a.entity_id = l.id::text AND a.created_at >= coalesce(l.lost_at, now()) - interval '5 seconds')) END,
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