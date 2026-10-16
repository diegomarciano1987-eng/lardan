-- Maintenance only: explicit scope + expected physical stock + immutable audit.
CREATE OR REPLACE FUNCTION public.kit_testes_cancelar(_plano jsonb, _ator uuid, _motivo text, _chave text, _executar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; c public.kit_cycles; b record; mov uuid; antes jsonb; resultado jsonb;
  itens jsonb := '[]'; total integer := 0; linhas integer := 0; anterior text;
BEGIN
  IF current_user IN ('anon','authenticated') OR
     coalesce(nullif(current_setting('request.jwt.claims',true), '')::jsonb->>'role','service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Manutenção restrita ao serviço interno.' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.user_roles r ON r.user_id=p.id
    WHERE p.id=_ator AND p.is_active AND r.role='master') THEN
    RAISE EXCEPTION 'Responsável Master ativo obrigatório.';
  END IF;
  IF jsonb_typeof(_plano) IS DISTINCT FROM 'array' OR jsonb_array_length(_plano)<>7
     OR (SELECT count(DISTINCT v->>'cycle_id') FROM jsonb_array_elements(_plano) v)<>7
     OR length(coalesce(_motivo,''))<15 OR length(coalesce(_chave,''))<15 THEN
    RAISE EXCEPTION 'Informe exatamente sete ciclos distintos, motivo e chave.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('kit-testes:'||_chave,0));
  SELECT payload INTO resultado FROM public.audit_logs WHERE action='kit.testes.cancelar.lote' AND entity_id=_chave;
  IF FOUND THEN
    IF resultado->'plano' IS DISTINCT FROM _plano THEN RAISE EXCEPTION 'Chave reutilizada com plano diferente.'; END IF;
    RETURN resultado||jsonb_build_object('repetida',true);
  END IF;
  anterior := coalesce(current_setting('lardan.kit_stock',true),'off');
  -- Lock all seven cycles in a stable order before any change.
  PERFORM id FROM public.kit_cycles WHERE id IN (SELECT (v->>'cycle_id')::uuid FROM jsonb_array_elements(_plano) v) ORDER BY id FOR UPDATE;
  FOR x IN SELECT v FROM jsonb_array_elements(_plano) v ORDER BY v->>'cycle_id' LOOP
    SELECT * INTO c FROM public.kit_cycles WHERE id=(x->>'cycle_id')::uuid;
    IF c.id IS NULL OR c.status::text IS DISTINCT FROM x->>'status' OR c.remessa_id IS NOT NULL THEN
      RAISE EXCEPTION 'Escopo ou situação mudou; nenhuma maleta foi cancelada.';
    END IF;
    IF (SELECT code FROM public.kits WHERE id=c.kit_id) IS DISTINCT FROM x->>'code' THEN RAISE EXCEPTION 'Código divergente.'; END IF;
    IF EXISTS(SELECT 1 FROM public.kit_signature_requests WHERE cycle_id=c.id)
      OR EXISTS(SELECT 1 FROM public.kit_balances WHERE cycle_id=c.id AND (qty_sold>0 OR qty_reserved>0 OR qty_return_transit>0))
      OR EXISTS(SELECT 1 FROM public.kit_movements WHERE cycle_id=c.id AND status='pendente') THEN
      RAISE EXCEPTION 'Existe assinatura, venda, reserva ou retorno pendente.';
    END IF;
    IF c.current_location_id<>c.origin_location_id AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=c.current_location_id AND kind='maleta') THEN
      RAISE EXCEPTION 'Local físico não é uma maleta.';
    END IF;
    PERFORM id FROM public.stock_balances WHERE location_id=c.current_location_id ORDER BY variant_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.stock_balances WHERE location_id=c.current_location_id AND c.current_location_id<>c.origin_location_id AND (quantity<0 OR reserved>0)) THEN
      RAISE EXCEPTION 'Saldo físico inválido ou reservado.';
    END IF;
    IF coalesce((SELECT sum(quantity) FROM public.stock_balances WHERE location_id=c.current_location_id AND c.current_location_id<>c.origin_location_id),0)<>(x->>'pieces')::integer THEN
      RAISE EXCEPTION 'Quantidade física mudou; nenhuma alteração será mantida.';
    END IF;
    SELECT jsonb_build_object('cycle',to_jsonb(c),'kit',(SELECT to_jsonb(k) FROM public.kits k WHERE id=c.kit_id),
      'balances',(SELECT jsonb_agg(to_jsonb(kb)) FROM public.kit_balances kb WHERE cycle_id=c.id),
      'transfers',(SELECT jsonb_agg(to_jsonb(t)) FROM public.kit_transfers t WHERE cycle_id=c.id)) INTO antes;
    FOR b IN SELECT * FROM public.stock_balances WHERE location_id=c.current_location_id AND c.current_location_id<>c.origin_location_id AND quantity>0 ORDER BY variant_id LOOP
      IF _executar THEN
        PERFORM set_config('lardan.kit_stock','on',true);
        mov := public.register_stock_movement('transferencia',b.variant_id,b.quantity,c.current_location_id,c.origin_location_id,
          'transferencia',NULL,'cancelamento-teste:'||c.id,_motivo,_chave||':'||c.id||':'||b.variant_id,NULL);
        PERFORM set_config('lardan.kit_stock',anterior,true);
      ELSE mov := NULL; END IF;
      itens := itens||jsonb_build_object('cycle_id',c.id,'variant_id',b.variant_id,'pieces',b.quantity,
        'from',c.current_location_id,'to',c.origin_location_id,'movement_id',mov);
      total := total+b.quantity; linhas := linhas+1;
    END LOOP;
    IF _executar THEN
      UPDATE public.kit_balances SET qty_returned=qty_returned+greatest(qty_available,0),is_published=false,updated_at=now() WHERE cycle_id=c.id;
      UPDATE public.kit_transfers SET status='cancelada',updated_by=_ator,note=coalesce(note,'')||' | '||_motivo WHERE cycle_id=c.id AND status IN ('pendente','transito');
      UPDATE public.kit_cycles SET status='cancelada',cancelled_at=now(),cancel_reason=_motivo,updated_by=_ator WHERE id=c.id;
      UPDATE public.kits SET is_active=false,updated_by=_ator WHERE id=c.kit_id;
      INSERT INTO public.kit_events(cycle_id,kind,from_status,to_status,actor_user_id,reason,payload)
        VALUES(c.id,'cancelamento_teste',c.status,'cancelada',_ator,_motivo,jsonb_build_object('chave',_chave,'pieces',x->'pieces'));
      INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
        VALUES(_ator,'kit.testes.cancelar','kit_cycles',c.id::text,jsonb_build_object('antes',antes,'chave',_chave,'motivo',_motivo,'pieces',x->'pieces'));
    END IF;
  END LOOP;
  resultado := jsonb_build_object('executado',_executar,'cycles',7,'pieces',total,'lines',linhas,'itens',itens,'plano',_plano,'motivo',_motivo);
  IF _executar THEN INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
    VALUES(_ator,'kit.testes.cancelar.lote','kit_cycles',_chave,resultado); END IF;
  RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.kit_testes_cancelar(jsonb,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kit_testes_cancelar(jsonb,uuid,text,text,boolean) TO service_role;