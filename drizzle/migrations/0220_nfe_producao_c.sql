-- 0216c — remessa da maleta: produção pela regra do ambiente
CREATE OR REPLACE FUNCTION public.fiscal_focus_maleta_dados(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE kc record; comp record; r record; base jsonb; itens jsonb; n_itens int; kit_no int; viva record; amb text;
BEGIN
  IF NOT (public.fiscal_focus_pode('emitir') OR public.fiscal_focus_eh_servidor()) THEN
    RAISE EXCEPTION 'Só o Master emite a nota.' USING errcode = '42501';
  END IF;
  SELECT * INTO kc FROM kit_cycles WHERE id = _cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF kc.status::text NOT IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao') THEN
    RAISE EXCEPTION 'A nota só sai depois que a maleta estiver montada e conferida (situação atual: %).', kc.status;
  END IF;
  IF kc.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora: defina a consultora antes da nota.'; END IF;
  amb := public.fiscal_focus_ambiente(_cycle);

  SELECT * INTO comp FROM kit_compositions WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  IF comp.id IS NULL THEN RAISE EXCEPTION 'Maleta sem peças.'; END IF;
  SELECT count(*) INTO n_itens FROM kit_composition_items WHERE composition_id = comp.id;
  IF n_itens = 0 THEN RAISE EXCEPTION 'Maleta sem peças.'; END IF;
  IF n_itens > 990 THEN RAISE EXCEPTION 'A NF-e aceita até 990 itens; esta maleta tem %.', n_itens; END IF;

  SELECT jsonb_agg(jsonb_build_object(
            'variant_id', v.id, 'codigo', public.fiscal_peca_codigo(v.id), 'descricao', public.fiscal_peca_descricao(v.id),
           'ncm', coalesce(nullif(regexp_replace(coalesce(v.ncm, pr.ncm, ''), '[^0-9]', '', 'g'), ''), '71171900'),
           'quantidade', i.quantity, 'preco_varejo_cents', public.kit_preco(_cycle, v.id))
         ORDER BY pr.name, v.label NULLS FIRST, v.id)
    INTO itens
    FROM kit_composition_items i JOIN product_variants v ON v.id = i.variant_id JOIN products pr ON pr.id = v.product_id
   WHERE i.composition_id = comp.id;

  base := public.fiscal_focus_dados(kc.consultora_party_id, '[]'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(itens) x WHERE coalesce((x->>'preco_varejo_cents')::bigint, 0) <= 0) THEN
    base := jsonb_set(base, '{pendencias}', (base->'pendencias') || '["peça sem preço de varejo"]'::jsonb);
  END IF;
  SELECT * INTO r FROM remessas WHERE id = kc.remessa_id;
  IF kc.remessa_id IS NOT NULL THEN
    SELECT count(*) INTO kit_no FROM kit_cycles k2 WHERE k2.remessa_id = kc.remessa_id AND (k2.created_at, k2.id) <= (kc.created_at, kc.id);
  END IF;
  SELECT ref, status INTO viva FROM fiscal_focus_envios
   WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = amb AND status IN ('pendente', 'processando_autorizacao', 'autorizado')
   ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ambiente', amb,
    'destinatario', base->'destinatario', 'itens', coalesce(itens, '[]'::jsonb), 'pendencias', base->'pendencias',
    'composicao_versao', comp.version,
    'remessa', jsonb_build_object('numero', r.numero, 'kit', coalesce(kit_no, kc.cycle_no)),
    'nota_viva', CASE WHEN viva.ref IS NULL THEN NULL ELSE jsonb_build_object('ref', viva.ref, 'status', viva.status) END);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_maleta_dados(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_maleta_dados(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fiscal_focus_envio_maleta_registrar(_ref text, _ambiente text, _cycle uuid, _party uuid,
  _composicao_versao int, _payload jsonb, _ator uuid, _variantes uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE kc record; viva text;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF _ambiente IS DISTINCT FROM public.fiscal_focus_ambiente(_cycle) THEN
    RAISE EXCEPTION 'Ambiente da nota (%) diferente do configurado; abra a nota de novo.', _ambiente;
  END IF;
  SELECT * INTO kc FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF kc.consultora_party_id IS DISTINCT FROM _party THEN RAISE EXCEPTION 'A consultora da maleta mudou; abra a nota de novo.'; END IF;
  IF kc.status::text NOT IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao') THEN
    RAISE EXCEPTION 'A nota só sai depois que a maleta estiver montada e conferida.';
  END IF;
  IF _composicao_versao IS DISTINCT FROM (SELECT max(version) FROM kit_compositions WHERE cycle_id = _cycle) THEN
    RAISE EXCEPTION 'As peças da maleta mudaram; abra a nota de novo.';
  END IF;
  IF _variantes IS NOT NULL AND coalesce(array_length(_variantes, 1), 0) <> jsonb_array_length(coalesce(_payload->'items', '[]'::jsonb)) THEN
    RAISE EXCEPTION 'Lista de peças da nota inconsistente.';
  END IF;
  SELECT ref INTO viva FROM fiscal_focus_envios
   WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = _ambiente AND status IN ('pendente', 'processando_autorizacao', 'autorizado') LIMIT 1;
  IF viva IS NOT NULL THEN RAISE EXCEPTION 'Esta maleta já tem nota de remessa (%).', viva; END IF;

  INSERT INTO fiscal_focus_envios (ref, ambiente, operacao, teste, ref_origem, party_id, payload, criado_por, cycle_id, composicao_versao, itens_variantes)
  VALUES (_ref, _ambiente, 'remessa', _ambiente = 'homologacao', NULL, _party, _payload, _ator, _cycle, _composicao_versao, _variantes);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_ator, 'fiscal.focus_envio', 'fiscal_focus_envios', _ref,
          jsonb_build_object('ambiente', _ambiente, 'operacao', 'remessa', 'cycle_id', _cycle, 'composicao_versao', _composicao_versao));
  RETURN jsonb_build_object('ref', _ref);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_envio_maleta_registrar(text,text,uuid,uuid,int,jsonb,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_envio_maleta_registrar(text,text,uuid,uuid,int,jsonb,uuid,uuid[]) TO service_role;