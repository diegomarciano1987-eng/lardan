-- ============================================================
-- NÚCLEO COMERCIAL — ETAPA 1: domínio de maletas
-- Aditivo. Não altera catálogo, estoque, financeiro ou cadastros.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.kit_status AS ENUM (
    'rascunho','montagem','conferida','expedida','transito',
    'recebida','operacao','acerto','encerrada','cancelada'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.kit_transfer_status AS ENUM (
    'pendente','transito','entregue','recusada','cancelada'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.kit_acceptance_kind AS ENUM ('integral','parcial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SEQUENCE IF NOT EXISTS public.kit_code_seq;

CREATE TABLE IF NOT EXISTS public.kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT ('MAL-' || lpad(nextval('public.kit_code_seq')::text, 5, '0')),
  qr_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  label text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kit_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id uuid NOT NULL REFERENCES public.kits(id) ON DELETE RESTRICT,
  cycle_no integer NOT NULL,
  status public.kit_status NOT NULL DEFAULT 'rascunho',
  consultora_party_id uuid REFERENCES public.parties(id),
  representante_party_id uuid REFERENCES public.parties(id),
  custodian_party_id uuid REFERENCES public.parties(id),
  origin_location_id uuid REFERENCES public.locations(id),
  current_location_id uuid REFERENCES public.locations(id),
  consultora_location_id uuid REFERENCES public.locations(id),
  reference_total_cents bigint NOT NULL DEFAULT 0,
  quantity_total integer NOT NULL DEFAULT 0,
  due_at timestamptz,
  shipped_at timestamptz,
  received_at timestamptz,
  settlement_started_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kit_id, cycle_no)
);
CREATE INDEX IF NOT EXISTS kit_cycles_consultora_idx ON public.kit_cycles (consultora_party_id, status);
CREATE INDEX IF NOT EXISTS kit_cycles_representante_idx ON public.kit_cycles (representante_party_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS kit_cycles_um_aberto_idx
  ON public.kit_cycles (kit_id)
  WHERE status NOT IN ('encerrada','cancelada');

CREATE TABLE IF NOT EXISTS public.kit_compositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id) ON DELETE CASCADE,
  version integer NOT NULL,
  frozen_at timestamptz,
  frozen_by uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, version)
);

CREATE TABLE IF NOT EXISTS public.kit_composition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  composition_id uuid NOT NULL REFERENCES public.kit_compositions(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_reference_cents integer NOT NULL DEFAULT 0 CHECK (unit_reference_cents >= 0),
  reservation_id uuid REFERENCES public.stock_reservations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (composition_id, variant_id)
);

CREATE TABLE IF NOT EXISTS public.kit_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  status public.kit_transfer_status NOT NULL DEFAULT 'pendente',
  from_party_id uuid REFERENCES public.parties(id),
  to_party_id uuid REFERENCES public.parties(id),
  from_location_id uuid REFERENCES public.locations(id),
  to_location_id uuid REFERENCES public.locations(id),
  carrier text,
  tracking_code text,
  shipping_cost_cents integer CHECK (shipping_cost_cents IS NULL OR shipping_cost_cents >= 0),
  shipped_at timestamptz,
  delivered_at timestamptz,
  refused_at timestamptz,
  refusal_reason text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, seq)
);

