-- 0339 (Diego/Tati, 19/11/2026) — corrigir a peça devolvida digitada/bipada errada no protocolo de troca.
CREATE OR REPLACE FUNCTION public.qualidade_troca_peca_corrigir(_id uuid, _variant uuid, _referencia text, _motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r public.qualidade_trocas; peca jsonb; nome_ator text := public.qualidade_ator_nome();
  nref text; nnome text; ntam text; nval integer; texto text;
BEGIN
  IF NOT public.has_capability(auth.uid(),'quality.manage') THEN RAISE EXCEPTION 'Sem permissão para corrigir a peça da troca.'; END IF;
  IF length(btrim(coalesce(_motivo,'')))<3 THEN RAISE EXCEPTION 'Informe o motivo da correção (ex.: digitei a referência errada).'; END IF;
  SELECT * INTO r FROM public.qualidade_trocas WHERE id=_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Solicitação inexistente.'; END IF;
  IF r.origem='legado_smalldata' THEN RAISE EXCEPTION 'Troca do histórico SmallData não pode ter a peça trocada.'; END IF;
  IF r.status IN ('resolvida','recusada') THEN RAISE EXCEPTION 'Troca finalizada: reabra em análise antes de trocar a peça.'; END IF;
  IF _variant IS NULL AND length(btrim(coalesce(_referencia,'')))>=3 THEN
    SELECT min(v.id::text)::uuid INTO _variant FROM public.product_variants v JOIN public.products p ON p.id=v.product_id
      WHERE v.is_active AND (upper(coalesce(nullif(v.reference_code,''),p.reference_code,''))=upper(btrim(_referencia)) OR v.barcode=btrim(_referencia))
      HAVING count(*)=1;
  END IF;
  IF _variant IS NULL AND length(btrim(coalesce(_referencia,'')))<3 THEN RAISE EXCEPTION 'Escolha a peça certa ou digite a referência da etiqueta.'; END IF;
  IF _variant IS NOT NULL THEN
    IF _variant = r.dev_variant_id THEN RAISE EXCEPTION 'Esta já é a peça devolvida da troca.'; END IF;
    peca := public.qualidade_peca(_variant);
    IF peca IS NULL THEN RAISE EXCEPTION 'Peça não encontrada.'; END IF;
    nref := upper(peca->>'referencia'); nnome := peca->>'nome'; ntam := peca->>'tamanho'; nval := (peca->>'valor_cents')::int;
  ELSE
    nref := upper(btrim(_referencia)); nnome := NULL; ntam := NULL; nval := NULL;
    IF r.dev_variant_id IS NULL AND upper(coalesce(r.dev_referencia,'')) = nref THEN RAISE EXCEPTION 'Esta já é a peça devolvida da troca.'; END IF;
  END IF;

  texto := 'Peça devolvida corrigida pela Lardan: de '||coalesce(r.dev_referencia,'s/ ref')||coalesce(' ('||r.dev_nome||')','')
        ||' para '||coalesce(nref,'s/ ref')||coalesce(' ('||nnome||')','')||'. Motivo: '||left(btrim(_motivo),300);

  UPDATE public.qualidade_trocas SET
    dev_variant_id=_variant, dev_produto_legado=NULL, dev_referencia=nref, dev_nome=nnome, dev_tamanho=ntam, dev_valor_cents=nval,
    rep_variant_id=CASE WHEN solucao IN ('mesma_peca','conserto') THEN _variant ELSE rep_variant_id END,
    rep_referencia=CASE WHEN solucao IN ('mesma_peca','conserto') THEN nref ELSE rep_referencia END,
    rep_nome=CASE WHEN solucao IN ('mesma_peca','conserto') THEN nnome ELSE rep_nome END,
    rep_tamanho=CASE WHEN solucao IN ('mesma_peca','conserto') THEN ntam ELSE rep_tamanho END,
    rep_valor_cents=CASE WHEN solucao IN ('mesma_peca','conserto') THEN nval ELSE rep_valor_cents END,
    diferenca_cents=CASE WHEN solucao IN ('mesma_peca','conserto') THEN 0
                         WHEN rep_valor_cents IS NOT NULL AND nval IS NOT NULL THEN nval-rep_valor_cents
                         ELSE NULL END,
    novidade_consultora=true, updated_at=now()
  WHERE id=r.id;

  INSERT INTO public.qualidade_trocas_eventos(troca_id,autor,autor_nome,status,texto,actor_id)
  VALUES(r.id,'lardan',nome_ator,NULL,texto,auth.uid());

  RETURN jsonb_build_object('id',r.id,
    'antes',jsonb_build_object('variant_id',r.dev_variant_id,'referencia',r.dev_referencia,'nome',r.dev_nome,'valor_cents',r.dev_valor_cents),
    'depois',jsonb_build_object('variant_id',_variant,'referencia',nref,'nome',nnome,'valor_cents',nval));
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_peca_corrigir(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_peca_corrigir(uuid,uuid,text,text) TO authenticated, service_role;