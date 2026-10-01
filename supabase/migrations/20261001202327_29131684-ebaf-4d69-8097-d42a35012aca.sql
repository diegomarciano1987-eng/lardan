CREATE TABLE public.showcase_illustrations (
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  prompt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  PRIMARY KEY (party_id, variant_id)
);
GRANT SELECT ON public.showcase_illustrations TO authenticated;
GRANT ALL ON public.showcase_illustrations TO service_role;
ALTER TABLE public.showcase_illustrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gestão de maletas vê ilustrações" ON public.showcase_illustrations
  FOR SELECT TO authenticated USING (public.can_manage_kits(auth.uid()));

CREATE OR REPLACE FUNCTION public.showcase_items_for(_party uuid, _design jsonb)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY ord, x->>'produto'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'cycle_id', min(b.cycle_id::text)::uuid,
      'variant_id', v.id, 'produto', pr.name, 'slug', pr.slug, 'variante', v.label,
      'tamanho', v.size, 'cor', v.color, 'categoria', cat.name,
      'disponivel', sum(b.qty_available)::int,
      'preco_cents', public.kit_reference_price(v.id),
      'media_id', coalesce(
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id
             AND pm.media_id::text = _design#>>ARRAY['organizacao','fotos',v.id::text]),
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1)),
      'midias', (SELECT coalesce(jsonb_agg(pm.media_id ORDER BY pm.position), '[]') FROM public.product_media pm WHERE pm.product_id = pr.id),
      'ilustracao', (SELECT '/api/public/vitrine-ilus/' || si.party_id || '/' || si.variant_id
          FROM public.showcase_illustrations si
         WHERE si.party_id = _party AND si.variant_id = v.id
           AND NOT EXISTS (SELECT 1 FROM public.product_media pm2 WHERE pm2.product_id = pr.id))
    ) AS x,
    coalesce((SELECT o FROM jsonb_array_elements_text(coalesce(_design#>'{organizacao,ordem}','[]')) WITH ORDINALITY q(e,o) WHERE e = v.id::text), 100000) AS ord
    FROM public.kit_balances b
    JOIN public.kit_cycles c ON c.id = b.cycle_id
    JOIN public.product_variants v ON v.id = b.variant_id
    JOIN public.products pr ON pr.id = v.product_id
    LEFT JOIN public.categories cat ON cat.id = pr.category_id
    WHERE c.consultora_party_id = _party AND c.status IN ('recebida','operacao')
      AND b.is_published AND b.qty_available > 0 AND v.is_active AND pr.status = 'publicado'
      AND coalesce(public.kit_reference_price(v.id), 0) > 0
    GROUP BY v.id, pr.id, cat.name
  ) s
$function$;