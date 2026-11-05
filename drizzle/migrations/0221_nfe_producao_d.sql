-- 0216d — acerto: produção pela regra do ambiente; remessa do MESMO ambiente
CREATE OR REPLACE FUNCTION public.fiscal_focus_acerto_dados(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE kc record; rem record; base jsonb; linhas jsonb; ops jsonb := '{}'::jsonb; op text; viva record; sem jsonb; amb text;
BEGIN
  IF NOT (public.fiscal_focus_pode('emitir') OR public.fiscal_focus_eh_servidor()) THEN
    RAISE EXCEPTION 'Só o Master emite a nota.' USING errcode = '42501';
  END IF;
  SELECT * INTO kc FROM kit_cycles WHERE id = _cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF kc.status::text <> 'encerrada' THEN
    RAISE EXCEPTION 'As notas do acerto só saem com a maleta encerrada (acerto conferido ou maleta perdida). Situação atual: %.', kc.status;
  END IF;
  amb := public.fiscal_focus_ambiente(_cycle);
  SELECT * INTO rem FROM fiscal_focus_envios
    WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = amb AND status = 'autorizado' ORDER BY created_at DESC LIMIT 1;
  IF rem.ref IS NULL THEN
    RAISE EXCEPTION 'Esta maleta não tem nota de remessa autorizada (%). Maleta remetida pelo SmallData fecha o acerto pelas notas do SmallData.',
      CASE WHEN amb = 'producao' THEN 'em produção' ELSE 'de teste' END;
  END IF;
  IF rem.chave_nfe IS NULL THEN RAISE EXCEPTION 'A nota de remessa ainda não tem chave; consulte a nota.'; END IF;

  WITH itens AS (
    SELECT n::int AS numero_item, i->>'codigo_produto' AS codigo, i->>'descricao' AS descricao, i->>'codigo_ncm' AS ncm,
           (i->>'quantidade_comercial')::numeric::int AS qtd_remessa, (i->>'valor_unitario_comercial')::numeric AS unit,
            coalesce(rem.itens_variantes[n],
             (SELECT ci.variant_id FROM kit_composition_items ci JOIN kit_compositions c ON c.id = ci.composition_id
               WHERE c.cycle_id = _cycle AND public.fiscal_peca_codigo(ci.variant_id) = i->>'codigo_produto'
               ORDER BY c.version DESC LIMIT 1),
             (SELECT v.id FROM kit_composition_items ci JOIN kit_compositions c ON c.id = ci.composition_id
                JOIN product_variants v ON v.id = ci.variant_id JOIN products pr ON pr.id = v.product_id
               WHERE c.cycle_id = _cycle AND coalesce(nullif(v.sku, ''), nullif(v.reference_code, ''), nullif(pr.internal_code, ''), left(v.id::text, 8)) = i->>'codigo_produto'
               ORDER BY c.version DESC LIMIT 1)) AS variant_id
      FROM jsonb_array_elements(rem.payload->'items') WITH ORDINALITY AS t(i, n)
  ), saldos AS (
    SELECT it.*, coalesce(b.ret, 0) ret, coalesce(b.sold, 0) sold, coalesce(b.lost, 0) lost
      FROM itens it
      LEFT JOIN (SELECT variant_id, sum(qty_returned) ret, sum(qty_sold) sold, sum(qty_lost) lost
                   FROM kit_balances WHERE cycle_id = _cycle GROUP BY variant_id) b ON b.variant_id = it.variant_id
  ), dist AS (
    SELECT s.*, least(s.ret, s.qtd_remessa) q_dev, least(s.sold, s.qtd_remessa - least(s.ret, s.qtd_remessa)) q_venda FROM saldos s
  ), dist2 AS (
    SELECT d.*, least(d.lost, d.qtd_remessa - d.q_dev - d.q_venda) q_perda FROM dist d
  )
  SELECT jsonb_agg(jsonb_build_object('numero_item', numero_item, 'variant_id', variant_id, 'codigo', codigo, 'descricao', descricao,
                                      'ncm', ncm, 'unit', unit, 'qtd_remessa', qtd_remessa, 'devolucao', q_dev, 'venda', q_venda,
                                      'perda', q_perda, 'sem_nota', qtd_remessa - q_dev - q_venda - q_perda) ORDER BY numero_item)
    INTO linhas FROM dist2;

  FOREACH op IN ARRAY ARRAY['devolucao', 'venda', 'perda'] LOOP
    SELECT ref, status, numero INTO viva FROM fiscal_focus_envios
     WHERE cycle_id = _cycle AND operacao = op AND ambiente = amb AND status IN ('pendente', 'processando_autorizacao', 'autorizado')
     ORDER BY created_at DESC LIMIT 1;
    ops := ops || jsonb_build_object(op, jsonb_build_object(
      'itens', coalesce((SELECT jsonb_agg(jsonb_build_object('codigo', l->>'codigo', 'descricao', l->>'descricao', 'ncm', l->>'ncm',
                   'quantidade', (l->>op)::int, 'preco_varejo_cents', round((l->>'unit')::numeric * 100)::int * 3,
                  'numero_item_origem', (l->>'numero_item')::int) ORDER BY (l->>'numero_item')::int)
                 FROM jsonb_array_elements(linhas) l WHERE (l->>op)::int > 0), '[]'::jsonb),
      'nota_viva', CASE WHEN viva.ref IS NULL THEN NULL ELSE jsonb_build_object('ref', viva.ref, 'status', viva.status, 'numero', viva.numero) END));
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', l->>'codigo', 'quantidade', (l->>'sem_nota')::int)), '[]'::jsonb)
    INTO sem FROM jsonb_array_elements(linhas) l WHERE (l->>'sem_nota')::int > 0;

  base := public.fiscal_focus_dados(kc.consultora_party_id, '[]'::jsonb);
  RETURN jsonb_build_object(
    'ambiente', amb,
    'destinatario', base->'destinatario', 'pendencias', base->'pendencias',
    'remessa', jsonb_build_object('ref', rem.ref, 'chave', rem.chave_nfe, 'numero', rem.numero,
                                  'data', to_char(rem.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'),
                                  'texto', rem.payload->>'informacoes_adicionais_contribuinte'),
    'operacoes', ops, 'sem_nota', sem);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_acerto_dados(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_acerto_dados(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fiscal_focus_envio_acerto_registrar(_ref text, _ambiente text, _cycle uuid, _operacao text,
  _ref_origem text, _party uuid, _payload jsonb, _ator uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE kc record; o record; viva text;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF _ambiente IS DISTINCT FROM public.fiscal_focus_ambiente(_cycle) THEN
    RAISE EXCEPTION 'Ambiente da nota (%) diferente do configurado; abra a nota de novo.', _ambiente;
  END IF;
  IF _operacao NOT IN ('devolucao', 'venda', 'perda') THEN RAISE EXCEPTION 'Operação inválida.'; END IF;
  SELECT * INTO kc FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF kc.status::text <> 'encerrada' THEN RAISE EXCEPTION 'As notas do acerto só saem com a maleta encerrada.'; END IF;
  IF kc.consultora_party_id IS DISTINCT FROM _party THEN RAISE EXCEPTION 'Consultora diferente da maleta.'; END IF;
  SELECT * INTO o FROM fiscal_focus_envios WHERE ref = _ref_origem;
  IF NOT FOUND OR o.operacao <> 'remessa' OR o.status <> 'autorizado' OR o.cycle_id IS DISTINCT FROM _cycle OR o.ambiente <> _ambiente THEN
    RAISE EXCEPTION 'A nota de origem precisa ser a remessa autorizada desta maleta.';
  END IF;
  SELECT ref INTO viva FROM fiscal_focus_envios
   WHERE cycle_id = _cycle AND operacao = _operacao AND ambiente = _ambiente AND status IN ('pendente', 'processando_autorizacao', 'autorizado') LIMIT 1;
  IF viva IS NOT NULL THEN RAISE EXCEPTION 'Esta maleta já tem nota de % (%).', _operacao, viva; END IF;

  INSERT INTO fiscal_focus_envios (ref, ambiente, operacao, teste, ref_origem, party_id, payload, criado_por, cycle_id)
  VALUES (_ref, _ambiente, _operacao, _ambiente = 'homologacao', _ref_origem, _party, _payload, _ator, _cycle);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_ator, 'fiscal.focus_envio', 'fiscal_focus_envios', _ref,
          jsonb_build_object('ambiente', _ambiente, 'operacao', _operacao, 'cycle_id', _cycle, 'ref_origem', _ref_origem));
  RETURN jsonb_build_object('ref', _ref);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_envio_acerto_registrar(text,text,uuid,text,text,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_envio_acerto_registrar(text,text,uuid,text,text,uuid,jsonb,uuid) TO service_role;