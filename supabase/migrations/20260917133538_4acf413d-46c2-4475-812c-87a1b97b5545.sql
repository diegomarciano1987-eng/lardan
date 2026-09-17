DO $$
DECLARE _t text;
BEGIN
  PERFORM set_config('statement_timeout', '300s', true);
  FOR _t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND (c.relname LIKE 'financial\_%' OR c.relname IN ('chart_of_accounts','cost_centers','payment_methods','import_rows','import_jobs','import_files','import_templates'))
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', _t);
  END LOOP;

  DELETE FROM public.financial_reconciliation_allocations;
  DELETE FROM public.financial_reconciliation_events;
  DELETE FROM public.financial_reconciliations;
  DELETE FROM public.financial_match_suggestions;
  DELETE FROM public.financial_statement_lines;
  DELETE FROM public.financial_statement_imports;
  DELETE FROM public.financial_statement_files;
  DELETE FROM public.financial_attachments;
  DELETE FROM public.financial_allocation_targets;
  DELETE FROM public.financial_allocations;
  DELETE FROM public.financial_adjustments;
  DELETE FROM public.financial_acknowledgements;
  DELETE FROM public.financial_installments;
  DELETE FROM public.financial_title_events;
  DELETE FROM public.financial_account_movements;
  DELETE FROM public.financial_settlements;
  DELETE FROM public.financial_transfers;
  DELETE FROM public.financial_titles;
  DELETE FROM public.financial_accounts;
  DELETE FROM public.cost_centers;
  DELETE FROM public.chart_of_accounts;
  DELETE FROM public.payment_methods;

  DELETE FROM public.import_rows;
  DELETE FROM public.import_jobs;
  DELETE FROM public.import_files;
  DELETE FROM public.import_templates;

  FOR _t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND (c.relname LIKE 'financial\_%' OR c.relname IN ('chart_of_accounts','cost_centers','payment_methods','import_rows','import_jobs','import_files','import_templates'))
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', _t);
  END LOOP;
END $$;