DO $mig$
DECLARE d text;
  procedure_list text[][] := ARRAY[
    ['kit_expedir', $a$SET status = 'transito', shipped_at = now(), custodian_party_id = destino,$a$,
                    $b$SET status = 'transito', shipped_at = now(), custodian_party_id = NULL,$b$],
    ['kit_aceitar', $a$IF c.status NOT IN ('transito','recebida') THEN
    RAISE EXCEPTION 'A maleta ainda não foi expedida.';$a$,
                    $b$IF c.status <> 'recebida' THEN
    RAISE EXCEPTION 'Confirme o recebimento da maleta antes da conferência.';$b$],
    ['kit_aceitar', $a$IF c.custodian_party_id IS DISTINCT FROM c.consultora_party_id THEN$a$,
                    $b$IF c.custodian_party_id IS DISTINCT FROM c.consultora_party_id
     OR NOT EXISTS (SELECT 1 FROM public.kit_transfers tt WHERE tt.cycle_id = c.id
                     AND tt.to_party_id = c.consultora_party_id AND tt.status = 'entregue') THEN$b$],
    ['kit_transfer_confirm', $a$  IF recusar THEN$a$,
                    $b$  IF t.status <> 'transito' THEN
    RAISE EXCEPTION 'Esta entrega não está em trânsito.';
  END IF;
  IF c.status NOT IN ('transito','recebida') THEN
    RAISE EXCEPTION 'Este ciclo não aceita mais confirmação de entrega.';
  END IF;
  IF t.seq <> (SELECT max(seq) FROM public.kit_transfers WHERE cycle_id = c.id) THEN
    RAISE EXCEPTION 'Existe uma entrega mais recente para esta maleta.';
  END IF;

  IF recusar THEN$b$],
    ['kit_transfer_forward', $a$  IF c.consultora_party_id IS NULL THEN$a$,
                    $b$  IF c.status <> 'transito' OR c.custodian_party_id IS NULL
     OR c.custodian_party_id = c.consultora_party_id THEN
    RAISE EXCEPTION 'Confirme o recebimento antes de encaminhar a maleta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kit_transfers WHERE cycle_id = _cycle AND status IN ('pendente','transito')) THEN
    RAISE EXCEPTION 'Já existe uma entrega em andamento para esta maleta.';
  END IF;
  IF c.consultora_party_id IS NULL THEN$b$],
    ['order_set_status', $a$  ELSIF novo = 'concluido' THEN
    UPDATE public.sales_orders SET status = novo, closed_at = now() WHERE id = o.id;$a$,
                    $b$  ELSIF novo = 'concluido' THEN
    RAISE EXCEPTION 'Conclusão exige o registro da venda, ainda não disponível.';$b$]
  ];
  i int;
BEGIN
  FOR i IN 1..array_length(procedure_list,1) LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname=procedure_list[i][1];
    IF d IS NULL OR position(procedure_list[i][2] in d) = 0 THEN
      RAISE EXCEPTION 'Trecho esperado não encontrado em %', procedure_list[i][1];
    END IF;
    EXECUTE replace(d, procedure_list[i][2], procedure_list[i][3]);
  END LOOP;
END $mig$;

REVOKE EXECUTE ON FUNCTION public.showcase_order_create(text, jsonb, jsonb, text) FROM anon, PUBLIC;