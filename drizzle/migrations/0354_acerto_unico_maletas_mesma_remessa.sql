-- 0354 (Diego, 19/11/2026) — Duas maletas da mesma remessa e do mesmo acerto: um acerto só no app, um Pix só.
-- Para a Lardan as maletas seguem separadas (cada uma com a sua pré-baixa, conferência e devolução).

ALTER TABLE public.kit_pre_baixas ADD COLUMN IF NOT EXISTS grupo_id uuid;
COMMENT ON COLUMN public.kit_pre_baixas.grupo_id IS 'Acerto único (0354): pré-baixas fechadas juntas no app dividem o mesmo título/Pix.';
CREATE INDEX IF NOT EXISTS kit_pre_baixas_grupo_idx ON public.kit_pre_baixas (grupo_id) WHERE grupo_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pre_baixa_grupo_ciclos(_cycle uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH c AS (
    SELECT c.id, c.consultora_party_id, c.remessa_id, public.pre_baixa_janela(c.id)->>'acerto_em' AS acerto, pb.grupo_id, pb.status AS pb_status
      FROM kit_cycles c LEFT JOIN kit_pre_baixas pb ON pb.cycle_id = c.id WHERE c.id = _cycle
  )
  SELECT CASE
    WHEN c.remessa_id IS NULL OR c.consultora_party_id IS NULL THEN ARRAY[c.id]
    WHEN c.pb_status IS NOT NULL AND c.pb_status <> 'aberta' AND c.grupo_id IS NULL THEN ARRAY[c.id]
    ELSE coalesce((
      SELECT array_agg(o.id ORDER BY o.created_at, o.id)
        FROM kit_cycles o LEFT JOIN kit_pre_baixas op ON op.cycle_id = o.id
       WHERE o.consultora_party_id = c.consultora_party_id AND o.remessa_id = c.remessa_id
         AND (public.pre_baixa_janela(o.id)->>'acerto_em') IS NOT DISTINCT FROM c.acerto
         AND (CASE WHEN c.grupo_id IS NOT NULL THEN op.grupo_id = c.grupo_id
                   ELSE o.status IN ('operacao', 'acerto') AND (op.id IS NULL OR op.status = 'aberta') END)
    ), ARRAY[c.id]) END
  FROM c
$function$;
REVOKE ALL ON FUNCTION public.pre_baixa_grupo_ciclos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_grupo_ciclos(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_grupo_ler(_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ids uuid[]; party uuid; rem uuid; pbs kit_pre_baixas[]; p kit_pre_baixas; n_pb int; aberta boolean;
  vend bigint := 0; outros bigint := 0; base bigint; pct numeric; com bigint := 0; rec bigint := 0; agu bigint := 0; adi bigint := 0;
  disp bigint; valor bigint := 0; sit text; sits text[]; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  jan jsonb; lib boolean := true; libera date; acerto date; v_prazo date; i int;
BEGIN
  IF NOT public.pre_baixa_pode(_cycle) THEN RAISE EXCEPTION 'Sem acesso a esta maleta.' USING errcode = '42501'; END IF;
  ids := public.pre_baixa_grupo_ciclos(_cycle);
  IF coalesce(array_length(ids, 1), 0) < 2 THEN RETURN jsonb_build_object('grupo', false); END IF;
  SELECT consultora_party_id, remessa_id INTO party, rem FROM kit_cycles WHERE id = _cycle;
  SELECT array_agg(pb ORDER BY array_position(ids, pb.cycle_id)) INTO pbs FROM kit_pre_baixas pb WHERE pb.cycle_id = ANY (ids);
  n_pb := coalesce(array_length(pbs, 1), 0);
  aberta := n_pb = 0 OR NOT EXISTS (SELECT 1 FROM unnest(pbs) x WHERE x.status <> 'aberta');
  FOR i IN 1 .. coalesce(array_length(ids, 1), 0) LOOP
    jan := public.pre_baixa_janela(ids[i]);
    lib := lib AND coalesce((jan->>'liberada')::boolean, false);
    libera := greatest(libera, (jan->>'libera_em')::date);
    acerto := coalesce(acerto, (jan->>'acerto_em')::date);
  END LOOP;
  IF aberta THEN
    SELECT coalesce(sum(it.qtd_vendida::bigint * it.preco_cents), 0) INTO vend
      FROM kit_pre_baixa_itens it JOIN kit_pre_baixas x ON x.id = it.pre_baixa_id WHERE x.cycle_id = ANY (ids);
    SELECT coalesce(sum(coalesce(o.vendido_final_cents, o.total_vendido_cents)), 0) INTO outros
      FROM kit_pre_baixas o WHERE o.remessa_id = rem AND o.consultora_party_id = party AND NOT (o.cycle_id = ANY (ids))
       AND o.status IN ('fechada', 'encerrada', 'pendencia');
    base := vend + outros; pct := public.pre_baixa_faixa(base);
    SELECT coalesce(sum(round(s.v * pct / 100)), 0) INTO com FROM (
      SELECT coalesce(sum(it.qtd_vendida::bigint * it.preco_cents), 0) v FROM kit_pre_baixa_itens it JOIN kit_pre_baixas x ON x.id = it.pre_baixa_id
       WHERE x.cycle_id = ANY (ids) GROUP BY x.id) s;
    FOR i IN 1 .. array_length(ids, 1) LOOP rec := rec + public.pre_baixa_recebido_lardan(ids[i]); END LOOP;
    SELECT coalesce(sum(it.quantity::bigint * it.unit_price_cents), 0) INTO agu
      FROM sales_order_items it JOIN sales_orders o ON o.id = it.order_id
     WHERE it.cycle_id = ANY (ids) AND o.status <> 'cancelado' AND o.payment_status = 'pendente'
       AND o.pay_installment_id IS NOT NULL AND coalesce(o.pay_method, '') <> 'dinheiro';
    disp := public.asaas_adiantamento_disponivel(party);
    adi := least(disp, greatest(vend - com - rec, 0));
    valor := vend - com - rec - adi;
    sit := CASE WHEN n_pb = 0 THEN NULL ELSE 'aberta' END;
  ELSE
    SELECT coalesce(sum(x.total_vendido_cents), 0), max(x.base_faixa_cents), max(x.comissao_pct), coalesce(sum(x.comissao_cents), 0),
           coalesce(sum(x.recebido_lardan_cents), 0), coalesce(sum(x.adiantado_cents), 0), coalesce(sum(x.valor_pagar_cents), 0)
      INTO vend, base, pct, com, rec, adi, valor FROM unnest(pbs) x;
    SELECT array_agg(public.pre_baixa_situacao(x)) INTO sits FROM unnest(pbs) x;
    sit := CASE WHEN 'pendencia' = ANY (sits) THEN 'pendencia'
                WHEN 'aguardando_pagamento' = ANY (sits) THEN 'aguardando_pagamento'
                WHEN 'aguardando_conferencia' = ANY (sits) THEN 'aguardando_conferencia'
                WHEN 'aberta' = ANY (sits) THEN 'aberta'
                ELSE 'encerrada' END;
  END IF;
  v_prazo := coalesce((SELECT min(x.prazo) FROM unnest(pbs) x), acerto);
  RETURN jsonb_build_object(
    'grupo', true, 'iniciado', n_pb = array_length(ids, 1), 'situacao', sit,
    'status', CASE WHEN aberta THEN 'aberta' ELSE 'fechada' END,
    'prazo', v_prazo, 'dias_para_prazo', v_prazo - hoje,
    'fechada_em', (SELECT max(x.fechada_em) FROM unnest(pbs) x), 'encerrada_em', (SELECT max(x.encerrada_em) FROM unnest(pbs) x),
    'installment_id', (SELECT x.installment_id FROM unnest(pbs) x WHERE x.installment_id IS NOT NULL LIMIT 1),
    'pendencia_motivo', (SELECT string_agg(x.pendencia_motivo, ' · ') FROM unnest(pbs) x WHERE x.pendencia_motivo IS NOT NULL),
    'janela', jsonb_build_object('acerto_em', acerto, 'dias_antes', 10, 'libera_em', libera, 'liberada', lib),
    'janela_vale', public.pre_baixa_janela_vale(_cycle),
    'calculo', jsonb_build_object('vendido_cents', vend, 'base_faixa_cents', coalesce(base, vend), 'comissao_pct', coalesce(pct, 0),
       'comissao_cents', com, 'recebido_lardan_cents', rec, 'aguardando_lardan_cents', agu, 'adiantado_consultora_cents', adi,
       'valor_pagar_cents', valor),
    'faixas', coalesce((SELECT jsonb_agg(jsonb_build_object('min_cents', min_vendido_cents, 'percentual', percentual) ORDER BY min_vendido_cents)
                         FROM consultora_comissao_faixas), '[]'::jsonb),
    'maletas', (SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'pecas', c.quantity_total,
                   'valor_cents', c.reference_total_cents) ORDER BY array_position(ids, c.id))
                  FROM kit_cycles c JOIN kits k ON k.id = c.kit_id WHERE c.id = ANY (ids)),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'cycle_id', x.cycle_id, 'maleta', k.code,
        'variant_id', it.variant_id, 'sku', coalesce(nullif(v.sku, ''), pr.internal_code), 'barcode', v.barcode, 'produto', pr.name, 'variante', v.label,
        'enviada', it.qtd_enviada, 'app', it.qtd_app, 'vendida', it.qtd_vendida, 'preco_cents', it.preco_cents)
        ORDER BY pr.name, v.label, k.code)
      FROM kit_pre_baixa_itens it JOIN kit_pre_baixas x ON x.id = it.pre_baixa_id
      JOIN kit_cycles c ON c.id = x.cycle_id JOIN kits k ON k.id = c.kit_id
      JOIN product_variants v ON v.id = it.variant_id JOIN products pr ON pr.id = v.product_id
     WHERE x.cycle_id = ANY (ids)), '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.pre_baixa_grupo_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_grupo_ler(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_grupo_abrir(_cycle uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ids uuid[]; res uuid[] := '{}'; c uuid;
