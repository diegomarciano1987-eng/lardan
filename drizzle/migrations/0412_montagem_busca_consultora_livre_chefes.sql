DROP FUNCTION IF EXISTS public.remessa_consultoras_sem_praca_busca(uuid, text);
CREATE FUNCTION public.remessa_consultoras_sem_praca_busca(_remessa uuid, _search text)
RETURNS TABLE(party_id uuid, display_name text, representante text, code text, cpf text, praca text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT cp.party_id, pa.display_name, rp.display_name, pa.code, public.cpf_mascarado(pa.doc), pr.nome
  FROM remessas r
  JOIN consultant_profiles cp ON cp.praca_id IS DISTINCT FROM r.praca_id
   AND (
     (NOT public.colab_restrita())
     OR (cp.praca_id IS NULL AND (cp.representative_party_id IS NULL OR r.representante_party_id IS NULL
          OR cp.representative_party_id = r.representante_party_id))
   )
  JOIN parties pa ON pa.id = cp.party_id AND pa.status NOT IN ('desligado','bloqueado','rascunho')
  LEFT JOIN parties rp ON rp.id = cp.representative_party_id
  LEFT JOIN cob_pracas pr ON pr.id = cp.praca_id
  WHERE r.id = _remessa AND public.can_manage_kits(auth.uid()) AND public.colab_party_ok(cp.party_id)
    AND _search IS NOT NULL AND length(btrim(_search)) >= 2
    AND NOT EXISTS (SELECT 1 FROM party_unificacoes u WHERE u.duplicada_id = pa.id)
    AND public.consultora_termo_casa(pa.id, pa.display_name, pa.code, pa.doc, _search)
  ORDER BY (upper(coalesce(pa.code,'')) = upper(btrim(_search))) DESC, (cp.praca_id IS NULL) DESC, pa.display_name LIMIT 30;
$function$;
REVOKE EXECUTE ON FUNCTION public.remessa_consultoras_sem_praca_busca(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remessa_consultoras_sem_praca_busca(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remessa_vincular_consultora(_remessa uuid, _consultora uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r remessas; cp consultant_profiles; livre boolean := NOT public.colab_restrita();
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode='42501'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.status IN ('fechada','cancelada') THEN RAISE EXCEPTION 'Esta remessa está %.', r.status; END IF;
  SELECT * INTO cp FROM consultant_profiles WHERE party_id = _consultora FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro de consultora não encontrado.'; END IF;
  IF NOT public.colab_party_ok(_consultora) THEN RAISE EXCEPTION 'Consultora fora da carteira.' USING errcode='42501'; END IF;
  IF cp.praca_id = r.praca_id THEN RETURN jsonb_build_object('repetida', true); END IF;
  IF NOT livre THEN
    IF cp.praca_id IS NOT NULL THEN RAISE EXCEPTION 'Esta consultora já pertence a outra praça. Mude no cadastro dela.'; END IF;
    IF cp.representative_party_id IS NOT NULL AND cp.representative_party_id IS DISTINCT FROM r.representante_party_id THEN
      RAISE EXCEPTION 'Esta consultora é de outro representante.';
    END IF;
  END IF;
  UPDATE consultant_profiles SET praca_id = r.praca_id,
    representative_party_id = coalesce(representative_party_id, r.representante_party_id), updated_at = now()
   WHERE party_id = _consultora;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_vincular_consultora', 'consultant_profiles', _consultora::text,
    jsonb_build_object('remessa', r.numero, 'praca', r.praca_id, 'praca_antes', cp.praca_id,
      'representante_antes', cp.representative_party_id, 'acesso_livre', livre));
  RETURN jsonb_build_object('repetida', false);
END $function$;