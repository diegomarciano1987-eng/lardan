-- 1. Financial read policies with capability checks
DROP POLICY IF EXISTS "fin targets read" ON public.financial_allocation_targets;
CREATE POLICY "fin targets read" ON public.financial_allocation_targets
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.financial_installments i
  JOIN public.financial_titles t ON t.id = i.title_id
  WHERE i.id = financial_allocation_targets.installment_id
    AND (
      (t.direction = 'payable'::fin_direction AND public.has_capability(auth.uid(), 'finance.payable.view'))
      OR (t.direction = 'receivable'::fin_direction AND public.has_capability(auth.uid(), 'finance.receivable.view'))
    )
));

DROP POLICY IF EXISTS "fin allocations read" ON public.financial_allocations;
CREATE POLICY "fin allocations read" ON public.financial_allocations
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.financial_settlements s
  WHERE s.id = financial_allocations.settlement_id
    AND (
      (s.direction = 'payable'::fin_direction AND public.has_capability(auth.uid(), 'finance.payable.view'))
      OR (s.direction = 'receivable'::fin_direction AND public.has_capability(auth.uid(), 'finance.receivable.view'))
    )
));

DROP POLICY IF EXISTS "fin events read" ON public.financial_title_events;
CREATE POLICY "fin events read" ON public.financial_title_events
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.financial_titles t
  WHERE t.id = financial_title_events.title_id
    AND (
      (t.direction = 'payable'::fin_direction AND public.has_capability(auth.uid(), 'finance.payable.view'))
      OR (t.direction = 'receivable'::fin_direction AND public.has_capability(auth.uid(), 'finance.receivable.view'))
    )
));

-- 2. Avatars: own folder only (master keeps full read)
DROP POLICY IF EXISTS "avatars_read_authenticated" ON storage.objects;
CREATE POLICY "avatars_read_own_or_master" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR public.has_role(auth.uid(), 'master'::app_role)
  )
);

-- 3. Fixed search_path on project functions missing it
ALTER FUNCTION public.kit_events_immutable() SET search_path = public;
ALTER FUNCTION public.showcase_slug_reserved(text) SET search_path = public;

-- 4. Revoke EXECUTE from anon / authenticated on non-public SECURITY DEFINER
--    functions and on all trigger functions in public.
DO $$
DECLARE
  r record;
  allowed text[] := ARRAY[
    'public_catalog_browse','public_catalog_list','public_categories','public_category',
    'public_product','public_taxonomy_redirect','showcase_public','showcase_order_create',
    'submit_candidatura','submit_contact_request','submit_lead'
  ];
  internal_only text[] := ARRAY[
    'expire_reservations_internal','expire_stock_reservations','kit_location_ensure',
    'kit_totals_refresh','kit_require_manage','kit_cycle_in_scope','kit_reference_price',
    'crm_require','crm_log','crm_audit','crm_card','crm_refresh_next','crm_touch_contact',
    'fin_installment_refresh','fin_fingerprint','apply_stock_delta'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.prosecdef,
           (pg_get_function_result(p.oid) = 'trigger') AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public' AND d.objid IS NULL
  LOOP
    IF r.is_trigger THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    ELSIF r.prosecdef AND NOT (r.proname = ANY(allowed)) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
      IF r.proname = ANY(internal_only) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
      END IF;
    END IF;
  END LOOP;
END $$;
