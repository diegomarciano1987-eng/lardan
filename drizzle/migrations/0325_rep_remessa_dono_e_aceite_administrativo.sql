-- 1) Remessa com representante só aparece para o dono (praça só conta quando a remessa não tem representante)
DO $$
DECLARE f record; d text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
            AND p.proname IN ('rep_remessas','rep_remessa_informacoes','rep_acerto_marcar') LOOP
    d := pg_get_functiondef(f.oid);
    d := replace(d, 'r.praca_id = any(public.rep_praca_ids(_rep))',
                    '(r.representante_party_id is null and r.praca_id = any(public.rep_praca_ids(_rep)))');
    EXECUTE d;
  END LOOP;
END $$;

-- 2) Aceite administrativo (somente Master), pelos motores oficiais
CREATE OR REPLACE FUNCTION public.remessa_aceites_pendentes(_remessa uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'Somente o Master.' USING errcode='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'cycle_id', c.id, 'codigo', k.code, 'situacao', c.status,
      'consultora', p.display_name, 'consultora_codigo', p.code,
      'com_quem', cu.display_name,
      'tem_login', EXISTS (SELECT 1 FROM profiles pr WHERE pr.party_id = c.consultora_party_id AND pr.is_active),
      'pecas', (SELECT coalesce(sum(i.quantity),0) FROM kit_composition_items i WHERE i.composition_id =
                 (SELECT id FROM kit_compositions WHERE cycle_id = c.id ORDER BY version DESC LIMIT 1))
    ) ORDER BY p.display_name)
    FROM kit_cycles c JOIN kits k ON k.id = c.kit_id
    JOIN parties p ON p.id = c.consultora_party_id
    LEFT JOIN parties cu ON cu.id = c.custodian_party_id
    WHERE c.remessa_id = _remessa AND c.status IN ('expedida','transito','recebida')
      AND NOT EXISTS (SELECT 1 FROM kit_acceptances a WHERE a.cycle_id = c.id)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.remessa_aceites_pendentes(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remessa_aceites_pendentes(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.kit_aceite_administrativo(_cycle uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); c kit_cycles; t kit_transfers; comp kit_compositions; itens jsonb; r jsonb; st kit_status;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid,'master') THEN
    RAISE EXCEPTION 'Somente o Master pode registrar o aceite pela consultora.' USING errcode='42501';
  END IF;
  IF length(trim(coalesce(_motivo,''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM kit_acceptances WHERE cycle_id = _cycle) OR c.status IN ('operacao','acerto','encerrada') THEN
    RETURN jsonb_build_object('repetida', true, 'situacao', c.status);
  END IF;
  IF c.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora.'; END IF;
  IF c.status NOT IN ('expedida','transito','recebida') THEN
    RAISE EXCEPTION 'A maleta precisa já ter saído da empresa (situação atual: %).', c.status;
  END IF;
  IF EXISTS (SELECT 1 FROM parties WHERE id = c.consultora_party_id AND status IN ('bloqueado','desligado')) THEN
    RAISE EXCEPTION 'Consultora bloqueada ou desligada.';
  END IF;
  SELECT * INTO comp FROM kit_compositions WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  IF comp.frozen_at IS NULL THEN RAISE EXCEPTION 'Composição não conferida.'; END IF;

  -- custódia até a consultora (motores oficiais)
  IF c.status <> 'recebida' THEN
    SELECT * INTO t FROM kit_transfers WHERE cycle_id = _cycle AND status = 'transito' ORDER BY seq DESC LIMIT 1;
    IF t.id IS NOT NULL AND t.to_party_id IS DISTINCT FROM c.consultora_party_id THEN
      PERFORM public.kit_transfer_confirm(t.id, '{}'::jsonb);
      t := NULL;
    END IF;
    SELECT * INTO c FROM kit_cycles WHERE id = _cycle;
    IF t.id IS NULL THEN
      SELECT * INTO t FROM kit_transfers WHERE cycle_id = _cycle AND status = 'transito'
        AND to_party_id = c.consultora_party_id ORDER BY seq DESC LIMIT 1;
    END IF;
    IF t.id IS NULL THEN
      IF c.status <> 'transito' THEN RAISE EXCEPTION 'A maleta não está em trânsito; confira a expedição.'; END IF;
      PERFORM public.kit_transfer_forward(_cycle, jsonb_build_object('note','Aceite administrativo: '||trim(_motivo)));
      SELECT * INTO t FROM kit_transfers WHERE cycle_id = _cycle AND status = 'transito' ORDER BY seq DESC LIMIT 1;
    END IF;
    PERFORM public.kit_transfer_confirm(t.id, jsonb_build_object('evidencia', jsonb_build_array(jsonb_build_object('tipo','aceite_administrativo','motivo',trim(_motivo)))));
  END IF;

  SELECT jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'qty_accepted', i.quantity, 'qty_divergent', 0))
    INTO itens FROM kit_composition_items i WHERE i.composition_id = comp.id;

  PERFORM set_config('lardan.assinatura_finalizando','on', true);
  r := public.kit_aceitar(_cycle, itens, 'aceite-administrativo:'||_cycle::text);
  PERFORM set_config('lardan.assinatura_finalizando','off', true);

  UPDATE kit_acceptances SET context = coalesce(context,'{}'::jsonb) || jsonb_build_object(
      'administrativo', true, 'motivo', trim(_motivo), 'registrado_por', uid)
   WHERE id = (r->>'acceptance_id')::uuid;
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload, reason)
  VALUES (_cycle, 'maleta.aceite_administrativo', uid, jsonb_build_object('aceite', r->'acceptance_id'), trim(_motivo));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.aceite_administrativo', 'kit_cycles', _cycle::text,
          jsonb_build_object('consultora', c.consultora_party_id, 'motivo', trim(_motivo), 'aceite', r->'acceptance_id'));
  SELECT status INTO st FROM kit_cycles WHERE id = _cycle;
  RETURN r || jsonb_build_object('situacao', st);
END $$;
REVOKE ALL ON FUNCTION public.kit_aceite_administrativo(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.kit_aceite_administrativo(uuid, text) TO authenticated;