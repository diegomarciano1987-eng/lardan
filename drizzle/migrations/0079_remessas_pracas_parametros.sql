
-- Etapa Remessas: praças ganham gestão própria e parâmetros de montagem configuráveis.

CREATE TABLE public.remessa_parametros (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  pecas_cliente_nova integer NOT NULL DEFAULT 35 CHECK (pecas_cliente_nova > 0),
  meta_colares integer NOT NULL DEFAULT 3 CHECK (meta_colares >= 0),
  meta_pulseiras integer NOT NULL DEFAULT 3 CHECK (meta_pulseiras >= 0),
  meta_aneis integer NOT NULL DEFAULT 4 CHECK (meta_aneis >= 0),
  meta_tornozeleiras integer NOT NULL DEFAULT 0 CHECK (meta_tornozeleiras >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.remessa_parametros TO authenticated;
GRANT UPDATE ON public.remessa_parametros TO authenticated;
GRANT ALL ON public.remessa_parametros TO service_role;
ALTER TABLE public.remessa_parametros ENABLE ROW LEVEL SECURITY;
CREATE POLICY remessa_parametros_read ON public.remessa_parametros
  FOR SELECT TO authenticated USING (true);
CREATE POLICY remessa_parametros_write ON public.remessa_parametros
  FOR UPDATE TO authenticated
  USING (public.can_manage_kits(auth.uid()))
  WITH CHECK (public.can_manage_kits(auth.uid()));
INSERT INTO public.remessa_parametros (id) VALUES (true);

CREATE OR REPLACE FUNCTION public.pracas_resumo()
RETURNS TABLE (id uuid, codigo integer, nome text, ativo boolean, consultoras bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.codigo, p.nome, p.ativo,
         (SELECT count(*) FROM consultant_profiles cp
           JOIN parties pa ON pa.id = cp.party_id
          WHERE cp.praca_id = p.id AND pa.status = 'ativo') AS consultoras
  FROM cob_pracas p
  ORDER BY p.nome;
$$;
GRANT EXECUTE ON FUNCTION public.pracas_resumo() TO authenticated;

CREATE OR REPLACE FUNCTION public.praca_criar(_nome text)
RETURNS cob_pracas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome text := upper(btrim(_nome));
  v_row cob_pracas;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para criar praças.';
  END IF;
  IF v_nome IS NULL OR length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Informe o nome da praça.';
  END IF;
  IF EXISTS (SELECT 1 FROM cob_pracas WHERE upper(nome) = v_nome) THEN
    RAISE EXCEPTION 'Já existe uma praça com este nome.';
  END IF;
  INSERT INTO cob_pracas (codigo, nome, ativo)
  VALUES ((SELECT coalesce(max(codigo), 0) + 1 FROM cob_pracas), v_nome, true)
  RETURNING * INTO v_row;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'praca_criar', 'cob_pracas', v_row.id::text,
          jsonb_build_object('nome', v_row.nome, 'codigo', v_row.codigo));
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.praca_criar(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.praca_alternar(_id uuid, _ativo boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para alterar praças.';
  END IF;
  UPDATE cob_pracas SET ativo = _ativo WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Praça não encontrada.'; END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'praca_alternar', 'cob_pracas', _id::text, jsonb_build_object('ativo', _ativo));
END;
$$;
GRANT EXECUTE ON FUNCTION public.praca_alternar(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.praca_consultoras(_praca uuid, _search text DEFAULT NULL)
RETURNS TABLE (party_id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cp.party_id, pa.display_name
  FROM consultant_profiles cp
  JOIN parties pa ON pa.id = cp.party_id
  WHERE cp.praca_id = _praca
    AND pa.status = 'ativo'
    AND (_search IS NULL OR btrim(_search) = ''
         OR pa.display_name ILIKE '%' || btrim(_search) || '%')
  ORDER BY pa.display_name
  LIMIT 60;
$$;
GRANT EXECUTE ON FUNCTION public.praca_consultoras(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.kit_consultora_info(_cycle uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'party_id', pa.id,
    'nome', pa.display_name,
    'praca', pr.nome,
    'cidade', (SELECT ad.city || '/' || ad.uf FROM party_addresses ad
                WHERE ad.party_id = pa.id ORDER BY ad.created_at LIMIT 1),
    'whatsapp', (SELECT ct.value FROM contact_points ct
                  WHERE ct.party_id = pa.id AND ct.kind = 'whatsapp'
                  ORDER BY ct.created_at LIMIT 1)
  )
  FROM kit_cycles kc
  JOIN parties pa ON pa.id = kc.consultora_party_id
  LEFT JOIN consultant_profiles cp ON cp.party_id = pa.id
  LEFT JOIN cob_pracas pr ON pr.id = cp.praca_id
  WHERE kc.id = _cycle;
$$;
GRANT EXECUTE ON FUNCTION public.kit_consultora_info(uuid) TO authenticated;
