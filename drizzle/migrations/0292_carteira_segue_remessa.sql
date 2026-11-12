-- 0292 (Diego/Daniel, 12/11/2026): quando a maleta passa para a remessa de outro representante,
-- a consultora passa para a carteira e a praça desse representante; a montagem da remessa vê todas as maletas.

-- Núcleo único: move a carteira (representante + praça) da consultora, auditado. Só é chamado pelas rotinas oficiais.
CREATE OR REPLACE FUNCTION public.consultora_carteira_seguir(_party uuid, _rep uuid, _praca uuid, _cycle uuid, _origem text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE cp consultant_profiles; st party_status; nova_praca uuid;
BEGIN
  IF _party IS NULL OR _rep IS NULL THEN RETURN NULL; END IF;
  SELECT status INTO st FROM parties WHERE id = _party;
  -- bloqueada/desligada nunca muda de carteira (decisão do financeiro)
  IF st IS NULL OR st IN ('bloqueado','desligado') THEN RETURN NULL; END IF;
  SELECT * INTO cp FROM consultant_profiles WHERE party_id = _party FOR UPDATE;
  IF cp.party_id IS NULL THEN RETURN NULL; END IF;
  nova_praca := coalesce(_praca, cp.praca_id);
  IF cp.representative_party_id IS NOT DISTINCT FROM _rep AND cp.praca_id IS NOT DISTINCT FROM nova_praca THEN
    RETURN NULL;
  END IF;
  UPDATE consultant_profiles SET representative_party_id = _rep, praca_id = nova_praca WHERE party_id = _party;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'consultora.carteira_seguiu_maleta', 'consultant_profiles', _party::text,
          jsonb_build_object('origem', _origem, 'cycle_id', _cycle,
                             'representante_antes', cp.representative_party_id, 'representante_depois', _rep,
                             'praca_antes', cp.praca_id, 'praca_depois', nova_praca));
  RETURN jsonb_build_object('representante_antes', cp.representative_party_id, 'representante_depois', _rep,
                            'praca_antes', cp.praca_id, 'praca_depois', nova_praca);
