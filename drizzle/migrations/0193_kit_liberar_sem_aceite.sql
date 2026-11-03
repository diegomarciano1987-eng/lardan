CREATE OR REPLACE FUNCTION public.kit_liberar_consultora(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; t public.kit_transfers;
  inicial public.kit_status; passos text[] := '{}'; i int := 0;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
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
  -- Aceite é da própria consultora no app (passo obrigatório pedido por Diego em 03/11/2026).
  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'maleta.liberada_equipe', inicial, 'recebida', uid,
          jsonb_build_object('passos', to_jsonb(passos), 'aguarda_aceite_consultora', true,
            'email', (SELECT email FROM auth.users WHERE id = uid)));
  RETURN jsonb_build_object('situacao','recebida','passos', to_jsonb(passos), 'aguarda_aceite', true);
END $$;
REVOKE ALL ON FUNCTION public.kit_liberar_consultora(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.kit_liberar_consultora(uuid) TO authenticated;