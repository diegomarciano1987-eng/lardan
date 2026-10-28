-- Nova regra Lardan (Daniel, 28/10/2026): sempre PARA BAIXO em degraus de R$ 5,00 terminados em 4,90/9,90.
-- 80,00–84,99 → 79,90 · 85,00–89,99 → 84,90 · 90,00–94,99 → 89,90. Preço que já é degrau (x4,90/x9,90) fica.
-- Abaixo de R$ 5,00 não muda. Nunca devolve valor maior que o atual.
CREATE OR REPLACE FUNCTION public.preco_regra_lardan(_cents integer) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _cents IS NULL OR _cents < 500 THEN _cents
    WHEN _cents % 500 = 490 THEN _cents
    ELSE least(_cents, (_cents / 500) * 500 - 10) END
$$;

CREATE OR REPLACE FUNCTION public.preco_reajuste_resumo() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'variantes', count(*), 'mudam', count(*) FILTER (WHERE diferenca_cents <> 0),
    'antes_cents', coalesce(sum(antes_cents), 0), 'depois_cents', coalesce(sum(depois_cents), 0),
    'maior_aumento_cents', coalesce(max(diferenca_cents), 0),
    'maior_reducao_cents', coalesce(-min(diferenca_cents), 0),
    'media_aumento_pct', round(avg(CASE WHEN antes_cents > 0 THEN diferenca_cents * 100.0 / antes_cents END), 2),
    'virada_em', (SELECT preco_virada_em FROM pedido_config),
    'ultimo_lote', (SELECT lote FROM preco_reajustes WHERE desfeito_em IS NULL ORDER BY criado_em DESC LIMIT 1))
  FROM public.preco_reajuste_previa()
$$;
REVOKE ALL ON FUNCTION public.preco_reajuste_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preco_reajuste_resumo() TO authenticated, service_role;