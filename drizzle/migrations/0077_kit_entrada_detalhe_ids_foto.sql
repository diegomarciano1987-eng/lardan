CREATE OR REPLACE FUNCTION public.kit_entrada_detalhe(_entrada uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.kit_entrada_exigir();
  SELECT jsonb_build_object(
    'id', e.id, 'codigo', e.code, 'status', e.status, 'total_pecas', e.total_pecas, 'referencia', e.referencia,
    'consultora', p.display_name, 'consultora_ativada', e.consultora_ativada,
    'consultora_status_anterior', e.consultora_status_anterior, 'local', l.name, 'criada_em', e.created_at,
    'leituras', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'codigo', i.codigo_lido,
        'peca', concat_ws(' · ', pp.name, v.label), 'quando', i.created_at, 'estornada', i.estornado_em IS NOT NULL,
        'product_id', pp.id, 'variant_id', v.id)
        ORDER BY i.created_at DESC)
      FROM public.kit_entrada_itens i JOIN public.product_variants v ON v.id = i.variant_id
      JOIN public.products pp ON pp.id = v.product_id WHERE i.entrada_id = e.id), '[]'::jsonb))
  INTO r
  FROM public.kit_entradas e JOIN public.parties p ON p.id = e.consultora_party_id
  JOIN public.locations l ON l.id = e.location_id WHERE e.id = _entrada;
  IF r IS NULL THEN RAISE EXCEPTION 'Entrada não encontrada.'; END IF;
  RETURN r;
END $$;