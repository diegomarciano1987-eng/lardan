ALTER TABLE public.consultant_clients ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id);
CREATE INDEX IF NOT EXISTS consultant_clients_party ON public.consultant_clients(party_id);
COMMENT ON COLUMN public.consultant_clients.party_id IS '0382: ficha da cliente na Central de Cadastros (papel cliente).';

CREATE OR REPLACE FUNCTION public.cliente_rede_garantir(_client uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE cc record; pid uuid; cod text;
BEGIN
  SELECT * INTO cc FROM public.consultant_clients WHERE id = _client FOR UPDATE;
  IF cc.id IS NULL THEN RETURN NULL; END IF;
  pid := cc.party_id;
  IF pid IS NULL THEN
    SELECT o.pay_party_id INTO pid FROM public.sales_orders o
     WHERE o.client_id = cc.id AND o.pay_party_id IS NOT NULL
       AND o.pay_party_id <> o.consultora_party_id
     ORDER BY o.created_at DESC LIMIT 1;
  END IF;
  IF pid IS NULL THEN
    SELECT code INTO cod FROM public.parties WHERE id = cc.consultora_party_id;
    INSERT INTO public.parties (kind, display_name, status, notes)
    VALUES ('pessoa', btrim(cc.nome), 'ativo', 'Cliente da consultora ' || coalesce(cod, '') || ' (app da consultora)')
    RETURNING id INTO pid;
    IF coalesce(cc.telefone, '') <> '' THEN
      BEGIN
        INSERT INTO public.contact_points (party_id, kind, value, is_primary) VALUES (pid, 'whatsapp', cc.telefone, true);
      EXCEPTION WHEN OTHERS THEN NULL; -- telefone inválido no app: não copia, nunca inventa
      END;
    END IF;
    IF coalesce(cc.email, '') <> '' THEN
      BEGIN
        INSERT INTO public.contact_points (party_id, kind, value, is_primary) VALUES (pid, 'email', cc.email, false);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.party_roles r WHERE r.party_id = pid AND r.role = 'cliente' AND r.ended_at IS NULL) THEN
    INSERT INTO public.party_roles (party_id, role, status, started_at, notes)
    VALUES (pid, 'cliente', 'ativo', cc.created_at::date, 'Cliente da rede (app da consultora)');
  END IF;
  IF cc.party_id IS DISTINCT FROM pid THEN
    UPDATE public.consultant_clients SET party_id = pid WHERE id = cc.id;
  END IF;
  RETURN pid;
