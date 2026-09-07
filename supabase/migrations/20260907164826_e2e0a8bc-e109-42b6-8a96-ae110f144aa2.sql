INSERT INTO public.locations (code, name, kind, is_active)
SELECT 'DEP-01', 'Depósito Principal', 'deposito', true
WHERE NOT EXISTS (SELECT 1 FROM public.locations WHERE code = 'DEP-01');