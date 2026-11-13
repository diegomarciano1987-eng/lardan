-- 0306c — fila do espelho: coluna certa da unificação e busca do celular repetido pelo índice (value_norm).
CREATE OR REPLACE FUNCTION public.asaas_cliente_espelho_proximos(_worker text, _limite int DEFAULT 15, _party uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r jsonb;
BEGIN
  IF coalesce(btrim(_worker), '') = '' THEN RAISE EXCEPTION 'Worker obrigatório.'; END IF;
  WITH alvo AS (
    SELECT e.customer_id FROM asaas_cliente_espelho e
     WHERE (_party IS NULL OR e.party_id = _party)
       AND (e.estado = 'pendente'
            OR (e.estado = 'processando' AND e.reservado_em < now() - interval '10 minutes')
            OR (e.estado = 'erro' AND e.tentativas < 5 AND e.atualizado_em < now() - make_interval(mins => 15 * greatest(e.tentativas, 1))))
     ORDER BY e.pedido_em
     LIMIT greatest(1, least(coalesce(_limite, 15), 50))
     FOR UPDATE SKIP LOCKED),
  marcado AS (
    UPDATE asaas_cliente_espelho e SET estado = 'processando', worker = _worker, reservado_em = clock_timestamp(), tentativas = e.tentativas + 1
      FROM alvo WHERE e.customer_id = alvo.customer_id
    RETURNING e.customer_id, e.party_id, e.account_id, e.motivo, e.forcar, e.forcado_por),
  dados AS (SELECT m.*, public.asaas_cliente_dados_lardan(m.party_id) AS lardan FROM marcado m)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'customer_id', d.customer_id, 'party_id', d.party_id, 'account_id', d.account_id, 'external_id', c.external_id,
           'primeira', coalesce(d.motivo, '') LIKE 'primeira conferência%', 'forcar', d.forcar, 'forcado_por', d.forcado_por,
           'lardan', d.lardan,
           'conhecidos', coalesce((SELECT jsonb_agg(DISTINCT regexp_replace(cp.value, '\D', '', 'g')) FROM contact_points cp
                                    WHERE cp.party_id = d.party_id AND cp.kind::text IN ('whatsapp','telefone')), '[]'::jsonb),
           'celular_compartilhado', (d.lardan->>'mobilePhone') IS NOT NULL AND EXISTS (
              SELECT 1 FROM contact_points o
               WHERE o.value_norm = '+55' || (d.lardan->>'mobilePhone') AND o.party_id <> d.party_id
                 AND o.kind::text IN ('whatsapp','telefone')
                 AND NOT EXISTS (SELECT 1 FROM party_unificacoes u WHERE u.duplicada_id = o.party_id)))), '[]'::jsonb) INTO r
    FROM dados d JOIN asaas_customers c ON c.id = d.customer_id;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_espelho_proximos(text, int, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_espelho_proximos(text, int, uuid) TO service_role;
