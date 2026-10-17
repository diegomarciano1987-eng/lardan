CREATE TABLE IF NOT EXISTS public.kit_divergencia_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  path text NOT NULL UNIQUE,
  enviado_por uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kit_div_fotos_cycle ON public.kit_divergencia_fotos (cycle_id, variant_id);
GRANT SELECT ON public.kit_divergencia_fotos TO authenticated;
GRANT ALL ON public.kit_divergencia_fotos TO service_role;
ALTER TABLE public.kit_divergencia_fotos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kit_div_fotos_ler ON public.kit_divergencia_fotos;
CREATE POLICY kit_div_fotos_ler ON public.kit_divergencia_fotos FOR SELECT TO authenticated
  USING (enviado_por = auth.uid() OR public.can_view_kits(auth.uid()));

CREATE OR REPLACE FUNCTION public.kit_divergencia_foto_registrar(_cycle uuid, _variant uuid, _path text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.kit_cycles; n int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.id IS NULL OR c.consultora_party_id IS DISTINCT FROM public.my_party_id() THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.status NOT IN ('transito','recebida') THEN RAISE EXCEPTION 'Fotos de divergência só na conferência da chegada.'; END IF;
  IF split_part(_path,'/',1) <> auth.uid()::text OR split_part(_path,'/',2) <> 'maleta-' || _cycle::text THEN RAISE EXCEPTION 'Caminho da foto inválido.'; END IF;
  SELECT count(*) INTO n FROM public.kit_divergencia_fotos WHERE cycle_id = _cycle AND variant_id = _variant;
  IF n >= 3 THEN RAISE EXCEPTION 'Máximo de 3 fotos por peça.'; END IF;
  INSERT INTO public.kit_divergencia_fotos (cycle_id, variant_id, path, enviado_por) VALUES (_cycle, _variant, _path, auth.uid()) ON CONFLICT (path) DO NOTHING;
  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  SELECT _cycle, 'divergencia_foto', auth.uid(), jsonb_build_object('variant_id', _variant, 'path', _path)
  WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='kit_events' AND column_name='payload');
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.kit_divergencia_foto_registrar(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_divergencia_foto_registrar(uuid,uuid,text) TO authenticated;

DROP POLICY IF EXISTS maleta_divergencia_foto_ler ON storage.objects;
CREATE POLICY maleta_divergencia_foto_ler ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'consultora-pos-venda' AND public.can_view_kits(auth.uid())
  AND EXISTS (SELECT 1 FROM public.kit_divergencia_fotos f WHERE f.path = objects.name));