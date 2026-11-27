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
  SELECT p.id, a.city::text, a.uf::text, pr.nome::text, rp.display_name::text
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