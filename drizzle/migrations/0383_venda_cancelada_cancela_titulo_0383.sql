CREATE OR REPLACE FUNCTION public.pedido_cancelado_titulo(_order uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o record; t record; pago bigint;
BEGIN
  SELECT * INTO o FROM public.sales_orders WHERE id = _order;
  IF o.id IS NULL OR o.status <> 'cancelado' OR o.payment_status = 'pago' OR o.pay_title_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO t FROM public.financial_titles WHERE id = o.pay_title_id FOR UPDATE;
  IF t.id IS NULL OR t.status = 'cancelado' OR t.origem IS DISTINCT FROM 'consultora' OR t.direction <> 'receivable' THEN RETURN false; END IF;
  SELECT coalesce(sum(a.valor_cents), 0) INTO pago FROM public.financial_allocations a
    JOIN public.financial_installments i ON i.id = a.installment_id WHERE i.title_id = t.id;
  IF pago <> 0 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.asaas_charges c
              WHERE (c.title_id = t.id OR c.installment_id IN (SELECT id FROM public.financial_installments WHERE title_id = t.id))
                AND c.external_status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')) THEN RETURN false; END IF;
  UPDATE public.financial_titles SET status = 'cancelado', cancel_reason = 'Venda ' || o.code || ' cancelada pela consultora (sem pagamento)', updated_at = now()
   WHERE id = t.id;
  INSERT INTO public.financial_title_events (title_id, evento, motivo, actor_id)
  VALUES (t.id, 'cancelado', 'Venda ' || o.code || ' cancelada pela consultora (sem pagamento)', auth.uid());
  RETURN true;
END $f$;
REVOKE ALL ON FUNCTION public.pedido_cancelado_titulo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedido_cancelado_titulo(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pedido_cancelado_titulo_trg()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.status = 'cancelado' AND OLD.status IS DISTINCT FROM 'cancelado' AND NEW.pay_title_id IS NOT NULL THEN
    BEGIN
      PERFORM public.pedido_cancelado_titulo(NEW.id);
    EXCEPTION WHEN OTHERS THEN NULL; -- nunca impede o cancelamento da venda
    END;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.pedido_cancelado_titulo_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_pedido_cancelado_titulo ON public.sales_orders;
CREATE TRIGGER zz_pedido_cancelado_titulo AFTER UPDATE OF status ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.pedido_cancelado_titulo_trg();

DO $do$ DECLARE r record; BEGIN
  FOR r IN SELECT o.id FROM public.sales_orders o JOIN public.financial_titles t ON t.id = o.pay_title_id
            WHERE o.status = 'cancelado' AND t.status <> 'cancelado' LOOP
    PERFORM public.pedido_cancelado_titulo(r.id);
  END LOOP;
END $do$;