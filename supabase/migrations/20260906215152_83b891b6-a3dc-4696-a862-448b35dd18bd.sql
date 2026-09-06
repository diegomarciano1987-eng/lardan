DROP POLICY IF EXISTS stock_movements_read ON public.stock_movements;
REVOKE SELECT ON public.stock_movements FROM authenticated;

DROP POLICY IF EXISTS variant_costs_manage ON public.variant_costs;
CREATE POLICY variant_costs_manage ON public.variant_costs
  FOR ALL TO authenticated
  USING (public.can_view_costs(auth.uid()))
  WITH CHECK (public.can_view_costs(auth.uid()));