BEGIN
  IF NOT public.pre_baixa_pode(_cycle, true) THEN RAISE EXCEPTION 'Sem acesso a esta maleta.' USING errcode = '42501'; END IF;
  ids := public.pre_baixa_grupo_ciclos(_cycle);
  FOREACH c IN ARRAY ids LOOP res := res || public.pre_baixa_abrir(c); END LOOP;
  RETURN res;
END $function$;
REVOKE ALL ON FUNCTION public.pre_baixa_grupo_abrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_grupo_abrir(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_grupo_fechar(_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); ids uuid[]; c uuid; pbid uuid; p kit_pre_baixas; g uuid; party uuid; rem uuid;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; jan jsonb; outros bigint; vend_total bigint := 0; base bigint; pct numeric;
  v_i bigint; com_i bigint; rec_i bigint; adi_i bigint; val_i bigint; total bigint := 0; adi_total bigint := 0;
  cfg consultora_cobranca_config; tid uuid; inst uuid; codigos text; nome text; v_prazo date; det jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.pre_baixa_pode(_cycle, true) THEN RAISE EXCEPTION 'Sem acesso a esta maleta.' USING errcode = '42501'; END IF;
  ids := public.pre_baixa_grupo_ciclos(_cycle);
  IF coalesce(array_length(ids, 1), 0) < 2 THEN RETURN public.pre_baixa_fechar(_cycle); END IF;
  FOREACH c IN ARRAY ids LOOP PERFORM public.pre_baixa_abrir(c); END LOOP;
  PERFORM 1 FROM kit_pre_baixas WHERE cycle_id = ANY (ids) ORDER BY id FOR UPDATE;
  SELECT consultora_party_id, remessa_id INTO party, rem FROM kit_cycles WHERE id = _cycle;
  SELECT string_agg(k.code, ' + ' ORDER BY array_position(ids, kc.id)) INTO codigos FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id WHERE kc.id = ANY (ids);

  IF NOT EXISTS (SELECT 1 FROM kit_pre_baixas WHERE cycle_id = ANY (ids) AND status = 'aberta') THEN
    SELECT min(grupo_id::text)::uuid INTO g FROM kit_pre_baixas WHERE cycle_id = ANY (ids);
    IF g IS NULL OR EXISTS (SELECT 1 FROM kit_pre_baixas WHERE cycle_id = ANY (ids) AND grupo_id IS DISTINCT FROM g) THEN
      RAISE EXCEPTION 'Uma das maletas já teve o acerto fechado separado. Fale com a Lardan.';
    END IF;
    SELECT * INTO p FROM kit_pre_baixas WHERE cycle_id = ANY (ids) AND installment_id IS NOT NULL LIMIT 1;
    RETURN jsonb_build_object('pre_baixa', g, 'grupo', g, 'repetida', true, 'installment_id', p.installment_id,
      'actor', (SELECT ator_user_id FROM consultora_cobranca_config WHERE id),
      'valor_pagar_cents', (SELECT coalesce(sum(valor_pagar_cents), 0) FROM kit_pre_baixas WHERE grupo_id = g),
      'vencimento', greatest(coalesce((SELECT min(prazo) FROM kit_pre_baixas WHERE grupo_id = g), hoje), hoje), 'maletas', codigos);
  END IF;
  IF EXISTS (SELECT 1 FROM kit_pre_baixas WHERE cycle_id = ANY (ids) AND status <> 'aberta') THEN
    RAISE EXCEPTION 'Uma das maletas já teve o acerto fechado separado. Fale com a Lardan.';
  END IF;

  FOREACH c IN ARRAY ids LOOP
    IF public.pre_baixa_janela_vale(c) THEN
      jan := public.pre_baixa_janela(c);
      IF jan->>'acerto_em' IS NULL THEN
        RAISE EXCEPTION 'A data do acerto desta maleta ainda não foi definida. A baixa fica liberada 10 dias antes do acerto; fale com a Lardan.' USING errcode = 'P0001';
      END IF;
      IF NOT (jan->>'liberada')::boolean THEN
        RAISE EXCEPTION 'A baixa desta maleta só fica liberada a partir de % (10 dias antes do acerto em %). Até lá, continue marcando as vendas.',
          to_char((jan->>'libera_em')::date, 'DD/MM/YYYY'), to_char((jan->>'acerto_em')::date, 'DD/MM/YYYY') USING errcode = 'P0001';
      END IF;
    END IF;
  END LOOP;

  SELECT coalesce(sum(it.qtd_vendida::bigint * it.preco_cents), 0) INTO vend_total
    FROM kit_pre_baixa_itens it JOIN kit_pre_baixas x ON x.id = it.pre_baixa_id WHERE x.cycle_id = ANY (ids);
  SELECT coalesce(sum(coalesce(o.vendido_final_cents, o.total_vendido_cents)), 0) INTO outros
    FROM kit_pre_baixas o WHERE o.remessa_id = rem AND o.consultora_party_id = party AND NOT (o.cycle_id = ANY (ids))
     AND o.status IN ('fechada', 'encerrada', 'pendencia');
  base := vend_total + outros; pct := public.pre_baixa_faixa(base);
  g := gen_random_uuid();

  FOREACH c IN ARRAY ids LOOP
    SELECT * INTO p FROM kit_pre_baixas WHERE cycle_id = c;
    SELECT coalesce(sum(qtd_vendida::bigint * preco_cents), 0) INTO v_i FROM kit_pre_baixa_itens WHERE pre_baixa_id = p.id;
    com_i := round(v_i * pct / 100);
    rec_i := public.pre_baixa_recebido_lardan(c);
    adi_i := least(public.asaas_adiantamento_disponivel(party), greatest(v_i - com_i - rec_i, 0));
    IF adi_i > 0 THEN adi_i := public.asaas_adiantamento_consumir(p.id, party, adi_i, 'fechamento'); END IF;
    val_i := v_i - com_i - rec_i - adi_i;
    UPDATE kit_pre_baixas SET status = 'fechada', total_vendido_cents = v_i, base_faixa_cents = base, comissao_pct = pct,
           comissao_cents = com_i, valor_pagar_cents = val_i, recebido_lardan_cents = rec_i, adiantado_cents = adi_i,
           fechada_em = now(), fechada_por = uid, grupo_id = g, updated_at = now()
     WHERE id = p.id;
    total := total + val_i; adi_total := adi_total + adi_i;
    det := det || jsonb_build_object('cycle_id', c, 'pre_baixa', p.id, 'vendido_cents', v_i, 'comissao_cents', com_i,
                                     'recebido_lardan_cents', rec_i, 'adiantado_cents', adi_i, 'valor_pagar_cents', val_i);
    INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
    SELECT c, 'pre_baixa.fechada', kc.status, kc.status, uid,
           jsonb_build_object('grupo', g, 'maletas', codigos, 'comissao_pct', pct, 'base_faixa_cents', base, 'vendido_cents', v_i,
                              'comissao_cents', com_i, 'valor_pagar_cents', val_i)
      FROM kit_cycles kc WHERE kc.id = c;
  END LOOP;
  SELECT min(kp.prazo) INTO v_prazo FROM kit_pre_baixas kp WHERE kp.grupo_id = g;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'pre_baixa.fechada_grupo', 'kit_pre_baixas', g::text,
          jsonb_build_object('grupo', g, 'maletas', codigos, 'ciclos', to_jsonb(ids), 'comissao_pct', pct, 'base_faixa_cents', base,
                             'total_pagar_cents', total, 'adiantado_cents', adi_total, 'detalhe', det, 'ator_real', uid));

  IF total > 0 THEN
    SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
    IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
    SELECT display_name INTO nome FROM parties WHERE id = party;
    PERFORM public.pdv_como(cfg.ator_user_id);
    tid := public.fin_title_create(jsonb_build_object('direction', 'receivable', 'business_entity_id', cfg.business_entity_id,
      'party_id', party, 'descricao', 'Acerto das maletas ' || coalesce(codigos, '') || ' — ' || coalesce(nome, 'consultora'),
      'documento', left('ACERTO-' || replace(coalesce(codigos, left(g::text, 8)), ' ', ''), 60), 'emissao', hoje, 'competencia', hoje,
      'valor_cents', total, 'financial_account_id', cfg.financial_account_id,
      'origem', 'pre_baixa', 'sistema_origem', 'pre_baixa', 'id_externo', 'prebaixa-grupo:' || g, 'status', 'ativo',
      'observacao', 'Acerto único de ' || array_length(ids, 1) || ' maletas da mesma remessa (um Pix só).'
         || CASE WHEN adi_total > 0 THEN ' Já abatidos R$ ' || replace(to_char(adi_total / 100.0, 'FM999999990.00'), '.', ',')
                                          || ' de Pix/boletos que a consultora pagou pelo app com a maleta aberta.' ELSE '' END,
      'parcelas', jsonb_build_array(jsonb_build_object('valor_cents', total, 'vencimento', greatest(coalesce(v_prazo, hoje), hoje)))));
    SELECT id INTO inst FROM financial_installments WHERE title_id = tid ORDER BY numero LIMIT 1;
    UPDATE kit_pre_baixas SET title_id = tid, installment_id = inst WHERE grupo_id = g;
  END IF;
  RETURN jsonb_build_object('pre_baixa', g, 'grupo', g, 'repetida', false, 'installment_id', inst,
    'actor', (SELECT ator_user_id FROM consultora_cobranca_config WHERE id), 'valor_pagar_cents', total,
    'adiantado_consultora_cents', adi_total, 'vencimento', greatest(coalesce(v_prazo, hoje), hoje), 'maletas', codigos, 'detalhe', det);
