-- 0276 (pacote 0275 do Diego, renumerado) — resistência para a semana de pico. Aditivo e idempotente.
-- 1. Notas sem resposta final: conferidas na Focus pela MESMA referência (só servidor).
CREATE OR REPLACE FUNCTION public.fiscal_focus_pendentes_conferir(_limite int DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('ref', e.ref, 'ambiente', e.ambiente, 'status', e.status) ORDER BY e.updated_at)
      FROM (SELECT ref, ambiente, status, updated_at FROM fiscal_focus_envios
             WHERE status IN ('pendente', 'processando_autorizacao')
               AND updated_at < now() - interval '3 minutes'
               AND created_at > now() - interval '30 days'
             ORDER BY updated_at
             LIMIT least(greatest(coalesce(_limite, 10), 1), 30)) e), '[]'::jsonb);
END $f$;
REVOKE ALL ON FUNCTION public.fiscal_focus_pendentes_conferir(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_pendentes_conferir(int) TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_focus_conferida(_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  UPDATE fiscal_focus_envios SET updated_at = now() WHERE ref = _ref AND status IN ('pendente', 'processando_autorizacao');
END $f$;
REVOKE ALL ON FUNCTION public.fiscal_focus_conferida(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_conferida(text) TO service_role;

-- 2. Fila fiscal: quem pega o item o reserva por 5 minutos.
CREATE OR REPLACE FUNCTION public.fiscal_fila_proximos(_limite integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF NOT public.fiscal_focus_producao_ativa() THEN RETURN '[]'::jsonb; END IF;
  WITH pegos AS (
    UPDATE fiscal_fila f SET proxima_em = now() + interval '5 minutes', atualizado_em = now()
     WHERE f.id IN (SELECT id FROM fiscal_fila WHERE status = 'pendente' AND proxima_em <= now()
                     ORDER BY id LIMIT least(greatest(coalesce(_limite, 5), 1), 20) FOR UPDATE SKIP LOCKED)
    RETURNING f.id, f.cycle_id, f.etapa)
  SELECT jsonb_agg(jsonb_build_object('id', id, 'cycle_id', cycle_id, 'etapa', etapa) ORDER BY id) INTO r FROM pegos;
  RETURN coalesce(r, '[]'::jsonb);
END $f$;
REVOKE ALL ON FUNCTION public.fiscal_fila_proximos(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_fila_proximos(integer) TO service_role;

-- 3. Índices dos caminhos quentes.
CREATE INDEX IF NOT EXISTS consultant_profiles_rep_idx ON public.consultant_profiles (representative_party_id) WHERE representative_party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS consultant_profiles_praca_idx ON public.consultant_profiles (praca_id) WHERE praca_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kit_transfers_para_idx ON public.kit_transfers (to_party_id, status);
CREATE INDEX IF NOT EXISTS kit_composition_items_reserva_idx ON public.kit_composition_items (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kit_composition_items_variante_idx ON public.kit_composition_items (variant_id);
CREATE INDEX IF NOT EXISTS kit_acceptances_party_idx ON public.kit_acceptances (party_id);
CREATE INDEX IF NOT EXISTS kit_cycles_local_atual_idx ON public.kit_cycles (current_location_id) WHERE current_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asaas_charges_parcela_idx ON public.asaas_charges (installment_id) WHERE installment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asaas_charges_party_idx ON public.asaas_charges (party_id) WHERE party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_orders_titulo_idx ON public.sales_orders (pay_title_id) WHERE pay_title_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_orders_cliente_idx ON public.sales_orders (customer_party_id) WHERE customer_party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_order_items_variante_idx ON public.sales_order_items (variant_id);
CREATE INDEX IF NOT EXISTS assinaturas_digitais_ciclo_idx ON public.assinaturas_digitais (cycle_id) WHERE cycle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kit_signature_requests_consultora_idx ON public.kit_signature_requests (consultora_party_id);
CREATE INDEX IF NOT EXISTS remessa_informacoes_consultora_idx ON public.remessa_informacoes (consultora_party_id) WHERE consultora_party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fiscal_focus_envios_party_idx ON public.fiscal_focus_envios (party_id) WHERE party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fiscal_focus_envios_conferir_idx ON public.fiscal_focus_envios (updated_at) WHERE status IN ('pendente', 'processando_autorizacao');
CREATE INDEX IF NOT EXISTS kit_pre_baixas_remessa_idx ON public.kit_pre_baixas (remessa_id) WHERE remessa_id IS NOT NULL;