CREATE TABLE IF NOT EXISTS public.kit_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id) ON DELETE CASCADE,
  composition_id uuid NOT NULL REFERENCES public.kit_compositions(id),
  kind public.kit_acceptance_kind NOT NULL,
  party_id uuid REFERENCES public.parties(id),
  actor_user_id uuid,
  terms_version text NOT NULL DEFAULT 'aceite-operacional-v1',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  UNIQUE (cycle_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.kit_acceptance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acceptance_id uuid NOT NULL REFERENCES public.kit_acceptances(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  qty_expected integer NOT NULL CHECK (qty_expected >= 0),
  qty_accepted integer NOT NULL CHECK (qty_accepted >= 0),
  qty_divergent integer NOT NULL DEFAULT 0 CHECK (qty_divergent >= 0),
  divergence_reason text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_at timestamptz,
  resolution text,
  UNIQUE (acceptance_id, variant_id)
);

CREATE TABLE IF NOT EXISTS public.kit_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  qty_allocated integer NOT NULL DEFAULT 0 CHECK (qty_allocated >= 0),
  qty_accepted integer NOT NULL DEFAULT 0 CHECK (qty_accepted >= 0),
  qty_divergent integer NOT NULL DEFAULT 0 CHECK (qty_divergent >= 0),
  qty_sold integer NOT NULL DEFAULT 0 CHECK (qty_sold >= 0),
  qty_reserved integer NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_returned integer NOT NULL DEFAULT 0 CHECK (qty_returned >= 0),
  qty_return_transit integer NOT NULL DEFAULT 0 CHECK (qty_return_transit >= 0),
  qty_retained integer NOT NULL DEFAULT 0 CHECK (qty_retained >= 0),
  qty_warranty integer NOT NULL DEFAULT 0 CHECK (qty_warranty >= 0),
  qty_lost integer NOT NULL DEFAULT 0 CHECK (qty_lost >= 0),
  qty_available integer GENERATED ALWAYS AS (
    qty_accepted - qty_sold - qty_reserved - qty_returned - qty_return_transit
    - qty_retained - qty_warranty - qty_lost
  ) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, variant_id),
  CONSTRAINT kit_balances_nao_negativo CHECK (
    qty_accepted - qty_sold - qty_reserved - qty_returned - qty_return_transit
    - qty_retained - qty_warranty - qty_lost >= 0
  )
);
CREATE INDEX IF NOT EXISTS kit_balances_variant_idx ON public.kit_balances (variant_id);

CREATE TABLE IF NOT EXISTS public.kit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  from_status public.kit_status,
  to_status public.kit_status,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kit_events_cycle_idx ON public.kit_events (cycle_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.kit_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'kit_events é histórico imutável';
END $$;

DROP TRIGGER IF EXISTS kit_events_no_change ON public.kit_events;
CREATE TRIGGER kit_events_no_change
  BEFORE UPDATE OR DELETE ON public.kit_events
  FOR EACH ROW EXECUTE FUNCTION public.kit_events_immutable();

DROP TRIGGER IF EXISTS kits_touch ON public.kits;
CREATE TRIGGER kits_touch BEFORE UPDATE ON public.kits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS kit_cycles_touch ON public.kit_cycles;
CREATE TRIGGER kit_cycles_touch BEFORE UPDATE ON public.kit_cycles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS kit_transfers_touch ON public.kit_transfers;
CREATE TRIGGER kit_transfers_touch BEFORE UPDATE ON public.kit_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- PERMISSÕES
-- ============================================================
INSERT INTO public.role_capabilities (role, capability) VALUES
  ('master','kit.view'), ('master','kit.manage'), ('master','kit.ship'),
  ('master','kit.receive'), ('master','kit.accept'), ('master','kit.settle'),
  ('diretoria','kit.view'),
  ('estoque','kit.view'), ('estoque','kit.manage'), ('estoque','kit.ship'),
  ('montagem','kit.view'), ('montagem','kit.manage'),
  ('financeiro','kit.view'),
  ('representante','kit.view'), ('representante','kit.receive'),
  ('consultora','kit.view'), ('consultora','kit.accept')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_manage_kits(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_capabilities rc ON rc.role = ur.role
    WHERE ur.user_id = _user_id AND rc.capability = 'kit.manage'
  )
$$;

CREATE OR REPLACE FUNCTION public.can_view_kits(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_capabilities rc ON rc.role = ur.role
    WHERE ur.user_id = _user_id AND rc.capability = 'kit.view'
  )
$$;

CREATE OR REPLACE FUNCTION public.my_party_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.party_id FROM public.profiles p WHERE p.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.kit_cycle_in_scope(_cycle_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kit_cycles c
    WHERE c.id = _cycle_id
      AND (
        public.can_manage_kits(auth.uid())
        OR public.has_role(auth.uid(), 'master')
        OR public.has_role(auth.uid(), 'diretoria')
        OR public.has_role(auth.uid(), 'financeiro')
        OR c.consultora_party_id = public.my_party_id()
        OR c.representante_party_id = public.my_party_id()
        OR c.custodian_party_id = public.my_party_id()
      )
  )
$$;

-- ============================================================
-- GRANTS + RLS
-- ============================================================
GRANT SELECT, INSERT, UPDATE ON public.kits TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kit_cycles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kit_compositions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kit_composition_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kit_transfers TO authenticated;
GRANT SELECT ON public.kit_acceptances TO authenticated;
GRANT SELECT ON public.kit_acceptance_items TO authenticated;
GRANT SELECT ON public.kit_balances TO authenticated;
GRANT SELECT ON public.kit_events TO authenticated;
GRANT ALL ON public.kits, public.kit_cycles, public.kit_compositions,
  public.kit_composition_items, public.kit_transfers, public.kit_acceptances,
  public.kit_acceptance_items, public.kit_balances, public.kit_events TO service_role;

ALTER TABLE public.kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_composition_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_acceptance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kits_read ON public.kits;
CREATE POLICY kits_read ON public.kits FOR SELECT TO authenticated
  USING (public.can_view_kits(auth.uid()));
DROP POLICY IF EXISTS kits_write ON public.kits;
CREATE POLICY kits_write ON public.kits FOR ALL TO authenticated
  USING (public.can_manage_kits(auth.uid())) WITH CHECK (public.can_manage_kits(auth.uid()));

DROP POLICY IF EXISTS kit_cycles_read ON public.kit_cycles;
CREATE POLICY kit_cycles_read ON public.kit_cycles FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(id));
DROP POLICY IF EXISTS kit_cycles_write ON public.kit_cycles;
CREATE POLICY kit_cycles_write ON public.kit_cycles FOR ALL TO authenticated
  USING (public.can_manage_kits(auth.uid())) WITH CHECK (public.can_manage_kits(auth.uid()));

