-- 0215 — NF-e do ACERTO da maleta: devolução, venda e perda (SÓ HOMOLOGAÇÃO)
ALTER TABLE public.fiscal_focus_envios ADD COLUMN IF NOT EXISTS itens_variantes uuid[];
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_focus_envios_acerto_viva_idx
  ON public.fiscal_focus_envios (cycle_id, ambiente, operacao)
  WHERE cycle_id IS NOT NULL AND operacao IN ('devolucao', 'venda', 'perda')
    AND status IN ('pendente', 'processando_autorizacao', 'autorizado');

DROP FUNCTION IF EXISTS public.fiscal_focus_envio_maleta_registrar(text,text,uuid,uuid,int,jsonb,uuid);
CREATE OR REPLACE FUNCTION public.fiscal_focus_envio_maleta_registrar(_ref text, _ambiente text, _cycle uuid, _party uuid,
  _composicao_versao int, _payload jsonb, _ator uuid, _variantes uuid[] DEFAULT NULL)
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
  IF _variantes IS NOT NULL AND coalesce(array_length(_variantes, 1), 0) <> jsonb_array_length(coalesce(_payload->'items', '[]'::jsonb)) THEN
    RAISE EXCEPTION 'Lista de peças da nota inconsistente.';
  END IF;
  SELECT ref INTO viva FROM fiscal_focus_envios
   WHERE cycle_id = _cycle AND ambiente = _ambiente AND operacao = 'remessa'
     AND status IN ('pendente', 'processando_autorizacao', 'autorizado') LIMIT 1;
  IF viva IS NOT NULL THEN RAISE EXCEPTION 'Esta maleta já tem nota de remessa (%).', viva; END IF;

  INSERT INTO fiscal_focus_envios (ref, ambiente, operacao, teste, ref_origem, party_id, payload, criado_por, cycle_id, composicao_versao, itens_variantes)
  VALUES (_ref, _ambiente, 'remessa', true, NULL, _party, _payload, _ator, _cycle, _composicao_versao, _variantes);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_ator, 'fiscal.focus_envio', 'fiscal_focus_envios', _ref,
          jsonb_build_object('ambiente', _ambiente, 'operacao', 'remessa', 'cycle_id', _cycle, 'composicao_versao', _composicao_versao));
  RETURN jsonb_build_object('ref', _ref);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_envio_maleta_registrar(text,text,uuid,uuid,int,jsonb,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_envio_maleta_registrar(text,text,uuid,uuid,int,jsonb,uuid,uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_focus_acerto_dados(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE kc record; rem record; base jsonb; linhas jsonb; ops jsonb := '{}'::jsonb; op text; viva record; sem jsonb;
BEGIN
  IF NOT public.fiscal_focus_pode('emitir') THEN RAISE EXCEPTION 'Só o Master emite a nota de teste.' USING errcode = '42501'; END IF;
  SELECT * INTO kc FROM kit_cycles WHERE id = _cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF kc.status::text <> 'encerrada' THEN
    RAISE EXCEPTION 'As notas do acerto só saem com a maleta encerrada (acerto conferido ou maleta perdida). Situação atual: %.', kc.status;
  END IF;
  SELECT * INTO rem FROM fiscal_focus_envios
   WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = 'homologacao' AND status = 'autorizado'
    ORDER BY created_at DESC LIMIT 1;
  IF rem.ref IS NULL THEN RAISE EXCEPTION 'Esta maleta não tem nota de remessa autorizada: emita a remessa antes do acerto.'; END IF;
  IF rem.chave_nfe IS NULL THEN RAISE EXCEPTION 'A nota de remessa ainda não tem chave; consulte a nota.'; END IF;

  WITH itens AS (
    SELECT n::int AS numero_item, i->>'codigo_produto' AS codigo, i->>'descricao' AS descricao, i->>'codigo_ncm' AS ncm,
           (i->>'quantidade_comercial')::numeric::int AS qtd_remessa, (i->>'valor_unitario_comercial')::numeric AS unit,
           coalesce(rem.itens_variantes[n],
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
    SELECT s.*, least(s.ret, s.qtd_remessa) q_dev,
           least(s.sold, s.qtd_remessa - least(s.ret, s.qtd_remessa)) q_venda
      FROM saldos s
  ), dist2 AS (
    SELECT d.*, least(d.lost, d.qtd_remessa - d.q_dev - d.q_venda) q_perda FROM dist d
  )
  SELECT jsonb_agg(jsonb_build_object('numero_item', numero_item, 'variant_id', variant_id, 'codigo', codigo, 'descricao', descricao,
                                      'ncm', ncm, 'unit', unit, 'qtd_remessa', qtd_remessa, 'devolucao', q_dev, 'venda', q_venda,
                                      'perda', q_perda, 'sem_nota', qtd_remessa - q_dev - q_venda - q_perda) ORDER BY numero_item)
    INTO linhas FROM dist2;

  FOREACH op IN ARRAY ARRAY['devolucao', 'venda', 'perda'] LOOP
    SELECT ref, status, numero INTO viva FROM fiscal_focus_envios
     WHERE cycle_id = _cycle AND operacao = op AND ambiente = 'homologacao' AND status IN ('pendente', 'processando_autorizacao', 'autorizado')
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
    'destinatario', base->'destinatario',
    'pendencias', base->'pendencias',
    'remessa', jsonb_build_object('ref', rem.ref, 'chave', rem.chave_nfe, 'numero', rem.numero,
                                  'data', to_char(rem.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'),
                                  'texto', rem.payload->>'informacoes_adicionais_contribuinte'),
    'operacoes', ops,
    'sem_nota', sem);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_acerto_dados(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_acerto_dados(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fiscal_focus_envio_acerto_registrar(_ref text, _ambiente text, _cycle uuid, _operacao text,
  _ref_origem text, _party uuid, _payload jsonb, _ator uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE kc record; o record; viva text;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF _ambiente <> 'homologacao' THEN RAISE EXCEPTION 'Nesta versão só há emissão em homologação.'; END IF;
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
   WHERE cycle_id = _cycle AND ambiente = _ambiente AND operacao = _operacao
     AND status IN ('pendente', 'processando_autorizacao', 'autorizado') LIMIT 1;
  IF viva IS NOT NULL THEN RAISE EXCEPTION 'Esta maleta já tem nota de % (%).', _operacao, viva; END IF;

  INSERT INTO fiscal_focus_envios (ref, ambiente, operacao, teste, ref_origem, party_id, payload, criado_por, cycle_id)
  VALUES (_ref, _ambiente, _operacao, true, _ref_origem, _party, _payload, _ator, _cycle);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_ator, 'fiscal.focus_envio', 'fiscal_focus_envios', _ref,
          jsonb_build_object('ambiente', _ambiente, 'operacao', _operacao, 'cycle_id', _cycle, 'ref_origem', _ref_origem));
  RETURN jsonb_build_object('ref', _ref);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_envio_acerto_registrar(text,text,uuid,text,text,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_envio_acerto_registrar(text,text,uuid,text,text,uuid,jsonb,uuid) TO service_role;

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
      'created_at', e.created_at,
      'acerto', coalesce((SELECT jsonb_agg(jsonb_build_object('operacao', a.operacao, 'ref', a.ref, 'status', a.status, 'numero', a.numero,
                                   'mensagem_sefaz', a.mensagem_sefaz, 'erros', a.erros, 'tem_danfe', a.caminho_danfe IS NOT NULL)
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