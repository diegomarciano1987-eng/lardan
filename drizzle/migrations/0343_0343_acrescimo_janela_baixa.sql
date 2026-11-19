CREATE OR REPLACE FUNCTION public.kit_acrescimo(_cycle uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  gerente boolean; c public.kit_cycles; loc uuid; origem uuid; destinatario uuid;
  mov uuid; transfer uuid; it jsonb; idx integer := 0; total integer := 0; n integer;
  idem text := nullif(_payload->>'idempotency_key','');
  hash text; existente public.kit_movements;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  IF _cycle IS NULL THEN RAISE EXCEPTION 'Informe a maleta.'; END IF;

  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;

  gerente := public.has_capability(uid, 'kit.manage') IS TRUE;
  IF NOT gerente THEN
    IF public.has_capability(uid, 'kit.acrescimo') IS NOT TRUE THEN
      RAISE EXCEPTION 'Sem permissão para acrescentar peças a maletas.' USING errcode='42501';
    END IF;
    IF eu IS NULL OR eu IS DISTINCT FROM c.representante_party_id THEN
      RAISE EXCEPTION 'Somente o representante vinculado a esta maleta pode acrescentar peças.'
        USING errcode='42501';
    END IF;
  END IF;

  IF c.status NOT IN ('transito','recebida','operacao') THEN
    RAISE EXCEPTION 'Só é possível acrescentar peças a uma maleta já expedida e ainda em operação.';
  END IF;
  IF jsonb_typeof(_payload->'itens') <> 'array' OR jsonb_array_length(_payload->'itens') = 0 THEN
    RAISE EXCEPTION 'Informe as peças do acréscimo.';
  END IF;

  origem := nullif(_payload->>'origem_location_id','')::uuid;
  IF origem IS NULL THEN origem := c.origin_location_id; END IF;
  IF origem IS NULL THEN RAISE EXCEPTION 'Escolha o depósito de origem do acréscimo.'; END IF;
  IF EXISTS (SELECT 1 FROM public.locations WHERE id = origem AND (is_blocked OR NOT is_active)) THEN
    RAISE EXCEPTION 'Este depósito não pode fornecer peças para maletas.';
  END IF;
  IF NOT gerente AND NOT EXISTS (
    SELECT 1 FROM public.locations l WHERE l.id = origem AND l.responsible_user_id = uid
  ) THEN
    RAISE EXCEPTION 'Sem permissão para retirar peças deste depósito.' USING errcode='42501';
  END IF;

  loc := public.kit_location_ensure(c.kit_id);
  destinatario := coalesce(c.custodian_party_id, c.consultora_party_id);
  hash := public.kit_idem_hash('acrescimo', _cycle, origem, loc, eu, destinatario, _payload->'itens');

  IF idem IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('kitmov:' || idem, 0));
    SELECT * INTO existente FROM public.kit_movements WHERE idempotency_key = idem;
    IF existente.id IS NOT NULL THEN
      IF existente.payload_hash IS DISTINCT FROM hash THEN
        RAISE EXCEPTION 'Esta chave já foi usada para outra operação.' USING errcode='22023';
      END IF;
      PERFORM public.kit_require_cycle(existente.cycle_id);
      RETURN jsonb_build_object('movement_id', existente.id, 'repetida', true,
                                'situacao', existente.status);
    END IF;
  END IF;

  SELECT coalesce(max(seq),0) + 1 INTO n FROM public.kit_transfers WHERE cycle_id = _cycle;
  INSERT INTO public.kit_transfers (cycle_id, seq, status, from_party_id, to_party_id,
    from_location_id, to_location_id, carrier, tracking_code, shipped_at, note, created_by, updated_by)
  VALUES (_cycle, n, 'transito', eu, destinatario,
    origem, loc, nullif(_payload->>'carrier',''), nullif(_payload->>'tracking_code',''), now(),
    nullif(_payload->>'note',''), uid, uid)
  RETURNING id INTO transfer;

  mov := public.kit_movement_open(_cycle, 'acrescimo', 'pendente', eu,
    destinatario, origem, loc, transfer, uid,
    nullif(_payload->>'note',''), idem, hash);

  PERFORM set_config('lardan.kit_stock', 'on', true);
  -- 0343: igual à expedição — estoque ainda não contado (peças na rua) não barra o acréscimo;
  -- o saldo fica negativo até a contagem e a transferência acima do disponível é auditada.
  PERFORM set_config('lardan.stock_unblock', 'on', true);
  FOR it IN SELECT * FROM jsonb_array_elements(_payload->'itens') LOOP
    idx := idx + 1;
    IF coalesce((it->>'quantity')::integer,0) <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida no item %.', idx;
    END IF;

    INSERT INTO public.kit_movement_items (movement_id, variant_id, quantity, unit_reference_cents, reason)
    VALUES (mov, (it->>'variant_id')::uuid, (it->>'quantity')::integer,
            nullif(it->>'unit_reference_cents','')::integer, nullif(it->>'reason',''));

    PERFORM public.register_stock_movement(
      'transferencia'::stock_move_kind, (it->>'variant_id')::uuid, (it->>'quantity')::integer,
      origem, loc, 'transferencia', NULL,
      'maleta:' || _cycle::text, 'Acréscimo de peças à maleta',
      'maleta-acr:' || mov::text || ':' || idx::text, NULL);

    INSERT INTO public.kit_balances (cycle_id, variant_id, qty_incoming)
    VALUES (_cycle, (it->>'variant_id')::uuid, (it->>'quantity')::integer)
    ON CONFLICT (cycle_id, variant_id)
    DO UPDATE SET qty_incoming = public.kit_balances.qty_incoming + excluded.qty_incoming,
                  updated_at = now();

    total := total + (it->>'quantity')::integer;
  END LOOP;
  PERFORM set_config('lardan.kit_stock', 'off', true);
  PERFORM set_config('lardan.stock_unblock', 'off', true);

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'maleta.acrescimo', uid,
    jsonb_build_object('movimento', mov, 'transferencia', transfer, 'itens', idx, 'quantidade', total,
                       'origem', origem, 'autor_pessoa', eu));

  RETURN jsonb_build_object('movement_id', mov, 'transfer_id', transfer,
                            'itens', idx, 'quantidade', total, 'situacao','pendente');
