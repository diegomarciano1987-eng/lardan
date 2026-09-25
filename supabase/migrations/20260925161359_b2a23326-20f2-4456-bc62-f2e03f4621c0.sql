CREATE OR REPLACE FUNCTION public.asaas_receber_parcelas(_filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE lim integer := least(greatest(coalesce((_filtros->>'limite')::int,25),1),100);
        busca text := nullif(btrim(coalesce(_filtros->>'busca','')),'');
        sit text := nullif(_filtros->>'situacao','');
        aid uuid := nullif(_filtros->>'account_id','')::uuid;
        vde date := nullif(_filtros->>'de','')::date;
        vate date := nullif(_filtros->>'ate','')::date;
        cv date := nullif(_filtros#>>'{cursor,v}','')::date;
        cid uuid := nullif(_filtros#>>'{cursor,id}','')::uuid;
        itens jsonb; prox jsonb; total bigint;
BEGIN
  IF NOT public.asaas_ator_pode(auth.uid(),'finance.receivable.view') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF sit IS NOT NULL AND sit NOT IN ('sem_cobranca','com_link','pendente_link','em_processamento',
                                     'conciliacao','desconhecida','rejeitada','aberta','quitada') THEN
    RAISE EXCEPTION 'Situação de filtro inválida.';
  END IF;
  WITH base AS (
    SELECT i.id, i.vencimento, i.valor_cents, i.settlement_status, t.id AS title_id, t.numero,
           t.descricao, pa.display_name AS pessoa,
            coalesce(ch.account_id,ci.account_id) AS account_id,
            ch.id AS ch_id, ch.external_id AS ch_ext, ch.external_status AS ch_status,
           ch.billing_type AS ch_forma, ch.invoice_url AS ch_url,
           ci.id AS ci_id, ci.state AS ci_state, ci.simulado AS ci_sim, ci.last_error AS ci_erro,
           ci.rejeicao_fase AS ci_fase
      FROM public.financial_installments i
      JOIN public.financial_titles t ON t.id = i.title_id
      LEFT JOIN public.parties pa ON pa.id = coalesce(t.pagador_party_id, t.party_id)
      LEFT JOIN LATERAL (SELECT * FROM public.asaas_charges c WHERE c.installment_id = i.id
                          ORDER BY c.imported_at DESC, c.id LIMIT 1) ch ON true
      LEFT JOIN LATERAL (SELECT * FROM public.asaas_charge_intents x WHERE x.installment_id = i.id
                          ORDER BY x.created_at DESC, x.id LIMIT 1) ci ON true
     WHERE t.direction = 'receivable' AND t.status <> 'cancelado'
       AND (vde IS NULL OR i.vencimento >= vde) AND (vate IS NULL OR i.vencimento <= vate)
       AND (aid IS NULL OR ch.account_id = aid OR ci.account_id = aid OR
            (ch.id IS NULL AND ci.id IS NULL AND EXISTS (
              SELECT 1 FROM public.asaas_accounts aa
               WHERE aa.id=aid AND aa.owner_entity_id=t.business_entity_id AND aa.billing_default)))
       AND (busca IS NULL OR pa.display_name ILIKE '%' || busca || '%'
            OR t.numero::text ILIKE '%' || busca || '%' OR t.descricao ILIKE '%' || busca || '%')
       AND (sit IS NULL
            OR (sit = 'aberta' AND i.settlement_status IN ('nao_liquidado','parcial'))
            OR (sit = 'quitada' AND i.settlement_status IN ('liquidado','excedente'))
            OR (sit = 'sem_cobranca' AND ch.id IS NULL AND ci.id IS NULL)
            OR (sit = 'com_link' AND ch.invoice_url IS NOT NULL)
            OR (sit = 'pendente_link' AND ch.id IS NOT NULL AND ch.invoice_url IS NULL)
            OR (sit = 'em_processamento' AND ci.state IN ('preparada','processando'))
            OR (sit = 'conciliacao' AND ci.state = 'conciliacao')
            OR (sit = 'desconhecida' AND ci.state = 'desconhecida')
            OR (sit = 'rejeitada' AND ci.state = 'rejeitada'))
  ), pagina AS (
    SELECT * FROM base WHERE cv IS NULL OR (vencimento, id) > (cv, cid)
     ORDER BY vencimento, id LIMIT lim + 1
  )
  SELECT (SELECT count(*) FROM base),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
             'installment_id', p.id, 'account_id',p.account_id,'title_id', p.title_id, 'numero', p.numero,
            'descricao', p.descricao, 'pessoa', p.pessoa, 'vencimento', p.vencimento,
            'valor_cents', p.valor_cents, 'saldo_cents', public.fin_installment_saldo(p.id),
            'settlement_status', p.settlement_status,
            'cobranca', CASE WHEN p.ch_id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', p.ch_id, 'external_id', p.ch_ext, 'status', p.ch_status,
               'billing_type', p.ch_forma, 'invoice_url', p.ch_url) END,
            'intencao', CASE WHEN p.ci_id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', p.ci_id, 'state', p.ci_state, 'simulado', p.ci_sim, 'erro', p.ci_erro,
               'fase', p.ci_fase) END)
            ORDER BY p.vencimento, p.id)
           FROM (SELECT * FROM pagina ORDER BY vencimento, id LIMIT lim) p), '[]'::jsonb),
         (SELECT jsonb_build_object('v', q.vencimento, 'id', q.id)
            FROM (SELECT * FROM pagina ORDER BY vencimento, id OFFSET lim - 1 LIMIT 1) q
           WHERE (SELECT count(*) FROM pagina) > lim)
    INTO total, itens, prox;
  RETURN jsonb_build_object('itens', itens, 'proximo', prox, 'total', total, 'limite', lim);
END $function$;