
CREATE TABLE public.remessas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero integer NOT NULL UNIQUE CHECK (numero > 0),
  praca_id uuid NOT NULL REFERENCES public.cob_pracas(id),
  representante_party_id uuid REFERENCES public.parties(id),
  origin_location_id uuid REFERENCES public.locations(id),
  data_emissao date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  data_acerto date,
  status text NOT NULL DEFAULT 'montagem' CHECK (status IN ('montagem','na_rua','acerto','fechada','cancelada')),
  observacoes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.remessas TO authenticated;
GRANT ALL ON public.remessas TO service_role;
ALTER TABLE public.remessas ENABLE ROW LEVEL SECURITY;
CREATE POLICY remessas_read ON public.remessas FOR SELECT TO authenticated
  USING (public.can_view_kits(auth.uid()) OR public.can_manage_kits(auth.uid()));

ALTER TABLE public.kit_cycles ADD COLUMN remessa_id uuid REFERENCES public.remessas(id);
CREATE INDEX kit_cycles_remessa_idx ON public.kit_cycles(remessa_id);
CREATE UNIQUE INDEX kit_cycles_remessa_consultora_uq ON public.kit_cycles(remessa_id, consultora_party_id)
  WHERE remessa_id IS NOT NULL AND consultora_party_id IS NOT NULL AND status <> 'cancelada';