END $function$;
REVOKE ALL ON FUNCTION public.consultora_carteira_seguir(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_carteira_seguir(uuid, uuid, uuid, uuid, text) TO service_role;

-- 1. Trocar a remessa da maleta: a consultora acompanha o novo representante e a praça da remessa.
CREATE OR REPLACE FUNCTION public.remessa_maleta_mudar_remessa(_cycle uuid, _remessa uuid, _motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles; r_old remessas; r_new remessas; novo_num int; nova_custodia uuid; novo_due timestamptz;
        carteira jsonb;
BEGIN
  IF uid IS NULL OR NOT (public.can_manage_kits(uid) OR public.has_role(uid, 'master')) THEN
    RAISE EXCEPTION 'Sem permissão para mudar a remessa da maleta.' USING errcode = '42501';
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501'; END IF;
  IF c.remessa_id = _remessa THEN RAISE EXCEPTION 'A maleta já está nesta remessa.'; END IF;
  IF c.status::text NOT IN ('rascunho','montagem','conferida','expedida','transito','recebida') THEN
    RAISE EXCEPTION 'Só dá para mudar a remessa antes do aceite da consultora (situação atual: %).', c.status;
  END IF;
  IF EXISTS (SELECT 1 FROM kit_acceptances WHERE cycle_id = _cycle) THEN RAISE EXCEPTION 'A consultora já aceitou esta maleta.'; END IF;
  IF EXISTS (SELECT 1 FROM kit_transfers WHERE cycle_id = _cycle AND status IN ('pendente','transito')
              AND to_party_id IS DISTINCT FROM c.custodian_party_id AND to_party_id = c.consultora_party_id) THEN
    RAISE EXCEPTION 'Há uma entrega em mãos para a consultora em andamento. Cancele a entrega antes de mudar a remessa.';
  END IF;
  SELECT * INTO r_new FROM remessas WHERE id = _remessa FOR UPDATE;
  IF r_new.id IS NULL THEN RAISE EXCEPTION 'Remessa de destino não encontrada.'; END IF;
  IF r_new.status = 'cancelada' THEN RAISE EXCEPTION 'A remessa % está cancelada.', r_new.numero; END IF;
  IF r_new.status = 'fechada' AND c.status::text IN ('rascunho','montagem') THEN
    RAISE EXCEPTION 'A remessa % está finalizada: só recebe maleta já conferida.', r_new.numero;
  END IF;
  SELECT * INTO r_old FROM remessas WHERE id = c.remessa_id;
  IF c.consultora_party_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM kit_cycles x WHERE x.remessa_id = _remessa AND x.consultora_party_id = c.consultora_party_id
         AND x.status <> 'cancelada' AND x.id <> _cycle) THEN
    RAISE EXCEPTION 'Esta consultora já tem uma maleta na remessa %.', r_new.numero;
  END IF;
  IF c.status::text = 'transito' AND c.custodian_party_id IS NOT NULL
     AND c.custodian_party_id IS NOT DISTINCT FROM coalesce(c.representante_party_id, r_old.representante_party_id) THEN
    IF r_new.representante_party_id IS NULL THEN
      RAISE EXCEPTION 'A maleta está com o representante; a remessa de destino precisa ter representante.';
    END IF;
    nova_custodia := r_new.representante_party_id;
  ELSE
    nova_custodia := c.custodian_party_id;
  END IF;
  IF c.consultora_party_id IS NULL AND r_new.representante_party_id IS NOT NULL THEN
    SELECT coalesce(max(abertura_numero), 0) + 1 INTO novo_num FROM kit_cycles
     WHERE remessa_id = _remessa AND consultora_party_id IS NULL AND status <> 'cancelada';
  ELSE
    novo_num := c.abertura_numero;
  END IF;
  novo_due := CASE WHEN c.received_at IS NULL THEN NULL ELSE c.due_at END;
  UPDATE kit_cycles SET remessa_id = _remessa, representante_party_id = r_new.representante_party_id,
         custodian_party_id = nova_custodia, abertura_numero = novo_num, due_at = novo_due, updated_by = uid
   WHERE id = _cycle;
  IF nova_custodia IS DISTINCT FROM c.custodian_party_id THEN
    UPDATE kit_transfers SET to_party_id = nova_custodia, updated_by = uid,
           note = coalesce(note, '') || ' | Remessa trocada para ' || r_new.numero
     WHERE cycle_id = _cycle AND status IN ('pendente','transito') AND to_party_id = c.custodian_party_id;
  END IF;
  -- 0292: a consultora passa para a carteira e a praça do representante da nova remessa
  IF c.consultora_party_id IS NOT NULL AND r_new.representante_party_id IS NOT NULL THEN
    carteira := public.consultora_carteira_seguir(c.consultora_party_id, r_new.representante_party_id, r_new.praca_id,
                                                  _cycle, 'remessa_maleta_mudar_remessa');
  END IF;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
  VALUES (_cycle, 'remessa.trocada', c.status, c.status, uid,
          jsonb_build_object('de_remessa', r_old.numero, 'para_remessa', r_new.numero,
                             'de_representante', c.representante_party_id, 'para_representante', r_new.representante_party_id,
                             'custodia_de', c.custodian_party_id, 'custodia_para', nova_custodia,
                             'carteira', carteira), btrim(_motivo));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.remessa_trocada', 'kit_cycles', _cycle::text,
          jsonb_build_object('de', c.remessa_id, 'para', _remessa, 'motivo', btrim(_motivo), 'carteira', carteira));
  RETURN jsonb_build_object('remessa', r_new.numero, 'representante_party_id', r_new.representante_party_id,
                            'custodia_mudou', nova_custodia IS DISTINCT FROM c.custodian_party_id, 'abertura_numero', novo_num,
                            'carteira_mudou', carteira IS NOT NULL,
                            'representante_nome', (SELECT display_name FROM parties WHERE id = r_new.representante_party_id));
END $function$;

