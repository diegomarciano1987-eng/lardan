-- 0199 — Auditoria de segurança do app da consultora (03/11/2026). Só regras de acesso mais estreitas.

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND _user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                 JOIN public.profiles p ON p.id = ur.user_id
                 WHERE ur.user_id = _user_id AND p.is_active
                   AND ur.role NOT IN ('consultora','representante'));
$function$;

CREATE OR REPLACE FUNCTION public.kit_ve_rede()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL
     AND (coalesce(public.kit_scope_all(), false)
          OR (public.colab_restrita() AND (coalesce(public.can_view_kits(auth.uid()), false)
                                          OR coalesce(public.can_manage_kits(auth.uid()), false))));
$$;
REVOKE ALL ON FUNCTION public.kit_ve_rede() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_ve_rede() TO authenticated;

CREATE OR REPLACE FUNCTION public.remessas_lista(_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, numero integer, praca_id uuid, praca text, representante text, data_emissao date, data_acerto date, status text, maletas bigint, maletas_conferidas bigint, consultoras_praca bigint, pecas bigint, valor_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.id, r.numero, r.praca_id, p.nome, rp.display_name, r.data_emissao, r.data_acerto, r.status,
    (SELECT count(*) FROM colab_v_kit_cycles k WHERE k.remessa_id = r.id AND k.status <> 'cancelada'),
    (SELECT count(*) FROM colab_v_kit_cycles k WHERE k.remessa_id = r.id AND k.status NOT IN ('cancelada','rascunho','montagem')),
    (SELECT count(*) FROM colab_v_consultant_profiles cp JOIN public.colab_v_parties pa ON pa.id = cp.party_id
      WHERE cp.praca_id = r.praca_id AND pa.status NOT IN ('desligado','bloqueado')),
    (SELECT coalesce(sum(k.quantity_total),0) FROM colab_v_kit_cycles k WHERE k.remessa_id = r.id AND k.status <> 'cancelada')::bigint,
    (SELECT coalesce(sum(k.reference_total_cents),0) FROM colab_v_kit_cycles k WHERE k.remessa_id = r.id AND k.status <> 'cancelada')::bigint
  FROM colab_v_remessas r
  JOIN colab_v_cob_pracas p ON p.id = r.praca_id
  LEFT JOIN parties rp ON rp.id = r.representante_party_id
  WHERE public.kit_ve_rede()
    AND (_status IS NULL OR r.status = _status)
  ORDER BY r.numero DESC;
$function$;

CREATE OR REPLACE FUNCTION public.remessa_maletas(_remessa uuid)
 RETURNS TABLE(cycle_id uuid, consultora_party_id uuid, consultora text, status text, pecas integer, valor_cents bigint, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT k.id, k.consultora_party_id, pa.display_name, k.status::text, k.quantity_total, k.reference_total_cents::bigint, k.created_at
  FROM colab_v_kit_cycles k LEFT JOIN public.colab_v_parties pa ON pa.id = k.consultora_party_id
  WHERE (k.consultora_party_id IS NULL OR public.colab_party_ok(k.consultora_party_id)) AND k.remessa_id = _remessa AND k.status <> 'cancelada'
    AND public.kit_ve_rede()
  ORDER BY pa.display_name;
$function$;

CREATE OR REPLACE FUNCTION public.praca_consultoras(_praca uuid, _search text DEFAULT NULL::text)
 RETURNS TABLE(party_id uuid, display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT cp.party_id, pa.display_name
  FROM colab_v_consultant_profiles cp
  JOIN parties pa ON pa.id = cp.party_id
  WHERE cp.praca_id = _praca
    AND pa.status NOT IN ('desligado','bloqueado')
    AND public.kit_ve_rede()
    AND (_search IS NULL OR btrim(_search) = ''
         OR pa.display_name ILIKE '%' || btrim(_search) || '%'
         OR regexp_replace(coalesce(pa.doc,''),'\D','','g') LIKE regexp_replace(btrim(_search),'\D','','g') || '%' AND regexp_replace(btrim(_search),'\D','','g') <> '')
  ORDER BY pa.display_name
  LIMIT 200;
$function$;

CREATE OR REPLACE FUNCTION public.maleta_total_sugerido(_party uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ult AS (
    SELECT vendidas, quando FROM (
      SELECT lm.pecas_vendidas::numeric AS vendidas, lm.fechamento::timestamptz AS quando
        FROM legado_maletas lm JOIN legado_consultoras lc ON lc.codcli = lm.codcli
       WHERE lc.party_id = _party AND lm.tipo = 'remessa' AND lm.fechamento IS NOT NULL AND lm.pecas_enviadas >= 10
      UNION ALL
      SELECT coalesce((SELECT sum(qty_sold) FROM kit_balances kb WHERE kb.cycle_id = c.id),0)::numeric, c.closed_at
        FROM kit_cycles c WHERE c.consultora_party_id = _party AND c.status = 'encerrada' AND c.closed_at IS NOT NULL
    ) x ORDER BY quando DESC NULLS LAST LIMIT 3)
  SELECT jsonb_build_object(
    'maletas', (SELECT count(*) FROM ult),
    'media', (SELECT round(avg(vendidas),1) FROM ult),
    'total', (SELECT CASE WHEN count(*) = 0 OR avg(vendidas) <= 0 THEN NULL ELSE least(ceil(avg(vendidas) * 1.3)::int, 1000) END FROM ult))
  WHERE (public.kit_ve_rede()
         OR public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque','montagem']::public.app_role[]))
    AND public.colab_party_ok(_party);
$function$;

CREATE OR REPLACE FUNCTION public.kit_depositos_operacao()
 RETURNS TABLE(id uuid, code text, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id, l.code::text, l.name::text FROM public.locations l
  WHERE l.kind = 'deposito' AND l.is_active AND NOT coalesce(l.is_blocked, false)
    AND l.code NOT ILIKE 'HOMOLOG%' AND l.name NOT ILIKE 'HOMOLOG%'
    AND (public.kit_ve_rede() OR public.has_capability(auth.uid(), 'stock.view'))
  ORDER BY (l.code = 'DEP-01') DESC, l.code
$function$;

DROP POLICY IF EXISTS remessas_read ON public.remessas;
CREATE POLICY remessas_read ON public.remessas FOR SELECT TO authenticated
  USING (public.kit_ve_rede()
         OR (representante_party_id IS NOT NULL AND representante_party_id = public.my_party_id())
         OR EXISTS (SELECT 1 FROM public.kit_cycles c WHERE c.remessa_id = remessas.id AND public.kit_cycle_in_scope(c.id)));

DROP POLICY IF EXISTS kit_div_fotos_ler ON public.kit_divergencia_fotos;
CREATE POLICY kit_div_fotos_ler ON public.kit_divergencia_fotos FOR SELECT TO authenticated
  USING (enviado_por = auth.uid() OR (public.can_view_kits(auth.uid()) AND public.kit_cycle_in_scope(cycle_id)));
DROP POLICY IF EXISTS maleta_divergencia_foto_ler ON storage.objects;
CREATE POLICY maleta_divergencia_foto_ler ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'consultora-pos-venda' AND public.can_view_kits(auth.uid())
         AND EXISTS (SELECT 1 FROM public.kit_divergencia_fotos f
                      WHERE f.path = objects.name AND public.kit_cycle_in_scope(f.cycle_id)));

REVOKE ALL ON FUNCTION public.crm_filtrar(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin_installment_saldo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_filtrar(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fin_installment_saldo(uuid) TO service_role;

DROP POLICY IF EXISTS remessa_parametros_read ON public.remessa_parametros;
CREATE POLICY remessa_parametros_read ON public.remessa_parametros FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR public.meu_acesso_colab());

CREATE OR REPLACE FUNCTION public.kit_conferir(_cycle uuid, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; comp public.kit_compositions; it record;
  res jsonb; validade timestamptz; total integer := 0;
  sem_reserva integer := 0; disp integer;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NOT NULL AND public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501';
  END IF;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF c.status = 'conferida' THEN
    RETURN jsonb_build_object('situacao','conferida','repetida',true);
  END IF;
  IF c.status NOT IN ('rascunho','montagem') THEN
    RAISE EXCEPTION 'Este ciclo está % e não pode ser conferido.', c.status;
  END IF;

  SELECT * INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.kit_composition_items WHERE composition_id = comp.id) THEN
    RAISE EXCEPTION 'A maleta está vazia.';
  END IF;

  validade := coalesce(c.due_at, now() + interval '30 days');
  IF validade <= now() THEN validade := now() + interval '30 days'; END IF;

  FOR it IN SELECT * FROM public.kit_composition_items WHERE composition_id = comp.id LOOP
    disp := public.stock_available(it.variant_id, c.origin_location_id);
    IF disp >= it.quantity THEN
      res := public.colab_kit_reserva_criar_interna(
        it.variant_id, c.origin_location_id, it.quantity, validade,
        'maleta', c.id::text, c.consultora_party_id,
        'Conferência da maleta', 'maleta-conf:' || comp.id::text || ':' || it.variant_id::text);
      UPDATE public.kit_composition_items
         SET reservation_id = (res->>'id')::uuid WHERE id = it.id;
    ELSE
      sem_reserva := sem_reserva + 1;
    END IF;
    total := total + it.quantity;
  END LOOP;

  UPDATE public.kit_compositions SET frozen_at = now(), frozen_by = uid, note = coalesce(_note, note)
   WHERE id = comp.id;
  UPDATE public.kit_cycles SET status = 'conferida', updated_by = uid WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
  VALUES (_cycle, 'ciclo.conferido', c.status, 'conferida', uid,
          jsonb_build_object('composicao', comp.id, 'versao', comp.version, 'pecas', total,
            'itens_sem_reserva', sem_reserva,
            'motivo_sem_reserva', CASE WHEN sem_reserva > 0
              THEN 'Estoque ainda não contado (peças na rua); conferida sem reserva.' END), _note);

  RETURN jsonb_build_object('situacao','conferida','composition_id',comp.id,'pecas',total,
                            'itens_sem_reserva', sem_reserva);
END $function$;

CREATE OR REPLACE FUNCTION public.kit_expedir(_cycle uuid, _payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; comp public.kit_compositions; it record;
  loc uuid; destino uuid; rota text; transfer uuid; movimentos integer := 0; mov uuid;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NOT NULL AND public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501';
  END IF;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF c.status IN ('expedida','transito','recebida','operacao','acerto','encerrada') THEN
    RETURN jsonb_build_object('situacao', c.status, 'repetida', true,
      'mensagem','Esta maleta já foi expedida.');
  END IF;
  IF c.status <> 'conferida' THEN
    RAISE EXCEPTION 'Confira a maleta antes de expedir.';
  END IF;

  rota := coalesce(nullif(_payload->>'rota',''), CASE WHEN c.representante_party_id IS NOT NULL
            THEN 'representante' ELSE 'direta' END);
  destino := CASE WHEN rota = 'representante' THEN c.representante_party_id
                  ELSE c.consultora_party_id END;
  IF destino IS NULL THEN
    RAISE EXCEPTION 'Defina a consultora (ou o representante) antes de expedir.';
  END IF;

  loc := public.kit_location_ensure(c.kit_id);
  SELECT * INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;

  PERFORM set_config('lardan.stock_unblock', 'on', true);

  FOR it IN SELECT * FROM public.kit_composition_items WHERE composition_id = comp.id LOOP
    IF it.reservation_id IS NOT NULL THEN
      PERFORM public.colab_kit_reserva_liberar_interna(it.reservation_id, false,
        'Expedição da maleta', 'maleta-exp-rel:' || it.id::text);
    END IF;
    PERFORM public.register_stock_movement(
      'transferencia'::stock_move_kind, it.variant_id, it.quantity,
      c.origin_location_id, loc, 'transferencia', NULL,
      'maleta:' || c.id::text, 'Expedição da maleta',
      'maleta-exp:' || it.id::text, NULL);

    INSERT INTO public.kit_balances (cycle_id, variant_id, qty_allocated)
    VALUES (_cycle, it.variant_id, it.quantity)
    ON CONFLICT (cycle_id, variant_id)
    DO UPDATE SET qty_allocated = public.kit_balances.qty_allocated + excluded.qty_allocated,
                  updated_at = now();
    movimentos := movimentos + 1;
  END LOOP;

  INSERT INTO public.kit_transfers (cycle_id, seq, status, from_party_id, to_party_id,
    from_location_id, to_location_id, carrier, tracking_code, shipped_at, note, created_by, updated_by)
  VALUES (_cycle, 1, 'transito', NULL, destino, c.origin_location_id, loc,
    nullif(_payload->>'carrier',''), nullif(_payload->>'tracking_code',''), now(),
    nullif(_payload->>'note',''), uid, uid)
  RETURNING id INTO transfer;

  mov := public.kit_movement_open(_cycle, 'remessa_inicial', 'confirmado', NULL, destino,
    c.origin_location_id, loc, transfer, uid, nullif(_payload->>'note',''), NULL, NULL);
  UPDATE public.kit_movements SET composition_id = comp.id WHERE id = mov;

  INSERT INTO public.kit_movement_items (movement_id, variant_id, quantity, unit_reference_cents)
  SELECT mov, i.variant_id, i.quantity, i.unit_reference_cents
    FROM public.kit_composition_items i WHERE i.composition_id = comp.id;

  UPDATE public.kit_cycles
     SET status = 'transito', shipped_at = now(), custodian_party_id = NULL,
         current_location_id = loc, updated_by = uid
   WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'ciclo.expedido', 'conferida', 'transito', uid,
          jsonb_build_object('rota', rota, 'destino', destino, 'transferencia', transfer,
                             'itens', movimentos, 'movimento', mov));

  RETURN jsonb_build_object('situacao','transito','rota',rota,'transfer_id',transfer,'itens',movimentos);
END $function$;

CREATE OR REPLACE FUNCTION public.kit_item_upsert(_cycle uuid, _variant uuid, _qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; comp uuid; disp integer; preco integer;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NOT NULL AND public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501';
  END IF;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF c.status NOT IN ('rascunho','montagem') THEN
    RAISE EXCEPTION 'A composição já foi conferida e não pode mais ser alterada aqui.';
  END IF;

  SELECT id INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;

  IF _qty IS NULL OR _qty <= 0 THEN
    DELETE FROM public.kit_composition_items WHERE composition_id = comp AND variant_id = _variant;
    PERFORM public.kit_totals_refresh(_cycle);
    RETURN jsonb_build_object('removido', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = _variant AND is_active) THEN
    RAISE EXCEPTION 'Peça inexistente ou inativa.';
  END IF;

  disp := public.stock_available(_variant, c.origin_location_id);

  preco := public.kit_reference_price(_variant);

  INSERT INTO public.kit_composition_items (composition_id, variant_id, quantity, unit_reference_cents)
  VALUES (comp, _variant, _qty, preco)
  ON CONFLICT (composition_id, variant_id)
  DO UPDATE SET quantity = excluded.quantity, unit_reference_cents = excluded.unit_reference_cents;

  UPDATE public.kit_cycles SET status = 'montagem', updated_by = uid WHERE id = _cycle;
  PERFORM public.kit_totals_refresh(_cycle);
  RETURN jsonb_build_object('composition_id', comp, 'variant_id', _variant,
                            'quantidade', _qty, 'valor_unitario', preco,
                            'disponivel_deposito', disp,
                            'estoque_insuficiente', disp < _qty);
END $function$;

CREATE OR REPLACE FUNCTION public.kit_liberar_consultora(_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; t public.kit_transfers;
  inicial public.kit_status; passos text[] := '{}'; i int := 0;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NOT NULL AND public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501';
  END IF;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  inicial := c.status;
  IF c.status IN ('recebida','operacao','acerto','encerrada') THEN
    RETURN jsonb_build_object('situacao', c.status, 'repetida', true);
  END IF;
  IF c.consultora_party_id IS NULL THEN
    RAISE EXCEPTION 'Esta maleta não tem consultora definida.';
  END IF;
  IF c.status NOT IN ('conferida','expedida','transito') THEN
    RAISE EXCEPTION 'Confira a maleta antes de liberar.';
  END IF;
  IF c.status = 'conferida' THEN
    PERFORM public.kit_expedir(_cycle, jsonb_build_object('rota','direta','note','Liberação direta'));
    passos := array_append(passos, 'expedida');
  END IF;
  LOOP
    i := i + 1; EXIT WHEN i > 4;
    SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
    EXIT WHEN c.status = 'recebida';
    t := NULL;
    SELECT * INTO t FROM public.kit_transfers WHERE cycle_id = _cycle AND status = 'transito'
     ORDER BY seq DESC LIMIT 1;
    IF t.id IS NOT NULL THEN
      PERFORM public.kit_transfer_confirm(t.id, '{}'::jsonb);
      passos := array_append(passos, 'entrega_confirmada');
    ELSIF c.status = 'transito' AND c.custodian_party_id IS NOT NULL
          AND c.custodian_party_id <> c.consultora_party_id THEN
      PERFORM public.kit_transfer_forward(_cycle, '{"note":"Liberação direta"}'::jsonb);
      passos := array_append(passos, 'encaminhada');
    ELSE
      EXIT;
    END IF;
  END LOOP;
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.status <> 'recebida' THEN
    RAISE EXCEPTION 'Não foi possível entregar a maleta à consultora (situação %).', c.status;
  END IF;
  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'maleta.liberada_equipe', inicial, 'recebida', uid,
          jsonb_build_object('passos', to_jsonb(passos), 'aguarda_aceite_consultora', true,
            'email', (SELECT email FROM auth.users WHERE id = uid)));
  RETURN jsonb_build_object('situacao','recebida','passos', to_jsonb(passos), 'aguarda_aceite', true);
END $function$;