CREATE OR REPLACE FUNCTION public.crm_card(_l public.leads)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', _l.id,
    'protocolo', _l.protocol,
    'nome', _l.full_name,
    'whatsapp', _l.whatsapp,
    'whatsapp_norm', _l.whatsapp_norm,
    'email', _l.email,
    'cidade', _l.city,
    'uf', _l.uf,
    'etapa_id', _l.stage_id,
    'etapa_desde', _l.stage_entered_at,
    'prioridade', _l.priority,
    'desfecho', _l.outcome,
    'origem', _l.source_normalized,
    'campanha', _l.utm->>'utm_campaign',
    'criada_em', _l.created_at,
    'ultimo_envio', coalesce(
      (SELECT max(cs.created_at) FROM public.candidatura_submissions cs WHERE cs.lead_id = _l.id),
      _l.created_at
    ),
    'ultimo_contato', _l.last_contact_at,
    'primeiro_atendimento', _l.first_response_at,
    'proximo_followup', _l.next_followup_at,
    'arquivada_em', _l.archived_at,
    'reenvios', _l.submissions_count,
    'responsavel_id', _l.assigned_to,
    'responsavel', (SELECT p.full_name FROM public.profiles p WHERE p.id = _l.assigned_to),
    'tags', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.name, 'cor', t.color) ORDER BY t.name)
                        FROM public.candidatura_tag_links tl
                        JOIN public.candidatura_tags t ON t.id = tl.tag_id
                       WHERE tl.lead_id = _l.id), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.crm_board(_f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN jsonb_build_object(
    'etapas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'chave', s.key, 'nome', s.name, 'ordem', s.sort_order,
        'cor', s.color, 'inicial', s.is_initial, 'ativa', s.is_active) ORDER BY s.sort_order)
      FROM public.candidatura_stages s WHERE s.is_active), '[]'::jsonb),
    'cards', coalesce((SELECT jsonb_agg(public.crm_card(l) ORDER BY coalesce(
        (SELECT max(cs.created_at) FROM public.candidatura_submissions cs WHERE cs.lead_id = l.id),
        l.created_at
      ) DESC)
      FROM public.leads l WHERE l.id IN (SELECT id FROM public.crm_filtrar(_f))), '[]'::jsonb),
    'radar', public.crm_radar()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_list(_f jsonb DEFAULT '{}'::jsonb, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_total bigint;
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  SELECT count(*) INTO v_total FROM public.crm_filtrar(_f);
  RETURN jsonb_build_object(
    'total', v_total,
    'itens', coalesce((SELECT jsonb_agg(c ORDER BY ord DESC)
       FROM (SELECT public.crm_card(l) c, coalesce(
                       (SELECT max(cs.created_at) FROM public.candidatura_submissions cs WHERE cs.lead_id = l.id),
                       l.created_at
                    ) ord
               FROM public.leads l
              WHERE l.id IN (SELECT id FROM public.crm_filtrar(_f))
              ORDER BY ord DESC
              LIMIT greatest(1, least(_limit, 200)) OFFSET greatest(0, _offset)) t), '[]'::jsonb)
  );
END;
$function$;