-- 2. Repasse do representante: a pessoa que recebe a maleta dele passa para a carteira dele (antes mantinha o antigo).
CREATE OR REPLACE FUNCTION public.rep_maleta_repassar(_rep uuid, _cycle uuid, _consultora uuid DEFAULT NULL::uuid, _lead uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles; r remessas; le leads; pid uuid; virou_consultora boolean := false; fw jsonb; carteira jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF (_consultora IS NULL) = (_lead IS NULL) THEN RAISE EXCEPTION 'Escolha uma consultora ou uma candidata.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL OR c.custodian_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta maleta não está com você.'; END IF;
  IF c.consultora_party_id IS NOT NULL THEN RAISE EXCEPTION 'Esta maleta já tem consultora.'; END IF;
  IF c.status <> 'transito' THEN RAISE EXCEPTION 'Confirme o recebimento da maleta antes de passar.'; END IF;
  SELECT * INTO r FROM remessas WHERE id = c.remessa_id;

  IF _consultora IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM consultant_profiles WHERE party_id = _consultora AND representative_party_id = _rep) THEN
      RAISE EXCEPTION 'Esta consultora não é da sua carteira.';
    END IF;
    pid := _consultora;
  ELSE
    SELECT * INTO le FROM leads WHERE id = _lead FOR UPDATE;
    IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não é sua.'; END IF;
    pid := le.party_id;
    IF pid IS NULL AND le.cpf_digits IS NOT NULL THEN
      SELECT id INTO pid FROM parties WHERE doc_digits = le.cpf_digits ORDER BY is_active DESC, created_at LIMIT 1;
    END IF;
    IF pid IS NULL THEN
      INSERT INTO parties (kind, display_name, legal_name, doc, doc_digits, status, created_by)
      VALUES ('pessoa', le.full_name, le.full_name, le.cpf, le.cpf_digits, 'em_analise', uid) RETURNING id INTO pid;
      INSERT INTO contact_points (party_id, kind, value, is_primary) VALUES (pid, 'whatsapp', le.whatsapp, true);
      INSERT INTO party_addresses (party_id, label, postal_code, street, street_number, no_number, city, uf, is_primary)
      VALUES (pid, 'Principal', le.postal_code, le.street, le.street_number, le.no_number, le.city, le.uf, true);
    END IF;
    INSERT INTO party_roles (party_id, role, status, started_at, created_by) VALUES (pid, 'candidata', 'aprovado', current_date, uid) ON CONFLICT DO NOTHING;
    UPDATE leads SET party_id = pid, status = 'aprovado', updated_at = now() WHERE id = le.id;
    INSERT INTO party_links (party_id, entity_type, entity_id) VALUES (pid, 'lead', le.id) ON CONFLICT DO NOTHING;
    INSERT INTO lead_events (lead_id, event_type, note, actor_id)
    VALUES (le.id, 'conversao', 'Recebeu maleta do representante (pessoa ' || pid::text || ')', uid);
    virou_consultora := true;
  END IF;

  -- a candidata vira consultora da carteira dele, na praça da remessa
  INSERT INTO party_roles (party_id, role, status, started_at, created_by) VALUES (pid, 'consultora', 'ativo', current_date, uid) ON CONFLICT DO NOTHING;
  INSERT INTO consultant_profiles (party_id, representative_party_id, praca_id, joined_at, origin)
  VALUES (pid, _rep, r.praca_id, current_date, 'Maleta do representante')
  ON CONFLICT (party_id) DO UPDATE SET representative_party_id = coalesce(consultant_profiles.representative_party_id, excluded.representative_party_id),
                                       praca_id = coalesce(consultant_profiles.praca_id, excluded.praca_id);
  -- 0292: cadastro que já existia em outra carteira passa para a carteira de quem entregou a maleta
  carteira := public.consultora_carteira_seguir(pid, _rep, r.praca_id, c.id, 'rep_maleta_repassar');

  UPDATE kit_cycles SET consultora_party_id = pid, updated_by = uid, updated_at = now() WHERE id = c.id;
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (c.id, 'maleta.repassada', uid, jsonb_build_object('representante', _rep, 'consultora', pid, 'candidata', _lead, 'carteira', carteira));
  fw := public.kit_transfer_forward(c.id, jsonb_build_object('note', 'Repasse do representante'));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.repasse_representante', 'kit_cycles', c.id::text, jsonb_build_object('representante', _rep, 'consultora', pid, 'candidata', _lead, 'carteira', carteira));
  RETURN jsonb_build_object('consultora_party_id', pid, 'nova_consultora', virou_consultora, 'carteira_mudou', carteira IS NOT NULL) || coalesce(fw, '{}'::jsonb);
END $function$;

-- 3. Tela da remessa: quem monta a remessa (colaboradora do representante dela) vê todas as maletas,
-- mesmo de consultora que ainda está mudando de carteira. Só nome e números da maleta.
CREATE OR REPLACE FUNCTION public.remessa_maletas(_remessa uuid)
 RETURNS TABLE(cycle_id uuid, consultora_party_id uuid, consultora text, status text, pecas integer, valor_cents bigint, created_at timestamp with time zone, abertura_numero integer, maleta_seq integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT k.id, k.consultora_party_id, pa.display_name, k.status::text, k.quantity_total, k.reference_total_cents::bigint, k.created_at,
         kc.abertura_numero,
         CASE WHEN k.consultora_party_id IS NULL THEN NULL
              ELSE (row_number() OVER (PARTITION BY k.consultora_party_id ORDER BY k.created_at, k.id))::int END
  FROM colab_v_kit_cycles k
  JOIN public.kit_cycles kc ON kc.id = k.id
  LEFT JOIN public.parties pa ON pa.id = k.consultora_party_id
  WHERE k.remessa_id = _remessa AND k.status <> 'cancelada'
    AND (k.consultora_party_id IS NULL OR public.colab_party_ok(k.consultora_party_id) OR public.colab_cycle_ok(k.id))
    AND public.kit_ve_rede()
  ORDER BY pa.display_name, kc.abertura_numero, k.created_at;
$function$;