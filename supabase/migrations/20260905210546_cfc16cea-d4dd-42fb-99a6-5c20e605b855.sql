-- Motor de estoque LARDAN Cloud (aditivo)

DO $$ BEGIN
  CREATE TYPE public.stock_move_kind AS ENUM ('entrada','saida','transferencia','ajuste','inventario');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Motivos de movimentação
CREATE TABLE IF NOT EXISTS public.stock_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  kind public.stock_move_kind NOT NULL,
  requires_adjust boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_reasons TO authenticated;
GRANT ALL ON public.stock_reasons TO service_role;
ALTER TABLE public.stock_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_reasons_read" ON public.stock_reasons FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'stock.view'));
CREATE POLICY "stock_reasons_manage" ON public.stock_reasons FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'stock.adjust'))
  WITH CHECK (public.has_capability(auth.uid(), 'stock.adjust'));

CREATE TRIGGER stock_reasons_updated_at BEFORE UPDATE ON public.stock_reasons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.stock_reasons (code, label, kind, requires_adjust) VALUES
  ('compra','Compra / recebimento de fornecedor','entrada',false),
  ('devolucao_cliente','Devolução de cliente','entrada',false),
  ('retorno_maleta','Retorno de maleta','entrada',false),
  ('venda','Venda','saida',false),
  ('envio_maleta','Envio para maleta','saida',false),
  ('perda','Perda','saida',true),
  ('avaria','Avaria','saida',true),
  ('transferencia','Transferência entre locais','transferencia',false),
  ('ajuste_manual','Ajuste manual','ajuste',true),
  ('inventario','Contagem de inventário','inventario',true)
ON CONFLICT (code) DO NOTHING;

-- Razão imutável
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.stock_move_kind NOT NULL,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  from_location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  to_location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost_cents integer,
  reason_code text,
  reference text,
  note text,
  balance_after integer,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_movements_read" ON public.stock_movements FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'stock.view'));

CREATE OR REPLACE FUNCTION public.block_stock_movement_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Movimentações de estoque são imutáveis.';
END $$;

CREATE TRIGGER stock_movements_immutable
  BEFORE UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.block_stock_movement_mutation();

CREATE INDEX IF NOT EXISTS stock_movements_variant_idx ON public.stock_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_created_idx ON public.stock_movements(created_at DESC);

-- Saldos
CREATE TABLE IF NOT EXISTS public.stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, location_id)
);
GRANT SELECT ON public.stock_balances TO authenticated;
GRANT ALL ON public.stock_balances TO service_role;
ALTER TABLE public.stock_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_balances_read" ON public.stock_balances FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'stock.view'));

CREATE INDEX IF NOT EXISTS stock_balances_location_idx ON public.stock_balances(location_id);

-- Aplicação de saldo (interna)
CREATE OR REPLACE FUNCTION public.apply_stock_delta(_variant uuid, _location uuid, _delta integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE novo integer;
BEGIN
  INSERT INTO public.stock_balances (variant_id, location_id, quantity)
  VALUES (_variant, _location, 0)
  ON CONFLICT (variant_id, location_id) DO NOTHING;

  UPDATE public.stock_balances
     SET quantity = quantity + _delta, updated_at = now()
   WHERE variant_id = _variant AND location_id = _location
  RETURNING quantity INTO novo;

  IF novo < 0 THEN
    RAISE EXCEPTION 'Saldo insuficiente: a operação deixaria % peças neste local.', novo;
  END IF;
  RETURN novo;
END $$;

-- Registro de movimentação
CREATE OR REPLACE FUNCTION public.register_stock_movement(
  _kind public.stock_move_kind,
  _variant_id uuid,
  _quantity integer,
  _from_location_id uuid DEFAULT NULL,
  _to_location_id uuid DEFAULT NULL,
  _reason_code text DEFAULT NULL,
  _unit_cost_cents integer DEFAULT NULL,
  _reference text DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  saldo integer;
  mov uuid;
  atual integer;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid, 'stock.operate') THEN
    RAISE EXCEPTION 'Sem permissão para movimentar estoque.';
  END IF;
  IF _kind IN ('ajuste','inventario') AND NOT public.has_capability(uid, 'stock.adjust') THEN
    RAISE EXCEPTION 'Sem permissão para ajustar estoque.';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;

  IF _kind = 'entrada' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local de destino.'; END IF;
    saldo := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
  ELSIF _kind = 'saida' THEN
    IF _from_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local de origem.'; END IF;
    saldo := public.apply_stock_delta(_variant_id, _from_location_id, -_quantity);
  ELSIF _kind = 'transferencia' THEN
    IF _from_location_id IS NULL OR _to_location_id IS NULL THEN
      RAISE EXCEPTION 'Informe origem e destino.';
    END IF;
    IF _from_location_id = _to_location_id THEN
      RAISE EXCEPTION 'Origem e destino devem ser diferentes.';
    END IF;
    PERFORM public.apply_stock_delta(_variant_id, _from_location_id, -_quantity);
    saldo := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
  ELSIF _kind = 'ajuste' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local.'; END IF;
    saldo := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
  ELSIF _kind = 'inventario' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local.'; END IF;
    SELECT COALESCE(quantity,0) INTO atual FROM public.stock_balances
      WHERE variant_id = _variant_id AND location_id = _to_location_id;
    saldo := public.apply_stock_delta(_variant_id, _to_location_id, _quantity - COALESCE(atual,0));
  END IF;

  INSERT INTO public.stock_movements (
    kind, variant_id, from_location_id, to_location_id, quantity,
    unit_cost_cents, reason_code, reference, note, balance_after, created_by
  ) VALUES (
    _kind, _variant_id, _from_location_id, _to_location_id, _quantity,
    _unit_cost_cents, _reason_code, _reference, _note, saldo, uid
  ) RETURNING id INTO mov;

  RETURN mov;
END $$;

REVOKE ALL ON FUNCTION public.apply_stock_delta(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_stock_movement(public.stock_move_kind, uuid, integer, uuid, uuid, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_stock_movement(public.stock_move_kind, uuid, integer, uuid, uuid, text, integer, text, text) TO authenticated, service_role;

-- Resumo para painéis
CREATE OR REPLACE FUNCTION public.stock_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.has_capability(auth.uid(), 'stock.view') THEN '{}'::jsonb ELSE jsonb_build_object(
    'locais', (SELECT count(*) FROM public.locations WHERE is_active),
    'pecas_com_saldo', (SELECT count(*) FROM public.stock_balances WHERE quantity > 0),
    'unidades', (SELECT COALESCE(sum(quantity),0) FROM public.stock_balances),
    'negativos', (SELECT count(*) FROM public.stock_balances WHERE quantity < 0),
    'movimentos_7d', (SELECT count(*) FROM public.stock_movements WHERE created_at > now() - interval '7 days')
  ) END
$$;
REVOKE ALL ON FUNCTION public.stock_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_overview() TO authenticated, service_role;

-- Auditoria
CREATE TRIGGER audit_stock_movements AFTER INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
