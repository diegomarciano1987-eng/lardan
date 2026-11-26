CREATE OR REPLACE FUNCTION public.crm_teste_resumo(_lead uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN t.id IS NULL THEN jsonb_build_object('situacao', 'sem_teste')
    WHEN t.concluido_em IS NULL THEN jsonb_build_object('situacao', 'pendente')
    ELSE jsonb_build_object(
      'situacao', 'concluido',
      'semaforo', coalesce(t.resultado->>'semaforo_final', t.resultado->>'semaforo_base'),
      'ipl', (t.resultado->>'ipl')::numeric,
      'risco_acerto', t.resultado->>'risco_acerto',
      'disc_perfil', t.resultado->>'disc_perfil',
      'serasa_confere', t.serasa_confere,
      'concluido_em', t.concluido_em)
  END
  FROM (SELECT 1) x
  LEFT JOIN LATERAL (
    SELECT * FROM candidatura_testes ct
     WHERE ct.lead_id = _lead AND ct.cancelado_em IS NULL
     ORDER BY (ct.concluido_em IS NOT NULL) DESC, coalesce(ct.concluido_em, ct.criado_em) DESC
     LIMIT 1) t ON true
$$;
REVOKE ALL ON FUNCTION public.crm_teste_resumo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_teste_resumo(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_fila_atendimento(_f jsonb DEFAULT '{}'::jsonb, _limite integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_lim int := least(greatest(coalesce(_limite, 200), 1), 500);
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN (
    WITH base AS (
      SELECT l.*, public.crm_teste_resumo(l.id) AS teste
        FROM leads l
       WHERE l.id IN (SELECT id FROM public.crm_filtrar(coalesce(_f, '{}'::jsonb) - 'followup' - 'desfecho'))
         AND l.outcome = 'aberta' AND l.archived_at IS NULL AND l.first_response_at IS NULL
    ), ordenada AS (
      SELECT b.*,
             CASE b.teste->>'semaforo' WHEN 'verde' THEN 1 WHEN 'amarelo' THEN 2 WHEN 'vermelho' THEN 4 ELSE 3 END AS cor_ordem
        FROM base b
    )
    SELECT jsonb_build_object(
      'resumo', jsonb_build_object(
        'total', (SELECT count(*) FROM ordenada),
        'verde', (SELECT count(*) FROM ordenada WHERE teste->>'semaforo' = 'verde'),
        'amarelo', (SELECT count(*) FROM ordenada WHERE teste->>'semaforo' = 'amarelo'),
        'vermelho', (SELECT count(*) FROM ordenada WHERE teste->>'semaforo' = 'vermelho'),
        'sem_teste', (SELECT count(*) FROM ordenada WHERE teste->>'situacao' <> 'concluido'),
        'com_representante', (SELECT count(*) FROM ordenada WHERE representante_party_id IS NOT NULL),
        'sem_representante', (SELECT count(*) FROM ordenada WHERE representante_party_id IS NULL),
        'espera_media_horas', (SELECT round(avg(extract(epoch FROM now() - created_at)) / 3600)::int FROM ordenada)),
      'itens', coalesce((
        SELECT jsonb_agg(public.crm_card(l2) || jsonb_build_object(
                 'teste', o.teste, 'posicao', o.pos,
                 'espera_horas', floor(extract(epoch FROM now() - o.created_at) / 3600)::int)
               ORDER BY o.pos)
          FROM (SELECT ordenada.*, row_number() OVER (ORDER BY cor_ordem, (teste->>'ipl')::numeric DESC NULLS LAST, created_at) AS pos
                  FROM ordenada) o
          JOIN leads l2 ON l2.id = o.id
         WHERE o.pos <= v_lim), '[]'::jsonb)
    ));
END $$;
REVOKE ALL ON FUNCTION public.crm_fila_atendimento(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_fila_atendimento(jsonb, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_expansao_cidades(_dias integer DEFAULT 180)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_dias int := least(greatest(coalesce(_dias, 180), 7), 730);
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN coalesce((
    WITH abertas AS (
      SELECT l.id, l.city, l.uf, l.created_at, public.praca_pela_cidade(l.city, l.uf) AS praca,
             public.crm_teste_resumo(l.id)->>'semaforo' AS cor
        FROM leads l
       WHERE l.outcome = 'aberta' AND l.archived_at IS NULL AND l.representante_party_id IS NULL
         AND l.created_at >= now() - make_interval(days => v_dias)
         AND public.crm_lead_maleta(l) IS NULL
    )
    SELECT jsonb_agg(jsonb_build_object(
             'cidade', c.cidade, 'uf', c.uf, 'candidatas', c.n, 'ultimos_30_dias', c.n30,
             'verdes', c.verdes, 'ultima', c.ultima, 'praca', c.praca_nome,
             'motivo', CASE WHEN c.praca IS NULL THEN 'cidade_fora_das_pracas' ELSE 'praca_sem_representante_unico' END)
           ORDER BY c.n DESC, c.verdes DESC, c.cidade)
      FROM (
        SELECT min(a.city) AS cidade, a.uf, a.praca, min(p.nome) AS praca_nome, count(*) AS n,
               count(*) FILTER (WHERE a.created_at >= now() - interval '30 days') AS n30,
               count(*) FILTER (WHERE a.cor = 'verde') AS verdes, max(a.created_at) AS ultima
          FROM abertas a LEFT JOIN cob_pracas p ON p.id = a.praca
         GROUP BY public.cidade_norm(a.city), a.uf, a.praca) c), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.crm_expansao_cidades(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_expansao_cidades(integer) TO authenticated;