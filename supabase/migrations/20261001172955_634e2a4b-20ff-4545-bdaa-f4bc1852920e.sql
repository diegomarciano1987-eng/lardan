CREATE TABLE public.consultant_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 140),
  corpo text NOT NULL DEFAULT '' CHECK (length(corpo) <= 5000),
  tipo text NOT NULL DEFAULT 'novidade' CHECK (tipo IN ('novidade','aviso','promocao')),
  critico boolean NOT NULL DEFAULT false,
  imagem_path text,
  link_url text CHECK (link_url IS NULL OR link_url ~ '^https://'),
  link_rotulo text,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','publicado','arquivado')),
  inicio_em timestamptz NOT NULL DEFAULT now(),
  fim_em timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_announcements TO authenticated;
GRANT ALL ON public.consultant_announcements TO service_role;
ALTER TABLE public.consultant_announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gestao avisos" ON public.consultant_announcements FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));
CREATE POLICY "consultora le avisos publicados" ON public.consultant_announcements FOR SELECT TO authenticated
  USING (status = 'publicado' AND inicio_em <= now() AND (fim_em IS NULL OR fim_em > now())
         AND public.has_role(auth.uid(), 'consultora'));
CREATE TRIGGER consultant_announcements_upd BEFORE UPDATE ON public.consultant_announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.consultant_announcement_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.consultant_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  lido_em timestamptz NOT NULL DEFAULT now(),
  ciente_em timestamptz,
  dispositivo text,
  UNIQUE (announcement_id, user_id)
);
GRANT SELECT ON public.consultant_announcement_reads TO authenticated;
GRANT ALL ON public.consultant_announcement_reads TO service_role;
ALTER TABLE public.consultant_announcement_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "le propria leitura" ON public.consultant_announcement_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_manage_content(auth.uid()));

-- Registro idempotente: leitura e ciência
CREATE OR REPLACE FUNCTION public.aviso_registrar(_id uuid, _ciente boolean DEFAULT false, _dispositivo text DEFAULT NULL)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ciente timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Acesso não liberado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM consultant_announcements a WHERE a.id = _id AND a.status = 'publicado'
                 AND a.inicio_em <= now() AND (a.fim_em IS NULL OR a.fim_em > now())) THEN
    RAISE EXCEPTION 'Aviso indisponível';
  END IF;
  INSERT INTO consultant_announcement_reads(announcement_id, user_id, ciente_em, dispositivo)
  VALUES (_id, auth.uid(), CASE WHEN _ciente THEN now() END, left(_dispositivo, 200))
  ON CONFLICT (announcement_id, user_id) DO UPDATE
    SET ciente_em = COALESCE(consultant_announcement_reads.ciente_em, EXCLUDED.ciente_em),
        dispositivo = COALESCE(consultant_announcement_reads.dispositivo, EXCLUDED.dispositivo)
  RETURNING ciente_em INTO v_ciente;
  RETURN v_ciente;
END $$;
REVOKE ALL ON FUNCTION public.aviso_registrar(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aviso_registrar(uuid, boolean, text) TO authenticated;

-- Relatório de ciência: todas as consultoras ativas, quem confirmou e quem falta
CREATE OR REPLACE FUNCTION public.aviso_relatorio(_id uuid)
RETURNS TABLE(user_id uuid, nome text, email text, lido_em timestamptz, ciente_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_manage_content(auth.uid()) THEN RAISE EXCEPTION 'Acesso não liberado'; END IF;
  RETURN QUERY
  SELECT u.user_id, COALESCE(NULLIF(p.full_name,''), p.display_name, p.email)::text, p.email::text, r.lido_em, r.ciente_em
  FROM (SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.role = 'consultora') u
  JOIN profiles p ON p.id = u.user_id AND COALESCE(p.is_active, true)
  LEFT JOIN consultant_announcement_reads r ON r.announcement_id = _id AND r.user_id = u.user_id
  ORDER BY r.ciente_em NULLS LAST, 2;
END $$;
REVOKE ALL ON FUNCTION public.aviso_relatorio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aviso_relatorio(uuid) TO authenticated;

-- Fotos dos avisos (bucket privado)
CREATE POLICY "avisos gestao escreve" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'avisos' AND public.can_manage_content(auth.uid()))
  WITH CHECK (bucket_id = 'avisos' AND public.can_manage_content(auth.uid()));
CREATE POLICY "avisos consultora le" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avisos' AND public.has_role(auth.uid(), 'consultora'));