END $function$;

-- 0343 (Diego, 19/11/2026) — janela da baixa pelo app: só a partir de 10 dias antes do acerto.
-- Data do acerto: a da maleta (due_at), senão a da remessa, senão o prazo gravado na pré-baixa.
CREATE OR REPLACE FUNCTION public.pre_baixa_janela(_cycle uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'acerto_em', b.acerto,
    'dias_antes', 10,
    'libera_em', b.acerto - 10,
    'liberada', b.acerto IS NOT NULL AND b.hoje >= b.acerto - 10)
  FROM (
    SELECT coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto, p.prazo) AS acerto,
           (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje
      FROM public.kit_cycles c
      LEFT JOIN public.remessas r ON r.id = c.remessa_id
      LEFT JOIN public.kit_pre_baixas p ON p.cycle_id = c.id
     WHERE c.id = _cycle
  ) b
$function$;
REVOKE ALL ON FUNCTION public.pre_baixa_janela(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pre_baixa_janela(uuid) TO service_role;

-- A regra vale para a consultora dona da maleta. Equipe (kit.manage) e o representante da carteira
-- (acerto em campo, com leitura das peças devolvidas) continuam podendo fechar.
CREATE OR REPLACE FUNCTION public.pre_baixa_janela_vale(_cycle uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT NOT (
    public.has_capability(auth.uid(), 'kit.manage') IS TRUE
    OR EXISTS (SELECT 1 FROM public.kit_cycles c JOIN public.consultant_profiles cp ON cp.party_id = c.consultora_party_id
                WHERE c.id = _cycle AND cp.representative_party_id IS NOT NULL
                  AND public.rep_portal_pode(cp.representative_party_id))
  )
$function$;
REVOKE ALL ON FUNCTION public.pre_baixa_janela_vale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pre_baixa_janela_vale(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pre_baixa_fechar(_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); v uuid; p kit_pre_baixas; calc jsonb; cfg consultora_cobranca_config; tid uuid; inst uuid;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; k text; nome text; adi bigint; jan jsonb;
BEGIN
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

CREATE OR REPLACE FUNCTION public.pre_baixa_ler(_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p kit_pre_baixas; calc jsonb; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.pre_baixa_pode(_cycle) THEN RAISE EXCEPTION 'Sem acesso a esta maleta.' USING errcode = '42501'; END IF;
  SELECT * INTO p FROM kit_pre_baixas WHERE cycle_id = _cycle;
  IF NOT FOUND THEN RETURN NULL; END IF;
  calc := CASE WHEN p.status = 'aberta' THEN public.pre_baixa_calculo(p.id)
               ELSE jsonb_build_object('vendido_cents', p.total_vendido_cents, 'base_faixa_cents', p.base_faixa_cents,
                      'comissao_pct', p.comissao_pct, 'comissao_cents', p.comissao_cents, 'recebido_lardan_cents', p.recebido_lardan_cents, 'valor_pagar_cents', p.valor_pagar_cents) END;
  RETURN jsonb_build_object(
    'id', p.id, 'cycle_id', p.cycle_id, 'status', p.status, 'situacao', public.pre_baixa_situacao(p),
    'prazo', p.prazo, 'dias_para_prazo', CASE WHEN p.prazo IS NOT NULL THEN p.prazo - hoje END,
    'fechada_em', p.fechada_em, 'encerrada_em', p.encerrada_em, 'installment_id', p.installment_id,
    'diferenca_cents', p.diferenca_cents, 'pendencia_motivo', p.pendencia_motivo,
    -- 0343: quando a baixa fica liberada e se a regra vale para quem está lendo
    'janela', public.pre_baixa_janela(_cycle), 'janela_vale', public.pre_baixa_janela_vale(_cycle),
    'calculo', calc,
    'faixas', coalesce((SELECT jsonb_agg(jsonb_build_object('min_cents', min_vendido_cents, 'percentual', percentual) ORDER BY min_vendido_cents)
                         FROM consultora_comissao_faixas), '[]'::jsonb),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'variant_id', i.variant_id, 'sku', coalesce(nullif(v.sku, ''), pr.internal_code), 'barcode', v.barcode, 'produto', pr.name, 'variante', v.label,
        'media_id', (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1),
        'enviada', i.qtd_enviada, 'app', i.qtd_app, 'vendida', i.qtd_vendida, 'preco_cents', i.preco_cents,
        'lida', i.qtd_lida, 'faltando', i.qtd_faltando, 'voltou_vendida', i.qtd_voltou_vendida,
        'etiqueta_nova', i.preco_cents <> public.kit_reference_price(i.variant_id), 'etiqueta_atualizada', i.etiqueta_atualizada)
        ORDER BY pr.name, v.label)
      FROM kit_pre_baixa_itens i JOIN product_variants v ON v.id = i.variant_id JOIN products pr ON pr.id = v.product_id
     WHERE i.pre_baixa_id = p.id), '[]'::jsonb));
