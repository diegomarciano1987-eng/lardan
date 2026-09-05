CREATE POLICY media_read_staff ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND public.is_staff(auth.uid()));
CREATE POLICY media_write_content ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND public.can_manage_content(auth.uid()));
CREATE POLICY media_update_content ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND public.can_manage_content(auth.uid()))
  WITH CHECK (bucket_id = 'media' AND public.can_manage_content(auth.uid()));
CREATE POLICY media_delete_content ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND public.can_manage_content(auth.uid()));

CREATE POLICY imports_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'imports' AND public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque']::public.app_role[]));
CREATE POLICY imports_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'imports' AND public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque']::public.app_role[]));
CREATE POLICY imports_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'imports' AND public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque']::public.app_role[]))
  WITH CHECK (bucket_id = 'imports' AND public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque']::public.app_role[]));
CREATE POLICY imports_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'imports' AND public.has_role(auth.uid(), 'master'));