revoke execute on function public.variant_ean_next() from anon, authenticated, public;
revoke execute on function public.ean13_check_digit(text) from anon, authenticated, public;
revoke execute on function public.variant_barcode_autofill() from anon, authenticated, public;

grant execute on function public.variant_ean_next() to service_role;
grant execute on function public.ean13_check_digit(text) to service_role;
grant usage on sequence public.variant_ean_seq to service_role;