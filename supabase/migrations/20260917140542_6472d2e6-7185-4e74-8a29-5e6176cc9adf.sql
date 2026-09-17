CREATE OR REPLACE FUNCTION public.kit_aceitar(_cycle uuid, _itens jsonb, _idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  c public.kit_cycles; comp public.kit_compositions; ac uuid; item jsonb;
  vid uuid; esperado integer; aceito integer; divergente integer;
  total_aceito integer := 0; total_div integer := 0; tipo public.kit_acceptance_kind;
  existente public.kit_acceptances;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF NOT (public.has_capability(uid,'kit.manage') OR c.consultora_party_id = eu) THEN
    RAISE EXCEPTION 'Somente a consultora desta maleta pode aceitá-la.' USING errcode = '42501';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO existente FROM public.kit_acceptances
     WHERE cycle_id = _cycle AND idempotency_key = _idempotency_key;
    IF existente.id IS NOT NULL THEN
      RETURN jsonb_build_object('acceptance_id', existente.id, 'repetida', true,
                                'situacao', c.status);
    END IF;
  END IF;

  IF c.status IN ('operacao','acerto','encerrada') THEN
    RAISE EXCEPTION 'Esta maleta já foi aceita.';
  END IF;
  IF c.status NOT IN ('transito','recebida') THEN
    RAISE EXCEPTION 'A maleta ainda não foi expedida.';
  END IF;
  -- a maleta precisa estar sob responsabilidade da consultora destinatária
  IF c.custodian_party_id IS DISTINCT FROM c.consultora_party_id THEN
    RAISE EXCEPTION 'A maleta ainda não chegou à consultora.';
  END IF;

  SELECT * INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  IF comp.frozen_at IS NULL THEN RAISE EXCEPTION 'Composição não conferida.'; END IF;

  INSERT INTO public.kit_acceptances (cycle_id, composition_id, kind, party_id, actor_user_id,
    context, idempotency_key)
  VALUES (_cycle, comp.id, 'integral', c.consultora_party_id, uid, '{}'::jsonb, _idempotency_key)
  RETURNING id INTO ac;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_itens,'[]'::jsonb)) LOOP
    vid := (item->>'variant_id')::uuid;
    SELECT quantity INTO esperado FROM public.kit_composition_items
     WHERE composition_id = comp.id AND variant_id = vid;
    IF esperado IS NULL THEN
      RAISE EXCEPTION 'Peça informada não faz parte desta maleta.';
    END IF;
    aceito := coalesce((item->>'qty_accepted')::integer, esperado);
    divergente := coalesce((item->>'qty_divergent')::integer, esperado - aceito);
    IF aceito < 0 OR divergente < 0 OR aceito + divergente > esperado THEN
      RAISE EXCEPTION 'Quantidades informadas não conferem com a maleta.';
    END IF;

    INSERT INTO public.kit_acceptance_items (acceptance_id, variant_id, qty_expected,
      qty_accepted, qty_divergent, divergence_reason, photos)
    VALUES (ac, vid, esperado, aceito, divergente,
            nullif(item->>'motivo',''), coalesce(item->'fotos','[]'::jsonb));

    UPDATE public.kit_balances
       SET qty_accepted = qty_accepted + aceito,
           qty_divergent = qty_divergent + divergente,
           updated_at = now()
     WHERE cycle_id = _cycle AND variant_id = vid;
  END LOOP;

  INSERT INTO public.kit_acceptance_items (acceptance_id, variant_id, qty_expected, qty_accepted, qty_divergent)
  SELECT ac, ci.variant_id, ci.quantity, ci.quantity, 0
    FROM public.kit_composition_items ci
   WHERE ci.composition_id = comp.id
     AND NOT EXISTS (SELECT 1 FROM public.kit_acceptance_items ai
                      WHERE ai.acceptance_id = ac AND ai.variant_id = ci.variant_id);

  UPDATE public.kit_balances b
     SET qty_accepted = b.qty_accepted + ai.qty_accepted, updated_at = now()
    FROM public.kit_acceptance_items ai
   WHERE ai.acceptance_id = ac AND b.cycle_id = _cycle AND b.variant_id = ai.variant_id
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(_itens,'[]'::jsonb)) x
        WHERE (x->>'variant_id')::uuid = ai.variant_id);

  SELECT coalesce(sum(qty_accepted),0), coalesce(sum(qty_divergent),0)
    INTO total_aceito, total_div
    FROM public.kit_acceptance_items WHERE acceptance_id = ac;

  tipo := CASE WHEN total_div > 0 THEN 'parcial'::public.kit_acceptance_kind
               ELSE 'integral'::public.kit_acceptance_kind END;
  UPDATE public.kit_acceptances SET kind = tipo WHERE id = ac;

  UPDATE public.kit_cycles
     SET status = 'operacao', received_at = coalesce(received_at, now()), updated_by = uid
   WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'maleta.aceita', c.status, 'operacao', uid,
          jsonb_build_object('aceite', ac, 'tipo', tipo, 'aceitas', total_aceito,
                             'divergentes', total_div, 'composicao', comp.id));

  RETURN jsonb_build_object('acceptance_id', ac, 'tipo', tipo, 'aceitas', total_aceito,
                            'divergentes', total_div, 'situacao','operacao');
END $$;

REVOKE EXECUTE ON FUNCTION public.kit_aceitar(uuid, jsonb, text) FROM anon;
