CREATE OR REPLACE FUNCTION public.kit_etiqueta_maleta_dados(_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para imprimir a etiqueta.'; END IF;
  SELECT jsonb_build_object(
    'cliente_codigo', pa.code,
    'cliente_nome', pa.display_name,
    'cidade', (SELECT ad.city || ' / ' || ad.uf FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'representante', coalesce(rep.display_name, krep.display_name),
    'remessa_numero', r.numero,
    'maleta_numero', CASE WHEN kc.remessa_id IS NULL THEN NULL ELSE
      (SELECT count(*) FROM kit_cycles k2 WHERE k2.remessa_id = kc.remessa_id AND (k2.created_at, k2.id) <= (kc.created_at, kc.id)) END,
    'maletas_total', CASE WHEN kc.remessa_id IS NULL THEN NULL ELSE
      (SELECT count(*) FROM kit_cycles k2 WHERE k2.remessa_id = kc.remessa_id) END
  ) INTO v
  FROM kit_cycles kc
  LEFT JOIN parties pa ON pa.id = coalesce(kc.consultora_party_id, kc.representante_party_id)
  LEFT JOIN remessas r ON r.id = kc.remessa_id
  LEFT JOIN parties rep ON rep.id = r.representante_party_id
  LEFT JOIN parties krep ON krep.id = kc.representante_party_id
  WHERE kc.id = _cycle;
  RETURN v;
END; $function$;
REVOKE ALL ON FUNCTION public.kit_etiqueta_maleta_dados(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.kit_etiqueta_maleta_dados(uuid) TO authenticated;