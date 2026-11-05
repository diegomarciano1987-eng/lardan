-- Toda variante nasce com código de barras curto (5 dígitos), inclusive a "Padrão" criada junto com o produto.
-- Importações que trazem código próprio continuam gravando o delas (código preenchido nunca é trocado).
CREATE OR REPLACE FUNCTION public.variant_barcode_autofill()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if coalesce(btrim(new.barcode), '') <> '' then
    return new;
  end if;
  new.barcode := public.variant_ean_next();
  return new;
end
$$;