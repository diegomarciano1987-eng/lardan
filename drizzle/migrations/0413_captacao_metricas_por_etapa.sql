DROP FUNCTION IF EXISTS public.crm_metrics(date, date);
CREATE FUNCTION public.crm_metrics(_de date DEFAULT NULL, _ate date DEFAULT NULL, _canal text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d1 timestamptz := coalesce(_de, (now() - interval '30 days')::date)::timestamptz;
        d2 timestamptz := (coalesce(_ate, now()::date) + 1)::timestamptz;
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN (
    WITH b AS (
      SELECT l.*, s.key etapa,
        CASE WHEN l.outcome = 'ganha' OR s.key IN ('aprovada','documentacao','onboarding') THEN 'aprovada'
             WHEN l.outcome = 'perdida' OR s.key = 'reprovada' THEN 'perdida'
             WHEN s.key IN ('conversa','teste','avaliacao','primeiro','perfil') THEN 'atendimento'
             ELSE 'nova' END grupo
      FROM public.leads l LEFT JOIN public.candidatura_stages s ON s.id = l.stage_id
      WHERE l.created_at >= d1 AND l.created_at < d2
        AND (_canal IS NULL OR public.captacao_canal(l) = _canal)
    )
    SELECT jsonb_build_object(
      'periodo', jsonb_build_object('de', d1, 'ate', d2),
      'total', count(*),
      'novas', count(*) FILTER (WHERE grupo = 'nova'),
      'em_atendimento', count(*) FILTER (WHERE grupo = 'atendimento'),
      'ganhas', count(*) FILTER (WHERE grupo = 'aprovada'),
      'perdidas', count(*) FILTER (WHERE grupo = 'perdida'),
      'taxa_conversao', CASE WHEN count(*) = 0 THEN 0
        ELSE round(100.0 * count(*) FILTER (WHERE grupo = 'aprovada') / count(*), 1) END,
      'minutos_primeiro_atendimento', coalesce(round(avg(
          EXTRACT(EPOCH FROM (first_response_at - created_at))/60)
          FILTER (WHERE first_response_at IS NOT NULL AND first_response_at >= created_at)), 0),
      'com_primeiro_atendimento', count(*) FILTER (WHERE first_response_at IS NOT NULL),
      'dias_no_funil', coalesce(round(avg(
          EXTRACT(EPOCH FROM (coalesce(won_at, lost_at, now()) - created_at))/86400)::numeric, 1), 0),
      'por_origem', coalesce((SELECT jsonb_object_agg(src, n) FROM (
          SELECT b2.source_normalized src, count(*) n FROM b b2 GROUP BY 1) o), '{}'::jsonb),
      'motivos_perda', coalesce((SELECT jsonb_object_agg(lbl, n) FROM (
          SELECT coalesce(r.label,'Não informado') lbl, count(*) n
            FROM b b3 LEFT JOIN public.candidatura_lost_reasons r ON r.id = b3.lost_reason_id
           WHERE b3.grupo = 'perdida' GROUP BY 1) m), '{}'::jsonb)
    ) FROM b
  );
END; $function$;
REVOKE EXECUTE ON FUNCTION public.crm_metrics(date, date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crm_metrics(date, date, text) TO authenticated;