END $function$;
REVOKE ALL ON FUNCTION public.pre_baixa_grupo_fechar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_grupo_fechar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_fechar(_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); v uuid; p kit_pre_baixas; calc jsonb; cfg consultora_cobranca_config; tid uuid; inst uuid;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; k text; nome text; adi bigint; jan jsonb;
BEGIN
  -- 0354: duas maletas da mesma remessa e do mesmo acerto fecham juntas, com um título só
  IF coalesce(array_length(public.pre_baixa_grupo_ciclos(_cycle), 1), 0) > 1 THEN
    RETURN public.pre_baixa_grupo_fechar(_cycle);
  END IF;
  v := public.pre_baixa_abrir(_cycle);
  SELECT * INTO p FROM kit_pre_baixas WHERE id = v FOR UPDATE;
  IF p.status <> 'aberta' THEN
    RETURN jsonb_build_object('pre_baixa', p.id, 'repetida', true, 'installment_id', p.installment_id,
      'actor', (SELECT ator_user_id FROM consultora_cobranca_config WHERE id), 'valor_pagar_cents', p.valor_pagar_cents,
      'vencimento', greatest(coalesce(p.prazo, hoje), hoje));
  END IF;
  -- 0343: a consultora só fecha a partir de 10 dias antes do acerto (evita baixa sem querer/testando).
  IF public.pre_baixa_janela_vale(_cycle) THEN
    jan := public.pre_baixa_janela(_cycle);
    IF jan->>'acerto_em' IS NULL THEN
      RAISE EXCEPTION 'A data do acerto desta maleta ainda não foi definida. A baixa fica liberada 10 dias antes do acerto; fale com a Lardan.'
        USING errcode = 'P0001';
    END IF;
    IF NOT (jan->>'liberada')::boolean THEN
      RAISE EXCEPTION 'A baixa desta maleta só fica liberada a partir de % (10 dias antes do acerto em %). Até lá, continue marcando as vendas.',
        to_char((jan->>'libera_em')::date, 'DD/MM/YYYY'), to_char((jan->>'acerto_em')::date, 'DD/MM/YYYY')
        USING errcode = 'P0001';
    END IF;
  END IF;
  calc := public.pre_baixa_calculo(v);
  -- 0293: abate os Pix que ela já pagou (trava os adiantamentos; o que sobrar fica para o próximo acerto)
  adi := public.asaas_adiantamento_consumir(v, p.consultora_party_id, coalesce((calc->>'adiantado_consultora_cents')::bigint, 0), 'fechamento');
  IF adi <> coalesce((calc->>'adiantado_consultora_cents')::bigint, 0) THEN
    calc := calc || jsonb_build_object('adiantado_consultora_cents', adi,
      'valor_pagar_cents', (calc->>'vendido_cents')::bigint - (calc->>'comissao_cents')::bigint - (calc->>'recebido_lardan_cents')::bigint - adi);
  END IF;
  UPDATE kit_pre_baixas SET status = 'fechada', total_vendido_cents = (calc->>'vendido_cents')::bigint,
         base_faixa_cents = (calc->>'base_faixa_cents')::bigint, comissao_pct = (calc->>'comissao_pct')::numeric,
         comissao_cents = (calc->>'comissao_cents')::bigint, valor_pagar_cents = (calc->>'valor_pagar_cents')::bigint,
         recebido_lardan_cents = (calc->>'recebido_lardan_cents')::bigint, adiantado_cents = adi,
         fechada_em = now(), fechada_por = uid, updated_at = now()
   WHERE id = v;
  IF (calc->>'valor_pagar_cents')::bigint > 0 THEN
    SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
    IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
    SELECT kk.code INTO k FROM kits kk JOIN kit_cycles c ON c.kit_id = kk.id WHERE c.id = _cycle;
    SELECT display_name INTO nome FROM parties WHERE id = p.consultora_party_id;
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (uid, 'pre_baixa.fechada', 'kit_pre_baixas', v::text, calc || jsonb_build_object('ator_real', uid));
    PERFORM public.pdv_como(cfg.ator_user_id);
    tid := public.fin_title_create(jsonb_build_object('direction', 'receivable', 'business_entity_id', cfg.business_entity_id,
      'party_id', p.consultora_party_id, 'descricao', 'Acerto da maleta ' || coalesce(k, '') || ' — ' || coalesce(nome, 'consultora'),
      'documento', 'ACERTO-' || coalesce(k, left(v::text, 8)), 'emissao', hoje, 'competencia', hoje,
      'valor_cents', (calc->>'valor_pagar_cents')::bigint, 'financial_account_id', cfg.financial_account_id,
      'origem', 'pre_baixa', 'sistema_origem', 'pre_baixa', 'id_externo', 'prebaixa:' || v, 'status', 'ativo',
      'observacao', CASE WHEN adi > 0 THEN 'Já abatidos R$ ' || replace(to_char(adi / 100.0, 'FM999999990.00'), '.', ',')
                                           || ' de Pix/boletos que a consultora pagou pelo app com a maleta aberta.' END,
      'parcelas', jsonb_build_array(jsonb_build_object('valor_cents', (calc->>'valor_pagar_cents')::bigint,
                                                       'vencimento', greatest(coalesce(p.prazo, hoje), hoje)))));
    SELECT id INTO inst FROM financial_installments WHERE title_id = tid ORDER BY numero LIMIT 1;
    UPDATE kit_pre_baixas SET title_id = tid, installment_id = inst WHERE id = v;
  END IF;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  SELECT _cycle, 'pre_baixa.fechada', c.status, c.status, uid, calc FROM kit_cycles c WHERE c.id = _cycle;
  RETURN jsonb_build_object('pre_baixa', v, 'repetida', false, 'installment_id', inst,
    'actor', (SELECT ator_user_id FROM consultora_cobranca_config WHERE id), 'valor_pagar_cents', (calc->>'valor_pagar_cents')::bigint,
    'adiantado_consultora_cents', adi, 'vencimento', greatest(coalesce(p.prazo, hoje), hoje));
