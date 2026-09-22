-- Conferência da maleta: expõe remessa inicial, acréscimo em trânsito e
-- acréscimo confirmado separadamente. Só leitura; nenhum saldo muda.
CREATE OR REPLACE FUNCTION public.kit_conciliacao(_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE linhas jsonb; tot jsonb;
BEGIN
  PERFORM public.kit_require_cycle(_cycle);

  WITH remessa AS (
    SELECT i.variant_id, sum(i.quantity)::integer q
      FROM public.kit_composition_items i
      JOIN public.kit_compositions comp ON comp.id = i.composition_id
     WHERE comp.cycle_id = _cycle
     GROUP BY 1
  ),
  acres AS (
    SELECT i.variant_id, sum(i.quantity)::integer q
      FROM public.kit_movement_items i
      JOIN public.kit_movements m ON m.id = i.movement_id
     WHERE m.cycle_id = _cycle AND m.kind = 'acrescimo' AND m.status = 'confirmado'
     GROUP BY 1
  ),
  acres_transito AS (
    SELECT i.variant_id, sum(i.quantity)::integer q
      FROM public.kit_movement_items i
      JOIN public.kit_movements m ON m.id = i.movement_id
     WHERE m.cycle_id = _cycle AND m.kind = 'acrescimo' AND m.status = 'pendente'
     GROUP BY 1
  ),
  base AS (
    SELECT b.variant_id,
           coalesce(r.q,0) AS enviado,
           coalesce(a.q,0) AS acrescido,
           coalesce(at.q,0) AS acrescido_transito,
           b.qty_accepted AS aceito,
           b.qty_returned AS retornado,
           b.qty_return_transit AS retorno_em_transito,
           b.qty_warranty AS garantia,
           b.qty_return_divergent AS divergencia,
           b.qty_lost AS perda,
           b.qty_retained AS mantida,
           b.qty_sold AS vendido,
           b.qty_incoming AS a_caminho
      FROM public.kit_balances b
      LEFT JOIN remessa r ON r.variant_id = b.variant_id
      LEFT JOIN acres a ON a.variant_id = b.variant_id
      LEFT JOIN acres_transito at ON at.variant_id = b.variant_id
     WHERE b.cycle_id = _cycle
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', variant_id,
           'enviado', enviado, 'acrescido', acrescido,
           'acrescido_transito', acrescido_transito,
           'aceito', aceito,
           'saiu', enviado + acrescido,
           'retornado', retornado, 'retorno_em_transito', retorno_em_transito,
           'garantia', garantia, 'divergencia', divergencia,
           'perda', perda, 'mantida', mantida,
           'vendido', vendido, 'a_caminho', a_caminho,
           'sob_responsabilidade', (enviado + acrescido)
             - retornado - retorno_em_transito - garantia - divergencia - perda - mantida - vendido,
           'a_explicar', (enviado + acrescido)
             - retornado - retorno_em_transito - garantia - divergencia - perda - mantida - vendido
         ) ORDER BY variant_id), '[]'::jsonb),
         jsonb_build_object(
           'enviado', coalesce(sum(enviado),0),
           'acrescido', coalesce(sum(acrescido),0),
           'acrescido_transito', coalesce(sum(acrescido_transito),0),
           'saiu', coalesce(sum(enviado + acrescido),0),
           'aceito', coalesce(sum(aceito),0),
           'retornado', coalesce(sum(retornado),0),
           'retorno_em_transito', coalesce(sum(retorno_em_transito),0),
           'garantia', coalesce(sum(garantia),0),
           'divergencia', coalesce(sum(divergencia),0),
           'perda', coalesce(sum(perda),0),
           'mantida', coalesce(sum(mantida),0),
           'vendido', coalesce(sum(vendido),0),
           'a_caminho', coalesce(sum(a_caminho),0),
           'a_explicar', coalesce(sum((enviado + acrescido)
             - retornado - retorno_em_transito - garantia - divergencia - perda - mantida - vendido),0))
    INTO linhas, tot
  FROM base;

  RETURN jsonb_build_object(
    'linhas', linhas,
    'totais', tot,
    'vendas_disponiveis', false,
    'aviso', 'Peças ainda sob responsabilidade não são venda nem dívida. As vendas da consultora ainda não alimentam esta conferência.');
END $function$;

REVOKE ALL ON FUNCTION public.kit_conciliacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_conciliacao(uuid) TO authenticated, service_role;