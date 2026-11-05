-- 0224 — Maleta de ABERTURA, DANFE enxuto e assinatura digital (ZapSign)
DO $abertura$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.kit_pedido_dados(uuid)'::regprocedure);
  IF position('''abertura''' in def) = 0 THEN
  novo := replace(def,
    $a$IF kc.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora definida.'; END IF;$a$,
    $b$IF kc.consultora_party_id IS NULL AND coalesce(kc.representante_party_id, kc.custodian_party_id) IS NULL THEN
    RAISE EXCEPTION 'Maleta sem consultora nem representante.';
  END IF;$b$);
  IF novo = def THEN RAISE EXCEPTION '0224: trava de consultora não encontrada em kit_pedido_dados'; END IF;
  def := novo;
  novo := replace(def, $a$'montado_por', montador,$a$, $b$'montado_por', montador, 'abertura', kc.consultora_party_id IS NULL,$b$);
  IF novo = def THEN RAISE EXCEPTION '0224: campo montado_por não encontrado em kit_pedido_dados'; END IF;
  EXECUTE novo;
  END IF;

  def := pg_get_functiondef('public.kit_consultora_doc(uuid)'::regprocedure);
  IF position('''abertura''' in def) = 0 THEN
  novo := replace(def, 'JOIN parties pa ON pa.id = kc.consultora_party_id', 'LEFT JOIN parties pa ON pa.id = kc.consultora_party_id');
  IF novo = def THEN RAISE EXCEPTION '0224: junção da consultora não encontrada em kit_consultora_doc'; END IF;
  def := novo;
  novo := replace(def, $a$'vencimento', coalesce($a$, $b$'abertura', kc.consultora_party_id IS NULL, 'vencimento', coalesce($b$);
  IF novo = def THEN RAISE EXCEPTION '0224: campo vencimento não encontrado em kit_consultora_doc'; END IF;
  def := novo;
  novo := replace(def, $a$IF v IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora definida.'; END IF;$a$,
    $b$IF v IS NULL OR (coalesce((v->>'abertura')::boolean, false) AND v->>'representante' IS NULL) THEN
    RAISE EXCEPTION 'Maleta sem consultora nem representante.';
  END IF;$b$);
  IF novo = def THEN RAISE EXCEPTION '0224: trava final não encontrada em kit_consultora_doc'; END IF;
  EXECUTE novo;
  END IF;
END $abertura$;

CREATE OR REPLACE FUNCTION public.fiscal_fila_kit_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record; v_etapa text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_etapa := CASE NEW.status::text WHEN 'conferida' THEN 'remessa' WHEN 'encerrada' THEN 'acerto' END;
  ELSIF OLD.consultora_party_id IS NULL AND NEW.consultora_party_id IS NOT NULL
        AND NEW.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao') THEN
    v_etapa := 'remessa';
  END IF;
  IF v_etapa IS NULL OR NEW.consultora_party_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO s FROM fiscal_settings WHERE id;
  IF NOT (public.fiscal_focus_producao_ativa() AND s.producao_automatico AND (s.producao_todas OR s.producao_piloto_cycle_id = NEW.id)) THEN
    RETURN NEW;
  END IF;
  IF v_etapa = 'acerto' AND NOT EXISTS (SELECT 1 FROM fiscal_focus_envios e WHERE e.cycle_id = NEW.id AND e.operacao = 'remessa'
                                       AND e.ambiente = 'producao' AND e.status = 'autorizado') THEN
    RETURN NEW;
  END IF;
  INSERT INTO fiscal_fila (cycle_id, etapa) VALUES (NEW.id, v_etapa)
   ON CONFLICT (cycle_id, etapa) DO UPDATE SET status = 'pendente', proxima_em = now(), atualizado_em = now()
   WHERE fiscal_fila.status = 'erro';
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_fila_kit_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_fiscal_fila_kit ON public.kit_cycles;
CREATE TRIGGER zz_fiscal_fila_kit AFTER UPDATE OF status, consultora_party_id ON public.kit_cycles
FOR EACH ROW EXECUTE FUNCTION public.fiscal_fila_kit_trg();

CREATE OR REPLACE FUNCTION public.fiscal_focus_pode_danfe(_ref text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.fiscal_focus_pode('ver')
    OR (public.can_manage_kits(auth.uid()) AND EXISTS (SELECT 1 FROM fiscal_focus_envios e WHERE e.ref = _ref AND e.cycle_id IS NOT NULL)))
$$;
REVOKE ALL ON FUNCTION public.fiscal_focus_pode_danfe(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_pode_danfe(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fiscal_focus_notas_maletas(_cycles uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (public.fiscal_focus_pode('ver') OR public.can_manage_kits(auth.uid())) THEN RETURN '[]'::jsonb; END IF;
  IF coalesce(array_length(_cycles, 1), 0) > 500 THEN RAISE EXCEPTION 'Informe até 500 maletas.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'cycle_id', e.cycle_id, 'ref', e.ref, 'ambiente', e.ambiente, 'status', e.status,
      'status_sefaz', e.status_sefaz, 'mensagem_sefaz', e.mensagem_sefaz, 'erros', e.erros,
      'numero', e.numero, 'serie', e.serie, 'tem_danfe', e.caminho_xml IS NOT NULL OR e.caminho_danfe IS NOT NULL,
      'desatualizada', e.composicao_versao IS DISTINCT FROM (SELECT max(version) FROM kit_compositions c WHERE c.cycle_id = e.cycle_id),
      'created_at', e.created_at,
      'acerto', coalesce((SELECT jsonb_agg(jsonb_build_object('operacao', a.operacao, 'ref', a.ref, 'status', a.status, 'numero', a.numero,
                                   'mensagem_sefaz', a.mensagem_sefaz, 'erros', a.erros, 'tem_danfe', a.caminho_xml IS NOT NULL OR a.caminho_danfe IS NOT NULL)
                                   ORDER BY a.operacao)
                  FROM (SELECT DISTINCT ON (operacao) * FROM fiscal_focus_envios x
                         WHERE x.cycle_id = e.cycle_id AND x.operacao IN ('devolucao', 'venda', 'perda') AND x.ambiente = e.ambiente
                         ORDER BY operacao, created_at DESC) a), '[]'::jsonb)))
    FROM (SELECT DISTINCT ON (cycle_id) * FROM fiscal_focus_envios
           WHERE cycle_id = ANY(_cycles) AND operacao = 'remessa'
           ORDER BY cycle_id, created_at DESC) e), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_notas_maletas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_notas_maletas(uuid[]) TO authenticated;

CREATE TABLE IF NOT EXISTS public.assinatura_modelos (
  tipo text PRIMARY KEY CHECK (tipo IN ('contrato', 'promissoria')),
  titulo text NOT NULL,
  texto text NOT NULL,
  revisado boolean NOT NULL DEFAULT false,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.assinatura_modelos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assinatura_modelos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.assinatura_modelos TO service_role;

INSERT INTO public.assinatura_modelos (tipo, titulo, texto) VALUES
('promissoria', 'Nota promissória — maleta {{maleta}}', $md$# NOTA PROMISSÓRIA

**Referente à maleta {{maleta}}** · Remessa {{remessa}}

**Vencimento:** {{vencimento}}

**Valor:** {{valor}} ({{valor_extenso}})

Em **{{vencimento_extenso}}** pagarei por esta única via de NOTA PROMISSÓRIA a **TSM COMÉRCIO DE SEMIJOIAS LTDA**, inscrita no CNPJ/MF sob nº **43.319.208/0001-80**, ou à sua ordem, a quantia de **{{valor_extenso}}** em moeda corrente deste país.

Pagável em **Ibiporã - PR**.

**Emitente (DEVEDORA):** {{nome}}

**CPF/MF:** {{cpf}}

**Endereço:** {{endereco}} - {{bairro}}

**Cidade/UF:** {{cidade}} · **CEP:** {{cep}}

Ibiporã/PR, {{hoje_extenso}}.
$md$),
('contrato', 'Contrato de consignação — {{nome}}', $md$# CONTRATO DE CONSIGNAÇÃO DE SEMIJOIAS

> **RASCUNHO — revisar com o jurídico antes de usar em produção.** O Master edita este texto em Integrações › Assinatura digital.

**CONSIGNANTE:** TSM COMÉRCIO DE SEMIJOIAS LTDA (LARDAN SEMIJOIAS), CNPJ 43.319.208/0001-80, Av. dos Estudantes, 1277, Setor 1, Ibiporã/PR.

**CONSIGNATÁRIA (CONSULTORA):** {{nome}}, CPF {{cpf}}, residente em {{endereco}} - {{bairro}}, {{cidade}}, CEP {{cep}}, WhatsApp {{whatsapp}}.

**Representante responsável:** {{representante}} · Praça {{praca}}.

1. **Objeto.** A CONSIGNANTE entrega à CONSULTORA, em consignação, maletas de semijoias para revenda, conforme o pedido de consignação de cada remessa, que integra este contrato.
2. **Preço e comissão.** As peças serão revendidas pelo preço indicado no pedido de consignação. A comissão da CONSULTORA segue as faixas vigentes informadas no pedido e no aplicativo Lardan.
3. **Acerto.** Na data de acerto de cada remessa, a CONSULTORA devolve as peças não vendidas e paga o valor das vendidas, descontada a sua comissão. Peças não devolvidas são consideradas vendidas pelo preço do pedido.
4. **Guarda.** A CONSULTORA é responsável pela guarda e conservação das peças enquanto estiverem com ela.
5. **Garantia.** A garantia das peças segue as regras impressas no pedido de consignação.
6. **Nota promissória.** A cada maleta entregue, a CONSULTORA assina nota promissória no valor da maleta, como garantia do acerto.
7. **Dados e comunicações.** A CONSULTORA autoriza o uso dos seus dados para cadastro, emissão de notas fiscais, cobrança e comunicações pelo WhatsApp e pelo aplicativo Lardan.
8. **Vigência.** Este contrato vale por prazo indeterminado e pode ser encerrado por qualquer das partes após o acerto de todas as maletas em aberto.
9. **Foro.** Fica eleito o foro da comarca de Ibiporã/PR.

Ibiporã/PR, {{hoje_extenso}}.
$md$)
ON CONFLICT (tipo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.assinaturas_digitais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provedor text NOT NULL DEFAULT 'zapsign',
  ambiente text NOT NULL CHECK (ambiente IN ('sandbox', 'producao')),
  tipo text NOT NULL CHECK (tipo IN ('contrato', 'promissoria')),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  cycle_id uuid REFERENCES public.kit_cycles(id),
  representante_party_id uuid REFERENCES public.parties(id),
  doc_token text UNIQUE,
  signer_token text,
  sign_url text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'assinado', 'recusado', 'cancelado', 'erro')),
  titulo text NOT NULL,
  texto_hash text NOT NULL,
  valor_cents bigint,
  enviado_whatsapp boolean NOT NULL DEFAULT false,
  erro text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  assinado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo <> 'promissoria' OR cycle_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS assinaturas_party_idx ON public.assinaturas_digitais (party_id, criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_pendente_unica
  ON public.assinaturas_digitais (party_id, tipo, coalesce(cycle_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'pendente';
ALTER TABLE public.assinaturas_digitais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assinaturas_digitais FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.assinaturas_digitais TO service_role;

CREATE OR REPLACE FUNCTION public.assinatura_pode(_party uuid, _rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro']::public.app_role[])
    OR public.can_manage_kits(auth.uid())
    OR (_rep IS NOT NULL AND public.rep_portal_pode(_rep)
        AND EXISTS (SELECT 1 FROM consultant_profiles cp WHERE cp.party_id = _party AND cp.representative_party_id = _rep)))
$$;
REVOKE ALL ON FUNCTION public.assinatura_pode(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_pode(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assinatura_dados(_tipo text, _party uuid, _cycle uuid, _rep uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p record; a record; m record; kc record; r record; cp record; valor bigint; venc date; pend jsonb; zap text; mail text;
  v_maleta text := ''; v_remessa text := '';
BEGIN
  IF NOT public.assinatura_pode(_party, _rep) THEN RAISE EXCEPTION 'Sem permissão para esta consultora.' USING errcode = '42501'; END IF;
  IF _tipo NOT IN ('contrato', 'promissoria') THEN RAISE EXCEPTION 'Tipo inválido.'; END IF;
  SELECT * INTO m FROM assinatura_modelos WHERE tipo = _tipo;
  SELECT * INTO p FROM parties WHERE id = _party;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultora não encontrada.'; END IF;
  SELECT * INTO a FROM party_addresses WHERE party_id = _party ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT * INTO cp FROM consultant_profiles WHERE party_id = _party;
  SELECT regexp_replace(value, '\D', '', 'g') INTO zap FROM contact_points WHERE party_id = _party AND kind = 'whatsapp' ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT value INTO mail FROM contact_points WHERE party_id = _party AND kind = 'email' ORDER BY is_primary DESC, created_at LIMIT 1;

  IF _tipo = 'promissoria' THEN
    IF _cycle IS NULL THEN RAISE EXCEPTION 'Escolha a maleta da promissória.'; END IF;
    SELECT * INTO kc FROM kit_cycles WHERE id = _cycle;
    IF NOT FOUND OR kc.consultora_party_id IS DISTINCT FROM _party THEN RAISE EXCEPTION 'Esta maleta não é desta consultora.'; END IF;
    SELECT * INTO r FROM remessas WHERE id = kc.remessa_id;
    SELECT coalesce(sum(i.quantity::bigint * public.kit_preco(_cycle, i.variant_id)), 0) INTO valor
      FROM kit_composition_items i WHERE i.composition_id = (SELECT id FROM kit_compositions WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1);
    venc := coalesce(r.data_acerto, (kc.due_at AT TIME ZONE 'America/Sao_Paulo')::date);
    IF valor <= 0 THEN RAISE EXCEPTION 'Maleta sem peças.'; END IF;
    v_maleta := coalesce((SELECT code FROM kits WHERE id = kc.kit_id), '');
    v_remessa := coalesce(r.numero::text, '');
  END IF;

  pend := '[]'::jsonb;
  IF zap IS NULL OR length(zap) < 10 THEN pend := pend || '["WhatsApp da consultora"]'::jsonb; END IF;
  IF p.doc_digits IS NULL OR length(p.doc_digits) <> 11 THEN pend := pend || '["CPF da consultora"]'::jsonb; END IF;

  RETURN jsonb_build_object(
    'modelo', jsonb_build_object('titulo', m.titulo, 'texto', m.texto, 'revisado', m.revisado),
    'pendencias', pend,
    'signer', jsonb_build_object('nome', p.display_name, 'cpf', p.doc_digits, 'whatsapp', zap, 'email', mail),
    'campos', jsonb_build_object(
      'nome', p.display_name,
      'cpf', CASE WHEN length(p.doc_digits) = 11 THEN regexp_replace(p.doc_digits, '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4') ELSE coalesce(p.doc_digits, '') END,
      'codigo', p.code,
      'endereco', btrim(concat_ws(', ', a.street, a.street_number)), 'bairro', coalesce(a.district, ''),
      'cidade', coalesce(a.city || '/' || a.uf, ''), 'cep', coalesce(regexp_replace(a.postal_code, '^(\d{5})(\d{3})$', '\1-\2'), ''),
      'whatsapp', coalesce(zap, ''),
      'representante', coalesce((SELECT display_name FROM parties WHERE id = coalesce(cp.representative_party_id, _rep)), ''),
      'praca', coalesce((SELECT nome FROM cob_pracas WHERE id = cp.praca_id), ''),
      'maleta', v_maleta,
      'remessa', v_remessa,
      'valor_cents', valor,
      'vencimento', venc));
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_dados(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_dados(text, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assinatura_pendente(_tipo text, _party uuid, _cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  RETURN (SELECT to_jsonb(x) FROM assinaturas_digitais x WHERE x.party_id = _party AND x.tipo = _tipo
            AND x.cycle_id IS NOT DISTINCT FROM _cycle AND x.status = 'pendente' ORDER BY criado_em DESC LIMIT 1);
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_pendente(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_pendente(text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.assinatura_registrar(_d jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE novo uuid;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF nullif(_d->>'substitui', '') IS NOT NULL THEN
    UPDATE assinaturas_digitais SET status = 'cancelado', atualizado_em = now()
     WHERE id = (_d->>'substitui')::uuid AND status = 'pendente';
  END IF;
  INSERT INTO assinaturas_digitais (ambiente, tipo, party_id, cycle_id, representante_party_id, doc_token, signer_token, sign_url,
                                    status, titulo, texto_hash, valor_cents, enviado_whatsapp, erro, criado_por)
  VALUES (_d->>'ambiente', _d->>'tipo', (_d->>'party_id')::uuid, nullif(_d->>'cycle_id', '')::uuid, nullif(_d->>'rep', '')::uuid,
          _d->>'doc_token', _d->>'signer_token', _d->>'sign_url', coalesce(_d->>'status', 'pendente'), _d->>'titulo', _d->>'texto_hash',
          nullif(_d->>'valor_cents', '')::bigint, coalesce((_d->>'whatsapp')::boolean, false), _d->>'erro', nullif(_d->>'ator', '')::uuid)
  RETURNING id INTO novo;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (nullif(_d->>'ator', '')::uuid, 'assinatura.enviada', 'assinaturas_digitais', novo::text,
          jsonb_build_object('tipo', _d->>'tipo', 'party_id', _d->>'party_id', 'cycle_id', _d->>'cycle_id', 'ambiente', _d->>'ambiente'));
  RETURN jsonb_build_object('id', novo);
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_registrar(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_registrar(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.assinatura_retorno(_doc_token text, _status text, _assinado_em timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE x record; st text;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  SELECT * INTO x FROM assinaturas_digitais WHERE doc_token = _doc_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ignorado', true); END IF;
  st := CASE _status WHEN 'signed' THEN 'assinado' WHEN 'refused' THEN 'recusado' WHEN 'deleted' THEN 'cancelado' ELSE x.status END;
  IF x.status = 'assinado' THEN st := 'assinado'; END IF;
  UPDATE assinaturas_digitais SET status = st, assinado_em = CASE WHEN st = 'assinado' THEN coalesce(assinado_em, _assinado_em, now()) END,
         atualizado_em = now() WHERE id = x.id;
  IF st IS DISTINCT FROM x.status THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'assinatura.' || st, 'assinaturas_digitais', x.id::text, jsonb_build_object('tipo', x.tipo, 'party_id', x.party_id));
  END IF;
  RETURN jsonb_build_object('id', x.id, 'status', st);
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_retorno(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_retorno(text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.assinatura_ler(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  RETURN (SELECT to_jsonb(x) FROM assinaturas_digitais x WHERE x.id = _id);
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_ler(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_ler(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.assinaturas_da_consultora(_party uuid, _rep uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.assinatura_pode(_party, _rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'documentos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'titulo', x.titulo, 'status', x.status, 'ambiente', x.ambiente,
        'sign_url', CASE WHEN x.status = 'pendente' THEN x.sign_url END, 'cycle_id', x.cycle_id, 'maleta', k.code, 'valor_cents', x.valor_cents,
        'criado_em', x.criado_em, 'assinado_em', x.assinado_em, 'enviado_whatsapp', x.enviado_whatsapp, 'erro', x.erro) ORDER BY x.criado_em DESC)
      FROM assinaturas_digitais x LEFT JOIN kit_cycles kc ON kc.id = x.cycle_id LEFT JOIN kits k ON k.id = kc.kit_id
     WHERE x.party_id = _party), '[]'::jsonb),
    'maletas', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', kc.id, 'maleta', k.code, 'status', kc.status, 'remessa', r.numero,
        'valor_cents', (SELECT coalesce(sum(i.quantity::bigint * public.kit_preco(kc.id, i.variant_id)), 0) FROM kit_composition_items i
                         WHERE i.composition_id = (SELECT id FROM kit_compositions WHERE cycle_id = kc.id ORDER BY version DESC LIMIT 1)))
        ORDER BY kc.created_at DESC)
      FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id LEFT JOIN remessas r ON r.id = kc.remessa_id
     WHERE kc.consultora_party_id = _party AND kc.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao', 'acerto')), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.assinaturas_da_consultora(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinaturas_da_consultora(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assinatura_modelos_ler()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['master','diretoria']::public.app_role[]) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.tipo) FROM assinatura_modelos m), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_modelos_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_modelos_ler() TO authenticated;

CREATE OR REPLACE FUNCTION public.assinatura_modelo_salvar(_tipo text, _titulo text, _texto text, _revisado boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE antes record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master edita os modelos.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_texto, ''))) < 50 THEN RAISE EXCEPTION 'Texto curto demais.'; END IF;
  SELECT * INTO antes FROM assinatura_modelos WHERE tipo = _tipo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Modelo inválido.'; END IF;
  UPDATE assinatura_modelos SET titulo = btrim(_titulo), texto = _texto, revisado = coalesce(_revisado, false),
         atualizado_por = auth.uid(), atualizado_em = now() WHERE tipo = _tipo;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'assinatura.modelo_alterado', 'assinatura_modelos', _tipo,
          jsonb_build_object('antes', antes.texto, 'revisado', _revisado));
  RETURN jsonb_build_object('tipo', _tipo);
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_modelo_salvar(text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_modelo_salvar(text, text, text, boolean) TO authenticated;