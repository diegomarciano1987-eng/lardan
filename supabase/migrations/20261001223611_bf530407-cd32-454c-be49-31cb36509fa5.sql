UPDATE public.products
SET warranty_text = 'Garantia de 2 anos, conforme as condições oficiais da marca.',
    updated_at = now()
WHERE warranty_text ILIKE '%6 meses%'
   OR warranty_text ILIKE '%seis meses%';