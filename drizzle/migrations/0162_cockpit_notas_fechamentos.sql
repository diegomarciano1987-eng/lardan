-- 0161 — Cockpit da consultora: notas fiscais e fechamentos (somente leitura).
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
          'situacao', CASE WHEN fd.cancelled_at IS NOT NULL THEN 'cancelada' ELSE fd.status END, 'valor_cents', fd.total_cents,
          'pecas', (SELECT sum(fi.quantity) FROM fiscal_document_items fi WHERE fi.document_id = fd.id),
          'remessa', (SELECT r.numero FROM kit_cycles c JOIN remessas r ON r.id = c.remessa_id WHERE c.id = fd.cycle_id),
          'maleta', (SELECT k.code FROM kit_cycles c JOIN kits k ON k.id = c.kit_id WHERE c.id = fd.cycle_id),
          'chave', fd.access_key, 'simulada', coalesce(fd.simulado, false)) n
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
          'vendido_cents', coalesce(pb.vendido_final_cents, pb.total_vendido_cents, ka.total_vendido_cents),
          'acerto_divergente', pb.status = 'pendencia', 'sem_cobranca', false,
          'cobranca', CASE WHEN pb.id IS NOT NULL THEN jsonb_build_object('data', (pb.fechada_em AT TIME ZONE 'America/Sao_Paulo')::date,
                        'venda_bruta_cents', coalesce(pb.vendido_final_cents, pb.total_vendido_cents), 'comissao_cents', pb.comissao_cents,
                        'venda_liquida_cents', coalesce(pb.valor_final_cents, pb.valor_pagar_cents),
                        'pago_cents', CASE WHEN pb.installment_id IS NULL THEN NULL
                                           ELSE (SELECT coalesce(sum(a.valor_cents), 0) FROM financial_allocations a WHERE a.installment_id = pb.installment_id) END,
                        'origem', pb.origem)
                      WHEN ka.id IS NOT NULL THEN jsonb_build_object('data', (ka.approved_at AT TIME ZONE 'America/Sao_Paulo')::date,
                        'venda_bruta_cents', ka.total_vendido_cents, 'venda_liquida_cents', ka.total_devido_cents) END,
          'notas', coalesce((SELECT jsonb_object_agg(fd.kind, fd.number) FROM fiscal_documents fd WHERE fd.cycle_id = kc.id AND fd.number IS NOT NULL), '{}'::jsonb)) f
          FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id LEFT JOIN remessas r ON r.id = kc.remessa_id
          LEFT JOIN kit_pre_baixas pb ON pb.cycle_id = kc.id
          LEFT JOIN LATERAL (SELECT * FROM kit_acertos a WHERE a.cycle_id = kc.id ORDER BY a.revision DESC LIMIT 1) ka ON true
          CROSS JOIN LATERAL (SELECT coalesce(sum(qty_accepted), 0) aceitas, coalesce(sum(qty_returned), 0) devolvidas, coalesce(sum(qty_sold), 0) vendidas
                                FROM kit_balances WHERE cycle_id = kc.id) b
         WHERE kc.consultora_party_id = _party AND kc.status NOT IN ('rascunho', 'montagem', 'cancelada')
      ) s), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.consultora_notas_e_fechamentos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_notas_e_fechamentos(uuid) TO authenticated, service_role;