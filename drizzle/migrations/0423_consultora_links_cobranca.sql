CREATE OR REPLACE FUNCTION public.consultora_links_cobranca(_orders uuid[])
 RETURNS TABLE(order_id uuid, url text, forma text, vencimento date)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT o.id, o.pay_url, o.pay_method, o.pay_due_date::date
    FROM sales_orders o
   WHERE o.id = ANY(_orders)
     AND o.consultora_party_id = public.my_party_id()
     AND o.payment_status = 'pendente'
     AND o.status::text <> 'cancelado'
     AND o.pay_url ~ '^https://'
$f$;
REVOKE ALL ON FUNCTION public.consultora_links_cobranca(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultora_links_cobranca(uuid[]) TO authenticated, service_role;