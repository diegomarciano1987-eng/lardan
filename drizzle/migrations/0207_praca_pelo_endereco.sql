CREATE OR REPLACE FUNCTION public.cidade_norm(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(upper(translate(btrim(coalesce(_t,'')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g')
$$;

-- Praça pela cidade/UF: só quando UMA praça ativa (fora a loja interna) atende a cidade. Cidade dividida = manual.
CREATE OR REPLACE FUNCTION public.praca_pela_cidade(_cidade text, _uf text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN count(DISTINCT p.id) = 1 THEN min(p.id::text)::uuid END
  FROM cob_pracas p
  JOIN legado_pracas lp ON lp.praca_id = p.id
  WHERE p.ativo AND p.nome NOT ILIKE '%INTERNO%'
    AND public.cidade_norm(_cidade) <> '' AND btrim(coalesce(_uf,'')) <> ''
    AND (public.cidade_norm(_cidade) || '/' || upper(btrim(_uf))) = ANY (
      SELECT public.cidade_norm(x) FROM unnest(string_to_array(lp.cidades, '|')) x)
$$;
REVOKE ALL ON FUNCTION public.praca_pela_cidade(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.praca_pela_cidade(text,text) TO authenticated, service_role;

-- Ao gravar endereço principal com cidade: consultora sem praça recebe a praça (nunca troca praça existente).
CREATE OR REPLACE FUNCTION public.consultora_praca_pelo_endereco_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF coalesce(new.is_primary, true) AND new.city IS NOT NULL THEN
    v := public.praca_pela_cidade(new.city, new.uf);
    IF v IS NOT NULL THEN
      UPDATE consultant_profiles SET praca_id = v WHERE party_id = new.party_id AND praca_id IS NULL;
    END IF;
  END IF;
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.consultora_praca_pelo_endereco_trg() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS zz_consultora_praca_pelo_endereco ON public.party_addresses;
CREATE TRIGGER zz_consultora_praca_pelo_endereco AFTER INSERT OR UPDATE OF city, uf, is_primary ON public.party_addresses
FOR EACH ROW EXECUTE FUNCTION public.consultora_praca_pelo_endereco_trg();

-- Ficha criada depois do endereço: preenche na criação.
CREATE OR REPLACE FUNCTION public.consultora_praca_na_ficha_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.praca_id IS NULL THEN
    SELECT public.praca_pela_cidade(a.city, a.uf) INTO new.praca_id
      FROM party_addresses a WHERE a.party_id = new.party_id AND a.city IS NOT NULL
      ORDER BY a.is_primary DESC, a.created_at LIMIT 1;
  END IF;
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.consultora_praca_na_ficha_trg() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS a_consultora_praca_na_ficha ON public.consultant_profiles;
CREATE TRIGGER a_consultora_praca_na_ficha BEFORE INSERT ON public.consultant_profiles
FOR EACH ROW EXECUTE FUNCTION public.consultora_praca_na_ficha_trg();

-- Busca da remessa: sem corte em 200 (cortava a partir da letra L), busca por partes sem acento, nome ou código.
CREATE OR REPLACE FUNCTION public.praca_consultoras(_praca uuid, _search text DEFAULT NULL::text)
 RETURNS TABLE(party_id uuid, display_name text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT cp.party_id, pa.display_name
  FROM colab_v_consultant_profiles cp
  JOIN parties pa ON pa.id = cp.party_id
  WHERE cp.praca_id = _praca
    AND pa.status NOT IN ('desligado','bloqueado')
    AND public.kit_ve_rede()
    AND (_search IS NULL OR btrim(_search) = ''
         OR NOT EXISTS (
              SELECT 1 FROM unnest(string_to_array(public.cidade_norm(_search), ' ')) t
              WHERE t <> '' AND public.cidade_norm(pa.display_name || ' ' || coalesce(pa.code,'')) NOT LIKE '%' || t || '%')
         OR (regexp_replace(btrim(_search),'\D','','g') <> ''
             AND regexp_replace(coalesce(pa.doc,''),'\D','','g') LIKE regexp_replace(btrim(_search),'\D','','g') || '%'))
  ORDER BY pa.display_name
  LIMIT 2000;
$function$;