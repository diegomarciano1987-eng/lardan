CREATE OR REPLACE FUNCTION public.maleta_total_sugerido(_party uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ult AS (
    SELECT enviadas, quando, desempate, origem FROM (
      SELECT lm.pecas_enviadas::numeric AS enviadas, coalesce(lm.emissao, lm.fechamento)::timestamptz AS quando,
             lm.fechamento::timestamptz AS desempate, 'smalldata'::text AS origem
        FROM legado_maletas lm JOIN legado_consultoras lc ON lc.codcli = lm.codcli
       WHERE lc.party_id = _party AND lm.tipo = 'remessa' AND lm.pecas_enviadas >= 10
      UNION ALL
      SELECT coalesce(nullif((SELECT sum(kb.qty_allocated) FROM kit_balances kb WHERE kb.cycle_id = c.id), 0), c.quantity_total, 0)::numeric,
             coalesce(c.shipped_at, c.created_at), c.created_at, 'lardan'
        FROM kit_cycles c
       WHERE c.consultora_party_id = _party
         AND c.status IN ('conferida','expedida','transito','recebida','operacao','acerto','encerrada')
    ) x WHERE enviadas >= 10 ORDER BY quando DESC NULLS LAST, desempate DESC NULLS LAST LIMIT 3)
  SELECT jsonb_build_object(
    'maletas', (SELECT count(*) FROM ult),
    'media', (SELECT round(avg(enviadas),1) FROM ult),
    'base', (SELECT coalesce(jsonb_agg(jsonb_build_object('pecas', enviadas::int, 'quando', quando, 'origem', origem) ORDER BY quando DESC NULLS LAST, desempate DESC NULLS LAST), '[]'::jsonb) FROM ult),
    'regra', 'média das peças enviadas nas últimas 3 maletas, arredondada para o múltiplo de 5 mais próximo',
    'total', (SELECT CASE WHEN count(*) = 0 OR avg(enviadas) <= 0 THEN NULL
                          ELSE least(greatest((round(avg(enviadas) / 5) * 5)::int, 5), 1000) END FROM ult))
  WHERE (public.kit_ve_rede()
         OR public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque','montagem']::public.app_role[]))
    AND public.colab_party_ok(_party);
$function$;