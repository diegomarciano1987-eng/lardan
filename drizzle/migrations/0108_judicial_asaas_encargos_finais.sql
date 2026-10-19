DO $$ DECLARE d text; alvo text := $a$  IF primeira IS NULL THEN RETURN jsonb_build_object('baixa',false,'motivo','dividas_ja_quitadas','pago_cents',valor); END IF;$a$; BEGIN
 d:=pg_get_functiondef('public.cob_acordo_baixa(uuid,uuid)'::regprocedure);
 IF position(alvo in d)=0 THEN RAISE EXCEPTION 'Rotina de baixa mudou; revisão necessária.'; END IF;
 d:=replace(d,alvo,$b$  IF primeira IS NULL AND s.judicial_acordo_id IS NOT NULL THEN
    SELECT i.id INTO primeira FROM financial_installments i WHERE i.id=ANY(s.installment_ids) ORDER BY i.vencimento,i.numero,i.id LIMIT 1;
    IF primeira IS NOT NULL THEN
      juros:=valor; resto:=0;
      aloc:=jsonb_build_array(jsonb_build_object('installment_id',primeira,'valor_cents',valor));
    END IF;
  END IF;
  IF primeira IS NULL THEN RETURN jsonb_build_object('baixa',false,'motivo','dividas_ja_quitadas','pago_cents',valor); END IF;$b$);
 EXECUTE d;
END $$;