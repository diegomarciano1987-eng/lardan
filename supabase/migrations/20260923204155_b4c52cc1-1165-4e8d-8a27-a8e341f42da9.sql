INSERT INTO public.candidatura_stages (key, name, color, sort_order, is_active, is_initial)
VALUES ('reprovada', 'Reprovada', '#C0453E', 90, true, false)
ON CONFLICT (key) DO NOTHING;