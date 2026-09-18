ALTER TABLE public.audit_logs DISABLE TRIGGER USER;

DELETE FROM public.audit_logs WHERE created_at <= now();

ALTER TABLE public.audit_logs ENABLE TRIGGER USER;