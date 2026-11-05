-- Busca única de consultora: nome por partes (sem acento), código atual, códigos antigos/legados e CPF.
CREATE OR REPLACE FUNCTION public.consultora_termo_casa(_party uuid, _nome text, _code text, _doc text, _termo text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t text := btrim(coalesce(_termo,'')); d text; doc_d text;
BEGIN
  IF t = '' THEN RETURN true; END IF;
  d := regexp_replace(t, '\D', '', 'g');
  IF _code IS NOT NULL AND upper(_code) LIKE upper(t) || '%' THEN RETURN true; END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(string_to_array(public.cidade_norm(t), ' ')) x
                 WHERE x <> '' AND public.cidade_norm(coalesce(_nome,'') || ' ' || coalesce(_code,'')) NOT LIKE '%' || x || '%') THEN
    RETURN true;
  END IF;
  IF EXISTS (SELECT 1 FROM public.party_codigos_legados l WHERE l.party_id = _party AND upper(l.codigo) LIKE upper(t) || '%')
     OR EXISTS (SELECT 1 FROM public.party_codigo_historico h WHERE h.party_id = _party AND upper(h.code_antigo) LIKE upper(t) || '%') THEN
    RETURN true;
  END IF;
  IF length(d) >= 3 THEN
    doc_d := regexp_replace(coalesce(_doc,''), '\D', '', 'g');
    IF doc_d LIKE d || '%' OR (length(d) >= 6 AND doc_d LIKE '%' || d || '%') THEN RETURN true; END IF;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.consultora_termo_casa(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_termo_casa(uuid, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cpf_mascarado(_doc text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN length(regexp_replace(coalesce(_doc,''),'\D','','g')) = 11
    THEN substr(regexp_replace(_doc,'\D','','g'),1,3) || '.***.***-' || substr(regexp_replace(_doc,'\D','','g'),10,2) END
$$;
GRANT EXECUTE ON FUNCTION public.cpf_mascarado(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.praca_consultoras_busca(_praca uuid, _search text)
RETURNS TABLE(party_id uuid, display_name text, code text, cpf text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT cp.party_id, pa.display_name, pa.code, public.cpf_mascarado(pa.doc)
  FROM colab_v_consultant_profiles cp
  JOIN parties pa ON pa.id = cp.party_id
  WHERE cp.praca_id = _praca
    AND pa.status NOT IN ('desligado','bloqueado')
    AND public.kit_ve_rede()
    AND public.consultora_termo_casa(pa.id, pa.display_name, pa.code, pa.doc, _search)
  ORDER BY (upper(coalesce(pa.code,'')) = upper(btrim(coalesce(_search,'')))) DESC, pa.display_name
  LIMIT 2000;
$$;
REVOKE ALL ON FUNCTION public.praca_consultoras_busca(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.praca_consultoras_busca(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remessa_consultoras_sem_praca_busca(_remessa uuid, _search text)
RETURNS TABLE(party_id uuid, display_name text, representante text, code text, cpf text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT cp.party_id, pa.display_name, rp.display_name, pa.code, public.cpf_mascarado(pa.doc)
  FROM remessas r
  JOIN consultant_profiles cp ON cp.praca_id IS NULL
   AND (cp.representative_party_id IS NULL OR cp.representative_party_id = r.representante_party_id)
  JOIN parties pa ON pa.id = cp.party_id AND pa.status NOT IN ('desligado','bloqueado','inativo','rascunho')
  LEFT JOIN parties rp ON rp.id = cp.representative_party_id
  WHERE r.id = _remessa AND public.can_manage_kits(auth.uid()) AND public.colab_party_ok(cp.party_id)
    AND _search IS NOT NULL AND length(btrim(_search)) >= 2
    AND public.consultora_termo_casa(pa.id, pa.display_name, pa.code, pa.doc, _search)
  ORDER BY (upper(coalesce(pa.code,'')) = upper(btrim(_search))) DESC, pa.display_name LIMIT 30;
$$;
REVOKE ALL ON FUNCTION public.remessa_consultoras_sem_praca_busca(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_consultoras_sem_praca_busca(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remessas_buscar(_busca text DEFAULT NULL::text, _status text DEFAULT NULL::text, _praca uuid DEFAULT NULL::uuid, _representante uuid DEFAULT NULL::uuid, _de date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _campo_data text DEFAULT 'emissao'::text)
 RETURNS TABLE(id uuid, numero integer, praca_id uuid, praca text, representante text, data_emissao date, data_acerto date, status text, maletas bigint, maletas_conferidas bigint, consultoras_praca bigint, pecas bigint, valor_cents bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT l.* FROM public.remessas_lista(_status) l
  JOIN colab_v_remessas r ON r.id = l.id
  WHERE (_praca IS NULL OR r.praca_id = _praca)
    AND (_representante IS NULL OR r.representante_party_id = _representante)
    AND (_de IS NULL OR (CASE WHEN _campo_data = 'acerto' THEN r.data_acerto ELSE r.data_emissao END) >= _de)
    AND (_ate IS NULL OR (CASE WHEN _campo_data = 'acerto' THEN r.data_acerto ELSE r.data_emissao END) <= _ate)
    AND (_busca IS NULL OR btrim(_busca) = ''
      OR l.numero::text LIKE btrim(_busca) || '%'
      OR l.praca ILIKE '%' || btrim(_busca) || '%'
      OR coalesce(l.representante,'') ILIKE '%' || btrim(_busca) || '%'
      OR EXISTS (SELECT 1 FROM colab_v_kit_cycles k JOIN public.parties px ON px.id = k.consultora_party_id
                 WHERE k.remessa_id = r.id
                   AND public.consultora_termo_casa(px.id, px.display_name, px.code, px.doc, _busca)))
  ORDER BY l.numero DESC;
$function$;