END $f$;
REVOKE ALL ON FUNCTION public.cliente_rede_garantir(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_rede_garantir(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cliente_rede_trg()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'consultant_clients' THEN
      IF NEW.party_id IS NULL THEN PERFORM public.cliente_rede_garantir(NEW.id); END IF;
    ELSIF NEW.client_id IS NOT NULL AND NEW.pay_party_id IS NOT NULL
          AND NEW.pay_party_id <> NEW.consultora_party_id THEN
      UPDATE public.consultant_clients SET party_id = NEW.pay_party_id
       WHERE id = NEW.client_id AND party_id IS NULL;
      IF NOT EXISTS (SELECT 1 FROM public.party_roles r WHERE r.party_id = NEW.pay_party_id AND r.role = 'cliente' AND r.ended_at IS NULL) THEN
        INSERT INTO public.party_roles (party_id, role, status, started_at, notes)
        VALUES (NEW.pay_party_id, 'cliente', 'ativo', current_date, 'Cliente da rede (pagamento)');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- a ficha da cliente nunca impede a venda nem o cadastro no app
  END;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.cliente_rede_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_cliente_rede_ficha ON public.consultant_clients;
CREATE TRIGGER zz_cliente_rede_ficha AFTER INSERT ON public.consultant_clients
  FOR EACH ROW EXECUTE FUNCTION public.cliente_rede_trg();
DROP TRIGGER IF EXISTS zz_cliente_rede_pagamento ON public.sales_orders;
CREATE TRIGGER zz_cliente_rede_pagamento AFTER INSERT OR UPDATE OF pay_party_id, client_id ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.cliente_rede_trg();

DO $do$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.consultant_clients WHERE party_id IS NULL ORDER BY created_at LOOP
    PERFORM public.cliente_rede_garantir(r.id);
  END LOOP;
END $do$;

CREATE OR REPLACE FUNCTION public.cliente_cockpit(_party uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') OR NOT public.colab_party_ok(_party) THEN
    RAISE EXCEPTION 'Sem permissão para ver esta cliente.' USING errcode = '42501';
  END IF;
  WITH cli AS (SELECT id FROM public.consultant_clients WHERE party_id = _party),
  ped AS (
    SELECT o.* FROM public.sales_orders o
     WHERE o.client_id IN (SELECT id FROM cli) OR o.pay_party_id = _party OR o.customer_party_id = _party
  ),
  itens AS (
    SELECT i.order_id, jsonb_agg(jsonb_build_object(
             'referencia', public.peca_referencia_etiqueta(i.variant_id),
             'produto', i.product_name, 'variante', i.variant_label,
             'quantidade', i.quantity, 'unitario_cents', i.unit_price_cents) ORDER BY i.created_at) lista,
           sum(i.quantity) pecas
      FROM public.sales_order_items i WHERE i.order_id IN (SELECT id FROM ped) GROUP BY i.order_id
  ),
  tit AS (
    SELECT t.id, t.numero, t.descricao, t.status::text status, t.emissao, t.valor_cents,
           CASE WHEN t.status = 'cancelado' THEN 0 ELSE
             coalesce((SELECT sum(public.fin_installment_saldo(i.id)) FROM public.financial_installments i WHERE i.title_id = t.id), 0) END saldo_cents,
           coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a JOIN public.financial_installments i ON i.id = a.installment_id WHERE i.title_id = t.id), 0) pago_cents
      FROM public.financial_titles t
     WHERE t.direction = 'receivable' AND (t.party_id = _party OR t.pagador_party_id = _party)
  )
  SELECT jsonb_build_object(
    'resumo', jsonb_build_object(
      'pedidos', (SELECT count(*) FROM ped WHERE status <> 'cancelado'),
      'pecas', (SELECT coalesce(sum(it.pecas), 0) FROM ped p JOIN itens it ON it.order_id = p.id WHERE p.status <> 'cancelado'),
      'total_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM ped WHERE status <> 'cancelado'),
      'pago_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM ped WHERE status <> 'cancelado' AND payment_status = 'pago'),
      'ultima_compra', (SELECT max(created_at) FROM ped WHERE status <> 'cancelado'),
      'em_aberto_cents', (SELECT coalesce(sum(saldo_cents), 0) FROM tit)),
    'consultoras', coalesce((SELECT jsonb_agg(jsonb_build_object('party_id', x.consultora_party_id, 'nome', pc.display_name, 'codigo', pc.code, 'pedidos', x.n))
        FROM (SELECT consultora_party_id, count(*) n FROM ped GROUP BY 1) x JOIN public.parties pc ON pc.id = x.consultora_party_id), '[]'::jsonb),
    'pedidos', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'codigo', p.code, 'data', p.created_at, 'status', p.status, 'pagamento', p.payment_status,
        'entrega', p.delivery_status, 'forma', p.pay_method, 'valor_cents', p.subtotal_cents, 'pago_em', p.pay_paid_at,
        'consultora', (SELECT '[Cód. ' || pc.code || '] ' || pc.display_name FROM public.parties pc WHERE pc.id = p.consultora_party_id),
        'itens', coalesce(it.lista, '[]'::jsonb)) ORDER BY p.created_at DESC)
        FROM ped p LEFT JOIN itens it ON it.order_id = p.id), '[]'::jsonb),
    'titulos', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.emissao DESC) FROM tit t), '[]'::jsonb),
    'asaas', coalesce((SELECT jsonb_agg(jsonb_build_object('cobranca', c.external_id, 'status', c.external_status,
        'forma', c.billing_type, 'valor_cents', c.value_cents, 'vencimento', c.due_date, 'pago_em', c.payment_date) ORDER BY c.due_date DESC)
        FROM public.asaas_charges c WHERE c.party_id = _party), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $f$;
REVOKE ALL ON FUNCTION public.cliente_cockpit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_cockpit(uuid) TO authenticated, service_role;