CREATE OR REPLACE FUNCTION public.consultora_notas_e_fechamentos(_party uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cods int[];
BEGIN
  IF NOT (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'registry.finance.view')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o financeiro desta pessoa' USING errcode = '42501';
  END IF;
  cods := coalesce(public.legado_codigos_da_pessoa(_party), '{}');
  RETURN jsonb_build_object(
    'notas', coalesce((SELECT jsonb_agg(n ORDER BY n->>'data' DESC NULLS LAST, n->>'numero' DESC) FROM (
        SELECT jsonb_build_object('origem', 'smalldata', 'id', 'sd:' || ln.nf_id, 'data', ln.emitida_em, 'numero', ln.numero::text, 'serie', ln.serie::text,
          'tipo', CASE ln.tipo WHEN 'R' THEN 'remessa' WHEN 'D' THEN 'devolucao' WHEN 'V' THEN 'venda' WHEN 'P' THEN 'perda' ELSE coalesce(lower(ln.natureza), 'outra') END,
          'natureza', ln.natureza, 'cfop', ln.cfop, 'operacao', ln.operacao, 'situacao', ln.situacao, 'valor_cents', ln.valor_cents, 'pecas', ln.pecas,
          'remessa', ln.remessa, 'maleta', CASE WHEN ln.kit IS NULL THEN NULL ELSE 'Kit ' || ln.kit END, 'chave', ln.chave, 'simulada', false) n
          FROM legado_notas ln WHERE ln.codcli = ANY (cods)
        UNION ALL
        SELECT jsonb_build_object('origem', 'lardan', 'id', fd.id, 'data', coalesce(fd.authorized_at, fd.issued_at, fd.created_at), 'numero', fd.number, 'serie', fd.series,
          'tipo', fd.kind, 'natureza', fd.kind, 'cfop', NULL, 'operacao', NULL,
          'situacao', CASE WHEN (to_jsonb(fd)->>'cancelled_at') IS NOT NULL OR fd.status IN ('cancelado', 'cancelada') THEN 'cancelada' ELSE fd.status END, 'valor_cents', fd.total_cents,
          'pecas', (SELECT sum(fi.quantity) FROM fiscal_document_items fi WHERE fi.document_id = fd.id),
          'remessa', (SELECT r.numero FROM kit_cycles c JOIN remessas r ON r.id = c.remessa_id WHERE c.id = fd.cycle_id),
          'maleta', (SELECT k.code FROM kit_cycles c JOIN kits k ON k.id = c.kit_id WHERE c.id = fd.cycle_id),
          'chave', fd.access_key, 'simulada', coalesce((to_jsonb(fd)->>'simulado')::boolean, false)) n
          FROM fiscal_documents fd
         WHERE fd.recipient_party_id = _party OR fd.debtor_party_id = _party
            OR EXISTS (SELECT 1 FROM kit_cycles c WHERE c.id = fd.cycle_id AND c.consultora_party_id = _party)
      ) s), '[]'::jsonb),
    'fechamentos', coalesce((SELECT jsonb_agg(f ORDER BY coalesce(f->>'fechamento', f->>'enviada') DESC NULLS LAST) FROM (
        SELECT jsonb_build_object('origem', 'smalldata', 'id', 'sd:' || m.remessa || ':' || m.kit, 'remessa', m.remessa, 'maleta', 'Kit ' || m.kit, 'tipo', m.tipo,
          'enviada', m.emissao, 'fechamento', coalesce(m.fechamento, m.fechamento_smalldata),
          'situacao', CASE WHEN m.tipo = 'perdida' THEN 'perdida' WHEN coalesce(m.fechamento, m.fechamento_smalldata) IS NOT NULL THEN 'fechada' ELSE 'aberta' END,
          'pecas_enviadas', m.pecas_enviadas, 'pecas_devolvidas', m.pecas_devolvidas, 'pecas_vendidas', m.pecas_vendidas, 'pecas_defeito', m.pecas_defeito,
          'valor_enviado_cents', m.valor_enviado_cents, 'valor_devolvido_cents', m.valor_devolvido_cents, 'vendido_cents', m.valor_venda_cents,
          'acerto_divergente', m.acerto_divergente, 'sem_cobranca', m.sem_cobranca,
          'cobranca', (SELECT jsonb_build_object('data', min(c.data), 'venda_bruta_cents', sum(c.venda_bruta_cents), 'venda_liquida_cents', sum(c.venda_liquida_cents),
                         'comissao_cents', sum(c.venda_bruta_cents - c.venda_liquida_cents), 'pago_cents', sum(c.total_pago_cents), 'fiado_novo_cents', sum(c.fiado_novo_cents))
                         FROM legado_cobrancas c WHERE c.codcli = m.codcli AND c.remessa = m.remessa AND c.tipo IN (1, 2) HAVING count(*) > 0),
          'notas', jsonb_strip_nulls(jsonb_build_object('remessa', m.nf_remessa, 'devolucao', m.nf_devolucao, 'venda', m.nf_venda, 'perda', m.nf_perda))) f
          FROM legado_maletas m WHERE m.codcli = ANY (cods)
        UNION ALL
        SELECT jsonb_build_object('origem', 'lardan', 'id', kc.id, 'remessa', r.numero, 'maleta', k.code, 'tipo', 'remessa',
          'enviada', (kc.shipped_at AT TIME ZONE 'America/Sao_Paulo')::date,
          'fechamento', (coalesce(pb.encerrada_em, kc.closed_at, pb.fechada_em) AT TIME ZONE 'America/Sao_Paulo')::date,
          'situacao', CASE WHEN pb.id IS NOT NULL THEN public.pre_baixa_situacao(pb) ELSE kc.status::text END,
          'pecas_enviadas', b.aceitas, 'pecas_devolvidas', b.devolvidas, 'pecas_vendidas', b.vendidas, 'pecas_defeito', NULL,
          'valor_enviado_cents', kc.reference_total_cents, 'valor_devolvido_cents', NULL,
          'vendido_cents', coalesce(pb.vendido_final_cents, pb.total_vendido_cents),
          'acerto_divergente', pb.status = 'pendencia', 'sem_cobranca', false,
          'cobranca', CASE WHEN pb.id IS NOT NULL THEN jsonb_build_object('data', (pb.fechada_em AT TIME ZONE 'America/Sao_Paulo')::date,
                        'venda_bruta_cents', coalesce(pb.vendido_final_cents, pb.total_vendido_cents), 'comissao_cents', pb.comissao_cents,
                        'venda_liquida_cents', coalesce(pb.valor_final_cents, pb.valor_pagar_cents),
                        'pago_cents', CASE WHEN pb.installment_id IS NULL THEN NULL
                                           ELSE (SELECT coalesce(sum(a.valor_cents), 0) FROM financial_allocations a WHERE a.installment_id = pb.installment_id) END,
                        'origem', pb.origem)
                      END,
          'notas', coalesce((SELECT jsonb_object_agg(fd.kind, fd.number) FROM fiscal_documents fd WHERE fd.cycle_id = kc.id AND fd.number IS NOT NULL), '{}'::jsonb)) f
          FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id LEFT JOIN remessas r ON r.id = kc.remessa_id
          LEFT JOIN kit_pre_baixas pb ON pb.cycle_id = kc.id
          CROSS JOIN LATERAL (SELECT coalesce(sum(qty_accepted), 0) aceitas, coalesce(sum(qty_returned), 0) devolvidas, coalesce(sum(qty_sold), 0) vendidas
                                FROM kit_balances WHERE cycle_id = kc.id) b
         WHERE kc.consultora_party_id = _party AND kc.status NOT IN ('rascunho', 'montagem', 'cancelada')
      ) s), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.consultora_notas_e_fechamentos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_notas_e_fechamentos(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_maletas_carteira(_rep uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'vencida')::boolean DESC, x->>'acerto' NULLS LAST, x->>'consultora') FROM (
    SELECT jsonb_build_object('id', c.id, 'fonte', 'lardan', 'cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'party_id', c.consultora_party_id, 'consultora', p.display_name,
      'status', c.status, 'acerto', a.acerto, 'dias', a.acerto - hoje, 'vencida', coalesce(a.acerto < hoje, false),
      'pecas', (SELECT coalesce(sum(b.qty_accepted), 0) FROM kit_balances b WHERE b.cycle_id = c.id),
      'valor_cents', c.reference_total_cents,
      'pre_baixa', CASE WHEN pb.id IS NULL THEN 'sem_pre_baixa' ELSE public.pre_baixa_situacao(pb) END,
      'origem', pb.origem, 'installment_id', pb.installment_id,
      'saldo_cents', CASE WHEN pb.installment_id IS NULL THEN NULL ELSE greatest(public.fin_installment_saldo(pb.installment_id), 0) END,
      'valor_pagar_cents', CASE WHEN pb.id IS NULL THEN NULL WHEN pb.status = 'aberta' THEN (public.pre_baixa_calculo(pb.id)->>'valor_pagar_cents')::bigint ELSE pb.valor_pagar_cents END) x
      FROM kit_cycles c JOIN consultant_profiles cp ON cp.party_id = c.consultora_party_id AND cp.representative_party_id = _rep
      JOIN kits k ON k.id = c.kit_id JOIN parties p ON p.id = c.consultora_party_id
      LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN kit_pre_baixas pb ON pb.cycle_id = c.id
      CROSS JOIN LATERAL (SELECT coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto) AS acerto) a
     WHERE c.status IN ('recebida', 'operacao', 'acerto')
    UNION ALL
    SELECT jsonb_build_object('id', 'sd:' || m.remessa || ':' || m.codcli || ':' || m.kit, 'fonte', 'smalldata', 'cycle_id', NULL,
      'maleta', 'Kit ' || m.kit, 'remessa', m.remessa, 'party_id', cp.party_id, 'consultora', p.display_name,
      'status', 'na_rua', 'acerto', lr.vencimento, 'dias', lr.vencimento - hoje, 'vencida', coalesce(lr.vencimento < hoje, false),
      'pecas', m.pecas_enviadas, 'valor_cents', m.valor_enviado_cents, 'pre_baixa', 'smalldata',
      'origem', NULL, 'installment_id', NULL, 'saldo_cents', NULL, 'valor_pagar_cents', NULL) x
      FROM consultant_profiles cp JOIN parties p ON p.id = cp.party_id
      CROSS JOIN LATERAL unnest(public.legado_codigos_da_pessoa(cp.party_id)) cod(codcli)
      JOIN legado_maletas m ON m.codcli = cod.codcli
      LEFT JOIN legado_remessas lr ON lr.numero = m.remessa
     WHERE cp.representative_party_id = _rep AND m.tipo = 'remessa'
       AND m.fechamento IS NULL AND m.fechamento_smalldata IS NULL
       AND public.legado_maleta_na_rua(m.remessa, m.codcli)) s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.rep_maletas_carteira(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_maletas_carteira(uuid) TO authenticated, service_role;

DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.preco_reajuste_previa()'::regprocedure);
  IF position('nullif(pr.internal_code, '''')' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def, $a$coalesce(nullif(v.sku, ''), pr.internal_code)$a$, $b$coalesce(nullif(v.sku, ''), nullif(pr.internal_code, ''), nullif(v.barcode, ''))$b$);
  IF novo = def THEN RAISE EXCEPTION 'preco_reajuste_previa não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $patch$;