-- 1) Contrato: email, rg, estado_civil, data_nascimento direto do cadastro
CREATE OR REPLACE FUNCTION public.assinatura_dados(_tipo text, _party uuid, _cycle uuid, _rep uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
      'email', coalesce(mail, ''),
      'rg', coalesce(btrim(concat_ws(' ', p.rg, p.rg_issuer)), ''),
      'estado_civil', coalesce(p.marital_status, ''),
      'data_nascimento', coalesce(p.birth_date::text, ''),
      'endereco', btrim(concat_ws(', ', a.street, a.street_number)), 'bairro', coalesce(a.district, ''),
      'cidade', coalesce(a.city || '/' || a.uf, ''), 'cep', coalesce(regexp_replace(a.postal_code, '^(\d{5})(\d{3})$', '\1-\2'), ''),
      'whatsapp', coalesce(zap, ''),
      'representante', coalesce((SELECT display_name FROM parties WHERE id = coalesce(cp.representative_party_id, _rep)), ''),
      'praca', coalesce((SELECT nome FROM cob_pracas WHERE id = cp.praca_id), ''),
      'maleta', v_maleta, 'remessa', v_remessa, 'valor_cents', valor, 'vencimento', venc));
END $function$;

-- 2) Abertura na rua: cadastro completo + perfil, decisão do representante
CREATE OR REPLACE FUNCTION public.rep_abertura_rua_cadastrar(_rep uuid, _dados jsonb, _perfil jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); d jsonb := coalesce(_dados,'{}'::jsonb);
  v_nome text := btrim(coalesce(d->>'nome','')); v_cpf text := regexp_replace(coalesce(d->>'cpf',''),'\D','','g');
  v_zap text := regexp_replace(coalesce(d->>'whatsapp',''),'\D','','g'); v_mail text := lower(btrim(coalesce(d->>'email','')));
  v_nasc date; v_rg text := btrim(coalesce(d->>'rg','')); v_rg_org text := nullif(btrim(coalesce(d->>'rg_orgao','')),'');
  v_civil text := btrim(coalesce(d->>'estado_civil','')); v_cep text := regexp_replace(coalesce(d->>'cep',''),'\D','','g');
  v_rua text := btrim(coalesce(d->>'rua','')); v_num text := btrim(coalesce(d->>'numero',''));
  v_comp text := nullif(btrim(coalesce(d->>'complemento','')),''); v_bairro text := btrim(coalesce(d->>'bairro',''));
  v_cidade text := btrim(coalesce(d->>'cidade','')); v_uf text := upper(btrim(coalesce(d->>'uf','')));
  pid uuid; outro uuid; v_lead uuid; pts int := 0; k text; res text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  IF length(v_nome) < 5 OR position(' ' in v_nome) = 0 THEN RAISE EXCEPTION 'Informe o nome completo.'; END IF;
  IF NOT public.cpf_is_valid(v_cpf) THEN RAISE EXCEPTION 'CPF inválido.'; END IF;
  IF v_zap LIKE '55%' AND length(v_zap) > 11 THEN v_zap := substr(v_zap,3); END IF;
  IF length(v_zap) <> 11 THEN RAISE EXCEPTION 'WhatsApp inválido: DDD + 9 dígitos.'; END IF;
  IF v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.'; END IF;
  BEGIN v_nasc := (d->>'nascimento')::date; EXCEPTION WHEN others THEN v_nasc := NULL; END;
  IF v_nasc IS NULL OR v_nasc > (current_date - interval '18 years')::date OR v_nasc < date '1920-01-01' THEN RAISE EXCEPTION 'Data de nascimento inválida (precisa ter 18 anos ou mais).'; END IF;
  IF length(v_rg) < 4 THEN RAISE EXCEPTION 'Informe o RG.'; END IF;
  IF v_civil NOT IN ('Solteira','Casada','União estável','Divorciada','Viúva') THEN RAISE EXCEPTION 'Escolha o estado civil.'; END IF;
  IF length(v_cep) <> 8 THEN RAISE EXCEPTION 'CEP inválido.'; END IF;
  IF v_rua = '' OR v_num = '' OR v_bairro = '' OR v_cidade = '' OR length(v_uf) <> 2 THEN RAISE EXCEPTION 'Endereço incompleto: rua, número, bairro, cidade e UF.'; END IF;
  IF _perfil IS NULL OR jsonb_typeof(_perfil) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(_perfil)) < 4 THEN RAISE EXCEPTION 'Responda as 4 perguntas do perfil.'; END IF;

  SELECT id INTO pid FROM parties WHERE doc_digits = v_cpf AND is_active ORDER BY created_at LIMIT 1;
  IF pid IS NOT NULL THEN
    SELECT representative_party_id INTO outro FROM consultant_profiles WHERE party_id = pid;
    IF outro IS NOT NULL AND outro <> _rep THEN RAISE EXCEPTION 'Este CPF já é consultora de outro representante. Fale com a Lardan.'; END IF;
    UPDATE parties SET rg = coalesce(nullif(rg,''), v_rg), rg_issuer = coalesce(rg_issuer, v_rg_org),
      birth_date = coalesce(birth_date, v_nasc), marital_status = coalesce(nullif(marital_status,''), v_civil), updated_at = now() WHERE id = pid;
  ELSE
    INSERT INTO parties (kind, display_name, legal_name, doc, doc_digits, rg, rg_issuer, birth_date, marital_status, status, created_by)
    VALUES ('pessoa', upper(v_nome), upper(v_nome), v_cpf, v_cpf, v_rg, v_rg_org, v_nasc, v_civil, 'em_analise', uid) RETURNING id INTO pid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contact_points WHERE party_id = pid AND kind = 'whatsapp' AND right(regexp_replace(value,'\D','','g'),11) = v_zap) THEN
    INSERT INTO contact_points (party_id, kind, value, is_primary) VALUES (pid, 'whatsapp', v_zap, NOT EXISTS (SELECT 1 FROM contact_points WHERE party_id = pid AND kind = 'whatsapp'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contact_points WHERE party_id = pid AND kind = 'email' AND lower(value) = v_mail) THEN
    INSERT INTO contact_points (party_id, kind, value, is_primary) VALUES (pid, 'email', v_mail, NOT EXISTS (SELECT 1 FROM contact_points WHERE party_id = pid AND kind = 'email'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM party_addresses WHERE party_id = pid) THEN
    INSERT INTO party_addresses (party_id, label, postal_code, street, street_number, complement, district, city, uf, is_primary)
    VALUES (pid, 'Principal', v_cep, v_rua, v_num, v_comp, v_bairro, v_cidade, v_uf, true);
  END IF;

  v_lead := public.rep_crm_lead_criar(_rep, v_nome, v_zap, v_cidade, v_uf, 'Abertura na rua');
  UPDATE leads SET cpf = coalesce(cpf, v_cpf), email = coalesce(nullif(email,''), v_mail), postal_code = v_cep, street = v_rua,
    street_number = v_num, party_id = pid, status = 'aprovado', updated_at = now() WHERE id = v_lead;
  INSERT INTO party_roles (party_id, role, status, started_at, created_by) VALUES (pid, 'candidata', 'aprovado', current_date, uid) ON CONFLICT DO NOTHING;
  INSERT INTO party_links (party_id, entity_type, entity_id) VALUES (pid, 'lead', v_lead) ON CONFLICT DO NOTHING;

  FOR k IN SELECT jsonb_object_keys(_perfil) LOOP pts := pts + coalesce((_perfil->>k)::int, 0); END LOOP;
  res := CASE WHEN pts >= 10 THEN 'Perfil forte' WHEN pts >= 7 THEN 'Perfil bom' ELSE 'Precisa de acompanhamento' END;
  INSERT INTO candidatura_assessments (lead_id, assessment_type, status, completed_at, result_reference, metadata)
  VALUES (v_lead, 'perfil_presencial', 'concluido', now(), res, jsonb_build_object('respostas', _perfil, 'pontos', pts, 'representante', _rep, 'por', uid));
  INSERT INTO lead_events (lead_id, event_type, note, actor_id) VALUES (v_lead, 'conversao', 'Abertura na rua pelo representante (decisão de campo)', uid);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'candidatura.abertura_rua', 'leads', v_lead::text, jsonb_build_object('representante', _rep, 'party', pid, 'perfil', res));
  RETURN jsonb_build_object('lead_id', v_lead, 'party_id', pid, 'perfil', res, 'pontos', pts);
END $function$;
GRANT EXECUTE ON FUNCTION public.rep_abertura_rua_cadastrar(uuid, jsonb, jsonb) TO authenticated;

-- 3) Trocas pelos Correios
CREATE TABLE public.qualidade_correios_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  troca_id uuid NOT NULL REFERENCES public.qualidade_trocas(id),
  direcao text NOT NULL CHECK (direcao IN ('volta','ida')),
  ambiente text NOT NULL, servico text NOT NULL,
  status text NOT NULL DEFAULT 'criando' CHECK (status IN ('criando','pre_postada','postada','em_transito','entregue','erro','cancelada')),
  codigo_objeto text, prepostagem_id text, valor_declarado_cents bigint NOT NULL DEFAULT 0, frete_cents bigint,
  rotulo_path text, payload jsonb NOT NULL DEFAULT '{}'::jsonb, resposta jsonb, eventos jsonb, erro text,
  rastreado_em timestamptz, postado_em timestamptz, entregue_em timestamptz,
  criado_por uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX qualidade_correios_um_vivo ON public.qualidade_correios_envios (troca_id, direcao) WHERE status NOT IN ('erro','cancelada');