DROP POLICY IF EXISTS kit_compositions_read ON public.kit_compositions;
CREATE POLICY kit_compositions_read ON public.kit_compositions FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(cycle_id));
DROP POLICY IF EXISTS kit_compositions_write ON public.kit_compositions;
CREATE POLICY kit_compositions_write ON public.kit_compositions FOR ALL TO authenticated
  USING (public.can_manage_kits(auth.uid())) WITH CHECK (public.can_manage_kits(auth.uid()));

DROP POLICY IF EXISTS kit_composition_items_read ON public.kit_composition_items;
CREATE POLICY kit_composition_items_read ON public.kit_composition_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.kit_compositions k WHERE k.id = composition_id AND public.kit_cycle_in_scope(k.cycle_id)));
DROP POLICY IF EXISTS kit_composition_items_write ON public.kit_composition_items;
CREATE POLICY kit_composition_items_write ON public.kit_composition_items FOR ALL TO authenticated
  USING (public.can_manage_kits(auth.uid())) WITH CHECK (public.can_manage_kits(auth.uid()));

DROP POLICY IF EXISTS kit_transfers_read ON public.kit_transfers;
CREATE POLICY kit_transfers_read ON public.kit_transfers FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(cycle_id));
DROP POLICY IF EXISTS kit_transfers_write ON public.kit_transfers;
CREATE POLICY kit_transfers_write ON public.kit_transfers FOR ALL TO authenticated
  USING (public.can_manage_kits(auth.uid())) WITH CHECK (public.can_manage_kits(auth.uid()));

DROP POLICY IF EXISTS kit_acceptances_read ON public.kit_acceptances;
CREATE POLICY kit_acceptances_read ON public.kit_acceptances FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(cycle_id));

DROP POLICY IF EXISTS kit_acceptance_items_read ON public.kit_acceptance_items;
CREATE POLICY kit_acceptance_items_read ON public.kit_acceptance_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.kit_acceptances a WHERE a.id = acceptance_id AND public.kit_cycle_in_scope(a.cycle_id)));

DROP POLICY IF EXISTS kit_balances_read ON public.kit_balances;
CREATE POLICY kit_balances_read ON public.kit_balances FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(cycle_id));

DROP POLICY IF EXISTS kit_events_read ON public.kit_events;
CREATE POLICY kit_events_read ON public.kit_events FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(cycle_id));
