CREATE OR REPLACE FUNCTION public.import_can_publish(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_capability(_user,'showcase.publish') OR public.has_capability(_user,'catalog.publish')
$$;

CREATE OR REPLACE FUNCTION public.import_publish_guard()
RETURNS void LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ SELECT $$;