GRANT SELECT ON public.qualidade_correios_envios TO authenticated;
GRANT ALL ON public.qualidade_correios_envios TO service_role;
ALTER TABLE public.qualidade_correios_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qualidade ve envios" ON public.qualidade_correios_envios FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'quality.view') OR public.has_capability(auth.uid(),'quality.manage'));

CREATE OR REPLACE FUNCTION public.qualidade_correios_dados(_troca uuid, _direcao text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t qualidade_trocas; emitente uuid; dest jsonb; rem jsonb; pend text[] := '{}'; valor bigint; vivo record;
BEGIN
  IF NOT (public.has_capability(auth.uid(),'quality.manage') OR public.correios_eh_servidor()) THEN
    RAISE EXCEPTION 'Sem permissão para enviar troca pelos Correios.' USING errcode = '42501'; END IF;
  IF _direcao NOT IN ('volta','ida') THEN RAISE EXCEPTION 'Direção inválida.'; END IF;
  SELECT * INTO t FROM qualidade_trocas WHERE id = _troca;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Troca não encontrada.'; END IF;
  IF t.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Troca sem consultora ligada ao cadastro.'; END IF;
  IF t.status IN ('resolvida','recusada') THEN RAISE EXCEPTION 'Troca já finalizada.'; END IF;
  IF _direcao = 'ida' AND t.status <> 'aguardando_envio' THEN RAISE EXCEPTION 'Mande a peça nova depois de escolher a solução (situação "Aguardando envio").'; END IF;
  SELECT be.party_id INTO emitente FROM fiscal_settings fs JOIN business_entities be ON be.id = fs.emitter_entity_id LIMIT 1;
  IF emitente IS NULL THEN pend := array_append(pend, 'emissor sem cadastro'); END IF;
  SELECT * INTO vivo FROM qualidade_correios_envios WHERE troca_id = _troca AND direcao = _direcao AND status NOT IN ('erro','cancelada') ORDER BY created_at DESC LIMIT 1;
  IF _direcao = 'volta' THEN
    rem := public.correios_endereco(t.consultora_party_id); dest := public.correios_endereco(emitente);
    IF coalesce(rem->>'email','') = '' THEN rem := jsonb_set(rem, '{email}', to_jsonb('lardansemijoias@gmail.com'::text)); END IF;
    valor := coalesce(t.dev_valor_cents, 0);
  ELSE
    rem := public.correios_endereco(emitente); dest := public.correios_endereco(t.consultora_party_id);
    valor := coalesce(t.rep_valor_cents, t.dev_valor_cents, 0);
  END IF;
  IF coalesce(dest->>'cep','') !~ '^[0-9]{8}$' THEN pend := array_append(pend, 'CEP do destinatário inválido'); END IF;
  IF coalesce(btrim(dest->>'logradouro'),'') = '' OR coalesce(btrim(dest->>'bairro'),'') = '' OR coalesce(dest->>'cidade','') = '' THEN pend := array_append(pend, 'endereço do destinatário incompleto'); END IF;
  IF coalesce(rem->>'cep','') !~ '^[0-9]{8}$' OR coalesce(btrim(rem->>'logradouro'),'') = '' OR coalesce(btrim(rem->>'bairro'),'') = '' THEN pend := array_append(pend, 'endereço do remetente incompleto'); END IF;
  IF length(coalesce(rem->>'doc','')) NOT IN (11,14) THEN pend := array_append(pend, 'remetente sem CPF/CNPJ'); END IF;
  RETURN jsonb_build_object('troca_id', _troca, 'direcao', _direcao, 'destinatario', dest, 'remetente', rem,
    'valor_declarado_cents', valor, 'pendencias', to_jsonb(pend),
    'envio_vivo', CASE WHEN vivo.id IS NULL THEN NULL ELSE jsonb_build_object('id', vivo.id, 'status', vivo.status, 'codigo_objeto', vivo.codigo_objeto) END);
END $function$;
GRANT EXECUTE ON FUNCTION public.qualidade_correios_dados(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.qualidade_correios_abrir(_troca uuid, _direcao text, _ambiente text, _servico text, _valor_cents bigint, _payload jsonb, _ator uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d jsonb; v_id uuid;
BEGIN
  IF NOT public.correios_eh_servidor() THEN RAISE EXCEPTION 'Só o servidor registra envio.' USING errcode = '42501'; END IF;
  IF _ator IS NULL OR NOT public.has_capability(_ator, 'quality.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  d := public.qualidade_correios_dados(_troca, _direcao);
  IF jsonb_array_length(d->'pendencias') > 0 THEN RAISE EXCEPTION 'Cadastro incompleto: %.', (SELECT string_agg(x, '; ') FROM jsonb_array_elements_text(d->'pendencias') x); END IF;
  IF d->'envio_vivo' IS NOT NULL AND d->'envio_vivo' <> 'null'::jsonb THEN RAISE EXCEPTION 'Esta troca já tem envio de % (%).', _direcao, d->'envio_vivo'->>'status'; END IF;
  INSERT INTO qualidade_correios_envios (troca_id, direcao, ambiente, servico, valor_declarado_cents, payload, criado_por)
  VALUES (_troca, _direcao, _ambiente, _servico, coalesce(_valor_cents,0), coalesce(_payload,'{}'::jsonb), _ator) RETURNING id INTO v_id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_ator, 'qualidade.correios.abrir', 'qualidade_correios_envios', v_id::text, jsonb_build_object('troca', _troca, 'direcao', _direcao, 'servico', _servico));
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.qualidade_correios_resultado(_id uuid, _ok boolean, _resposta jsonb, _codigo text, _prepostagem text, _frete_cents bigint, _erro text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e qualidade_correios_envios; txt text;
BEGIN
  IF NOT public.correios_eh_servidor() THEN RAISE EXCEPTION 'Só o servidor.' USING errcode = '42501'; END IF;
  UPDATE qualidade_correios_envios SET status = CASE WHEN _ok THEN 'pre_postada' ELSE 'erro' END, resposta = _resposta,
    codigo_objeto = CASE WHEN _ok THEN upper(nullif(btrim(_codigo),'')) END, prepostagem_id = _prepostagem, frete_cents = _frete_cents,
    erro = CASE WHEN _ok THEN NULL ELSE left(_erro,500) END, updated_at = now()
  WHERE id = _id AND status = 'criando' RETURNING * INTO e;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envio inexistente ou já finalizado.'; END IF;
  IF _ok THEN
    txt := CASE WHEN e.direcao = 'volta'
      THEN 'Código para postar a peça nos Correios (sem custo para você): ' || e.codigo_objeto || '. Leve a peça bem embalada a uma agência em até 7 dias e informe esse código.'
      ELSE 'Sua peça foi enviada pelos Correios. Rastreio: ' || e.codigo_objeto || '.' END;
    INSERT INTO qualidade_trocas_eventos (troca_id, autor, autor_nome, texto, actor_id)
    VALUES (e.troca_id, 'lardan', 'Lardan', txt, e.criado_por);
    UPDATE qualidade_trocas SET novidade_consultora = true, updated_at = now() WHERE id = e.troca_id;
  END IF;
  RETURN to_jsonb(e);
END $function$;

CREATE OR REPLACE FUNCTION public.qualidade_correios_rotulo(_id uuid, _path text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.correios_eh_servidor() THEN RAISE EXCEPTION 'Só o servidor.' USING errcode = '42501'; END IF;
  UPDATE qualidade_correios_envios SET rotulo_path = _path, updated_at = now() WHERE id = _id;
END $function$;

CREATE OR REPLACE FUNCTION public.qualidade_correios_rastro(_id uuid, _eventos jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e qualidade_correios_envios; ult text; novo text;
BEGIN
  IF NOT public.correios_eh_servidor() THEN RAISE EXCEPTION 'Só o servidor.' USING errcode = '42501'; END IF;
  SELECT * INTO e FROM qualidade_correios_envios WHERE id = _id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Envio inexistente.'; END IF;
  ult := upper(coalesce(_eventos->0->>'codigo','') || ' ' || coalesce(_eventos->0->>'descricao',''));
  novo := CASE WHEN ult ~ 'ENTREGUE' THEN 'entregue' WHEN jsonb_array_length(coalesce(_eventos,'[]'::jsonb)) > 1 THEN 'em_transito'
               WHEN jsonb_array_length(coalesce(_eventos,'[]'::jsonb)) = 1 THEN 'postada' ELSE e.status END;
  IF e.status = 'entregue' THEN novo := 'entregue'; END IF;
  UPDATE qualidade_correios_envios SET eventos = _eventos, rastreado_em = now(), status = novo,
    postado_em = CASE WHEN novo IN ('postada','em_transito','entregue') THEN coalesce(postado_em, now()) ELSE postado_em END,
    entregue_em = CASE WHEN novo = 'entregue' THEN coalesce(entregue_em, now()) ELSE entregue_em END, updated_at = now()
  WHERE id = _id RETURNING * INTO e;
  RETURN to_jsonb(e);
END $function$;

CREATE OR REPLACE FUNCTION public.qualidade_correios_cancelar(_id uuid, _motivo text, _ator uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.correios_eh_servidor() THEN RAISE EXCEPTION 'Só o servidor.' USING errcode = '42501'; END IF;
  UPDATE qualidade_correios_envios SET status = 'cancelada', erro = left(_motivo,300), updated_at = now() WHERE id = _id AND status IN ('criando','pre_postada','erro');
  IF NOT FOUND THEN RAISE EXCEPTION 'Só dá para cancelar envio ainda não postado.'; END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload) VALUES (_ator, 'qualidade.correios.cancelar', 'qualidade_correios_envios', _id::text, jsonb_build_object('motivo', _motivo));
END $function$;

REVOKE ALL ON FUNCTION public.qualidade_correios_abrir(uuid,text,text,text,bigint,jsonb,uuid), public.qualidade_correios_resultado(uuid,boolean,jsonb,text,text,bigint,text),
  public.qualidade_correios_rotulo(uuid,text), public.qualidade_correios_rastro(uuid,jsonb), public.qualidade_correios_cancelar(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualidade_correios_abrir(uuid,text,text,text,bigint,jsonb,uuid), public.qualidade_correios_resultado(uuid,boolean,jsonb,text,text,bigint,text),
  public.qualidade_correios_rotulo(uuid,text), public.qualidade_correios_rastro(uuid,jsonb), public.qualidade_correios_cancelar(uuid,text,uuid) TO service_role;