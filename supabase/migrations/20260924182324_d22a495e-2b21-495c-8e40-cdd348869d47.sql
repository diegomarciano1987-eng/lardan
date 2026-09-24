revoke execute on function public.variant_ean_next() from anon, public;
revoke execute on function public.ean13_check_digit(text) from anon, public;

alter function public.ean13_check_digit(text) set search_path to public;