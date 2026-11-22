CREATE OR REPLACE FUNCTION public.fin_mesa_por_documento(_line uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  l financial_statement_lines%rowtype; v_doc text; v_tipo text; v_ids uuid[]; v_party uuid;
  v_valor bigint; v_resto bigint; v_parcelas jsonb := '[]'::jsonb; v_total bigint := 0; v_dist bigint := 0;
  r record; v_aloc bigint; v_nomes jsonb; v_jud boolean;
BEGIN
  IF NOT has_capability(auth.uid(), 'finance.statement.view') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO l FROM financial_statement_lines WHERE id = _line;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Linha não encontrada'; END IF;
  -- só recebimentos de banco (Pix do Asaas seguem pela própria cobrança)
  IF l.kind <> 'entrada' OR coalesce(l.raw->>'paymentId', '') ~ '^pay_' THEN
    RETURN jsonb_build_object('situacao', 'nao_se_aplica');
  END IF;
  -- documento no fim do histórico: "PIX RECEBIDO     04256874909" (CPF 11 / CNPJ 14 dígitos)
  v_doc := substring(coalesce(l.historico, '') FROM '(?:^|\D)(\d{14}|\d{11})\s*$');
  IF v_doc IS NULL THEN RETURN jsonb_build_object('situacao', 'sem_documento'); END IF;
  v_tipo := CASE WHEN length(v_doc) = 11 THEN 'cpf' ELSE 'cnpj' END;

  SELECT array_agg(p.id ORDER BY p.created_at) INTO v_ids FROM parties p
   WHERE p.doc_digits = v_doc
     AND NOT EXISTS (SELECT 1 FROM party_unificacoes u WHERE u.duplicada_id = p.id);
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('situacao', 'sem_cadastro', 'tipo', v_tipo, 'documento', public.fin_doc_mascarar(v_doc));
  END IF;
  IF array_length(v_ids, 1) > 1 THEN
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', coalesce(p.display_name, p.legal_name), 'code', p.code))
      INTO v_nomes FROM parties p WHERE p.id = ANY (v_ids);
    RETURN jsonb_build_object('situacao', 'varios_cadastros', 'tipo', v_tipo, 'documento', public.fin_doc_mascarar(v_doc), 'cadastros', v_nomes);
  END IF;
  v_party := v_ids[1];
  v_jud := EXISTS (SELECT 1 FROM cob_judicial j WHERE j.party_id = v_party);
  v_valor := greatest(coalesce(l.valor_cents, 0) - coalesce(l.conciliado_cents, 0), 0);
  v_resto := v_valor;

  FOR r IN
    SELECT i.id, i.vencimento, i.numero, t.descricao, t.numero AS tnum,
           (SELECT count(*) FROM financial_installments x WHERE x.title_id = t.id) AS total_parc,
           public.fin_installment_saldo(i.id) AS saldo,
           EXISTS (SELECT 1 FROM asaas_charge_intents x WHERE x.acordo_simulacao_id IS NOT NULL
                    AND x.installment_id = i.id AND x.state IN ('criada', 'conciliacao')) AS em_acordo
      FROM financial_titles t
      JOIN financial_installments i ON i.title_id = t.id
     WHERE t.party_id = ANY (public.party_e_unificadas(v_party))
       AND t.direction = 'receivable' AND t.status IN ('ativo', 'aprovado')
       AND t.approval_status IN ('nao_exigida', 'aprovada')
       AND i.settlement_status IN ('nao_liquidado', 'parcial')
     ORDER BY i.vencimento, t.created_at, i.numero
  LOOP
    CONTINUE WHEN r.saldo <= 0;
    v_aloc := CASE WHEN r.em_acordo THEN 0 ELSE least(r.saldo, v_resto) END;
    v_resto := v_resto - v_aloc;
    IF NOT r.em_acordo THEN v_total := v_total + r.saldo; END IF;
    v_dist := v_dist + v_aloc;
    v_parcelas := v_parcelas || jsonb_build_object(
      'installment_id', r.id, 'vencimento', r.vencimento,
      'titulo', r.descricao || CASE WHEN r.total_parc > 1 THEN ' (' || r.numero || '/' || r.total_parc || ')' ELSE '' END,
      'titulo_numero', r.tnum, 'aberto_cents', r.saldo, 'aloc_cents', v_aloc, 'em_acordo', r.em_acordo,
      'parcial', v_aloc > 0 AND v_aloc < r.saldo);
  END LOOP;

  RETURN jsonb_build_object(
    'situacao', CASE WHEN v_total = 0 THEN 'sem_aberto' ELSE 'ok' END,
    'tipo', v_tipo, 'documento', public.fin_doc_mascarar(v_doc),
    'party_id', v_party, 'party_nome', (SELECT coalesce(display_name, legal_name) FROM parties WHERE id = v_party),
    'party_code', (SELECT code FROM parties WHERE id = v_party),
    'judicial', v_jud,
    'valor_linha_cents', v_valor, 'total_aberto_cents', v_total,
    'distribuido_cents', v_dist, 'sobra_cents', v_valor - v_dist,
    'parcelas', v_parcelas);
END $$;

CREATE OR REPLACE FUNCTION public.fin_doc_mascarar(_d text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN length(_d) = 11 THEN substr(_d, 1, 3) || '.***.***-' || substr(_d, 10, 2)
              WHEN length(_d) = 14 THEN substr(_d, 1, 2) || '.***.***/****-' || substr(_d, 13, 2)
              ELSE NULL END
$$;

REVOKE ALL ON FUNCTION public.fin_mesa_por_documento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_mesa_por_documento(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fin_doc_mascarar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_doc_mascarar(text) TO authenticated, service_role;