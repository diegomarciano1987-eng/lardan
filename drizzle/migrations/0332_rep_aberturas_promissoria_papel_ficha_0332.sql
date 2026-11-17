-- 0332 (Diego 17/11)

-- ---------------------------------------------------------------- promissória assinada no papel
CREATE TABLE IF NOT EXISTS public.promissorias_papel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  representante_party_id uuid REFERENCES public.parties(id),
  valor_cents bigint,
  observacao text,
  foto_path text,
  registrado_por uuid NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  cancelada_em timestamptz,
  cancelada_por uuid,
  cancelada_motivo text
);
CREATE UNIQUE INDEX IF NOT EXISTS promissorias_papel_ativa_uq ON public.promissorias_papel (cycle_id) WHERE cancelada_em IS NULL;
CREATE INDEX IF NOT EXISTS promissorias_papel_party_idx ON public.promissorias_papel (party_id);
GRANT ALL ON public.promissorias_papel TO service_role;
ALTER TABLE public.promissorias_papel ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.promissorias_papel IS 'Promissória da maleta assinada à mão (folha A4). Leitura e escrita só por rotinas (assinaturas_da_consultora, promissoria_papel_*).';

CREATE OR REPLACE FUNCTION public.maleta_valor_cents(_cycle uuid)
 RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(sum(i.quantity::bigint * public.kit_preco(_cycle, i.variant_id)), 0)::bigint FROM kit_composition_items i
   WHERE i.composition_id = (SELECT id FROM kit_compositions WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1)
