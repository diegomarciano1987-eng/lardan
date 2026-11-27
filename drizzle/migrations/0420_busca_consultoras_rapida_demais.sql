CREATE OR REPLACE FUNCTION public.remessa_consultoras_sem_praca_busca(_remessa uuid, _search text)
 RETURNS TABLE(party_id uuid, display_name text, representante text, code text, cpf text, praca text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE _uid uuid := auth.uid(); _rest boolean; r public.remessas;
  _reps uuid[]; _pracas uuid[]; _diretas uuid[];
  _t text := btrim(coalesce(_search,'')); _d text; _tok text[];
BEGIN
  IF _uid IS NULL OR length(_t) < 2 OR NOT public.can_manage_kits(_uid) THEN RETURN; END IF;
  SELECT * INTO r FROM public.remessas WHERE id = _remessa;
  IF r.id IS NULL THEN RETURN; END IF;
  _rest := public.colab_restrita();
  IF _rest THEN
    _reps := coalesce(public.colab_reps(), '{}'); _pracas := coalesce(public.colab_pracas_extra(), '{}');
    _diretas := coalesce(public.colab_direta_party_ids(), '{}');
  END IF;
  _d := regexp_replace(_t, '\D', '', 'g');
  _tok := ARRAY(SELECT x FROM unnest(string_to_array(public.cidade_norm(_t), ' ')) x WHERE x <> '');
  RETURN QUERY
  SELECT cp.party_id, pa.display_name, rp.display_name, pa.code, public.cpf_mascarado(pa.doc), pr.nome
    FROM public.consultant_profiles cp
    JOIN public.parties pa ON pa.id = cp.party_id AND pa.status NOT IN ('desligado','bloqueado','rascunho')
    LEFT JOIN public.parties rp ON rp.id = cp.representative_party_id
    LEFT JOIN public.cob_pracas pr ON pr.id = cp.praca_id
   WHERE cp.praca_id IS DISTINCT FROM r.praca_id
     AND (NOT _rest OR (cp.praca_id IS NULL AND (cp.representative_party_id IS NULL OR r.representante_party_id IS NULL
                         OR cp.representative_party_id = r.representante_party_id)
                    AND (cp.representative_party_id = ANY(_reps) OR cp.praca_id = ANY(_pracas) OR cp.party_id = ANY(_diretas))))
     AND NOT EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id = pa.id)
     AND ((pa.code IS NOT NULL AND upper(pa.code) LIKE upper(_t) || '%')
       OR NOT EXISTS (SELECT 1 FROM unnest(_tok) x WHERE public.cidade_norm(coalesce(pa.display_name,'') || ' ' || coalesce(pa.code,'')) NOT LIKE '%' || x || '%')
       OR EXISTS (SELECT 1 FROM public.party_codigos_legados l WHERE l.party_id = pa.id AND upper(l.codigo) LIKE upper(_t) || '%')
       OR EXISTS (SELECT 1 FROM public.party_codigo_historico h WHERE h.party_id = pa.id AND upper(h.code_antigo) LIKE upper(_t) || '%')
       OR (length(_d) >= 3 AND (regexp_replace(coalesce(pa.doc,''), '\D', '', 'g') LIKE _d || '%'
            OR (length(_d) >= 6 AND regexp_replace(coalesce(pa.doc,''), '\D', '', 'g') LIKE '%' || _d || '%'))))
   ORDER BY (upper(coalesce(pa.code,'')) = upper(_t)) DESC, (cp.praca_id IS NULL) DESC, pa.display_name
   LIMIT 30;
END $function$;

CREATE OR REPLACE FUNCTION public.maleta_direta_consultoras(_search text)
 RETURNS TABLE(party_id uuid, display_name text, code text, cpf text, praca_id uuid, praca text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE _t text := btrim(coalesce(_search,'')); _d text; _tok text[];
BEGIN
  IF auth.uid() IS NULL OR length(_t) < 2 OR NOT public.can_manage_kits(auth.uid()) THEN RETURN; END IF;
  _d := regexp_replace(_t, '\D', '', 'g');
  _tok := ARRAY(SELECT x FROM unnest(string_to_array(public.cidade_norm(_t), ' ')) x WHERE x <> '');
  RETURN QUERY
  SELECT cp.party_id, pa.display_name, pa.code, public.cpf_mascarado(pa.doc), cp.praca_id, pr.nome
    FROM public.consultant_profiles cp
    JOIN public.parties pa ON pa.id = cp.party_id AND pa.status NOT IN ('desligado','bloqueado','rascunho')
    LEFT JOIN public.cob_pracas pr ON pr.id = cp.praca_id
   WHERE NOT EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id = pa.id)
     AND ((pa.code IS NOT NULL AND upper(pa.code) LIKE upper(_t) || '%')
       OR NOT EXISTS (SELECT 1 FROM unnest(_tok) x WHERE public.cidade_norm(coalesce(pa.display_name,'') || ' ' || coalesce(pa.code,'')) NOT LIKE '%' || x || '%')
       OR EXISTS (SELECT 1 FROM public.party_codigos_legados l WHERE l.party_id = pa.id AND upper(l.codigo) LIKE upper(_t) || '%')
       OR EXISTS (SELECT 1 FROM public.party_codigo_historico h WHERE h.party_id = pa.id AND upper(h.code_antigo) LIKE upper(_t) || '%')
       OR (length(_d) >= 3 AND (regexp_replace(coalesce(pa.doc,''), '\D', '', 'g') LIKE _d || '%'
            OR (length(_d) >= 6 AND regexp_replace(coalesce(pa.doc,''), '\D', '', 'g') LIKE '%' || _d || '%'))))
   ORDER BY (upper(coalesce(pa.code,'')) = upper(_t)) DESC, pa.display_name
   LIMIT 30;
END $function$;