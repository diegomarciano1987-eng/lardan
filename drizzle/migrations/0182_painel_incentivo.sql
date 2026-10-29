-- 0182 — PAINEL DE INCENTIVO da consultora (pacote 2 do plano de 29/10/2026).
-- Etiqueta verde no topo do app ("Você pode ganhar R$ X" = comissão vendendo a maleta inteira) e o painel em tela cheia
-- que ela abre. Uma leitura só, no banco: ganhos da maleta atual (consultora_ganhos) + comissão da maleta inteira +
-- próximo degrau + objetivo gravado na maleta (0181). Somente leitura; não cria nem altera dado.

CREATE OR REPLACE FUNCTION public.consultora_incentivo() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); g jsonb; c kit_cycles; obj jsonb; vendido bigint; valor bigint; atual bigint;
        inteira jsonb; prox_min bigint; prox_ganho jsonb; alvo bigint;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501';
  END IF;
  g := public.consultora_ganhos();
  IF NOT coalesce((g->>'maleta')::boolean, false) THEN RETURN jsonb_build_object('maleta', false); END IF;
  -- a mesma maleta que consultora_ganhos escolhe
  SELECT * INTO c FROM kit_cycles WHERE consultora_party_id = eu AND status IN ('operacao', 'recebida', 'acerto')
   ORDER BY array_position(ARRAY['operacao', 'recebida', 'acerto']::text[], status::text), created_at DESC LIMIT 1;
  obj := public.kit_cycle_objetivo(c.id);
  vendido := coalesce((g->>'vendido_cents')::bigint, 0);
  valor := coalesce((g->>'valor_maleta_cents')::bigint, 0);
  atual := coalesce((g->>'comissao_cents')::bigint, 0);
  inteira := public.comissao_pelas_faixas(valor);
  prox_min := (g->'proxima'->>'min_cents')::bigint;
  prox_ganho := CASE WHEN prox_min IS NULL THEN NULL ELSE public.comissao_pelas_faixas(prox_min) END;
  alvo := (obj->>'objetivo_cents')::bigint;
  RETURN g || jsonb_build_object(
    'cycle_id', c.id,
    'comissao_maleta_cents', (inteira->>'comissao_cents')::bigint,
    'percentual_maleta', (inteira->>'percentual')::numeric,
    -- chegando na próxima faixa: quanto ela ganha a mais (a faixa vale sobre tudo)
    'proxima_ganho_extra_cents', CASE WHEN prox_ganho IS NULL THEN NULL ELSE (prox_ganho->>'comissao_cents')::bigint - atual END,
    'objetivo', obj,
    'objetivo_falta_cents', CASE WHEN alvo IS NULL THEN NULL ELSE greatest(alvo - vendido, 0) END,
    'objetivo_batido', alvo IS NOT NULL AND vendido >= alvo);
END $$;
REVOKE ALL ON FUNCTION public.consultora_incentivo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_incentivo() TO authenticated, service_role;