END $function$;

-- 0343: desfazer uma baixa fechada sem querer (equipe com kit.manage, motivo obrigatório, auditado).
CREATE OR REPLACE FUNCTION public.pre_baixa_desfazer(_cycle uuid, _motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); p kit_pre_baixas; pago bigint; pagas integer; mot text := trim(coalesce(_motivo, ''));
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
  IF p.status <> 'fechada' OR p.conferida_em IS NOT NULL OR p.encerrada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Só dá para desfazer uma baixa fechada que ainda não foi conferida.';
  END IF;
  IF coalesce(p.adiantado_cents, 0) > 0 THEN
    RAISE EXCEPTION 'Esta baixa já abateu Pix pagos pela consultora. Desfazer precisa do financeiro.';
  END IF;

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

  UPDATE kit_pre_baixas
     SET status = 'aberta', fechada_em = NULL, fechada_por = NULL, title_id = NULL, installment_id = NULL,
         total_vendido_cents = 0, base_faixa_cents = 0, comissao_pct = 0, comissao_cents = 0,
         valor_pagar_cents = 0, recebido_lardan_cents = 0, adiantado_cents = 0, updated_at = now()
   WHERE id = p.id;

  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, reason, payload)
  SELECT _cycle, 'pre_baixa.desfeita', c.status, c.status, uid, mot, jsonb_build_object('antes', to_jsonb(p))
    FROM kit_cycles c WHERE c.id = _cycle;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'pre_baixa.desfeita', 'kit_pre_baixas', p.id::text,
          jsonb_build_object('motivo', mot, 'cycle_id', _cycle, 'titulo_cancelado', p.title_id, 'antes', to_jsonb(p)));

  RETURN jsonb_build_object('pre_baixa', p.id, 'repetida', false, 'titulo_cancelado', p.title_id);
END $function$;
REVOKE ALL ON FUNCTION public.pre_baixa_desfazer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pre_baixa_desfazer(uuid, text) TO authenticated, service_role;