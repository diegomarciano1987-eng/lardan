ALTER TABLE public.cob_simulacoes ADD COLUMN IF NOT EXISTS judicial_acordo_id uuid REFERENCES public.cob_judicial_acordos(id);
CREATE UNIQUE INDEX IF NOT EXISTS cob_simulacoes_judicial_uidx ON public.cob_simulacoes(judicial_acordo_id) WHERE judicial_acordo_id IS NOT NULL;
ALTER TABLE public.cob_judicial_acordos ADD COLUMN IF NOT EXISTS simulacao_id uuid;
COMMENT ON TABLE public.cob_judicial_acordos IS 'Acordos judiciais. Parcelas marcadas asaas=true viram um acordo de cobrança vinculado (cob_simulacoes.judicial_acordo_id) e seguem o fluxo oficial de cobrança Asaas; parcelas de alvará/depósito judicial nunca geram cobrança.';

CREATE OR REPLACE FUNCTION public.cob_judicial_acordo_salvar(_party uuid, _d jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v uuid; ids uuid[]; s bigint; h bigint; ca bigint; cu bigint; o bigint; de bigint; tot bigint; soma bigint;
  pa jsonb; pa_tot bigint; pa_n int; sim uuid;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cob_judicial WHERE party_id=_party) THEN RAISE EXCEPTION 'Encaminhe para judicial antes de lançar o acordo'; END IF;
  IF nullif(_d->>'data_acordo','') IS NULL THEN RAISE EXCEPTION 'Informe a data do acordo'; END IF;
  ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(_d->'installment_ids','[]'))::uuid);
  SELECT coalesce(sum(saldo_cents),0) INTO s FROM public.cob_parcelas_abertas() WHERE installment_id = any(ids) AND party_id=_party;
  h := coalesce((_d->>'honorarios_cents')::bigint,0); ca := coalesce((_d->>'cartorio_cents')::bigint,0);
  cu := coalesce((_d->>'custas_cents')::bigint,0); o := coalesce((_d->>'outros_cents')::bigint,0);
  de := coalesce((_d->>'desconto_cents')::bigint,0); tot := (_d->>'total_cents')::bigint;
  IF tot IS NULL OR tot <= 0 THEN RAISE EXCEPTION 'Informe o valor total do acordo'; END IF;
  SELECT coalesce(sum((x->>'valor_cents')::bigint),0) INTO soma FROM jsonb_array_elements(coalesce(_d->'plano','[]')) x;
  IF jsonb_array_length(coalesce(_d->'plano','[]')) = 0 THEN RAISE EXCEPTION 'Informe as parcelas do acordo'; END IF;
  IF soma <> tot THEN RAISE EXCEPTION 'As parcelas precisam somar o total do acordo'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('numero',(x->>'numero')::int,'data',x->>'data','valor_cents',(x->>'valor_cents')::bigint) ORDER BY (x->>'numero')::int),'[]'),
         coalesce(sum((x->>'valor_cents')::bigint),0), count(*)
    INTO pa, pa_tot, pa_n
    FROM jsonb_array_elements(_d->'plano') x WHERE coalesce((x->>'asaas')::boolean,false) AND NOT coalesce((x->>'alvara')::boolean,false);
  IF pa_n > 0 AND s <= 0 THEN RAISE EXCEPTION 'Para cobrar parcelas no Asaas, marque ao menos uma dívida em aberto incluída no acordo.'; END IF;
  IF pa_n > 48 THEN RAISE EXCEPTION 'No máximo 48 parcelas podem ser cobradas no Asaas.'; END IF;
  INSERT INTO cob_judicial_acordos(party_id,data_acordo,installment_ids,principal_cents,honorarios_cents,cartorio_cents,custas_cents,outros_cents,outros_descricao,desconto_cents,total_cents,plano,observacao,autor_id)
  VALUES(_party,(_d->>'data_acordo')::date,ids,s,h,ca,cu,o,nullif(_d->>'outros_descricao',''),de,tot,_d->'plano',left(nullif(_d->>'observacao',''),2000),auth.uid())
  RETURNING id INTO v;
  IF pa_n > 0 THEN
    INSERT INTO cob_simulacoes(party_id,installment_ids,data_base,multa_pct,juros_mes_pct,principal_cents,encargos_cents,desconto_cents,total_cents,entrada_cents,
      parcelas,primeira_data,plano,observacao,status,autor_id,judicial_acordo_id)
    VALUES(_party,ids,(_d->>'data_acordo')::date,0,0,s,0,0,pa_tot,0,pa_n,(pa->0->>'data')::date,pa,
      'Acordo judicial de '||to_char((_d->>'data_acordo')::date,'DD/MM/YYYY')||' — parcelas cobradas no Asaas','efetivada',auth.uid(),v)
    RETURNING id INTO sim;
    UPDATE cob_judicial_acordos SET simulacao_id=sim WHERE id=v;
  END IF;
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(_party,'negociacao','sucesso','Acordo judicial de '||to_char((_d->>'data_acordo')::date,'DD/MM/YYYY')||': total '||to_char(tot/100.0,'FM999G999G990D00')||' em '||jsonb_array_length(_d->'plano')||'x'
    ||CASE WHEN pa_n>0 THEN ' ('||pa_n||' parcela(s) para cobrar no Asaas: '||to_char(pa_tot/100.0,'FM999G999G990D00')||')' ELSE ' (sem cobrança Asaas)' END,ids,auth.uid());
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload) VALUES (auth.uid(), 'cob_judicial_acordo_salvar', 'cob_judicial_acordos', v::text, _d || jsonb_build_object('simulacao_id',sim));
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.cob_judicial_acordo_status(_id uuid, _status text, _motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r cob_judicial_acordos;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF _status NOT IN ('cumprido','descumprido','cancelado') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  IF nullif(trim(_motivo),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  SELECT * INTO r FROM cob_judicial_acordos WHERE id=_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Acordo não encontrado'; END IF;
  IF r.status <> 'vigente' THEN RAISE EXCEPTION 'Acordo já encerrado'; END IF;
  UPDATE cob_judicial_acordos SET status=_status, status_motivo=left(_motivo,500), updated_at=now() WHERE id=_id;
  IF _status='cancelado' AND r.simulacao_id IS NOT NULL THEN
    UPDATE cob_simulacoes SET status='cancelada', updated_at=now() WHERE id=r.simulacao_id AND status IN ('simulada','aguardando_entrada','efetivada');
  END IF;
  INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id) VALUES(r.party_id,'anotacao','Acordo judicial '||_status||': '||left(_motivo,500),auth.uid());
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload) VALUES (auth.uid(), 'cob_judicial_acordo_status', 'cob_judicial_acordos', _id::text, jsonb_build_object('status',_status,'motivo',_motivo));
END $function$;