-- Consultoras da praça: todas as ligadas à praça (cadastro histórico vem como inativo), exceto desligadas/bloqueadas.
CREATE OR REPLACE FUNCTION public.praca_consultoras(_praca uuid, _search text DEFAULT NULL)
RETURNS TABLE (party_id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cp.party_id, pa.display_name
  FROM consultant_profiles cp
  JOIN parties pa ON pa.id = cp.party_id
  WHERE cp.praca_id = _praca
    AND pa.status NOT IN ('desligado','bloqueado')
    AND (public.can_view_kits(auth.uid()) OR public.can_manage_kits(auth.uid()))
    AND (_search IS NULL OR btrim(_search) = ''
         OR pa.display_name ILIKE '%' || btrim(_search) || '%'
         OR regexp_replace(coalesce(pa.doc,''),'\D','','g') LIKE regexp_replace(btrim(_search),'\D','','g') || '%' AND regexp_replace(btrim(_search),'\D','','g') <> '')
  ORDER BY pa.display_name
  LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION public.pracas_resumo()
RETURNS TABLE (id uuid, codigo integer, nome text, ativo boolean, consultoras bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.codigo, p.nome, p.ativo,
         (SELECT count(*) FROM consultant_profiles cp JOIN parties pa ON pa.id = cp.party_id
          WHERE cp.praca_id = p.id AND pa.status NOT IN ('desligado','bloqueado')) AS consultoras
  FROM cob_pracas p ORDER BY p.nome;
$$;

CREATE OR REPLACE FUNCTION public.remessa_criar(_praca uuid, _numero integer DEFAULT NULL, _data_emissao date DEFAULT NULL,
  _data_acerto date DEFAULT NULL, _representante uuid DEFAULT NULL, _deposito uuid DEFAULT NULL, _observacoes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_num integer; v_id uuid;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para abrir remessas.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cob_pracas WHERE id = _praca AND ativo) THEN RAISE EXCEPTION 'Escolha uma praça ativa.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('remessa_numero'));
  v_num := coalesce(_numero, (SELECT coalesce(max(numero), 874) + 1 FROM remessas));
  IF EXISTS (SELECT 1 FROM remessas WHERE numero = v_num) THEN RAISE EXCEPTION 'Já existe a remessa nº %.', v_num; END IF;
  IF _data_acerto IS NOT NULL AND _data_acerto < coalesce(_data_emissao, current_date) THEN
    RAISE EXCEPTION 'A data de acerto não pode ser antes da emissão.';
  END IF;
  INSERT INTO remessas (numero, praca_id, representante_party_id, origin_location_id, data_emissao, data_acerto, observacoes, created_by)
  VALUES (v_num, _praca, _representante, _deposito,
          coalesce(_data_emissao, (now() AT TIME ZONE 'America/Sao_Paulo')::date), _data_acerto, nullif(btrim(_observacoes),''), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_criar', 'remessas', v_id::text, jsonb_build_object('numero', v_num, 'praca', _praca, 'acerto', _data_acerto));
  RETURN jsonb_build_object('id', v_id, 'numero', v_num);
END; $$;

CREATE OR REPLACE FUNCTION public.remessa_atualizar(_id uuid, _data_acerto date, _representante uuid, _status text, _observacoes text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para alterar remessas.'; END IF;
  UPDATE remessas SET data_acerto = _data_acerto, representante_party_id = _representante,
    status = coalesce(_status, status), observacoes = nullif(btrim(_observacoes),''), updated_at = now()
  WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_atualizar', 'remessas', _id::text,
          jsonb_build_object('acerto', _data_acerto, 'representante', _representante, 'status', _status));
END; $$;

CREATE OR REPLACE FUNCTION public.remessas_lista(_status text DEFAULT NULL)
RETURNS TABLE (id uuid, numero integer, praca_id uuid, praca text, representante text, data_emissao date, data_acerto date,
  status text, maletas bigint, maletas_conferidas bigint, consultoras_praca bigint, pecas bigint, valor_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.numero, r.praca_id, p.nome, rp.display_name, r.data_emissao, r.data_acerto, r.status,
    (SELECT count(*) FROM kit_cycles k WHERE k.remessa_id = r.id AND k.status <> 'cancelada'),
    (SELECT count(*) FROM kit_cycles k WHERE k.remessa_id = r.id AND k.status NOT IN ('cancelada','rascunho','montagem')),
    (SELECT count(*) FROM consultant_profiles cp JOIN parties pa ON pa.id = cp.party_id
      WHERE cp.praca_id = r.praca_id AND pa.status NOT IN ('desligado','bloqueado')),
    (SELECT coalesce(sum(k.quantity_total),0) FROM kit_cycles k WHERE k.remessa_id = r.id AND k.status <> 'cancelada')::bigint,
    (SELECT coalesce(sum(k.reference_total_cents),0) FROM kit_cycles k WHERE k.remessa_id = r.id AND k.status <> 'cancelada')::bigint
  FROM remessas r
  JOIN cob_pracas p ON p.id = r.praca_id
  LEFT JOIN parties rp ON rp.id = r.representante_party_id
  WHERE (public.can_view_kits(auth.uid()) OR public.can_manage_kits(auth.uid()))
    AND (_status IS NULL OR r.status = _status)
  ORDER BY r.numero DESC;
$$;

CREATE OR REPLACE FUNCTION public.remessa_maletas(_remessa uuid)
RETURNS TABLE (cycle_id uuid, consultora_party_id uuid, consultora text, status text, pecas integer, valor_cents bigint, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.consultora_party_id, pa.display_name, k.status::text, k.quantity_total, k.reference_total_cents::bigint, k.created_at
  FROM kit_cycles k LEFT JOIN parties pa ON pa.id = k.consultora_party_id
  WHERE k.remessa_id = _remessa AND k.status <> 'cancelada'
    AND (public.can_view_kits(auth.uid()) OR public.can_manage_kits(auth.uid()))
  ORDER BY pa.display_name;
$$;

CREATE OR REPLACE FUNCTION public.remessa_abrir_maleta(_remessa uuid, _consultora uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r remessas; v jsonb; v_cycle uuid;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para abrir maletas.'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.status IN ('fechada','cancelada') THEN RAISE EXCEPTION 'Esta remessa está %.', r.status; END IF;
  IF NOT EXISTS (SELECT 1 FROM consultant_profiles WHERE party_id = _consultora AND praca_id = r.praca_id) THEN
    RAISE EXCEPTION 'Esta consultora não pertence à praça da remessa.';
  END IF;
  SELECT id INTO v_cycle FROM kit_cycles WHERE remessa_id = r.id AND consultora_party_id = _consultora AND status <> 'cancelada';
  IF v_cycle IS NOT NULL THEN RETURN jsonb_build_object('cycle_id', v_cycle, 'repetida', true); END IF;
  v := public.kit_cycle_create(jsonb_build_object(
    'consultora_party_id', _consultora, 'representante_party_id', r.representante_party_id,
    'origin_location_id', r.origin_location_id, 'label', 'Remessa ' || r.numero,
    'due_at', CASE WHEN r.data_acerto IS NULL THEN NULL ELSE (r.data_acerto::timestamp AT TIME ZONE 'America/Sao_Paulo') END));
  v_cycle := (v->>'cycle_id')::uuid;
  UPDATE kit_cycles SET remessa_id = r.id WHERE id = v_cycle;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_abrir_maleta', 'remessas', r.id::text, jsonb_build_object('numero', r.numero, 'cycle', v_cycle, 'consultora', _consultora));
  RETURN v || jsonb_build_object('remessa_numero', r.numero);
END; $$;

CREATE OR REPLACE FUNCTION public.kit_consultora_doc(_cycle uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para ver os dados de impressão.'; END IF;
  SELECT jsonb_build_object(
    'nome', pa.display_name, 'doc', pa.doc, 'rg', pa.rg,
    'praca', coalesce(rpr.nome, pr.nome),
    'remessa_numero', r.numero,
    'remessa_emissao', r.data_emissao,
    'representante', coalesce(rep.display_name, krep.display_name),
    'endereco', (SELECT btrim(concat_ws(', ', ad.street, ad.street_number)) FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'bairro', (SELECT ad.district FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'cidade', (SELECT ad.city || '/' || ad.uf FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'cep', (SELECT ad.postal_code FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'whatsapp', (SELECT ct.value FROM contact_points ct WHERE ct.party_id = pa.id AND ct.kind = 'whatsapp' ORDER BY ct.created_at LIMIT 1),
    'vencimento', coalesce(r.data_acerto::timestamptz, kc.due_at)
  ) INTO v
  FROM kit_cycles kc
  JOIN parties pa ON pa.id = kc.consultora_party_id
  LEFT JOIN consultant_profiles cp ON cp.party_id = pa.id
  LEFT JOIN cob_pracas pr ON pr.id = cp.praca_id
  LEFT JOIN remessas r ON r.id = kc.remessa_id
  LEFT JOIN cob_pracas rpr ON rpr.id = r.praca_id
  LEFT JOIN parties rep ON rep.id = r.representante_party_id
  LEFT JOIN parties krep ON krep.id = kc.representante_party_id
  WHERE kc.id = _cycle;
  IF v IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora definida.'; END IF;
  RETURN v;
END; $$;

REVOKE EXECUTE ON FUNCTION public.remessa_criar(uuid,integer,date,date,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remessa_atualizar(uuid,date,uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remessas_lista(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remessa_maletas(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remessa_abrir_maleta(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_criar(uuid,integer,date,date,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remessa_atualizar(uuid,date,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remessas_lista(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remessa_maletas(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remessa_abrir_maleta(uuid,uuid) TO authenticated;
