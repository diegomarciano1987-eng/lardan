
CREATE OR REPLACE FUNCTION public.remessas_buscar(_busca text DEFAULT NULL, _status text DEFAULT NULL, _praca uuid DEFAULT NULL,
  _representante uuid DEFAULT NULL, _de date DEFAULT NULL, _ate date DEFAULT NULL, _campo_data text DEFAULT 'emissao')
RETURNS TABLE (id uuid, numero integer, praca_id uuid, praca text, representante text, data_emissao date, data_acerto date,
  status text, maletas bigint, maletas_conferidas bigint, consultoras_praca bigint, pecas bigint, valor_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.* FROM public.remessas_lista(_status) l
  JOIN remessas r ON r.id = l.id
  WHERE (_praca IS NULL OR r.praca_id = _praca)
    AND (_representante IS NULL OR r.representante_party_id = _representante)
    AND (_de IS NULL OR (CASE WHEN _campo_data = 'acerto' THEN r.data_acerto ELSE r.data_emissao END) >= _de)
    AND (_ate IS NULL OR (CASE WHEN _campo_data = 'acerto' THEN r.data_acerto ELSE r.data_emissao END) <= _ate)
    AND (_busca IS NULL OR btrim(_busca) = ''
      OR l.numero::text LIKE btrim(_busca) || '%'
      OR l.praca ILIKE '%' || btrim(_busca) || '%'
      OR coalesce(l.representante,'') ILIKE '%' || btrim(_busca) || '%'
      OR EXISTS (SELECT 1 FROM kit_cycles k JOIN parties pa ON pa.id = k.consultora_party_id
                 WHERE k.remessa_id = r.id AND pa.display_name ILIKE '%' || btrim(_busca) || '%'))
  ORDER BY l.numero DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.remessas_buscar(text,text,uuid,uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessas_buscar(text,text,uuid,uuid,date,date,text) TO authenticated;
