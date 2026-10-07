CREATE OR REPLACE FUNCTION public.asaas_conciliacao_automatica(_actor uuid, _executar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; vinc int := 0; amb int := 0; baixas int := 0; res jsonb; pend jsonb; itens jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN
    RAISE EXCEPTION 'Sem permissão para conciliar.';
  END IF;
  CREATE TEMP TABLE _m ON COMMIT DROP AS
  WITH pc AS (  -- pessoa da cobrança: vínculo direto ou CPF/CNPJ único do cliente Asaas
    SELECT c.id, c.value_cents, c.due_date, c.external_status, c.external_id,
           coalesce(c.party_id, (SELECT min(p.id::text)::uuid FROM parties p
               WHERE length(cu.doc)>=11 AND p.doc_digits = regexp_replace(cu.doc,'\D','','g')
               HAVING count(*)=1)) party_id
      FROM asaas_charges c
      LEFT JOIN asaas_customers cu ON cu.account_id=c.account_id AND cu.external_id=c.customer_external_id
     WHERE c.title_id IS NULL AND c.installment_id IS NULL
       AND c.external_status IN ('PENDING','OVERDUE','RECEIVED','DUNNING_REQUESTED')
  ), pa AS (
    SELECT i.id inst, i.title_id, t.party_id, i.valor_cents, i.vencimento
      FROM financial_installments i JOIN financial_titles t ON t.id=i.title_id
     WHERE t.direction='receivable' AND t.status='ativo'
       AND public.fin_installment_saldo(i.id) = i.valor_cents
       AND NOT EXISTS (SELECT 1 FROM asaas_charges x WHERE x.installment_id=i.id AND x.external_status<>'DELETED')
  )
  SELECT pc.*, pa.inst, pa.title_id FROM pc JOIN pa
    ON pa.party_id=pc.party_id AND pa.valor_cents=pc.value_cents AND pa.vencimento=pc.due_date
   WHERE pc.party_id IS NOT NULL;

  SELECT count(DISTINCT id) INTO amb FROM _m m
   WHERE (SELECT count(*) FROM _m a WHERE a.id=m.id)>1 OR (SELECT count(*) FROM _m b WHERE b.inst=m.inst)>1;

  FOR r IN SELECT * FROM _m m WHERE (SELECT count(*) FROM _m a WHERE a.id=m.id)=1
                                 AND (SELECT count(*) FROM _m b WHERE b.inst=m.inst)=1 LOOP
    vinc := vinc + 1;
    IF _executar THEN
      PERFORM public.asaas_vincular_interno(r.id, r.title_id, r.inst,
        'Conciliação automática: mesmo CPF/CNPJ, valor e vencimento (casamento único)', _actor);
    END IF;
    IF jsonb_array_length(itens) < 50 THEN
      itens := itens || jsonb_build_object('cobranca', r.external_id, 'status', r.external_status, 'valor_cents', r.value_cents, 'vencimento', r.due_date);
    END IF;
  END LOOP;

  IF _executar THEN
    pend := public.asaas_baixa_pendentes(true);   -- somente RECEIVED; idempotente
    baixas := coalesce((pend->>'baixadas')::int,0);
    INSERT INTO public.audit_logs(actor_id, action, entity, payload)
    VALUES (_actor, 'asaas.conciliacao_automatica', 'asaas_charges',
            jsonb_build_object('vinculadas', vinc, 'ambiguas', amb, 'baixas', baixas));
  END IF;
  RETURN jsonb_build_object('executado', _executar, 'vinculadas', vinc, 'ambiguas', amb, 'baixas', baixas, 'amostra', itens);
END $$;
REVOKE ALL ON FUNCTION public.asaas_conciliacao_automatica(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_conciliacao_automatica(uuid, boolean) TO authenticated, service_role;