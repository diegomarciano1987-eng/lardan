CREATE OR REPLACE FUNCTION public.colab_legacy_rep_codigos()
 RETURNS integer[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(array_agg(lr.codigo), '{}') FROM legado_representantes lr
   WHERE public.colab_rep() IS NOT NULL AND (lr.party_id = public.colab_rep()
     OR upper(trim(lr.nome)) = (SELECT upper(trim(display_name)) FROM parties WHERE id = public.colab_rep()))
$$;
REVOKE ALL ON FUNCTION public.colab_legacy_rep_codigos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.colab_legacy_rep_codigos() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.colab_praca_ok(_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT NOT public.colab_restrita() OR _id = ANY(public.colab_praca_ids()) $$;

CREATE OR REPLACE FUNCTION public.colab_legacy_rep_ok(_codigo integer)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT NOT public.colab_restrita() OR _codigo = ANY(public.colab_legacy_rep_codigos()) $$;

CREATE OR REPLACE VIEW public.colab_v_legado_representantes AS SELECT lr.* FROM public.legado_representantes lr
  WHERE NOT (SELECT public.colab_restrita()) OR lr.codigo = ANY((SELECT public.colab_legacy_rep_codigos())::integer[]);