CREATE TABLE public.consultant_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 2 AND 120),
  telefone text NOT NULL DEFAULT '' CHECK (telefone ~ '^[0-9]{0,13}$'),
  email text CHECK (email IS NULL OR length(email) <= 160),
  aniversario date,
  preferencias text NOT NULL DEFAULT '' CHECK (length(preferencias) <= 600),
  observacoes text NOT NULL DEFAULT '' CHECK (length(observacoes) <= 1000),
  proximo_retorno date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consultant_clients_owner ON public.consultant_clients (consultora_party_id, nome);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_clients TO authenticated;
GRANT ALL ON public.consultant_clients TO service_role;
ALTER TABLE public.consultant_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Consultora cuida das próprias clientes" ON public.consultant_clients FOR ALL TO authenticated
  USING (consultora_party_id = public.my_party_id() AND public.has_role(auth.uid(),'consultora'))
  WITH CHECK (consultora_party_id = public.my_party_id() AND public.has_role(auth.uid(),'consultora'));
CREATE POLICY "Operação consulta clientes" ON public.consultant_clients FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'kit.manage') IS TRUE);
CREATE TRIGGER consultant_clients_updated BEFORE UPDATE ON public.consultant_clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER consultant_clients_audit AFTER INSERT OR UPDATE OR DELETE ON public.consultant_clients FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

CREATE TABLE public.consultant_client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.consultant_clients(id) ON DELETE CASCADE,
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  canal text NOT NULL CHECK (canal IN ('whatsapp','ligacao','presencial','outro')),
  nota text NOT NULL DEFAULT '' CHECK (length(nota) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consultant_client_contacts_client ON public.consultant_client_contacts (client_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.consultant_client_contacts TO authenticated;
GRANT ALL ON public.consultant_client_contacts TO service_role;
ALTER TABLE public.consultant_client_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Consultora registra os próprios atendimentos" ON public.consultant_client_contacts FOR ALL TO authenticated
  USING (consultora_party_id = public.my_party_id() AND public.has_role(auth.uid(),'consultora'))
  WITH CHECK (consultora_party_id = public.my_party_id() AND public.has_role(auth.uid(),'consultora')
    AND EXISTS (SELECT 1 FROM public.consultant_clients c WHERE c.id = client_id AND c.consultora_party_id = public.my_party_id()));
CREATE POLICY "Operação consulta atendimentos" ON public.consultant_client_contacts FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'kit.manage') IS TRUE);

ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.consultant_clients(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.consultant_order_create(_client uuid, _itens jsonb, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  eu uuid := public.my_party_id(); cli public.consultant_clients; existente public.sales_orders;
  pedido uuid; item jsonb; vid uuid; cyc uuid; q integer; preco integer; b public.kit_balances;
  total bigint := 0; contagem integer := 0;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501';
  END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN RAISE EXCEPTION 'Chave do pedido inválida.'; END IF;
  SELECT * INTO existente FROM public.sales_orders WHERE idempotency_key = _idempotency_key;
  IF existente.id IS NOT NULL THEN
    IF existente.consultora_party_id IS DISTINCT FROM eu THEN RAISE EXCEPTION 'Chave do pedido inválida.'; END IF;
    RETURN jsonb_build_object('order_id', existente.id, 'codigo', existente.code, 'total_cents', existente.subtotal_cents, 'repetido', true);
  END IF;
  SELECT * INTO cli FROM public.consultant_clients WHERE id = _client AND consultora_party_id = eu;
  IF cli.id IS NULL THEN RAISE EXCEPTION 'Escolha uma cliente sua.'; END IF;
  IF jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 THEN RAISE EXCEPTION 'Escolha pelo menos uma peça.'; END IF;
  IF jsonb_array_length(_itens) > 60 THEN RAISE EXCEPTION 'Pedido grande demais.'; END IF;

  INSERT INTO public.sales_orders (consultora_party_id, client_id, customer_name, customer_phone, customer_email, channel, status, idempotency_key)
  VALUES (eu, cli.id, cli.nome, cli.telefone, cli.email, 'consultora', 'em_atendimento', _idempotency_key)
  RETURNING id INTO pedido;

  FOR item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    vid := (item->>'variant_id')::uuid; cyc := (item->>'cycle_id')::uuid;
    q := coalesce((item->>'quantidade')::integer, 0);
    IF q < 1 OR q > 99 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.kit_cycles c WHERE c.id = cyc AND c.consultora_party_id = eu AND c.status IN ('recebida','operacao')) THEN
      RAISE EXCEPTION 'Essa peça não está numa maleta ativa sua.';
    END IF;
    SELECT * INTO b FROM public.kit_balances WHERE cycle_id = cyc AND variant_id = vid;
    IF b.id IS NULL OR b.qty_available < q THEN
      RAISE EXCEPTION 'Restam apenas % unidade(s) de uma das peças.', greatest(coalesce(b.qty_available,0),0);
    END IF;
    preco := public.kit_reference_price(vid);
    INSERT INTO public.sales_order_items (order_id, cycle_id, variant_id, product_name, variant_label, quantity, unit_price_cents)
    SELECT pedido, cyc, vid, pr.name, v.label, q, preco FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id WHERE v.id = vid;
    total := total + preco::bigint * q; contagem := contagem + q;
  END LOOP;

  UPDATE public.sales_orders SET subtotal_cents = total, items_count = contagem WHERE id = pedido;
  INSERT INTO public.sales_order_events (order_id, kind, to_status, actor_user_id, payload)
  VALUES (pedido, 'pedido.criado_consultora', 'em_atendimento', auth.uid(), jsonb_build_object('itens', contagem, 'reserva', false));
  RETURN jsonb_build_object('order_id', pedido, 'codigo', (SELECT code FROM public.sales_orders WHERE id = pedido), 'total_cents', total);
END $$;
REVOKE ALL ON FUNCTION public.consultant_order_create(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_order_create(uuid,jsonb,text) TO authenticated;