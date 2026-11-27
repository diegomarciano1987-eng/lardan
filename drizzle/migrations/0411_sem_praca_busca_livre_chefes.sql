CREATE OR REPLACE FUNCTION public.remessa_consultoras_sem_praca_busca(_remessa uuid, _search text)
 RETURNS TABLE(party_id uuid, display_name text, representante text, code text, cpf text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT cp.party_id, pa.display_name, rp.display_name, pa.code, public.cpf_mascarado(pa.doc)
  FROM remessas r
  JOIN consultant_profiles cp ON cp.praca_id IS NULL
   AND (cp.representative_party_id IS NULL OR r.representante_party_id IS NULL
        OR cp.representative_party_id = r.representante_party_id
        OR public.colab_rede_toda() OR NOT public.colab_restrita())
  JOIN parties pa ON pa.id = cp.party_id AND pa.status NOT IN ('desligado','bloqueado','rascunho')
  LEFT JOIN parties rp ON rp.id = cp.representative_party_id
  WHERE r.id = _remessa AND public.can_manage_kits(auth.uid()) AND public.colab_party_ok(cp.party_id)
    AND _search IS NOT NULL AND length(btrim(_search)) >= 2
    AND NOT EXISTS (SELECT 1 FROM party_unificacoes u WHERE u.duplicada_id = pa.id)
    AND public.consultora_termo_casa(pa.id, pa.display_name, pa.code, pa.doc, _search)
  ORDER BY (upper(coalesce(pa.code,'')) = upper(btrim(_search))) DESC, pa.display_name LIMIT 30;
$function$;