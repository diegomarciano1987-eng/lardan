
alter function public.imp_valor_cents(text) set search_path = public;
alter function public.imp_data(text) set search_path = public;
alter function public.imp_texto(text) set search_path = public;
revoke all on function public.imp_valor_cents(text) from public, anon;
revoke all on function public.imp_data(text) from public, anon;
revoke all on function public.imp_texto(text) from public, anon;
grant execute on function public.imp_valor_cents(text) to authenticated;
grant execute on function public.imp_data(text) to authenticated;
grant execute on function public.imp_texto(text) to authenticated;
