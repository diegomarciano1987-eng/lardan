CREATE OR REPLACE FUNCTION public.lara_conversas_lista(_filtro text DEFAULT 'todas', _busca text DEFAULT NULL, _limite integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_busca text := nullif(btrim(coalesce(_busca, '')), '');
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN jsonb_build_object(
    'ativa', public.lara_ativa(),
    'contagem', jsonb_build_object(
      'pessoa', (SELECT count(*) FROM lara_conversas WHERE humano AND NOT opt_out),
      'revisao', (SELECT count(DISTINCT lead_id) FROM captacao_revisao_pedidos WHERE resolvido_em IS NULL),
      'nao_lidas', (SELECT count(*) FROM lara_conversas WHERE nao_lidas > 0)),
    'itens', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'ordem') DESC) FROM (
      SELECT jsonb_build_object(
        'lead_id', c.lead_id, 'nome', l.full_name, 'cidade', l.city, 'uf', l.uf, 'estado', c.estado, 'humano', c.humano,
        'humano_motivo', c.humano_motivo, 'opt_out', c.opt_out, 'nao_lidas', c.nao_lidas,
        'revisao', EXISTS (SELECT 1 FROM captacao_revisao_pedidos r WHERE r.lead_id = c.lead_id AND r.resolvido_em IS NULL),
        'ultima', (SELECT jsonb_build_object('texto', left(m.texto, 140), 'em', m.criado_em, 'direcao', m.direcao, 'autor', m.autor, 'status', m.status)
                     FROM lara_mensagens m WHERE m.lead_id = c.lead_id ORDER BY m.criado_em DESC LIMIT 1),
        'janela_aberta', c.ultima_entrada_em > now() - interval '23 hours 50 minutes',
        'ordem', greatest(c.ultima_entrada_em, c.ultima_saida_em, c.criado_em)) x
        FROM lara_conversas c JOIN leads l ON l.id = c.lead_id
       WHERE (coalesce(_filtro, 'todas') = 'todas'
               OR (_filtro = 'pessoa' AND c.humano AND NOT c.opt_out)
              OR (_filtro = 'nao_lidas' AND c.nao_lidas > 0)
              OR (_filtro = 'revisao' AND EXISTS (SELECT 1 FROM captacao_revisao_pedidos r WHERE r.lead_id = c.lead_id AND r.resolvido_em IS NULL)))
         AND (v_busca IS NULL OR public.busca_casa(l.full_name, v_busca)
              OR (regexp_replace(v_busca, '\D', '', 'g') <> '' AND c.wa_id LIKE '%' || regexp_replace(v_busca, '\D', '', 'g') || '%'))
       ORDER BY greatest(c.ultima_entrada_em, c.ultima_saida_em, c.criado_em) DESC
       LIMIT greatest(1, least(coalesce(_limite, 100), 300))) s), '[]'::jsonb),
    'sem_candidatura', (SELECT count(DISTINCT wa_id) FROM lara_mensagens WHERE lead_id IS NULL AND direcao = 'entrada' AND criado_em > now() - interval '30 days'));
END $$;
REVOKE ALL ON FUNCTION public.lara_conversas_lista(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lara_conversas_lista(text, text, integer) TO authenticated;
