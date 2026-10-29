CREATE OR REPLACE FUNCTION public.preco_reajuste_aplicar(_confirmacao text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); v_lote text; n_lista int; n_var int; n_prod int; n_kit int := 0; c record;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN
    RAISE EXCEPTION 'Só o Master aplica o reajuste de preço.' USING errcode = '42501';
  END IF;
  IF coalesce(_confirmacao, '') <> 'APLICAR NOVO PRECO' THEN
    RAISE EXCEPTION 'Para aplicar, digite exatamente: APLICAR NOVO PRECO';
  END IF;
  v_lote := 'preco-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 4);

  INSERT INTO preco_reajustes (lote, variant_id, onde, antes_cents, depois_cents, ator)
  SELECT v_lote, p.variant_id, 'lista', p.price_cents, public.preco_regra_lardan(p.price_cents), uid
    FROM public_price_list p
   WHERE p.variant_id IS NOT NULL AND p.price_cents > 0 AND public.preco_regra_lardan(p.price_cents) <> p.price_cents;
  GET DIAGNOSTICS n_lista = ROW_COUNT;
  UPDATE public_price_list p SET price_cents = r.depois_cents
    FROM preco_reajustes r WHERE r.lote = v_lote AND r.onde = 'lista' AND r.variant_id = p.variant_id;

  INSERT INTO preco_reajustes (lote, variant_id, onde, antes_cents, depois_cents, ator)
  SELECT v_lote, v.id, 'variante', v.price_cents, public.preco_regra_lardan(v.price_cents), uid
    FROM product_variants v
   WHERE v.price_cents > 0 AND public.preco_regra_lardan(v.price_cents) <> v.price_cents;
  GET DIAGNOSTICS n_var = ROW_COUNT;
  UPDATE product_variants v SET price_cents = r.depois_cents
    FROM preco_reajustes r WHERE r.lote = v_lote AND r.onde = 'variante' AND r.variant_id = v.id;

  -- Preço do produto (coluna exibida na lista de produtos) segue a mesma regra.
  UPDATE products SET price_cents = public.preco_regra_lardan(price_cents)
   WHERE price_cents >= 500 AND public.preco_regra_lardan(price_cents) <> price_cents;
  GET DIAGNOSTICS n_prod = ROW_COUNT;

  FOR c IN SELECT DISTINCT kc.id FROM kit_cycles kc JOIN kit_compositions co ON co.cycle_id = kc.id
            WHERE kc.status IN ('rascunho', 'montagem') AND co.frozen_at IS NULL LOOP
    UPDATE kit_composition_items i SET unit_reference_cents = public.kit_reference_price(i.variant_id)
      FROM kit_compositions co
     WHERE co.id = i.composition_id AND co.cycle_id = c.id AND co.frozen_at IS NULL
       AND i.unit_reference_cents IS DISTINCT FROM public.kit_reference_price(i.variant_id);
    PERFORM public.kit_totals_refresh(c.id);
    n_kit := n_kit + 1;
  END LOOP;

  UPDATE pedido_config SET preco_virada_em = now(), atualizado_por = uid, atualizado_em = now() WHERE true;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'preco.reajuste_aplicado', 'product_variants', v_lote,
          jsonb_build_object('lista', n_lista, 'variantes', n_var, 'produtos', n_prod, 'maletas_em_montagem', n_kit));
  RETURN jsonb_build_object('lote', v_lote, 'lista', n_lista, 'variantes', n_var, 'produtos', n_prod, 'maletas_em_montagem', n_kit);
END $function$;