-- 0322 (Diego, 13/11/2026): a equipe da montagem precisa abrir uma SEGUNDA maleta para a mesma consultora
-- na mesma remessa. Até aqui "Abrir maleta" devolvia a maleta que ela já tinha; a segunda só existia
-- transferindo uma maleta pronta. Agora a abertura aceita a segunda maleta com motivo escrito (mesma marca
-- segunda_maleta_motivo da 0283, que libera o índice único), com auditoria. Nada muda na primeira maleta.
CREATE OR REPLACE FUNCTION public.remessa_abrir_segunda_maleta(_remessa uuid, _consultora uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); r remessas; v jsonb; v_cycle uuid; v_primeira text; v_motivo text := btrim(coalesce(_motivo, ''));
BEGIN
  IF uid IS NULL OR NOT public.can_manage_kits(uid) THEN RAISE EXCEPTION 'Sem permissão para abrir maletas.' USING errcode = '42501'; END IF;
  IF length(v_motivo) < 5 THEN RAISE EXCEPTION 'Escreva o motivo da segunda maleta (mínimo 5 letras).'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.status IN ('fechada', 'cancelada') THEN RAISE EXCEPTION 'Esta remessa está %.', r.status; END IF;
  IF NOT EXISTS (SELECT 1 FROM consultant_profiles WHERE party_id = _consultora AND praca_id = r.praca_id) THEN
    RAISE EXCEPTION 'Esta consultora não pertence à praça da remessa.';
  END IF;
  SELECT k.code INTO v_primeira FROM kit_cycles c JOIN kits k ON k.id = c.kit_id
   WHERE c.remessa_id = r.id AND c.consultora_party_id = _consultora AND c.status <> 'cancelada'
   ORDER BY c.created_at LIMIT 1;
  IF v_primeira IS NULL THEN RAISE EXCEPTION 'Ela ainda não tem maleta nesta remessa: use "Abrir maleta".'; END IF;
  -- clique duplo / segunda maleta ainda vazia: devolve a mesma em vez de criar outra
  SELECT c.id INTO v_cycle FROM kit_cycles c
   WHERE c.remessa_id = r.id AND c.consultora_party_id = _consultora AND c.segunda_maleta_motivo IS NOT NULL
     AND c.status IN ('rascunho', 'montagem')
     AND NOT EXISTS (SELECT 1 FROM kit_compositions kc JOIN kit_composition_items i ON i.composition_id = kc.id
                      WHERE kc.cycle_id = c.id AND i.quantity > 0)
   ORDER BY c.created_at DESC LIMIT 1;
  IF v_cycle IS NOT NULL THEN RETURN jsonb_build_object('cycle_id', v_cycle, 'repetida', true, 'remessa_numero', r.numero); END IF;

  v := public.kit_cycle_create(jsonb_build_object(
    'consultora_party_id', _consultora, 'representante_party_id', r.representante_party_id,
    'origin_location_id', r.origin_location_id, 'label', 'Remessa ' || r.numero || ' (2ª maleta)',
    'due_at', CASE WHEN r.data_acerto IS NULL THEN NULL ELSE (r.data_acerto::timestamp AT TIME ZONE 'America/Sao_Paulo') END));
  v_cycle := (v->>'cycle_id')::uuid;
  -- a marca vem antes da remessa: é ela que libera o índice único (remessa, consultora)
  PERFORM public.maleta_segunda_marcar(v_cycle, v_motivo);
  UPDATE kit_cycles SET remessa_id = r.id WHERE id = v_cycle;
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, reason, payload)
  VALUES (v_cycle, 'maleta.segunda', uid, v_motivo, jsonb_build_object('consultora', _consultora, 'origem', 'abertura', 'primeira_maleta', v_primeira));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'remessa_abrir_segunda_maleta', 'remessas', r.id::text,
          jsonb_build_object('numero', r.numero, 'cycle', v_cycle, 'consultora', _consultora, 'motivo', v_motivo, 'primeira_maleta', v_primeira));
  RETURN v || jsonb_build_object('remessa_numero', r.numero, 'primeira_maleta', v_primeira);
END $$;
REVOKE ALL ON FUNCTION public.remessa_abrir_segunda_maleta(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_abrir_segunda_maleta(uuid, uuid, text) TO authenticated;