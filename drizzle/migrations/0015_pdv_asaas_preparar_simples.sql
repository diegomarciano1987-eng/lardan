CREATE OR REPLACE FUNCTION public.pdv_asaas_preparar(_actor uuid, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(select 1 from pdv_unidades where pix_responsavel_user_id=_actor) THEN RAISE EXCEPTION 'Responsável Pix inválido.'; END IF;
  IF NOT EXISTS(select 1 from pdv_vendas where installment_id=(_payload->>'installment_id')::uuid and status='aguardando_pix') THEN RAISE EXCEPTION 'Parcela não pertence a venda do PDV.'; END IF;
  PERFORM public.pdv_como(_actor);
  RETURN public.asaas_cobranca_preparar(_payload);
END $$;
REVOKE ALL ON FUNCTION public.pdv_asaas_preparar(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_asaas_preparar(uuid,jsonb) TO service_role;