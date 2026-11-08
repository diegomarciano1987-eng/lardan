-- 0273 (Diego, 08/11): o representante pode usar QUALQUER maleta que está com ele
-- (inclusive uma já designada a outra consultora e ainda não entregue em mãos) para uma abertura.
-- Só enquanto nada aconteceu em nome da consultora original: sem entrega/aceite, sem nota fiscal,
-- sem promissória/termo, sem pedido, sem pré-baixa, sem envio pelos Correios. Tudo auditado.
CREATE OR REPLACE FUNCTION public.rep_maleta_trocar_destino(_rep uuid, _cycle uuid, _consultora uuid DEFAULT NULL, _lead uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles; anterior uuid; anterior_nome text; v_num int; res jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF (_consultora IS NULL) = (_lead IS NULL) THEN RAISE EXCEPTION 'Escolha uma consultora ou uma candidata.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL OR c.custodian_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta maleta não está com você.'; END IF;
  IF c.status <> 'transito' THEN RAISE EXCEPTION 'Confirme o recebimento da maleta antes de passar.'; END IF;
  anterior := c.consultora_party_id;
  IF anterior IS NULL THEN
    -- maleta de abertura comum: segue o caminho de sempre
    RETURN public.rep_maleta_repassar(_rep, _cycle, _consultora, _lead);
  END IF;
  IF anterior = _consultora THEN RAISE EXCEPTION 'Esta maleta já é dela.'; END IF;
  SELECT display_name INTO anterior_nome FROM parties WHERE id = anterior;

  IF EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.status IN ('pendente','transito')) THEN
    RAISE EXCEPTION 'Esta maleta já foi entregue em mãos para %. Ela precisa ser devolvida antes.', anterior_nome;
  END IF;
  IF EXISTS (SELECT 1 FROM kit_acceptances a WHERE a.cycle_id = c.id) THEN
    RAISE EXCEPTION '% já aceitou esta maleta. Não dá para trocar.', anterior_nome;
  END IF;
  IF EXISTS (SELECT 1 FROM kit_signature_requests s WHERE s.cycle_id = c.id AND s.estado::text NOT ILIKE 'cancel%') THEN
    RAISE EXCEPTION 'Já existe termo de aceite de % para esta maleta. Fale com a montagem.', anterior_nome;
  END IF;
  IF EXISTS (SELECT 1 FROM assinaturas_digitais s WHERE s.cycle_id = c.id AND s.status::text NOT ILIKE 'cancel%') THEN
    RAISE EXCEPTION 'Já existe promissória de % para esta maleta. Fale com a montagem.', anterior_nome;
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.cycle_id = c.id AND f.status::text NOT ILIKE 'cancel%' AND f.status::text NOT ILIKE 'rejeit%')
     OR EXISTS (SELECT 1 FROM fiscal_focus_envios e WHERE e.cycle_id = c.id AND e.status::text NOT IN ('cancelado','erro_autorizacao')) THEN
    RAISE EXCEPTION 'Esta maleta já tem nota fiscal em nome de %. A montagem precisa cancelar a nota antes.', anterior_nome;
  END IF;
  IF EXISTS (SELECT 1 FROM sales_order_items i WHERE i.cycle_id = c.id) THEN
    RAISE EXCEPTION 'Já existe pedido de cliente com peças desta maleta. Não dá para trocar.';
  END IF;
  IF EXISTS (SELECT 1 FROM kit_pre_baixas p WHERE p.cycle_id = c.id) THEN
    RAISE EXCEPTION 'Esta maleta já tem acerto começado. Não dá para trocar.';
  END IF;
  IF EXISTS (SELECT 1 FROM correios_envios e WHERE e.cycle_id = c.id) THEN
    RAISE EXCEPTION 'Esta maleta tem envio pelos Correios. Não dá para trocar.';
  END IF;

  -- vira maleta de abertura (número na remessa) e volta a ficar sem consultora por um instante
  IF c.abertura_numero IS NULL AND c.remessa_id IS NOT NULL THEN
    SELECT coalesce(max(abertura_numero), 0) + 1 INTO v_num FROM kit_cycles
     WHERE remessa_id = c.remessa_id AND representante_party_id IS NOT DISTINCT FROM c.representante_party_id;
  ELSE
    v_num := c.abertura_numero;
  END IF;
  UPDATE kit_cycles SET consultora_party_id = NULL, abertura_numero = v_num, updated_by = uid, updated_at = now() WHERE id = c.id;
  UPDATE remessa_informacoes SET cycle_id = NULL, updated_at = now() WHERE cycle_id = c.id;

  BEGIN
    res := public.rep_maleta_repassar(_rep, _cycle, _consultora, _lead);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ela já tem uma maleta nesta remessa.';
  END;

  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (c.id, 'maleta.trocada_para_abertura', uid, jsonb_build_object('representante', _rep, 'consultora_anterior', anterior,
          'consultora_nova', res->>'consultora_party_id', 'candidata', _lead, 'abertura_numero', v_num));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.trocada_para_abertura', 'kit_cycles', c.id::text, jsonb_build_object('representante', _rep,
          'consultora_anterior', anterior, 'consultora_anterior_nome', anterior_nome,
          'consultora_nova', res->>'consultora_party_id', 'candidata', _lead, 'abertura_numero', v_num));
  RETURN res || jsonb_build_object('consultora_anterior', anterior_nome, 'abertura_numero', v_num);
END $function$;

REVOKE ALL ON FUNCTION public.rep_maleta_trocar_destino(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_maleta_trocar_destino(uuid, uuid, uuid, uuid) TO authenticated, service_role;