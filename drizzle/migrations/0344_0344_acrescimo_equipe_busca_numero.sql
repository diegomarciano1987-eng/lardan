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
  -- 0343/0344: equipe da Lardan (kit.manage), igual à expedição — estoque ainda não contado (peças na rua)
  -- não barra o acréscimo; o saldo fica negativo até a contagem e a saída acima do disponível é auditada.
  -- O representante continua limitado ao que existe no depósito dele.
  IF gerente THEN
    PERFORM set_config('lardan.stock_unblock', 'on', true);
  END IF;
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

CREATE OR REPLACE FUNCTION public.maletas_buscar(_termo text, _limite integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t text := btrim(coalesce(_termo, ''));
  d text := nullif(ltrim(regexp_replace(coalesce(_termo, ''), '\D', '', 'g'), '0'), '');
  num boolean := btrim(coalesce(_termo, '')) ~* '^(MAL-?\s*)?\d{1,7}$';
  lim int := least(greatest(coalesce(_limite, 20), 1), 50);
  res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(), 'kit.view') THEN
    RAISE EXCEPTION 'Acesso não liberado.' USING errcode = '42501';
  END IF;
  IF length(t) < 2 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'ordem' ORDER BY x.ordem, x.criado_em DESC), '[]'::jsonb) INTO res
  FROM (
    SELECT c.id AS cycle_id, k.code AS maleta, c.cycle_no AS ciclo, c.status::text AS status,
      c.consultora_party_id, pc.display_name AS consultora, pc.code AS consultora_codigo,
      r.id AS remessa_id, r.numero AS remessa, pr.nome AS praca, rep.display_name AS representante,
      r.data_acerto, c.abertura_numero, c.quantity_total AS pecas, c.created_at AS criado_em,
      CASE
        WHEN upper(k.code) = upper(t) OR k.qr_token = t THEN 0
        WHEN num AND ltrim(regexp_replace(k.code, '\D', '', 'g'), '0') = d THEN 0
        WHEN pc.code IS NOT NULL AND upper(pc.code) = upper(t) THEN 1
        ELSE 2
      END AS ordem
    FROM public.kit_cycles c
    JOIN public.kits k ON k.id = c.kit_id
    LEFT JOIN public.parties pc ON pc.id = c.consultora_party_id
    LEFT JOIN public.remessas r ON r.id = c.remessa_id
    LEFT JOIN public.cob_pracas pr ON pr.id = r.praca_id
    LEFT JOIN public.parties rep ON rep.id = coalesce(c.representante_party_id, r.representante_party_id)
    WHERE c.status <> 'cancelada'
      AND (
        upper(k.code) = upper(t) OR k.qr_token = t
        OR (num AND ltrim(regexp_replace(k.code, '\D', '', 'g'), '0') = d)
        OR (pc.id IS NOT NULL AND public.consultora_termo_casa(pc.id, pc.display_name, pc.code, pc.doc, t))
      )
      AND public.kit_cycle_in_scope(c.id)
    ORDER BY 16, c.created_at DESC
    LIMIT lim
  ) x;
  RETURN res;
END
$function$;

CREATE OR REPLACE FUNCTION public.remessas_buscar(_busca text DEFAULT NULL::text, _status text DEFAULT NULL::text, _praca uuid DEFAULT NULL::uuid, _representante uuid DEFAULT NULL::uuid, _de date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _campo_data text DEFAULT 'emissao'::text)
 RETURNS TABLE(id uuid, numero integer, praca_id uuid, praca text, representante text, data_emissao date, data_acerto date, status text, maletas bigint, maletas_conferidas bigint, consultoras_praca bigint, pecas bigint, valor_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.* FROM public.remessas_lista(_status) l
  JOIN colab_v_remessas r ON r.id = l.id
  WHERE (_praca IS NULL OR r.praca_id = _praca)
    AND (_representante IS NULL OR r.representante_party_id = _representante)
    AND (_de IS NULL OR (CASE WHEN _campo_data = 'acerto' THEN r.data_acerto ELSE r.data_emissao END) >= _de)
    AND (_ate IS NULL OR (CASE WHEN _campo_data = 'acerto' THEN r.data_acerto ELSE r.data_emissao END) <= _ate)
    AND (_busca IS NULL OR btrim(_busca) = ''
      OR l.numero::text LIKE btrim(_busca) || '%'
      OR l.praca ILIKE '%' || btrim(_busca) || '%'
      OR coalesce(l.representante,'') ILIKE '%' || btrim(_busca) || '%'
      OR EXISTS (SELECT 1 FROM colab_v_kit_cycles k JOIN public.parties px ON px.id = k.consultora_party_id
                 WHERE k.remessa_id = r.id
                   AND public.consultora_termo_casa(px.id, px.display_name, px.code, px.doc, _busca))
      OR EXISTS (SELECT 1 FROM public.kit_cycles kc JOIN public.kits kk ON kk.id = kc.kit_id
                 WHERE kc.remessa_id = r.id AND kc.status <> 'cancelada'
                   AND (upper(kk.code) = upper(btrim(_busca)) OR kk.qr_token = btrim(_busca)
                     OR (btrim(_busca) ~* '^MAL-?\s*\d{1,7}$'
                         AND ltrim(regexp_replace(kk.code, '\D', '', 'g'), '0')
                             = nullif(ltrim(regexp_replace(_busca, '\D', '', 'g'), '0'), '')))))
  ORDER BY l.numero DESC;
$function$;