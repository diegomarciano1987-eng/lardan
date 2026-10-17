CREATE TABLE IF NOT EXISTS public.biblioteca_artes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 2 AND 80),
  legenda text NOT NULL DEFAULT '' CHECK (length(legenda) <= 1000),
  formato text NOT NULL DEFAULT 'story' CHECK (formato IN ('story','feed','status')),
  path text NOT NULL UNIQUE,
  publicado boolean NOT NULL DEFAULT false,
  semana date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.biblioteca_artes TO authenticated;
GRANT ALL ON public.biblioteca_artes TO service_role;
ALTER TABLE public.biblioteca_artes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS biblioteca_artes_gerir ON public.biblioteca_artes;
CREATE POLICY biblioteca_artes_gerir ON public.biblioteca_artes FOR ALL TO authenticated USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));
DROP POLICY IF EXISTS biblioteca_artes_consultora ON public.biblioteca_artes;
CREATE POLICY biblioteca_artes_consultora ON public.biblioteca_artes FOR SELECT TO authenticated USING (publicado AND public.has_role(auth.uid(),'consultora'));
DROP TRIGGER IF EXISTS trg_audit_biblioteca_artes ON public.biblioteca_artes;
CREATE TRIGGER trg_audit_biblioteca_artes AFTER INSERT OR UPDATE OR DELETE ON public.biblioteca_artes FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP POLICY IF EXISTS biblioteca_gerir ON storage.objects;
CREATE POLICY biblioteca_gerir ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'biblioteca-lardan' AND public.can_manage_content(auth.uid()))
  WITH CHECK (bucket_id = 'biblioteca-lardan' AND public.can_manage_content(auth.uid()) AND lower(storage.extension(name)) = ANY (ARRAY['jpg','jpeg','png','webp','mp4','pdf']));
DROP POLICY IF EXISTS biblioteca_consultora_ler ON storage.objects;
CREATE POLICY biblioteca_consultora_ler ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'biblioteca-lardan' AND public.has_role(auth.uid(),'consultora')
    AND EXISTS (SELECT 1 FROM public.biblioteca_artes a WHERE a.path = objects.name AND a.publicado));