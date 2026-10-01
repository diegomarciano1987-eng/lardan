-- Permite montar a maleta mesmo com estoque zerado no depósito de origem.
-- Motivo: as peças estão na rua e o estoque ainda não foi contado.
-- A montagem não movimenta estoque; o bloqueio físico continua na expedição.
CREATE OR REPLACE FUNCTION public.kit_item_upsert(_cycle uuid, _variant uuid, _qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; comp uuid; disp integer; preco integer;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF c.status NOT IN ('rascunho','montagem') THEN
    RAISE EXCEPTION 'A composição já foi conferida e não pode mais ser alterada aqui.';
  END IF;

  SELECT id INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;

  IF _qty IS NULL OR _qty <= 0 THEN
    DELETE FROM public.kit_composition_items WHERE composition_id = comp AND variant_id = _variant;
    PERFORM public.kit_totals_refresh(_cycle);
    RETURN jsonb_build_object('removido', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = _variant AND is_active) THEN
    RAISE EXCEPTION 'Peça inexistente ou inativa.';
  END IF;

  -- Estoque zerado NÃO bloqueia mais a montagem (peças na rua, contagem pendente).
  -- Apenas informamos o disponível para a tela avisar.
  disp := public.stock_available(_variant, c.origin_location_id);

  preco := public.kit_reference_price(_variant);

  INSERT INTO public.kit_composition_items (composition_id, variant_id, quantity, unit_reference_cents)
  VALUES (comp, _variant, _qty, preco)
  ON CONFLICT (composition_id, variant_id)
  DO UPDATE SET quantity = excluded.quantity, unit_reference_cents = excluded.unit_reference_cents;

  UPDATE public.kit_cycles SET status = 'montagem', updated_by = uid WHERE id = _cycle;
  PERFORM public.kit_totals_refresh(_cycle);
  RETURN jsonb_build_object('composition_id', comp, 'variant_id', _variant,
                            'quantidade', _qty, 'valor_unitario', preco,
                            'disponivel_deposito', disp,
                            'estoque_insuficiente', disp < _qty);
END $function$;