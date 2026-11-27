CREATE OR REPLACE FUNCTION public.remessa_consultoras_buscar(_remessa uuid, _search text)
RETURNS TABLE(party_id uuid, display_name text, code text, cpf text, praca text, mesma_praca boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT cp.party_id, pa.display_name, pa.code, public.cpf_mascarado(pa.doc), pr.nome,
        cp.praca_id IS NOT DISTINCT FROM r.praca_id
 FROM public.remessas r
 JOIN public.consultant_profiles cp ON (cp.praca_id=r.praca_id OR NOT public.colab_restrita())
 JOIN public.parties pa ON pa.id=cp.party_id
 LEFT JOIN public.cob_pracas pr ON pr.id=cp.praca_id
 WHERE r.id=_remessa AND public.can_manage_kits((SELECT auth.uid()))
   AND public.colab_rem_ok(r.id) AND public.colab_party_ok(cp.party_id)
   AND pa.status NOT IN ('desligado','bloqueado','rascunho')
   AND NOT EXISTS(SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id=pa.id)
   AND public.consultora_termo_casa(pa.id,pa.display_name,pa.code,pa.doc,_search)
 ORDER BY (upper(coalesce(pa.code,''))=upper(btrim(coalesce(_search,'')))) DESC,
          (cp.praca_id IS NOT DISTINCT FROM r.praca_id) DESC,pa.display_name
 LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.remessa_consultoras_buscar(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remessa_consultoras_buscar(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.remessa_abrir_maleta_busca(_remessa uuid,_consultora uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.remessas; cp public.consultant_profiles;
BEGIN
 IF NOT public.can_manage_kits((SELECT auth.uid())) OR NOT public.colab_rem_ok(_remessa) THEN
   RAISE EXCEPTION 'Sem permissão para esta remessa.' USING errcode='42501';
 END IF;
 SELECT * INTO r FROM public.remessas WHERE id=_remessa FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
 SELECT * INTO cp FROM public.consultant_profiles WHERE party_id=_consultora FOR UPDATE;
 IF cp.party_id IS NULL OR NOT public.colab_party_ok(_consultora) THEN
   RAISE EXCEPTION 'Consultora fora da carteira.' USING errcode='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.parties p WHERE p.id=_consultora AND p.status NOT IN ('desligado','bloqueado','rascunho'))
 OR EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id=_consultora) THEN
   RAISE EXCEPTION 'Cadastro bloqueado, desligado ou unificado.';
 END IF;
 IF cp.praca_id IS DISTINCT FROM r.praca_id THEN
   IF public.colab_restrita() THEN RAISE EXCEPTION 'Esta consultora não pertence à praça da remessa.' USING errcode='42501'; END IF;
   PERFORM public.remessa_vincular_consultora(_remessa,_consultora);
 END IF;
 RETURN public.remessa_abrir_maleta(_remessa,_consultora);
END $$;
REVOKE ALL ON FUNCTION public.remessa_abrir_maleta_busca(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remessa_abrir_maleta_busca(uuid,uuid) TO authenticated;