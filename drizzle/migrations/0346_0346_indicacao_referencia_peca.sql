-- 0346: comissão de indicação guarda a referência da peça (regra "referência sempre junto da peça").
-- Só acrescenta variant_id/referencia/variante no retrato das peças; valores e cálculo não mudam.
DO $mig$
DECLARE def text; novo text;
BEGIN
  SELECT pg_get_functiondef('public.indicacao_apurar_maleta()'::regprocedure) INTO def;
  novo := replace(def,
    $a$coalesce(pr.name,'Peça') produto$a$,
    $a$coalesce(pr.name,'Peça') produto, public.peca_referencia_etiqueta(v.reference_code, pr.reference_code) referencia, nullif(v.label,'') variante$a$);
  novo := replace(novo,
    $a$jsonb_build_object('produto',produto,'qtd',qty_sold$a$,
    $a$jsonb_build_object('produto',produto,'variant_id',variant_id,'referencia',referencia,'variante',variante,'qtd',qty_sold$a$);
  IF novo = def OR position('referencia' in novo) = 0 OR position($a$'variant_id',variant_id$a$ in novo) = 0 THEN
    RAISE EXCEPTION '0346: definição de indicacao_apurar_maleta diferente do esperado';
  END IF;
  EXECUTE novo;
END $mig$;