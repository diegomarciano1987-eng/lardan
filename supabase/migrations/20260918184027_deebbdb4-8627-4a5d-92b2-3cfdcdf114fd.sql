DO $$
DECLARE
  v_products uuid[];
  v_variants uuid[];
  v_locations uuid[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_products
  FROM public.products
  WHERE name ILIKE 'HOMOLOG%' AND status <> 'publicado';

  SELECT coalesce(array_agg(id), '{}') INTO v_variants
  FROM public.product_variants WHERE product_id = ANY(v_products);

  SELECT coalesce(array_agg(id), '{}') INTO v_locations
  FROM public.locations WHERE name ILIKE 'HOMOLOG%' OR kind = 'maleta';

  ALTER TABLE public.stock_movements DISABLE TRIGGER stock_movements_immutable;
  ALTER TABLE public.stock_movements DISABLE TRIGGER audit_stock_movements;
  ALTER TABLE public.kit_events DISABLE TRIGGER kit_events_no_change;
  ALTER TABLE public.sales_order_events DISABLE TRIGGER trg_sales_order_events_immutable;
  ALTER TABLE public.products DISABLE TRIGGER trg_audit_products;
  ALTER TABLE public.product_variants DISABLE TRIGGER trg_audit_product_variants;
  ALTER TABLE public.product_variants DISABLE TRIGGER trg_product_variants_guard;
  ALTER TABLE public.locations DISABLE TRIGGER trg_audit_locations;
  ALTER TABLE public.stock_reservations DISABLE TRIGGER stock_reservations_no_delete;

  -- pedidos de teste
  DELETE FROM public.sales_orders o
  WHERE EXISTS (SELECT 1 FROM public.sales_order_items i WHERE i.order_id = o.id AND i.variant_id = ANY(v_variants));

  -- maletas/ciclos de teste
  DELETE FROM public.kit_cycles c
  WHERE c.origin_location_id = ANY(v_locations)
     OR c.current_location_id = ANY(v_locations)
     OR c.consultora_location_id = ANY(v_locations)
     OR EXISTS (SELECT 1 FROM public.kit_composition_items ci
                JOIN public.kit_compositions k ON k.id = ci.composition_id
                WHERE k.cycle_id = c.id AND ci.variant_id = ANY(v_variants));
  DELETE FROM public.kits k WHERE NOT EXISTS (SELECT 1 FROM public.kit_cycles c WHERE c.kit_id = k.id);

  -- estoque de teste
  DELETE FROM public.stock_reservations WHERE variant_id = ANY(v_variants) OR location_id = ANY(v_locations);
  DELETE FROM public.stock_movements WHERE variant_id = ANY(v_variants)
     OR from_location_id = ANY(v_locations) OR to_location_id = ANY(v_locations);
  DELETE FROM public.stock_balances WHERE variant_id = ANY(v_variants) OR location_id = ANY(v_locations);

  -- vínculos de importação
  UPDATE public.import_rows SET variant_id = NULL WHERE variant_id = ANY(v_variants);
  UPDATE public.import_rows SET product_id = NULL WHERE product_id = ANY(v_products);
  UPDATE public.import_jobs SET location_id = NULL WHERE location_id = ANY(v_locations);
  DELETE FROM public.product_import_stage WHERE product_id = ANY(v_products) OR variant_id = ANY(v_variants);

  -- peças de teste
  DELETE FROM public.public_price_list WHERE product_id = ANY(v_products) OR variant_id = ANY(v_variants);
  DELETE FROM public.variant_costs WHERE variant_id = ANY(v_variants);
  DELETE FROM public.product_media WHERE product_id = ANY(v_products);
  DELETE FROM public.product_slug_history WHERE product_id = ANY(v_products);
  DELETE FROM public.product_variants WHERE product_id = ANY(v_products);
  DELETE FROM public.products WHERE id = ANY(v_products);

  -- depósitos e maletas de teste sem dependências restantes
  DELETE FROM public.locations l
  WHERE l.id = ANY(v_locations)
    AND NOT EXISTS (SELECT 1 FROM public.kit_cycles c WHERE c.origin_location_id = l.id OR c.current_location_id = l.id OR c.consultora_location_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM public.kit_transfers t WHERE t.from_location_id = l.id OR t.to_location_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM public.stock_balances b WHERE b.location_id = l.id);

  ALTER TABLE public.stock_movements ENABLE TRIGGER stock_movements_immutable;
  ALTER TABLE public.stock_movements ENABLE TRIGGER audit_stock_movements;
  ALTER TABLE public.kit_events ENABLE TRIGGER kit_events_no_change;
  ALTER TABLE public.sales_order_events ENABLE TRIGGER trg_sales_order_events_immutable;
  ALTER TABLE public.products ENABLE TRIGGER trg_audit_products;
  ALTER TABLE public.product_variants ENABLE TRIGGER trg_audit_product_variants;
  ALTER TABLE public.product_variants ENABLE TRIGGER trg_product_variants_guard;
  ALTER TABLE public.locations ENABLE TRIGGER trg_audit_locations;
  ALTER TABLE public.stock_reservations ENABLE TRIGGER stock_reservations_no_delete;
END $$;