END $function$;

CREATE OR REPLACE FUNCTION public.pre_baixa_pago(_pb kit_pre_baixas)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _pb.status IN ('fechada', 'encerrada', 'pendencia') AND (
    (coalesce(_pb.valor_pagar_cents, 0) <= 0 AND _pb.installment_id IS NULL)
    OR EXISTS (SELECT 1 FROM financial_installments i WHERE i.id = _pb.installment_id AND i.settlement_status IN ('liquidado', 'excedente')))
$function$;

CREATE OR REPLACE FUNCTION public.pre_baixa_desfazer(_cycle uuid, _motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); p kit_pre_baixas; q kit_pre_baixas; pago bigint; pagas integer; mot text := trim(coalesce(_motivo, ''));
BEGIN
  IF uid IS NULL OR public.has_capability(uid, 'kit.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem permissão para desfazer a baixa.' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM kit_cycles WHERE id = _cycle) THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501';
  END IF;
  IF length(mot) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;

  SELECT * INTO p FROM kit_pre_baixas WHERE cycle_id = _cycle FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Esta maleta não tem baixa pelo app.'; END IF;
  IF p.status = 'aberta' THEN RETURN jsonb_build_object('pre_baixa', p.id, 'repetida', true); END IF;
  IF p.grupo_id IS NOT NULL THEN
    PERFORM 1 FROM kit_pre_baixas WHERE grupo_id = p.grupo_id ORDER BY id FOR UPDATE;
  END IF;
  FOR q IN SELECT * FROM kit_pre_baixas WHERE id = p.id OR (p.grupo_id IS NOT NULL AND grupo_id = p.grupo_id) LOOP
    IF q.status <> 'fechada' OR q.conferida_em IS NOT NULL OR q.encerrada_em IS NOT NULL THEN
      RAISE EXCEPTION 'Só dá para desfazer uma baixa fechada que ainda não foi conferida.';
    END IF;
    IF coalesce(q.adiantado_cents, 0) > 0 THEN
      RAISE EXCEPTION 'Esta baixa já abateu Pix pagos pela consultora. Desfazer precisa do financeiro.';
    END IF;
  END LOOP;

  IF p.title_id IS NOT NULL THEN
    SELECT coalesce(sum(a.valor_cents), 0) INTO pago
      FROM financial_allocations a JOIN financial_installments i ON i.id = a.installment_id WHERE i.title_id = p.title_id;
    IF pago <> 0 THEN RAISE EXCEPTION 'O acerto já tem pagamento registrado; não dá para desfazer.'; END IF;
    SELECT count(*) INTO pagas FROM asaas_charges
     WHERE title_id = p.title_id AND external_status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH');
    IF pagas > 0 THEN RAISE EXCEPTION 'O Pix do acerto já foi pago no Asaas; não dá para desfazer.'; END IF;

    UPDATE financial_titles
       SET status = 'cancelado', cancel_reason = 'Baixa da maleta desfeita: ' || mot,
           id_externo = id_externo || ':desfeita:' || to_char(now(), 'YYYYMMDDHH24MISS'), updated_at = now()
     WHERE id = p.title_id;
    INSERT INTO financial_title_events (title_id, evento, motivo, actor_id)
    VALUES (p.title_id, 'cancelado', 'Baixa da maleta desfeita: ' || mot, uid);
  END IF;

  FOR q IN SELECT * FROM kit_pre_baixas WHERE id = p.id OR (p.grupo_id IS NOT NULL AND grupo_id = p.grupo_id) LOOP
    UPDATE kit_pre_baixas
       SET status = 'aberta', fechada_em = NULL, fechada_por = NULL, title_id = NULL, installment_id = NULL,
           total_vendido_cents = 0, base_faixa_cents = 0, comissao_pct = 0, comissao_cents = 0,
           valor_pagar_cents = 0, recebido_lardan_cents = 0, adiantado_cents = 0, grupo_id = NULL, updated_at = now()
     WHERE id = q.id;
    INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, reason, payload)
    SELECT q.cycle_id, 'pre_baixa.desfeita', c.status, c.status, uid, mot, jsonb_build_object('antes', to_jsonb(q))
      FROM kit_cycles c WHERE c.id = q.cycle_id;
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (uid, 'pre_baixa.desfeita', 'kit_pre_baixas', q.id::text,
            jsonb_build_object('motivo', mot, 'cycle_id', q.cycle_id, 'titulo_cancelado', p.title_id, 'grupo', p.grupo_id, 'antes', to_jsonb(q)));
  END LOOP;

  RETURN jsonb_build_object('pre_baixa', p.id, 'repetida', false, 'titulo_cancelado', p.title_id, 'grupo', p.grupo_id);
END $function$;