$$;
REVOKE ALL ON FUNCTION public.maleta_valor_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maleta_valor_cents(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.promissoria_papel_registrar(_rep uuid, _cycle uuid, _obs text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c kit_cycles; v_id uuid; ja uuid;
BEGIN
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.consultora_party_id IS NULL THEN RAISE EXCEPTION 'A maleta ainda não tem consultora.'; END IF;
  IF NOT public.assinatura_pode(c.consultora_party_id, _rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF c.status IN ('encerrada','cancelada') THEN RAISE EXCEPTION 'Esta maleta já foi encerrada.'; END IF;
  SELECT id INTO ja FROM promissorias_papel WHERE cycle_id = _cycle AND cancelada_em IS NULL;
  IF ja IS NOT NULL THEN RETURN jsonb_build_object('id', ja, 'repetida', true, 'party_id', c.consultora_party_id); END IF;
  INSERT INTO promissorias_papel (cycle_id, party_id, representante_party_id, valor_cents, observacao, registrado_por)
  VALUES (_cycle, c.consultora_party_id, _rep, public.maleta_valor_cents(_cycle), nullif(left(btrim(coalesce(_obs, '')), 500), ''), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'promissoria.papel', auth.uid(), jsonb_build_object('id', v_id, 'representante', _rep));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'promissoria.papel_registrada', 'kit_cycles', _cycle::text, jsonb_build_object('id', v_id, 'consultora', c.consultora_party_id, 'representante', _rep));
  RETURN jsonb_build_object('id', v_id, 'repetida', false, 'party_id', c.consultora_party_id);
END $$;
REVOKE ALL ON FUNCTION public.promissoria_papel_registrar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promissoria_papel_registrar(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.promissoria_papel_cancelar(_rep uuid, _id uuid, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE p promissorias_papel;
BEGIN
  SELECT * INTO p FROM promissorias_papel WHERE id = _id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;
  IF NOT public.assinatura_pode(p.party_id, _rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  IF p.cancelada_em IS NOT NULL THEN RETURN jsonb_build_object('repetida', true); END IF;
  UPDATE promissorias_papel SET cancelada_em = now(), cancelada_por = auth.uid(), cancelada_motivo = left(btrim(_motivo), 500) WHERE id = _id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'promissoria.papel_cancelada', 'kit_cycles', p.cycle_id::text, jsonb_build_object('id', _id, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('repetida', false);
END $$;
REVOKE ALL ON FUNCTION public.promissoria_papel_cancelar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promissoria_papel_cancelar(uuid, uuid, text) TO authenticated, service_role;

-- dados para imprimir a promissória A4 (mesmo conteúdo da montagem), liberado a quem pode mandar a promissória
CREATE OR REPLACE FUNCTION public.promissoria_dados_impressao(_rep uuid, _cycle uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c kit_cycles; v jsonb;
BEGIN
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle;
  IF c.id IS NULL OR c.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora.'; END IF;
  IF NOT public.assinatura_pode(c.consultora_party_id, _rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  SELECT jsonb_build_object(
    'nome', pa.display_name, 'doc', pa.doc, 'rg', pa.rg, 'praca', coalesce(rpr.nome, pr.nome),
    'remessa_numero', r.numero, 'remessa_emissao', r.data_emissao, 'representante', coalesce(rep.display_name, krep.display_name),
    'endereco', (SELECT btrim(concat_ws(', ', ad.street, ad.street_number)) FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'bairro', (SELECT ad.district FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'cidade', (SELECT ad.city || '/' || ad.uf FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'cep', (SELECT ad.postal_code FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'whatsapp', (SELECT ct.value FROM contact_points ct WHERE ct.party_id = pa.id AND ct.kind = 'whatsapp' ORDER BY ct.created_at LIMIT 1),
    'abertura', false, 'vencimento', coalesce(r.data_acerto::timestamptz, c.due_at),
    'valor_cents', public.maleta_valor_cents(c.id), 'maleta', k.code)
    INTO v
    FROM parties pa
    JOIN kits k ON k.id = c.kit_id
    LEFT JOIN consultant_profiles cp ON cp.party_id = pa.id LEFT JOIN cob_pracas pr ON pr.id = cp.praca_id
    LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN cob_pracas rpr ON rpr.id = r.praca_id
    LEFT JOIN parties rep ON rep.id = r.representante_party_id LEFT JOIN parties krep ON krep.id = c.representante_party_id
   WHERE pa.id = c.consultora_party_id;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.promissoria_dados_impressao(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promissoria_dados_impressao(uuid, uuid) TO authenticated, service_role;

-- documentos da consultora agora trazem também as promissórias de papel
CREATE OR REPLACE FUNCTION public.assinaturas_da_consultora(_party uuid, _rep uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.assinatura_pode(_party, _rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'documentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'titulo', x.titulo, 'status', x.status, 'ambiente', x.ambiente,
        'sign_url', CASE WHEN x.status = 'pendente' THEN x.sign_url END, 'cycle_id', x.cycle_id, 'maleta', k.code, 'valor_cents', x.valor_cents,
        'criado_em', x.criado_em, 'assinado_em', x.assinado_em, 'enviado_whatsapp', x.enviado_whatsapp, 'erro', x.erro,
        'invalidada_em', x.invalidada_em, 'invalidada_motivo', x.invalidada_motivo) ORDER BY x.criado_em DESC)
      FROM assinaturas_digitais x LEFT JOIN kit_cycles kc ON kc.id = x.cycle_id LEFT JOIN kits k ON k.id = kc.kit_id
     WHERE x.party_id = _party), '[]'::jsonb),
    'maletas', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', kc.id, 'maleta', k.code, 'status', kc.status, 'remessa', r.numero,
        'valor_cents', public.maleta_valor_cents(kc.id))
        ORDER BY kc.created_at DESC)
      FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id LEFT JOIN remessas r ON r.id = kc.remessa_id
     WHERE kc.consultora_party_id = _party AND kc.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao', 'acerto')), '[]'::jsonb),
    'papel', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'cycle_id', p.cycle_id, 'maleta', k.code, 'valor_cents', p.valor_cents,
        'registrado_em', p.registrado_em, 'tem_foto', p.foto_path IS NOT NULL, 'observacao', p.observacao,
        'registrado_por', coalesce((SELECT pr.full_name FROM profiles pr WHERE pr.id = p.registrado_por), 'equipe')) ORDER BY p.registrado_em DESC)
      FROM promissorias_papel p JOIN kit_cycles kc ON kc.id = p.cycle_id JOIN kits k ON k.id = kc.kit_id
     WHERE p.party_id = _party AND p.cancelada_em IS NULL), '[]'::jsonb));
END $function$;

-- ---------------------------------------------------------------- aberturas aguardando assinatura (lidas do servidor)
CREATE OR REPLACE FUNCTION public.rep_aberturas_assinatura(_rep uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  WITH novas AS (
    SELECT cp.party_id, cp.joined_at FROM consultant_profiles cp
     WHERE cp.representative_party_id = _rep AND cp.joined_at >= current_date - 60),
  mal AS (
    SELECT DISTINCT ON (kc.consultora_party_id) kc.consultora_party_id party_id, kc.id cycle_id, k.code maleta, kc.status::text status,
           kc.abertura_numero, r.numero remessa
      FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id LEFT JOIN remessas r ON r.id = kc.remessa_id
     WHERE kc.consultora_party_id IN (SELECT party_id FROM novas)
       AND kc.status::text IN ('conferida','expedida','transito','recebida','operacao','acerto')
     ORDER BY kc.consultora_party_id, kc.created_at DESC),
  linhas AS (
    SELECT n.party_id, n.joined_at, pa.display_name nome,
           (SELECT ct.value FROM contact_points ct WHERE ct.party_id = n.party_id AND ct.kind = 'whatsapp' ORDER BY ct.is_primary DESC, ct.created_at LIMIT 1) telefone,
           m.cycle_id, m.maleta, m.status maleta_status, m.abertura_numero, m.remessa,
           (SELECT x.status FROM assinaturas_digitais x WHERE x.party_id = n.party_id AND x.tipo = 'contrato' AND x.status <> 'cancelado' AND x.invalidada_em IS NULL ORDER BY (x.status = 'assinado') DESC, x.criado_em DESC LIMIT 1) contrato,
           (SELECT x.status FROM assinaturas_digitais x WHERE x.party_id = n.party_id AND x.tipo = 'promissoria' AND x.cycle_id = m.cycle_id AND x.status <> 'cancelado' AND x.invalidada_em IS NULL ORDER BY (x.status = 'assinado') DESC, x.criado_em DESC LIMIT 1) promissoria,
           EXISTS (SELECT 1 FROM promissorias_papel p WHERE p.cycle_id = m.cycle_id AND p.cancelada_em IS NULL) promissoria_papel,
           (SELECT max(x.assinado_em) FROM assinaturas_digitais x WHERE x.party_id = n.party_id AND x.status = 'assinado') ultima_assinatura
      FROM novas n JOIN parties pa ON pa.id = n.party_id JOIN mal m ON m.party_id = n.party_id
     WHERE pa.status::text NOT IN ('bloqueado','desligado'))
  SELECT jsonb_build_object(
    'pendentes', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.joined_at DESC, l.nome) FROM linhas l
                            WHERE coalesce(l.contrato, '') <> 'assinado' OR (coalesce(l.promissoria, '') <> 'assinado' AND NOT l.promissoria_papel)), '[]'::jsonb),
    'concluidas', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.ultima_assinatura DESC NULLS LAST) FROM (
                              SELECT * FROM linhas l WHERE l.contrato = 'assinado' AND (l.promissoria = 'assinado' OR l.promissoria_papel)
                              ORDER BY l.ultima_assinatura DESC NULLS LAST LIMIT 20) l), '[]'::jsonb))
    INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.rep_aberturas_assinatura(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_aberturas_assinatura(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- 2ª maleta: ela já tem maleta nesta remessa?
CREATE OR REPLACE FUNCTION public.rep_maleta_ja_tem(_rep uuid, _cycle uuid, _consultora uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c kit_cycles; v_code text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle;
  IF c.id IS NULL OR c.remessa_id IS NULL THEN RETURN jsonb_build_object('maleta', NULL); END IF;
  SELECT k.code INTO v_code FROM kit_cycles o JOIN kits k ON k.id = o.kit_id
   WHERE o.remessa_id = c.remessa_id AND o.consultora_party_id = _consultora AND o.id <> c.id AND o.status <> 'cancelada'
   ORDER BY o.created_at LIMIT 1;
  RETURN jsonb_build_object('maleta', v_code);
END $$;
REVOKE ALL ON FUNCTION public.rep_maleta_ja_tem(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_maleta_ja_tem(uuid, uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- ficha completa da candidata para o representante
CREATE OR REPLACE FUNCTION public.rep_candidata_ficha(_lead uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE l leads; pa parties; ad party_addresses;
BEGIN
  SELECT * INTO l FROM leads WHERE id = _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  IF NOT (public.has_capability(auth.uid(), 'candidaturas.view')
          OR (l.representante_party_id IS NOT NULL AND public.rep_portal_pode(l.representante_party_id))) THEN
    RAISE EXCEPTION 'sem_permissao' USING errcode = '42501';
  END IF;
  IF l.party_id IS NOT NULL THEN
    SELECT * INTO pa FROM parties WHERE id = l.party_id;
    SELECT * INTO ad FROM party_addresses WHERE party_id = l.party_id ORDER BY is_primary DESC, created_at LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'nome', coalesce(pa.display_name, l.full_name),
    'cpf', coalesce(pa.doc, l.cpf),
    'nascimento', pa.birth_date,
    'rg', pa.rg, 'rg_orgao', pa.rg_issuer, 'estado_civil', pa.marital_status,
    'whatsapp', l.whatsapp,
    'email', coalesce(l.email, (SELECT ct.value FROM contact_points ct WHERE ct.party_id = l.party_id AND ct.kind = 'email' ORDER BY ct.created_at LIMIT 1)),
    'cep', coalesce(ad.postal_code, l.postal_code),
    'rua', coalesce(ad.street, l.street),
    'numero', coalesce(ad.street_number, l.street_number),
    'sem_numero', coalesce(ad.no_number, l.no_number),
    'complemento', ad.complement, 'bairro', ad.district, 'referencia', ad.reference,
    'cidade', coalesce(ad.city, l.city), 'uf', coalesce(ad.uf, l.uf),
    'protocolo', l.protocol, 'enviada_em', l.created_at, 'indicado_por', l.indicado_por_texto,
    'respostas', jsonb_build_object(
      'Quanto quer ganhar por mês', l.financial_goal,
      'Tempo disponível por semana', l.availability,
      'Experiência com vendas', l.experience,
      'Para quem vai vender', l.audience,
      'Por que quer ser Lardan', l.motivation,
      'Sonho', l.dream,
      'Valor do sonho', CASE WHEN l.dream_value_cents IS NOT NULL THEN to_char(l.dream_value_cents / 100.0, 'FM999G999G990D00') END,
      'Como conheceu a Lardan', l.source),
    'envios', coalesce((SELECT jsonb_agg(jsonb_build_object('em', s.created_at, 'respostas', s.payload - 'privacy_version' - 'marketing_consent') ORDER BY s.created_at)
                          FROM candidatura_submissions s WHERE s.lead_id = l.id), '[]'::jsonb),
    'perfil_presencial', (SELECT jsonb_build_object('em', a.completed_at, 'resultado', a.metadata) FROM candidatura_assessments a
                           WHERE a.lead_id = l.id AND a.assessment_type = 'perfil_presencial' ORDER BY a.created_at DESC LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION public.rep_candidata_ficha(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_candidata_ficha(uuid) TO authenticated, service_role;