ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS combinado_forma text, ADD COLUMN IF NOT EXISTS combinado_parcelas smallint, ADD COLUMN IF NOT EXISTS combinado_vencimento date;
ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_combinado_ck;
ALTER TABLE public.sales_orders ADD CONSTRAINT sales_orders_combinado_ck CHECK ((combinado_forma IS NULL OR combinado_forma IN ('pix','credito','debito','dinheiro','a_prazo')) AND (combinado_parcelas IS NULL OR combinado_parcelas BETWEEN 1 AND 12));
CREATE OR REPLACE FUNCTION public.consultant_order_combinado_set(_order uuid, _forma text, _parcelas integer, _vencimento date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); o public.sales_orders;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  SELECT * INTO o FROM public.sales_orders WHERE id = _order FOR UPDATE;
  IF o.id IS NULL OR o.consultora_party_id IS DISTINCT FROM eu THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status IN ('concluido','cancelado') THEN RAISE EXCEPTION 'Pedido já encerrado.'; END IF;
  IF _forma IS NOT NULL AND _forma NOT IN ('pix','credito','debito','dinheiro','a_prazo') THEN RAISE EXCEPTION 'Forma inválida.'; END IF;
  IF _parcelas IS NOT NULL AND (_parcelas < 1 OR _parcelas > 12) THEN RAISE EXCEPTION 'Parcelas inválidas.'; END IF;
  UPDATE public.sales_orders SET combinado_forma = _forma,
    combinado_parcelas = CASE WHEN _forma IN ('credito','a_prazo') THEN coalesce(_parcelas,1) END,
    combinado_vencimento = CASE WHEN _forma = 'a_prazo' THEN _vencimento END, updated_at = now()
  WHERE id = _order;
  INSERT INTO public.sales_order_events (order_id, kind, actor_user_id, payload)
  VALUES (_order, 'combinado', auth.uid(), jsonb_build_object('forma',_forma,'parcelas',_parcelas,'vencimento',_vencimento));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.consultant_order_combinado_set(uuid,text,integer,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_order_combinado_set(uuid,text,integer,date) TO authenticated;

CREATE TABLE IF NOT EXISTS public.consultora_comissao_faixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_vendido_cents bigint NOT NULL CHECK (min_vendido_cents >= 0),
  percentual numeric(5,2) NOT NULL CHECK (percentual >= 0 AND percentual <= 80),
  titulo text NOT NULL DEFAULT '',
  meta_cents bigint CHECK (meta_cents IS NULL OR meta_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (min_vendido_cents)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultora_comissao_faixas TO authenticated;
GRANT ALL ON public.consultora_comissao_faixas TO service_role;
ALTER TABLE public.consultora_comissao_faixas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comissao_faixas_gerir ON public.consultora_comissao_faixas;
CREATE POLICY comissao_faixas_gerir ON public.consultora_comissao_faixas FOR ALL TO authenticated USING (public.can_manage_leads(auth.uid())) WITH CHECK (public.can_manage_leads(auth.uid()));
DROP TRIGGER IF EXISTS trg_audit_comissao_faixas ON public.consultora_comissao_faixas;
CREATE TRIGGER trg_audit_comissao_faixas AFTER INSERT OR UPDATE OR DELETE ON public.consultora_comissao_faixas FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- Painel "Quanto eu ganho": estimativa da maleta atual pela faixa configurada; nunca grava nada.
CREATE OR REPLACE FUNCTION public.consultora_ganhos() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); c public.kit_cycles; vendido bigint := 0; pecas int := 0; acerto date; f public.consultora_comissao_faixas; prox public.consultora_comissao_faixas;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE consultora_party_id = eu AND status IN ('operacao','recebida','acerto')
    ORDER BY array_position(ARRAY['operacao','recebida','acerto']::text[], status::text), created_at DESC LIMIT 1;
  IF c.id IS NULL THEN RETURN jsonb_build_object('maleta', false, 'configurado', EXISTS (SELECT 1 FROM public.consultora_comissao_faixas)); END IF;
  SELECT coalesce(sum(i.quantity * i.unit_price_cents),0), coalesce(sum(i.quantity),0) INTO vendido, pecas
    FROM public.sales_order_items i JOIN public.sales_orders o ON o.id = i.order_id
   WHERE i.cycle_id = c.id AND o.consultora_party_id = eu AND o.status <> 'cancelado' AND (o.payment_status = 'pago' OR o.status = 'concluido');
  SELECT coalesce(r.data_acerto, (c.due_at AT TIME ZONE 'America/Sao_Paulo')::date) INTO acerto FROM (SELECT 1) x LEFT JOIN public.remessas r ON r.id = c.remessa_id;
  SELECT * INTO f FROM public.consultora_comissao_faixas WHERE min_vendido_cents <= vendido ORDER BY min_vendido_cents DESC LIMIT 1;
  SELECT * INTO prox FROM public.consultora_comissao_faixas WHERE min_vendido_cents > vendido ORDER BY min_vendido_cents LIMIT 1;
  RETURN jsonb_build_object('maleta', true, 'configurado', EXISTS (SELECT 1 FROM public.consultora_comissao_faixas),
    'vendido_cents', vendido, 'pecas_vendidas', pecas, 'pecas_total', c.quantity_total, 'valor_maleta_cents', coalesce(c.reference_total_cents,0),
    'acerto', acerto, 'hoje', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'faixa', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object('titulo', f.titulo, 'percentual', f.percentual) END,
    'comissao_cents', CASE WHEN f.id IS NULL THEN 0 ELSE round(vendido * f.percentual / 100) END,
    'repasse_cents', CASE WHEN f.id IS NULL THEN NULL ELSE vendido - round(vendido * f.percentual / 100) END,
    'proxima', CASE WHEN prox.id IS NULL THEN NULL ELSE jsonb_build_object('titulo', prox.titulo, 'percentual', prox.percentual, 'falta_cents', prox.min_vendido_cents - vendido, 'min_cents', prox.min_vendido_cents) END);
END $$;
REVOKE ALL ON FUNCTION public.consultora_ganhos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_ganhos() TO authenticated;

-- Consulta das faixas pela consultora (só leitura).
CREATE OR REPLACE FUNCTION public.consultora_comissao_tabela() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('min_cents', min_vendido_cents, 'percentual', percentual, 'titulo', titulo) ORDER BY min_vendido_cents), '[]'::jsonb)
  FROM public.consultora_comissao_faixas WHERE auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'consultora');
$$;
REVOKE ALL ON FUNCTION public.consultora_comissao_tabela() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_comissao_tabela() TO authenticated;