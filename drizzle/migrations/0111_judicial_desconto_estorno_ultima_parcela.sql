DO $$ DECLARE d text; crit text:=$a$where motivo LIKE '%Desconto final do acordo judicial '||aid||'%'$a$; BEGIN
 d:=pg_get_functiondef('public.cob_judicial_estorno_desconto(uuid,uuid)'::regprocedure);
 d:=replace(d,'FROM financial_adjustments WHERE motivo LIKE ''%Desconto final do acordo judicial ''||aid||''%'' GROUP BY', 'FROM financial_adjustments fa WHERE (fa.motivo LIKE ''%Desconto final do acordo judicial ''||aid||''%'' OR EXISTS(SELECT 1 FROM financial_settlements rev JOIN financial_adjustments orig ON orig.settlement_id=rev.reversed_of WHERE rev.id=fa.settlement_id AND orig.installment_id=fa.installment_id AND orig.kind=fa.kind AND orig.motivo LIKE ''%Desconto final do acordo judicial ''||aid||''%'')) GROUP BY');
 EXECUTE d;
 d:=pg_get_functiondef('public.cob_judicial_desconto_final(uuid,uuid)'::regprocedure);
 d:=replace(d,'FROM financial_adjustments WHERE motivo LIKE ''%Desconto final do acordo judicial ''||a.id||''%'';', 'FROM financial_adjustments fa WHERE (fa.motivo LIKE ''%Desconto final do acordo judicial ''||a.id||''%'' OR EXISTS(SELECT 1 FROM financial_settlements rev JOIN financial_adjustments orig ON orig.settlement_id=rev.reversed_of WHERE rev.id=fa.settlement_id AND orig.installment_id=fa.installment_id AND orig.kind=fa.kind AND orig.motivo LIKE ''%Desconto final do acordo judicial ''||a.id||''%''));');
 EXECUTE d;
END $$;