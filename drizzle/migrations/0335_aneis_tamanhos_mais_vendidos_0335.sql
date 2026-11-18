-- 0335 (Diego, 18/11/2026): tamanhos de anel mais vendidos por consultora. Só leitura.
CREATE OR REPLACE FUNCTION public.anel_tamanho_peca(_size text, _barcode text, _legacy text, _label text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN n BETWEEN 1 AND 40 THEN n::text
    ELSE NULL END
  FROM (SELECT CASE
    WHEN btrim(coalesce(_size, '')) ~ '^\d{1,2}$' THEN btrim(_size)::int
    WHEN _barcode ~ '^\d+$' AND _legacy ~ '^\d+$' AND length(_barcode) = length(_legacy) + 2
         AND left(_barcode, length(_legacy)) = _legacy THEN right(_barcode, 2)::int
    WHEN _label ~* '^\s*aro\s*\d{1,2}\s*$' THEN substring(_label from '(\d{1,2})')::int
    ELSE NULL END AS n) x
$function$;

CREATE OR REPLACE FUNCTION public.consultora_aneis_tamanhos_dados(_party uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cods AS (SELECT coalesce(public.legado_codigos_da_pessoa(_party), '{}'::int[]) c),
  lardan_rem AS (SELECT DISTINCT rm.numero FROM kit_pre_baixas pb JOIN remessas rm ON rm.id = pb.remessa_id
                  WHERE pb.consultora_party_id = _party AND pb.status IN ('fechada','encerrada','pendencia')),
  v AS (
    SELECT public.anel_tamanho_peca(v.tamanho, NULL, NULL, NULL) tam, v.quantidade q
      FROM legado_maleta_vendidos v
      JOIN legado_produtos lp ON lp.codigo = v.produto
     WHERE v.codcli = ANY ((SELECT c FROM cods)::int[]) AND v.quantidade > 0
       AND upper(translate(coalesce(lp.categoria, ''), 'éÉ', 'eE')) LIKE 'ANE%'
       AND v.remessa NOT IN (SELECT numero FROM lardan_rem)
    UNION ALL
    SELECT public.anel_tamanho_peca(pv.size, pv.barcode, pr.legacy_code, pv.label), i.qtd_vendida
      FROM kit_pre_baixas pb
      JOIN kit_pre_baixa_itens i ON i.pre_baixa_id = pb.id
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN products pr ON pr.id = pv.product_id
      JOIN categories ct ON ct.id = pr.category_id
     WHERE pb.consultora_party_id = _party AND pb.status IN ('fechada','encerrada','pendencia') AND i.qtd_vendida > 0
       AND upper(translate(coalesce(ct.name, ''), 'éÉ', 'eE')) LIKE 'ANE%'),
  g AS (SELECT tam, sum(q)::int q FROM v WHERE tam IS NOT NULL GROUP BY 1),
  com AS (SELECT coalesce(sum(q), 0)::int t FROM g)
  SELECT jsonb_build_object(
    'total', coalesce((SELECT sum(q)::int FROM v), 0),
    'com_tamanho', (SELECT t FROM com),
    'sem_tamanho', coalesce((SELECT sum(q)::int FROM v WHERE tam IS NULL), 0),
    'tamanhos', coalesce((SELECT jsonb_agg(jsonb_build_object('tamanho', g.tam, 'qtd', g.q,
                          'pct', round(100.0 * g.q / nullif((SELECT t FROM com), 0)))
                          ORDER BY g.q DESC, g.tam::int) FROM g), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.consultora_aneis_tamanhos(_party uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  IF _party IS DISTINCT FROM public.my_party_id() THEN
    IF NOT (((public.is_staff(uid) OR public.colab_restrita())
              AND (public.legado_pode_ver(uid) OR public.can_view_kits(uid) OR public.has_capability(uid, 'registry.view')))
            OR (public.has_role(uid, 'representante') AND EXISTS (SELECT 1 FROM consultant_profiles cp
                  WHERE cp.party_id = _party AND cp.representative_party_id = public.my_party_id()))) THEN
      RAISE EXCEPTION 'Sem permissão para ver as vendas desta consultora.' USING errcode = '42501';
    END IF;
    IF public.colab_restrita() AND NOT (public.has_capability(uid, 'kit.manage') OR public.colab_party_ok(_party)) THEN
      RAISE EXCEPTION 'Cadastro fora da carteira.' USING errcode = '42501';
    END IF;
  END IF;
  RETURN public.consultora_aneis_tamanhos_dados(_party);
END $function$;

REVOKE ALL ON FUNCTION public.consultora_aneis_tamanhos_dados(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_aneis_tamanhos_dados(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.consultora_aneis_tamanhos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_aneis_tamanhos(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anel_tamanho_peca(text, text, text, text) TO authenticated, service_role;