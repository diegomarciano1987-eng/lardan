CREATE OR REPLACE FUNCTION public.remessa_consultoras_buscar(_remessa uuid, _search text)
 RETURNS TABLE(party_id uuid, display_name text, code text, cpf text, praca text, mesma_praca boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _uid uuid := auth.uid(); _rest boolean; _praca uuid;
  _reps uuid[]; _pracas uuid[]; _diretas uuid[];
  _t text := btrim(coalesce(_search,'')); _d text; _tok text[];
BEGIN
  IF _uid IS NULL OR NOT public.can_manage_kits(_uid) OR NOT public.colab_rem_ok(_remessa) THEN RETURN; END IF;
  SELECT r.praca_id INTO _praca FROM public.remessas r WHERE r.id = _remessa;
  IF NOT FOUND THEN RETURN; END IF;
  _rest := public.colab_restrita();
  IF _rest THEN
    _reps := coalesce(public.colab_reps(), '{}'); _pracas := coalesce(public.colab_pracas_extra(), '{}');
    _diretas := coalesce(public.colab_direta_party_ids(), '{}');
  END IF;
  _d := regexp_replace(_t, '\D', '', 'g');
  _tok := ARRAY(SELECT x FROM unnest(string_to_array(public.cidade_norm(_t), ' ')) x WHERE x <> '');
  RETURN QUERY
  SELECT cp.party_id, pa.display_name, pa.code, public.cpf_mascarado(pa.doc), pr.nome,
         cp.praca_id IS NOT DISTINCT FROM _praca
    FROM public.consultant_profiles cp
    JOIN public.parties pa ON pa.id = cp.party_id
    LEFT JOIN public.cob_pracas pr ON pr.id = cp.praca_id
   WHERE (NOT _rest OR (cp.praca_id = _praca AND (cp.representative_party_id = ANY(_reps) OR cp.praca_id = ANY(_pracas) OR cp.party_id = ANY(_diretas))))
     AND pa.status NOT IN ('desligado','bloqueado','rascunho')
     AND NOT EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id = pa.id)
     AND (_t = ''
       OR (pa.code IS NOT NULL AND upper(pa.code) LIKE upper(_t) || '%')
       OR NOT EXISTS (SELECT 1 FROM unnest(_tok) x WHERE public.cidade_norm(coalesce(pa.display_name,'') || ' ' || coalesce(pa.code,'')) NOT LIKE '%' || x || '%')
       OR EXISTS (SELECT 1 FROM public.party_codigos_legados l WHERE l.party_id = pa.id AND upper(l.codigo) LIKE upper(_t) || '%')
       OR EXISTS (SELECT 1 FROM public.party_codigo_historico h WHERE h.party_id = pa.id AND upper(h.code_antigo) LIKE upper(_t) || '%')
       OR (length(_d) >= 3 AND (regexp_replace(coalesce(pa.doc,''), '\D', '', 'g') LIKE _d || '%'
            OR (length(_d) >= 6 AND regexp_replace(coalesce(pa.doc,''), '\D', '', 'g') LIKE '%' || _d || '%'))))
   ORDER BY (upper(coalesce(pa.code,'')) = upper(_t)) DESC, (cp.praca_id IS NOT DISTINCT FROM _praca) DESC, pa.display_name
   LIMIT 100;
END $function$;

