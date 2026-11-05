-- 0214 — NF-e de remessa consignada a partir da MALETA conferida (SÓ HOMOLOGAÇÃO)
ALTER TABLE public.fiscal_focus_envios ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.kit_cycles(id);
ALTER TABLE public.fiscal_focus_envios ADD COLUMN IF NOT EXISTS composicao_versao int;
CREATE INDEX IF NOT EXISTS fiscal_focus_envios_cycle_idx ON public.fiscal_focus_envios (cycle_id, created_at DESC) WHERE cycle_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_focus_envios_remessa_viva_idx
  ON public.fiscal_focus_envios (cycle_id, ambiente)
  WHERE cycle_id IS NOT NULL AND operacao = 'remessa' AND status IN ('pendente', 'processando_autorizacao', 'autorizado');

CREATE OR REPLACE FUNCTION public.fiscal_focus_maleta_dados(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE kc record; comp record; r record; base jsonb; itens jsonb; n_itens int; kit_no int; viva record;
BEGIN
  IF NOT public.fiscal_focus_pode('emitir') THEN RAISE EXCEPTION 'Só o Master emite a nota de teste.' USING errcode = '42501'; END IF;
  SELECT * INTO kc FROM kit_cycles WHERE id = _cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF kc.status::text NOT IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao') THEN
    RAISE EXCEPTION 'A nota só sai depois que a maleta estiver montada e conferida (situação atual: %).', kc.status;
  END IF;
  IF kc.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora: defina a consultora antes da nota.'; END IF;

  SELECT * INTO comp FROM kit_compositions WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  IF comp.id IS NULL THEN RAISE EXCEPTION 'Maleta sem peças.'; END IF;

  SELECT count(*) INTO n_itens FROM kit_composition_items WHERE composition_id = comp.id;
  IF n_itens = 0 THEN RAISE EXCEPTION 'Maleta sem peças.'; END IF;
  IF n_itens > 990 THEN RAISE EXCEPTION 'A NF-e aceita até 990 itens; esta maleta tem %.', n_itens; END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'variant_id', v.id,
           'codigo', coalesce(nullif(v.sku, ''), nullif(v.reference_code, ''), nullif(pr.internal_code, ''), left(v.id::text, 8)),
           'descricao', btrim(pr.name || coalesce(' ' || nullif(v.label, ''), '')),
           'ncm', coalesce(nullif(regexp_replace(coalesce(v.ncm, pr.ncm, ''), '\D', '', 'g'), ''), '71171900'),
           'quantidade', i.quantity,
           'preco_varejo_cents', public.kit_preco(_cycle, v.id))
         ORDER BY pr.name, v.label NULLS FIRST, v.id)
    INTO itens
    FROM kit_composition_items i
    JOIN product_variants v ON v.id = i.variant_id
    JOIN products pr ON pr.id = v.product_id
   WHERE i.composition_id = comp.id;

  base := public.fiscal_focus_dados(kc.consultora_party_id, '[]'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(itens) x WHERE coalesce((x->>'preco_varejo_cents')::bigint, 0) <= 0) THEN
    base := jsonb_set(base, '{pendencias}', (base->'pendencias') || '["peça sem preço de varejo"]'::jsonb);
  END IF;

  SELECT * INTO r FROM remessas WHERE id = kc.remessa_id;
  IF kc.remessa_id IS NOT NULL THEN
    SELECT count(*) INTO kit_no FROM kit_cycles k2
     WHERE k2.remessa_id = kc.remessa_id AND (k2.created_at, k2.id) <= (kc.created_at, kc.id);
  END IF;

  SELECT ref, status INTO viva FROM fiscal_focus_envios
   WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = 'homologacao'
     AND status IN ('pendente', 'processando_autorizacao', 'autorizado')
   ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'destinatario', base->'destinatario',
    'itens', coalesce(itens, '[]'::jsonb),
    'pendencias', base->'pendencias',
    'composicao_versao', comp.version,
    'remessa', jsonb_build_object('numero', r.numero, 'kit', coalesce(kit_no, kc.cycle_no)),
    'nota_viva', CASE WHEN viva.ref IS NULL THEN NULL ELSE jsonb_build_object('ref', viva.ref, 'status', viva.status) END);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_maleta_dados(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_maleta_dados(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fiscal_focus_envio_maleta_registrar(_ref text, _ambiente text, _cycle uuid, _party uuid,
  _composicao_versao int, _payload jsonb, _ator uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE kc record; viva text;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF _ambiente <> 'homologacao' THEN RAISE EXCEPTION 'Nesta versão só há emissão em homologação.'; END IF;
  SELECT * INTO kc FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF kc.consultora_party_id IS DISTINCT FROM _party THEN RAISE EXCEPTION 'A consultora da maleta mudou; abra a nota de novo.'; END IF;
  IF kc.status::text NOT IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao') THEN
    RAISE EXCEPTION 'A nota só sai depois que a maleta estiver montada e conferida.';
  END IF;
  IF _composicao_versao IS DISTINCT FROM (SELECT max(version) FROM kit_compositions WHERE cycle_id = _cycle) THEN
    RAISE EXCEPTION 'As peças da maleta mudaram; abra a nota de novo.';
  END IF;
  SELECT ref INTO viva FROM fiscal_focus_envios
   WHERE cycle_id = _cycle AND ambiente = _ambiente AND operacao = 'remessa'
     AND status IN ('pendente', 'processando_autorizacao', 'autorizado') LIMIT 1;
  IF viva IS NOT NULL THEN RAISE EXCEPTION 'Esta maleta já tem nota de remessa (%).', viva; END IF;

  INSERT INTO fiscal_focus_envios (ref, ambiente, operacao, teste, ref_origem, party_id, payload, criado_por, cycle_id, composicao_versao)
  VALUES (_ref, _ambiente, 'remessa', true, NULL, _party, _payload, _ator, _cycle, _composicao_versao);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_ator, 'fiscal.focus_envio', 'fiscal_focus_envios', _ref,
          jsonb_build_object('ambiente', _ambiente, 'operacao', 'remessa', 'cycle_id', _cycle, 'composicao_versao', _composicao_versao));
  RETURN jsonb_build_object('ref', _ref);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_envio_maleta_registrar(text,text,uuid,uuid,int,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_envio_maleta_registrar(text,text,uuid,uuid,int,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_focus_notas_maletas(_cycles uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.fiscal_focus_pode('ver') THEN RETURN '[]'::jsonb; END IF;
  IF coalesce(array_length(_cycles, 1), 0) > 500 THEN RAISE EXCEPTION 'Informe até 500 maletas.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'cycle_id', e.cycle_id, 'ref', e.ref, 'ambiente', e.ambiente, 'status', e.status,
      'status_sefaz', e.status_sefaz, 'mensagem_sefaz', e.mensagem_sefaz, 'erros', e.erros,
      'numero', e.numero, 'serie', e.serie, 'tem_danfe', e.caminho_danfe IS NOT NULL,
      'desatualizada', e.composicao_versao IS DISTINCT FROM (SELECT max(version) FROM kit_compositions c WHERE c.cycle_id = e.cycle_id),
      'created_at', e.created_at))
    FROM (SELECT DISTINCT ON (cycle_id) * FROM fiscal_focus_envios
           WHERE cycle_id = ANY(_cycles) AND operacao = 'remessa'
           ORDER BY cycle_id, created_at DESC) e), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_notas_maletas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_notas_maletas(uuid[]) TO authenticated;