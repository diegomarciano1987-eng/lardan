CREATE OR REPLACE FUNCTION public.qualidade_troca_criar(_party uuid,_origem text,_variant uuid,_referencia text,_nome text,_tamanho text,_valor_cents integer,_tipo text,_motivo text,_observacao text,_fotos jsonb,_chave text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.qualidade_trocas; pa public.parties; peca jsonb; nome_ator text := public.qualidade_ator_nome(); praca record;
BEGIN
  IF length(coalesce(_chave,''))<8 THEN RAISE EXCEPTION 'Chave inválida.'; END IF;
  IF _tipo NOT IN ('troca','garantia') THEN RAISE EXCEPTION 'Escolha troca ou garantia.'; END IF;
  IF length(btrim(coalesce(_motivo,'')))<3 THEN RAISE EXCEPTION 'Informe o motivo (ex.: escureceu, pedra soltou).'; END IF;
  IF NOT public.qualidade_fotos_validas(_fotos) THEN RAISE EXCEPTION 'Fotos inválidas (até 6, da sua conta).'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_chave,0));
  SELECT * INTO r FROM public.qualidade_trocas WHERE idempotency_key=_chave;
  IF r.id IS NOT NULL THEN
    IF r.aberto_por IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Chave usada em outra solicitação.'; END IF;
    RETURN jsonb_build_object('id',r.id,'protocolo','TG-'||lpad(r.protocolo::text,6,'0'),'repetida',true);
  END IF;
  SELECT * INTO pa FROM public.parties WHERE id=_party;
  IF pa.id IS NULL THEN RAISE EXCEPTION 'Consultora não encontrada.'; END IF;
  IF _variant IS NULL AND length(btrim(coalesce(_referencia,'')))>=3 THEN
    SELECT min(v.id::text)::uuid INTO _variant FROM public.product_variants v JOIN public.products p ON p.id=v.product_id
      WHERE v.is_active AND (upper(coalesce(nullif(v.reference_code,''),p.reference_code,''))=upper(btrim(_referencia)) OR v.barcode=btrim(_referencia))
      HAVING count(*)=1;
  END IF;
  IF _variant IS NOT NULL THEN peca := public.qualidade_peca(_variant); IF peca IS NULL THEN RAISE EXCEPTION 'Peça não encontrada.'; END IF; END IF;
  IF _variant IS NULL AND length(btrim(coalesce(_referencia,'')))<3 AND length(btrim(coalesce(_nome,'')))<3 THEN RAISE EXCEPTION 'Escolha a peça ou digite a referência da etiqueta.'; END IF;
  SELECT lp.codigo, lp.nome INTO praca FROM public.qualidade_trocas t
    LEFT JOIN LATERAL (SELECT t.praca_codigo AS codigo, t.praca_nome AS nome) lp ON true
    WHERE t.consultora_party_id=_party AND t.praca_nome IS NOT NULL ORDER BY t.aberto_em DESC LIMIT 1;
  INSERT INTO public.qualidade_trocas(origem,consultora_party_id,consultora_codigo,consultora_nome,praca_codigo,praca_nome,tipo,motivo,observacao,
     dev_variant_id,dev_referencia,dev_nome,dev_tamanho,dev_valor_cents,fotos,aberto_por,aberto_por_nome,idempotency_key,novidade_lardan,novidade_consultora)
  VALUES(_origem,_party,pa.code,coalesce(pa.display_name,pa.legal_name),praca.codigo,praca.nome,_tipo,btrim(_motivo),left(nullif(btrim(coalesce(_observacao,'')),''),1000),
     _variant,upper(coalesce(peca->>'referencia',nullif(btrim(_referencia),''))),coalesce(peca->>'nome',nullif(btrim(_nome),'')),coalesce(nullif(btrim(coalesce(_tamanho,'')),''),peca->>'tamanho'),
     coalesce((peca->>'valor_cents')::int,_valor_cents),coalesce(_fotos,'[]'::jsonb),auth.uid(),nome_ator,_chave,_origem='app_consultora',_origem='admin_manual')
  RETURNING * INTO r;
  INSERT INTO public.qualidade_trocas_eventos(troca_id,autor,autor_nome,status,texto,fotos,actor_id)
  VALUES(r.id,CASE WHEN _origem='app_consultora' THEN 'consultora' ELSE 'lardan' END,nome_ator,'aberta',r.motivo||coalesce(' · '||r.observacao,''),r.fotos,auth.uid());
  RETURN jsonb_build_object('id',r.id,'protocolo','TG-'||lpad(r.protocolo::text,6,'0'),'repetida',false);
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_criar(uuid,text,uuid,text,text,text,integer,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_criar(uuid,text,uuid,text,text,text,integer,text,text,text,jsonb,text) TO service_role;

UPDATE public.qualidade_trocas t SET dev_variant_id=x.vid, dev_nome=coalesce(t.dev_nome,public.qualidade_peca(x.vid)->>'nome'),
  dev_valor_cents=coalesce(t.dev_valor_cents,(public.qualidade_peca(x.vid)->>'valor_cents')::int)
FROM (SELECT t2.id, min(v.id::text)::uuid vid FROM public.qualidade_trocas t2 JOIN public.product_variants v ON v.is_active
        JOIN public.products p ON p.id=v.product_id
      WHERE t2.dev_variant_id IS NULL AND t2.dev_referencia IS NOT NULL
        AND upper(coalesce(nullif(v.reference_code,''),p.reference_code,''))=upper(t2.dev_referencia)
      GROUP BY t2.id HAVING count(*)=1) x WHERE t.id=x.id;