CREATE OR REPLACE FUNCTION public.praca_consultoras_busca(_praca uuid, _search text)
 RETURNS TABLE(party_id uuid, display_name text, code text, cpf text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _rest boolean; _rt boolean; _rep uuid; _diretas uuid[];
  _t text := btrim(coalesce(_search,'')); _d text; _tok text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.kit_ve_rede() THEN RETURN; END IF;
  _rest := public.colab_restrita(); _rt := public.colab_rede_toda();
  IF _rest THEN _rep := public.colab_rep(); _diretas := coalesce(public.colab_direta_party_ids(), '{}'); END IF;
  _d := regexp_replace(_t, '\D', '', 'g');
  _tok := ARRAY(SELECT x FROM unnest(string_to_array(public.cidade_norm(_t), ' ')) x WHERE x <> '');
  RETURN QUERY
  SELECT cp.party_id, pa.display_name, pa.code, public.cpf_mascarado(pa.doc)
    FROM public.consultant_profiles cp
    JOIN public.parties pa ON pa.id = cp.party_id
   WHERE (NOT _rest OR cp.representative_party_id = _rep OR cp.party_id = ANY(_diretas))
     AND (cp.praca_id = _praca OR _rt)
     AND pa.status NOT IN ('desligado','bloqueado')
     AND (_t = ''
       OR (pa.code IS NOT NULL AND upper(pa.code) LIKE upper(_t) || '%')
       OR NOT EXISTS (SELECT 1 FROM unnest(_tok) x WHERE public.cidade_norm(coalesce(pa.display_name,'') || ' ' || coalesce(pa.code,'')) NOT LIKE '%' || x || '%')
       OR EXISTS (SELECT 1 FROM public.party_codigos_legados l WHERE l.party_id = pa.id AND upper(l.codigo) LIKE upper(_t) || '%')
       OR EXISTS (SELECT 1 FROM public.party_codigo_historico h WHERE h.party_id = pa.id AND upper(h.code_antigo) LIKE upper(_t) || '%')
       OR (length(_d) >= 3 AND (regexp_replace(coalesce(pa.doc,''), '\D', '', 'g') LIKE _d || '%'
            OR (length(_d) >= 6 AND regexp_replace(coalesce(pa.doc,''), '\D', '', 'g') LIKE '%' || _d || '%'))))
   ORDER BY (upper(coalesce(pa.code,'')) = upper(_t)) DESC, pa.display_name
   LIMIT 2000;
END $function$;

CREATE OR REPLACE FUNCTION public.pessoas_busca_contexto(_ids uuid[])
 RETURNS TABLE(party_id uuid, cidade text, uf text, praca text, responsavel text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE _uid uuid := auth.uid(); _staff boolean; _rest boolean; _kvr boolean;
  _reps uuid[]; _pracas uuid[]; _diretas uuid[];
BEGIN
  IF _uid IS NULL OR cardinality(coalesce(_ids,'{}'::uuid[])) > 2500 THEN RETURN; END IF;
  _staff := coalesce(public.is_staff(_uid), false); _rest := public.colab_restrita();
  IF _rest THEN
    _kvr := public.kit_ve_rede();
    _reps := coalesce(public.colab_reps(), '{}'); _pracas := coalesce(public.colab_pracas_extra(), '{}');
    _diretas := coalesce(public.colab_direta_party_ids(), '{}');
  END IF;
  RETURN QUERY
  SELECT p.id, a.city, a.uf, pr.nome, rp.display_name
    FROM unnest(coalesce(_ids, '{}'::uuid[])) WITH ORDINALITY u(id, n)
    JOIN public.parties p ON p.id = u.id
    LEFT JOIN public.consultant_profiles cp ON cp.party_id = p.id
    LEFT JOIN public.parties rp ON rp.id = cp.representative_party_id
    LEFT JOIN public.cob_pracas pr ON pr.id = cp.praca_id
    LEFT JOIN LATERAL (SELECT ad.city, ad.uf FROM public.party_addresses ad WHERE ad.party_id = p.id
                        ORDER BY ad.is_primary DESC, ad.updated_at DESC NULLS LAST LIMIT 1) a ON true
   WHERE NOT _rest
      OR _staff AND (_kvr OR cp.representative_party_id = ANY(_reps) OR cp.praca_id = ANY(_pracas) OR p.id = ANY(_diretas))
      OR (cp.representative_party_id = ANY(_reps) OR cp.praca_id = ANY(_pracas) OR p.id = ANY(_diretas))
   ORDER BY u.n;
END $function$;