CREATE SEQUENCE IF NOT EXISTS public.variant_codigo_curto_seq START WITH 18497;
SELECT setval('public.variant_codigo_curto_seq', greatest(18496, (select coalesce(max(barcode::int),18496) from public.product_variants where barcode ~ '^\d{5}$')));
CREATE OR REPLACE FUNCTION public.variant_ean_next()
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  tent int := 0;
  codigo text;
begin
  -- Código curto sequencial (padrão Lardan, 5 dígitos): legível na etiqueta Argox 95x12 mm.
  -- EAN-13 de 13 dígitos não é lido após impressão térmica nessa etiqueta.
  loop
    tent := tent + 1;
    if tent > 200 then
      raise exception 'Não foi possível gerar um código de barras livre.' using errcode = '23505';
    end if;
    codigo := nextval('public.variant_codigo_curto_seq')::text;
    if not exists (select 1 from public.product_variants v where v.barcode = codigo)
       and not exists (select 1 from public.products p where p.barcode = codigo) then
      return codigo;
    end if;
  end loop;
end
$function$;