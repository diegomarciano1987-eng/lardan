-- 0160 — app do representante (conteúdo do pacote lardan-0160).

CREATE OR REPLACE FUNCTION public.rep_dono_da_consultora(_party uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT representative_party_id FROM consultant_profiles WHERE party_id = _party
$$;
REVOKE ALL ON FUNCTION public.rep_dono_da_consultora(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.party_divida_aberta(_party uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(greatest(public.fin_installment_saldo(i.id), 0)), 0)::bigint
    FROM financial_titles t JOIN financial_installments i ON i.title_id = t.id
   WHERE t.direction = 'receivable' AND t.status NOT IN ('cancelado', 'rascunho')
     AND coalesce(t.pagador_party_id, t.party_id) = _party
$$;
REVOKE ALL ON FUNCTION public.party_divida_aberta(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_cobrancas_lista(_rep uuid, _faixa text DEFAULT 'vencidas', _ordem text DEFAULT 'recentes',
  _pagina integer DEFAULT 1, _busca text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; termo text := nullif(btrim(coalesce(_busca, '')), ''); r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  WITH ab AS (
    SELECT a.installment_id, a.party_id, a.vencimento, a.saldo_cents, a.numero, hoje - a.vencimento AS atraso
      FROM public.rep_portal_abertos(_rep) a),
  div AS (SELECT party_id, sum(saldo_cents) divida, coalesce(sum(saldo_cents) FILTER (WHERE atraso > 0), 0) vencida, max(atraso) maior_atraso FROM ab GROUP BY party_id),
  achados AS (
    SELECT ab.*, p.display_name, p.code, d.divida, d.vencida, d.maior_atraso
      FROM ab JOIN parties p ON p.id = ab.party_id JOIN div d ON d.party_id = ab.party_id
     WHERE termo IS NULL OR (SELECT bool_and(public.fin_unaccent_lower(p.display_name || ' ' || coalesce(p.code, '') || ' ' || coalesce(ab.numero, '')) LIKE '%' || w || '%')
                              FROM unnest(string_to_array(public.fin_unaccent_lower(termo), ' ')) w WHERE w <> '')),
  base AS (
    SELECT * FROM achados WHERE CASE coalesce(_faixa, 'vencidas')
      WHEN 'todas' THEN true WHEN 'vencidas' THEN atraso > 0 WHEN 'hoje' THEN atraso = 0 WHEN 'a_vencer' THEN atraso < 0
      WHEN '1_30' THEN atraso BETWEEN 1 AND 30 WHEN '31_60' THEN atraso BETWEEN 31 AND 60 WHEN '61_90' THEN atraso BETWEEN 61 AND 90
      WHEN '90_mais' THEN atraso > 90 ELSE atraso > 0 END)
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'total_cents', (SELECT coalesce(sum(saldo_cents), 0) FROM base),
    'faixas', (SELECT jsonb_build_object(
        'vencidas', count(*) FILTER (WHERE atraso > 0), 'hoje', count(*) FILTER (WHERE atraso = 0), 'a_vencer', count(*) FILTER (WHERE atraso < 0),
        '1_30', count(*) FILTER (WHERE atraso BETWEEN 1 AND 30), '31_60', count(*) FILTER (WHERE atraso BETWEEN 31 AND 60),
        '61_90', count(*) FILTER (WHERE atraso BETWEEN 61 AND 90), '90_mais', count(*) FILTER (WHERE atraso > 90), 'todas', count(*)) FROM achados),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'installment_id', x.installment_id, 'numero', x.numero, 'vencimento', x.vencimento, 'saldo_cents', x.saldo_cents, 'atraso', x.atraso,
        'party_id', x.party_id, 'display_name', x.display_name, 'code', x.code, 'divida_cents', x.divida, 'vencido_cents', x.vencida,
        'ultimo_contato', (SELECT jsonb_build_object('em', ci.created_at, 'tipo', ci.tipo, 'resultado', ci.resultado, 'obs', left(ci.observacao, 140))
                             FROM cob_interacoes ci WHERE ci.party_id = x.party_id AND ci.tipo NOT IN ('correcao', 'etapa') ORDER BY ci.created_at DESC LIMIT 1),
        'promessa', (SELECT jsonb_build_object('valor_cents', pr.valor_cents, 'data', pr.data_prometida)
                       FROM cob_promessas pr WHERE pr.party_id = x.party_id AND pr.status = 'vigente' ORDER BY pr.data_prometida LIMIT 1))
        ORDER BY x.ord2 DESC, x.ord3 DESC, x.display_name)
      FROM (SELECT b.*,
              CASE WHEN _ordem = 'maior' THEN b.divida ELSE b.vencimento - DATE '2000-01-01' END ord2,
              CASE WHEN _ordem = 'maior' THEN b.vencimento - DATE '2000-01-01' ELSE b.saldo_cents END ord3
              FROM base b
             ORDER BY CASE WHEN _ordem = 'maior' THEN b.divida ELSE b.vencimento - DATE '2000-01-01' END DESC,
                      CASE WHEN _ordem = 'maior' THEN b.vencimento - DATE '2000-01-01' ELSE b.saldo_cents END DESC, b.display_name
             LIMIT 50 OFFSET (greatest(_pagina, 1) - 1) * 50) x), '[]'::jsonb)) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.rep_cobrancas_lista(uuid, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_cobrancas_lista(uuid, text, text, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_cob_registrar(_party uuid, _tipo text, _resultado text, _obs text, _parcelas uuid[] DEFAULT '{}'::uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dono uuid := public.rep_dono_da_consultora(_party); v uuid; fora int;
BEGIN
  IF dono IS NULL OR NOT public.rep_portal_pode(dono) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.' USING errcode = '42501'; END IF;
  IF _tipo NOT IN ('ligacao', 'whatsapp_aberto', 'anotacao', 'negociacao') THEN RAISE EXCEPTION 'Tipo de contato inválido.'; END IF;
  IF _resultado IS NOT NULL AND _resultado NOT IN ('sucesso', 'sem_sucesso', 'nao_atendeu', 'recado', 'outro') THEN RAISE EXCEPTION 'Resultado inválido.'; END IF;
  SELECT count(*) INTO fora FROM unnest(coalesce(_parcelas, '{}')) x
   WHERE NOT EXISTS (SELECT 1 FROM financial_installments i JOIN financial_titles t ON t.id = i.title_id WHERE i.id = x AND t.party_id = _party);
  IF fora > 0 THEN RAISE EXCEPTION 'Parcela de outra pessoa.'; END IF;
  INSERT INTO cob_interacoes (party_id, tipo, resultado, observacao, installment_ids, autor_id)
  VALUES (_party, _tipo, _resultado, left(coalesce(_obs, ''), 2000), coalesce(_parcelas, '{}'), auth.uid()) RETURNING id INTO v;
  INSERT INTO cob_casos (party_id, etapa, updated_by) VALUES (_party, 'em_contato', auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET updated_at = now(), updated_by = auth.uid(),
    etapa = CASE WHEN cob_casos.etapa = 'novo_atraso' THEN 'em_contato' ELSE cob_casos.etapa END;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.rep_cob_registrar(uuid, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_cob_registrar(uuid, text, text, text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_cob_promessa(_party uuid, _valor bigint, _data date, _parcelas uuid[], _obs text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dono uuid := public.rep_dono_da_consultora(_party); v uuid; s bigint; n int; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF dono IS NULL OR NOT public.rep_portal_pode(dono) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.' USING errcode = '42501'; END IF;
  IF coalesce(cardinality(_parcelas), 0) = 0 THEN RAISE EXCEPTION 'Escolha a parcela da promessa.'; END IF;
  IF _data IS NULL OR _data < hoje OR _data > hoje + 60 THEN RAISE EXCEPTION 'A data da promessa deve ser entre hoje e os próximos 60 dias.'; END IF;
  SELECT count(*), sum(public.fin_installment_saldo(i.id)) INTO n, s FROM financial_installments i JOIN financial_titles t ON t.id = i.title_id
   WHERE i.id = ANY (_parcelas) AND t.party_id = _party AND t.direction = 'receivable' AND t.status = 'ativo' AND public.fin_installment_saldo(i.id) > 0;
  IF n <> cardinality(_parcelas) THEN RAISE EXCEPTION 'Parcela inválida ou já quitada.'; END IF;
  IF coalesce(_valor, 0) <= 0 OR _valor > s THEN RAISE EXCEPTION 'A promessa vai de R$ 0,01 até o saldo das parcelas (%).', replace(to_char(s / 100.0, 'FM999999990.00'), '.', ','); END IF;
  IF EXISTS (SELECT 1 FROM cob_promessas WHERE status = 'vigente' AND installment_ids && _parcelas) THEN RAISE EXCEPTION 'Já existe promessa vigente para esta parcela.'; END IF;
  INSERT INTO cob_promessas (party_id, valor_cents, data_prometida, installment_ids, saldo_inicial_cents, observacao, responsavel_id, autor_id)
  VALUES (_party, _valor, _data, _parcelas, s, _obs, auth.uid(), auth.uid()) RETURNING id INTO v;
  INSERT INTO cob_casos (party_id, etapa, pausa_ate, pausa_motivo, updated_by) VALUES (_party, 'promessa', _data, 'Promessa de pagamento', auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET etapa = 'promessa', pausa_ate = _data, pausa_motivo = 'Promessa de pagamento', updated_at = now(), updated_by = auth.uid();
  INSERT INTO cob_interacoes (party_id, tipo, resultado, observacao, installment_ids, autor_id)
  VALUES (_party, 'negociacao', 'sucesso', 'Promessa de ' || replace(to_char(_valor / 100.0, 'FM999999990.00'), '.', ',') || ' para ' || to_char(_data, 'DD/MM/YYYY')
          || ' (representante)' || coalesce(' — ' || nullif(btrim(_obs), ''), ''), _parcelas, auth.uid());
  INSERT INTO cob_tarefas (party_id, titulo, vence_em, autor_id, responsavel_id, installment_ids)
  VALUES (_party, 'Conferir promessa · ' || replace(to_char(_valor / 100.0, 'FM999999990.00'), '.', ','), _data, auth.uid(), auth.uid(), _parcelas);
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.rep_cob_promessa(uuid, bigint, date, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_cob_promessa(uuid, bigint, date, uuid[], text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_cob_historico(_party uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE dono uuid := public.rep_dono_da_consultora(_party);
BEGIN
  IF dono IS NULL OR NOT public.rep_portal_pode(dono) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'interacoes', coalesce((SELECT jsonb_agg(x ORDER BY x->>'em' DESC) FROM (
        SELECT jsonb_build_object('em', ci.created_at, 'tipo', ci.tipo, 'resultado', ci.resultado, 'obs', ci.observacao,
               'autor', coalesce(nullif(pf.display_name, ''), nullif(pf.full_name, ''), 'Lardan')) x
          FROM cob_interacoes ci LEFT JOIN profiles pf ON pf.id = ci.autor_id
         WHERE ci.party_id = _party AND ci.tipo <> 'correcao' ORDER BY ci.created_at DESC LIMIT 40) s), '[]'::jsonb),
    'promessas', coalesce((SELECT jsonb_agg(jsonb_build_object('valor_cents', pr.valor_cents, 'data', pr.data_prometida, 'status', pr.status) ORDER BY pr.created_at DESC)
                  FROM (SELECT * FROM cob_promessas WHERE party_id = _party ORDER BY created_at DESC LIMIT 10) pr), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.rep_cob_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_cob_historico(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.rep_reativacao_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  rep_party_id uuid REFERENCES public.parties(id),
  pedido_por uuid NOT NULL,
  motivo text,
  divida_cents bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'recusado')),
  decidido_por uuid,
  decidido_em timestamptz,
  decisao_motivo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rep_reativacao_pedidos_pendente_uq ON public.rep_reativacao_pedidos (party_id) WHERE status = 'pendente';

CREATE OR REPLACE FUNCTION public.rep_reativar_checado(_party uuid, _actor uuid, _motivo text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id = _party AND status::text = 'inativo') THEN RETURN public.rep_reativar_interno(_party, _actor, _motivo); END IF;
  d := public.party_divida_aberta(_party);
  IF d > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (_actor, 'consultora.reativacao_bloqueada_divida', 'parties', _party::text, jsonb_build_object('motivo', _motivo, 'divida_cents', d));
    RETURN false;
  END IF;
  RETURN public.rep_reativar_interno(_party, _actor, _motivo);
END $$;
REVOKE ALL ON FUNCTION public.rep_reativar_checado(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE f text; def text; novo text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.rep_cheque_registrar(jsonb)', 'public.rep_asaas_preparar(uuid,uuid,jsonb)'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    IF position('rep_reativar_checado' IN def) > 0 THEN CONTINUE; END IF;
    novo := replace(def, 'public.rep_reativar_interno(', 'public.rep_reativar_checado(');
    IF novo = def THEN RAISE EXCEPTION '% não tem o formato esperado.', f; END IF;
    EXECUTE novo;
  END LOOP;
END $patch$;

CREATE OR REPLACE FUNCTION public.rep_consultora_reativar(_party uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.rep_dono_da_consultora(_party);
BEGIN
  IF eu IS NULL OR NOT public.rep_portal_pode(eu) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.'; END IF;
  RETURN public.rep_reativar_checado(_party, auth.uid(), 'reativada pelo representante');
END $$;
REVOKE ALL ON FUNCTION public.rep_consultora_reativar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_consultora_reativar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_consultora_reativar_pedir(_party uuid, _motivo text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.rep_dono_da_consultora(_party); st text; d bigint;
BEGIN
  IF eu IS NULL OR NOT public.rep_portal_pode(eu) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.' USING errcode = '42501'; END IF;
  SELECT status::text INTO st FROM parties WHERE id = _party;
  IF st = 'ativo' THEN RETURN jsonb_build_object('resultado', 'ja_ativa'); END IF;
  IF st IN ('bloqueado', 'desligado') THEN RETURN jsonb_build_object('resultado', 'bloqueada'); END IF;
  d := public.party_divida_aberta(_party);
  IF d = 0 THEN
    PERFORM public.rep_reativar_interno(_party, auth.uid(), coalesce(nullif(btrim(_motivo), ''), 'reativada pelo representante (sem dívida)'));
    RETURN jsonb_build_object('resultado', 'reativada');
  END IF;
  IF EXISTS (SELECT 1 FROM rep_reativacao_pedidos WHERE party_id = _party AND status = 'pendente') THEN
    RETURN jsonb_build_object('resultado', 'ja_pedido', 'divida_cents', d);
  END IF;
  INSERT INTO rep_reativacao_pedidos (party_id, rep_party_id, pedido_por, motivo, divida_cents) VALUES (_party, eu, auth.uid(), nullif(btrim(_motivo), ''), d);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'consultora.reativacao_pedida', 'parties', _party::text, jsonb_build_object('divida_cents', d, 'motivo', _motivo, 'carteira', eu));
  RETURN jsonb_build_object('resultado', 'pedido_enviado', 'divida_cents', d);
END $$;
REVOKE ALL ON FUNCTION public.rep_consultora_reativar_pedir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_consultora_reativar_pedir(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_reativacoes_pendentes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['master', 'diretoria', 'financeiro', 'cobranca']::public.app_role[]) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'party_id', r.party_id, 'consultora', p.display_name, 'code', p.code,
      'representante', rp.display_name, 'motivo', r.motivo, 'divida_cents', r.divida_cents, 'divida_hoje_cents', public.party_divida_aberta(r.party_id), 'em', r.created_at)
      ORDER BY r.created_at)
    FROM rep_reativacao_pedidos r JOIN parties p ON p.id = r.party_id LEFT JOIN parties rp ON rp.id = r.rep_party_id WHERE r.status = 'pendente'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.rep_reativacoes_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_reativacoes_pendentes() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_reativacao_decidir(_id uuid, _aprovar boolean, _motivo text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r rep_reativacao_pedidos;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master aprova reativação com dívida.' USING errcode = '42501'; END IF;
  SELECT * INTO r FROM rep_reativacao_pedidos WHERE id = _id AND status = 'pendente' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou já decidido.'; END IF;
  UPDATE rep_reativacao_pedidos SET status = CASE WHEN _aprovar THEN 'aprovado' ELSE 'recusado' END, decidido_por = auth.uid(), decidido_em = now(),
         decisao_motivo = nullif(btrim(_motivo), '') WHERE id = _id;
  IF _aprovar THEN PERFORM public.rep_reativar_interno(r.party_id, auth.uid(), 'reativação com dívida aprovada pelo Master' || coalesce(': ' || nullif(btrim(_motivo), ''), '')); END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'consultora.reativacao_' || CASE WHEN _aprovar THEN 'aprovada' ELSE 'recusada' END, 'parties', r.party_id::text,
          jsonb_build_object('pedido', _id, 'motivo', _motivo, 'divida_cents', public.party_divida_aberta(r.party_id)));
END $$;
REVOKE ALL ON FUNCTION public.rep_reativacao_decidir(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_reativacao_decidir(uuid, boolean, text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.rep_cobrancas_parciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_origem uuid NOT NULL REFERENCES public.financial_installments(id),
  installment_parcial uuid NOT NULL REFERENCES public.financial_installments(id),
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  chave uuid NOT NULL UNIQUE,
  criado_por uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rep_cobrancas_parciais_origem_idx ON public.rep_cobrancas_parciais (installment_origem);

CREATE OR REPLACE FUNCTION public.rep_cobranca_avulsa(_party uuid, _valor_cents bigint, _descricao text, _chave uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Toda cobrança nova precisa estar ligada a uma parcela em aberto. Escolha a parcela e digite o valor (até o saldo dela).';
END $$;
REVOKE ALL ON FUNCTION public.rep_cobranca_avulsa(uuid, bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_cobranca_avulsa(uuid, bigint, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_cobranca_parcial(_installment uuid, _valor_cents bigint, _chave uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dono uuid := public.rep_parcela_dono(_installment); uid uuid := auth.uid(); cfg consultora_cobranca_config; t financial_titles; saldo bigint; outras bigint;
  inst uuid; tid uuid; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF dono IS NULL OR NOT public.rep_portal_pode(dono) THEN RAISE EXCEPTION 'Parcela fora da sua carteira.' USING errcode = '42501'; END IF;
  IF _chave IS NULL THEN RAISE EXCEPTION 'Chave da cobrança ausente.'; END IF;
  SELECT installment_parcial INTO inst FROM rep_cobrancas_parciais WHERE chave = _chave;
  IF inst IS NOT NULL THEN RETURN inst; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rep-parcial:' || _installment, 0));
  saldo := public.fin_installment_saldo(_installment);
  SELECT coalesce(sum(greatest(public.fin_installment_saldo(installment_parcial), 0)), 0) INTO outras FROM rep_cobrancas_parciais WHERE installment_origem = _installment;
  IF coalesce(_valor_cents, 0) <= 0 THEN RAISE EXCEPTION 'Digite um valor maior que zero.'; END IF;
  IF _valor_cents > saldo - outras THEN
    RAISE EXCEPTION 'O valor passa do saldo da parcela: dá para cobrar até %.', replace(to_char(greatest(saldo - outras, 0) / 100.0, 'FM999999990.00'), '.', ',');
  END IF;
  IF _valor_cents = saldo AND outras = 0 THEN RETURN _installment; END IF;
  SELECT t2.* INTO t FROM financial_titles t2 JOIN financial_installments i ON i.title_id = t2.id WHERE i.id = _installment;
  SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
  IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'representante.cobranca_parcial', 'financial_installments', _installment::text, jsonb_build_object('valor_cents', _valor_cents, 'saldo_cents', saldo, 'carteira', dono, 'chave', _chave));
  PERFORM public.pdv_como(cfg.ator_user_id);
  tid := public.fin_title_create(jsonb_build_object('direction', 'receivable', 'business_entity_id', cfg.business_entity_id, 'party_id', t.party_id,
     'descricao', 'Pagamento parcial — ref. título ' || coalesce(t.numero, t.documento, left(t.id::text, 8)), 'documento', 'PARC-' || left(_chave::text, 8),
     'emissao', hoje, 'competencia', hoje, 'valor_cents', _valor_cents, 'financial_account_id', cfg.financial_account_id,
     'origem', 'representante', 'id_externo', 'rep-parcial:' || _chave, 'status', 'ativo',
     'parcelas', jsonb_build_array(jsonb_build_object('valor_cents', _valor_cents, 'vencimento', hoje))));
  SELECT id INTO inst FROM financial_installments WHERE title_id = tid ORDER BY numero LIMIT 1;
  INSERT INTO rep_cobrancas_parciais (installment_origem, installment_parcial, valor_cents, chave, criado_por) VALUES (_installment, inst, _valor_cents, _chave, uid);
  RETURN inst;
END $$;
REVOKE ALL ON FUNCTION public.rep_cobranca_parcial(uuid, bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_cobranca_parcial(uuid, bigint, uuid) TO authenticated, service_role;

DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.rep_portal_busca_todas(uuid,text,integer)'::regprocedure);
  IF position('A busca fica só na sua carteira' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def, $a$  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;$a$,
    $b$  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro','cobranca']::public.app_role[]) THEN
    RAISE EXCEPTION 'A busca fica só na sua carteira. Consultora de outra carteira: fale com a Lardan.' USING errcode = '42501';
  END IF;$b$);
  IF novo = def THEN RAISE EXCEPTION 'rep_portal_busca_todas não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $patch$;

CREATE SEQUENCE IF NOT EXISTS public.rep_recibos_numero_seq;
CREATE TABLE IF NOT EXISTS public.rep_recibos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint NOT NULL DEFAULT nextval('public.rep_recibos_numero_seq') UNIQUE,
  chave uuid NOT NULL UNIQUE,
  party_id uuid NOT NULL REFERENCES public.parties(id),
  rep_party_id uuid NOT NULL REFERENCES public.parties(id),
  installment_id uuid NOT NULL REFERENCES public.financial_installments(id),
  settlement_id uuid NOT NULL REFERENCES public.financial_settlements(id),
  financial_account_id uuid NOT NULL REFERENCES public.financial_accounts(id),
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  referente text,
  observacao text,
  recebido_por uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rep_recibos_rep_idx ON public.rep_recibos (rep_party_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.rep_conta_retido(_empresa uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('rep-conta-retido:' || coalesce(_empresa::text, '-'), 0));
  SELECT id INTO v FROM financial_accounts
   WHERE (nome = 'Retido Representante' OR nome LIKE 'Retido Representante — %') AND is_active AND excluida_em IS NULL
     AND (business_entity_id = _empresa OR business_entity_id IS NULL OR _empresa IS NULL)
   ORDER BY (business_entity_id IS NOT DISTINCT FROM _empresa) DESC, created_at LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  INSERT INTO financial_accounts (business_entity_id, nome, kind, notes)
  VALUES (_empresa, CASE WHEN EXISTS (SELECT 1 FROM financial_accounts WHERE nome = 'Retido Representante') THEN
                      'Retido Representante — ' || coalesce((SELECT coalesce(nullif(trade_name, ''), legal_name) FROM business_entities WHERE id = _empresa), left(_empresa::text, 8))
                    ELSE 'Retido Representante' END, 'caixa', 'Dinheiro recebido pelos representantes e ainda não repassado à Lardan (criada pela 0160).')
  RETURNING id INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.rep_conta_retido(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_recibo_json(_r rep_recibos) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('numero', _r.numero, 'em', _r.created_at, 'valor_cents', _r.valor_cents, 'referente', _r.referente,
    'consultora', (SELECT display_name FROM parties WHERE id = _r.party_id), 'code', (SELECT code FROM parties WHERE id = _r.party_id),
    'doc_masked', (SELECT CASE WHEN length(regexp_replace(coalesce(doc, ''), '\D', '', 'g')) = 11
                              THEN '***.' || substr(regexp_replace(doc, '\D', '', 'g'), 4, 3) || '.' || substr(regexp_replace(doc, '\D', '', 'g'), 7, 3) || '-**' END
                     FROM parties WHERE id = _r.party_id),
    'representante', (SELECT display_name FROM parties WHERE id = _r.rep_party_id),
    'saldo_restante_cents', greatest(public.fin_installment_saldo(_r.installment_id), 0), 'observacao', _r.observacao)
$$;
REVOKE ALL ON FUNCTION public.rep_recibo_json(rep_recibos) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_dinheiro_receber(_installment uuid, _valor_cents bigint, _chave uuid, _obs text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dono uuid := public.rep_parcela_dono(_installment); uid uuid := auth.uid(); cfg consultora_cobranca_config; r rep_recibos; saldo bigint;
  conta uuid; s jsonb; t financial_titles; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; num bigint;
BEGIN
  IF dono IS NULL OR NOT public.rep_portal_pode(dono) THEN RAISE EXCEPTION 'Parcela fora da sua carteira.' USING errcode = '42501'; END IF;
  IF _chave IS NULL THEN RAISE EXCEPTION 'Chave do recibo ausente.'; END IF;
  SELECT * INTO r FROM rep_recibos WHERE chave = _chave;
  IF FOUND THEN RETURN public.rep_recibo_json(r) || jsonb_build_object('repetido', true); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rep-dinheiro:' || _installment, 0));
  saldo := public.fin_installment_saldo(_installment);
  IF coalesce(_valor_cents, 0) <= 0 THEN RAISE EXCEPTION 'Digite o valor recebido.'; END IF;
  IF _valor_cents > saldo THEN RAISE EXCEPTION 'O valor passa do saldo da parcela (%).', replace(to_char(saldo / 100.0, 'FM999999990.00'), '.', ','); END IF;
  SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
  IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
  IF NOT public.asaas_ator_pode(cfg.ator_user_id, 'finance.settlement.create') THEN
    RAISE EXCEPTION 'O usuário técnico da cobrança Lardan precisa da permissão de baixa. Avise o financeiro.';
  END IF;
  SELECT t2.* INTO t FROM financial_titles t2 JOIN financial_installments i ON i.title_id = t2.id WHERE i.id = _installment;
  conta := public.rep_conta_retido(t.business_entity_id);
  num := nextval('public.rep_recibos_numero_seq');
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'representante.dinheiro_recebido', 'financial_installments', _installment::text,
          jsonb_build_object('valor_cents', _valor_cents, 'recibo', num, 'carteira', dono, 'conta', conta));
  PERFORM public.pdv_como(cfg.ator_user_id);
  s := public.fin_settlement_create(jsonb_build_object('direction', 'receivable', 'financial_account_id', conta, 'data', hoje,
        'valor_cents', _valor_cents, 'referencia', 'RECIBO-REP-' || num,
        'observacao', 'Dinheiro recebido pelo representante (recibo ' || num || ')' || coalesce(' · ' || nullif(btrim(_obs), ''), ''),
        'idempotency_key', 'rep-dinheiro:' || _chave,
        'alocacoes', jsonb_build_array(jsonb_build_object('installment_id', _installment, 'valor_cents', _valor_cents))));
  INSERT INTO rep_recibos (numero, chave, party_id, rep_party_id, installment_id, settlement_id, financial_account_id, valor_cents, referente, observacao, recebido_por)
  VALUES (num, _chave, t.party_id, dono, _installment, (s->>'id')::uuid, conta, _valor_cents, t.descricao, nullif(btrim(_obs), ''), uid)
  RETURNING * INTO r;
  RETURN public.rep_recibo_json(r) || jsonb_build_object('repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.rep_dinheiro_receber(uuid, bigint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_dinheiro_receber(uuid, bigint, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_recibos_lista(_rep uuid, _dias integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'total_cents', (SELECT coalesce(sum(valor_cents), 0) FROM rep_recibos WHERE rep_party_id = _rep AND created_at > now() - make_interval(days => greatest(_dias, 1))),
    'itens', coalesce((SELECT jsonb_agg(public.rep_recibo_json(r) ORDER BY r.created_at DESC)
                         FROM (SELECT * FROM rep_recibos WHERE rep_party_id = _rep AND created_at > now() - make_interval(days => greatest(_dias, 1)) ORDER BY created_at DESC LIMIT 100) r), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.rep_recibos_lista(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_recibos_lista(uuid, integer) TO authenticated, service_role;

ALTER TABLE public.kit_pre_baixa_itens ADD COLUMN IF NOT EXISTS qtd_devolvida_campo integer;
ALTER TABLE public.kit_pre_baixas ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'app';
ALTER TABLE public.kit_pre_baixas ADD COLUMN IF NOT EXISTS campo_por uuid;
ALTER TABLE public.kit_pre_baixas ADD COLUMN IF NOT EXISTS campo_em timestamptz;

CREATE OR REPLACE FUNCTION public.pre_baixa_pode(_cycle uuid, _escrever boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM kit_cycles c WHERE c.id = _cycle AND c.consultora_party_id = public.my_party_id()
             AND public.has_role(auth.uid(), 'consultora'))
    OR public.has_capability(auth.uid(), 'kit.manage')
    OR EXISTS (SELECT 1 FROM kit_cycles c JOIN consultant_profiles cp ON cp.party_id = c.consultora_party_id
                WHERE c.id = _cycle AND cp.representative_party_id IS NOT NULL AND public.rep_portal_pode(cp.representative_party_id))
    OR (NOT _escrever AND (public.has_capability(auth.uid(), 'kit.view.all') OR public.cob_pode(auth.uid()))))
$$;
REVOKE ALL ON FUNCTION public.pre_baixa_pode(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_acerto_campo_devolucao(_cycle uuid, _leituras jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dono uuid; v uuid; it record; lida int; erro text; desconhecida text;
BEGIN
  SELECT cp.representative_party_id INTO dono FROM kit_cycles c JOIN consultant_profiles cp ON cp.party_id = c.consultora_party_id WHERE c.id = _cycle;
  IF dono IS NULL OR NOT public.rep_portal_pode(dono) THEN RAISE EXCEPTION 'Maleta fora da sua carteira.' USING errcode = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM kit_cycles WHERE id = _cycle AND status IN ('recebida', 'operacao', 'acerto')) THEN
    RAISE EXCEPTION 'Esta maleta não está com a consultora.';
  END IF;
  v := public.pre_baixa_abrir(_cycle);
  IF (SELECT status FROM kit_pre_baixas WHERE id = v) <> 'aberta' THEN RAISE EXCEPTION 'O acerto desta maleta já foi fechado.'; END IF;
  SELECT string_agg(x->>'variant_id', ', ') INTO desconhecida FROM jsonb_array_elements(coalesce(_leituras, '[]')) x
   WHERE NOT EXISTS (SELECT 1 FROM kit_pre_baixa_itens i WHERE i.pre_baixa_id = v AND i.variant_id::text = x->>'variant_id');
  IF desconhecida IS NOT NULL THEN RAISE EXCEPTION 'Peça que não é desta maleta: %.', desconhecida; END IF;
  FOR it IN SELECT i.*, coalesce(pr.name || coalesce(' ' || nullif(pv.label, ''), ''), i.variant_id::text) AS nome
              FROM kit_pre_baixa_itens i LEFT JOIN product_variants pv ON pv.id = i.variant_id LEFT JOIN products pr ON pr.id = pv.product_id
             WHERE i.pre_baixa_id = v FOR UPDATE OF i LOOP
    SELECT coalesce(sum((x->>'qtd')::int), 0) INTO lida FROM jsonb_array_elements(coalesce(_leituras, '[]')) x WHERE x->>'variant_id' = it.variant_id::text;
    IF lida > it.qtd_enviada THEN erro := format('%s: leu %s, mas foram %s.', it.nome, lida, it.qtd_enviada); EXIT; END IF;
    IF it.qtd_enviada - lida < it.qtd_app THEN
      erro := format('%s voltou, mas tem %s venda(s) paga(s) pelo app. Confira com a consultora antes de fechar.', it.nome, it.qtd_app); EXIT;
    END IF;
    UPDATE kit_pre_baixa_itens SET qtd_vendida = it.qtd_enviada - lida, qtd_devolvida_campo = lida WHERE pre_baixa_id = v AND variant_id = it.variant_id;
  END LOOP;
  IF erro IS NOT NULL THEN RAISE EXCEPTION '%', erro; END IF;
  UPDATE kit_pre_baixas SET origem = 'campo', campo_por = auth.uid(), campo_em = now(), updated_at = now() WHERE id = v;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'pre_baixa.campo_devolucao', 'kit_pre_baixas', v::text, jsonb_build_object('leituras', _leituras, 'carteira', dono));
  RETURN public.pre_baixa_calculo(v);
END $$;
REVOKE ALL ON FUNCTION public.rep_acerto_campo_devolucao(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_acerto_campo_devolucao(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_maletas_carteira(_rep uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'vencida')::boolean DESC, x->>'acerto' NULLS LAST, x->>'consultora') FROM (
    SELECT jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'party_id', c.consultora_party_id, 'consultora', p.display_name,
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
     WHERE c.status IN ('recebida', 'operacao', 'acerto')) s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.rep_maletas_carteira(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_maletas_carteira(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.rep_visitas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_party_id uuid NOT NULL REFERENCES public.parties(id),
  party_id uuid REFERENCES public.parties(id),
  lead_id uuid REFERENCES public.leads(id),
  quando timestamptz NOT NULL,
  motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 2 AND 200),
  status text NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada', 'realizada', 'nao_encontrada', 'cancelada')),
  resultado text,
  registrada_em timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (party_id IS NOT NULL OR lead_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS rep_visitas_rep_quando_idx ON public.rep_visitas (rep_party_id, quando);

CREATE OR REPLACE FUNCTION public.rep_visita_agendar(_rep uuid, _party uuid, _lead uuid, _quando timestamptz, _motivo text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  IF _party IS NULL AND _lead IS NULL THEN RAISE EXCEPTION 'Escolha a consultora ou a candidata.'; END IF;
  IF _party IS NOT NULL AND public.rep_dono_da_consultora(_party) IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Consultora fora da sua carteira.'; END IF;
  IF _lead IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads WHERE id = _lead AND representante_party_id = _rep) THEN RAISE EXCEPTION 'Candidata fora do seu funil.'; END IF;
  IF _quando IS NULL OR _quando < now() - interval '1 day' THEN RAISE EXCEPTION 'Escolha a data da visita.'; END IF;
  INSERT INTO rep_visitas (rep_party_id, party_id, lead_id, quando, motivo, created_by) VALUES (_rep, _party, _lead, _quando, btrim(_motivo), auth.uid()) RETURNING id INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.rep_visita_agendar(uuid, uuid, uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_visita_agendar(uuid, uuid, uuid, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_visita_registrar(_id uuid, _status text, _resultado text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v rep_visitas;
BEGIN
  SELECT * INTO v FROM rep_visitas WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.rep_portal_pode(v.rep_party_id) THEN RAISE EXCEPTION 'Visita não encontrada.' USING errcode = '42501'; END IF;
  IF _status NOT IN ('realizada', 'nao_encontrada', 'cancelada') THEN RAISE EXCEPTION 'Situação inválida.'; END IF;
  IF _status <> 'cancelada' AND length(btrim(coalesce(_resultado, ''))) < 3 THEN RAISE EXCEPTION 'Conte em poucas palavras como foi a visita.'; END IF;
  UPDATE rep_visitas SET status = _status, resultado = nullif(btrim(_resultado), ''), registrada_em = now() WHERE id = _id;
  IF v.party_id IS NOT NULL AND _status <> 'cancelada' THEN
    INSERT INTO cob_interacoes (party_id, tipo, resultado, observacao, autor_id)
    VALUES (v.party_id, 'anotacao', CASE WHEN _status = 'realizada' THEN 'sucesso' ELSE 'nao_atendeu' END,
            'Visita do representante (' || v.motivo || '): ' || CASE WHEN _status = 'nao_encontrada' THEN 'não encontrada. ' ELSE '' END || btrim(_resultado), auth.uid());
  END IF;
  IF v.lead_id IS NOT NULL AND _status <> 'cancelada' THEN
    UPDATE rep_crm_cards SET nota = left('Visita ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM') || ': ' || btrim(_resultado), 280), updated_at = now() WHERE lead_id = v.lead_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.rep_visita_registrar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_visita_registrar(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_agenda(_rep uuid, _de date DEFAULT NULL, _ate date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'quando', v.quando, 'motivo', v.motivo, 'status', v.status, 'resultado', v.resultado,
      'party_id', v.party_id, 'lead_id', v.lead_id, 'nome', coalesce(p.display_name, l.full_name), 'cidade', coalesce(l.city, NULL),
      'atrasada', v.status = 'agendada' AND (v.quando AT TIME ZONE 'America/Sao_Paulo')::date < hoje) ORDER BY v.quando)
    FROM rep_visitas v LEFT JOIN parties p ON p.id = v.party_id LEFT JOIN leads l ON l.id = v.lead_id
   WHERE v.rep_party_id = _rep
     AND ((v.quando AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN coalesce(_de, hoje - 30) AND coalesce(_ate, hoje + 60)
          OR (v.status = 'agendada' AND (v.quando AT TIME ZONE 'America/Sao_Paulo')::date < hoje))), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.rep_agenda(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_agenda(uuid, date, date) TO authenticated, service_role;

ALTER TABLE public.rep_crm_etapas ADD COLUMN IF NOT EXISTS sistema text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rep_crm_etapas_sistema_ck') THEN
    ALTER TABLE public.rep_crm_etapas ADD CONSTRAINT rep_crm_etapas_sistema_ck CHECK (sistema IS NULL OR sistema IN ('aprovada', 'primeira_maleta', 'nao_aprovada'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS rep_crm_etapas_sistema_uq ON public.rep_crm_etapas (rep_party_id, sistema) WHERE sistema IS NOT NULL;

CREATE OR REPLACE FUNCTION public.rep_crm_etapas_garantir(_rep uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rep_crm_etapas WHERE rep_party_id = _rep) THEN
    INSERT INTO rep_crm_etapas (rep_party_id, nome, ordem) VALUES
      (_rep, 'Novo contato', 1), (_rep, 'Conversando', 2), (_rep, 'Visita agendada', 3), (_rep, 'Aguardando Lardan', 4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema = 'primeira_maleta') THEN
    UPDATE rep_crm_etapas SET sistema = 'primeira_maleta', ordem = 60
     WHERE id = (SELECT id FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema IS NULL AND lower(btrim(nome)) = 'primeira maleta' ORDER BY ordem LIMIT 1);
    IF NOT FOUND THEN INSERT INTO rep_crm_etapas (rep_party_id, nome, ordem, sistema) VALUES (_rep, 'Primeira maleta', 60, 'primeira_maleta'); END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema = 'aprovada') THEN
    INSERT INTO rep_crm_etapas (rep_party_id, nome, ordem, sistema) VALUES (_rep, 'Aprovada pela Lardan', 50, 'aprovada');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema = 'nao_aprovada') THEN
    INSERT INTO rep_crm_etapas (rep_party_id, nome, ordem, sistema) VALUES (_rep, 'Não aprovada', 70, 'nao_aprovada');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.rep_crm_etapas_garantir(uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE r uuid;
BEGIN
  FOR r IN SELECT DISTINCT rep_party_id FROM public.rep_crm_etapas LOOP PERFORM public.rep_crm_etapas_garantir(r); END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.rep_crm_coluna_sistema(_l leads) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _l.party_id IS NOT NULL AND EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id = _l.party_id AND c.status NOT IN ('cancelada', 'rascunho')) THEN 'primeira_maleta'
    WHEN _l.status::text = 'aprovado' OR _l.outcome = 'ganha' OR _l.party_id IS NOT NULL THEN 'aprovada'
    WHEN _l.status::text = 'recusado' OR _l.outcome = 'perdida' THEN 'nao_aprovada'
    ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.rep_crm_coluna_sistema(leads) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_crm(_rep uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; primeira uuid;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  PERFORM public.rep_crm_etapas_garantir(_rep);
  SELECT id INTO primeira FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema IS NULL ORDER BY ordem LIMIT 1;
  SELECT jsonb_build_object(
    'codigo', (SELECT lower(code) FROM parties WHERE id = _rep),
    'etapas', (SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'sistema', sistema) ORDER BY ordem) FROM rep_crm_etapas WHERE rep_party_id = _rep),
    'cards', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'lead_id', l.id, 'protocolo', l.protocol, 'nome', l.full_name, 'whatsapp', l.whatsapp, 'cidade', l.city || '/' || l.uf,
        'status_lardan', l.status::text, 'origem', l.representante_origem, 'criado', l.created_at, 'nota', c.nota,
        'travado', s.col IS NOT NULL,
        'etapa_id', CASE WHEN s.col IS NOT NULL THEN (SELECT id FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema = s.col)
                         WHEN ce.sistema IS NULL AND ce.id IS NOT NULL THEN ce.id ELSE primeira END)
        ORDER BY l.created_at DESC)
      FROM leads l LEFT JOIN rep_crm_cards c ON c.lead_id = l.id LEFT JOIN rep_crm_etapas ce ON ce.id = c.etapa_id
      CROSS JOIN LATERAL (SELECT public.rep_crm_coluna_sistema(l) AS col) s
      WHERE l.representante_party_id = _rep AND l.status::text NOT IN ('arquivado')), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.rep_crm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_crm(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_crm_mover(_lead uuid, _etapa uuid, _nota text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid; l leads; sis text;
BEGIN
  SELECT * INTO l FROM leads WHERE id = _lead;
  eu := l.representante_party_id;
  IF eu IS NULL OR NOT public.rep_portal_pode(eu) THEN RAISE EXCEPTION 'Candidatura fora da sua carteira.'; END IF;
  SELECT sistema INTO sis FROM rep_crm_etapas WHERE id = _etapa AND rep_party_id = eu;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etapa inválida.'; END IF;
  IF sis IS NOT NULL THEN RAISE EXCEPTION 'Esta coluna muda sozinha quando a Lardan aprova, recusa ou manda a primeira maleta.'; END IF;
  IF public.rep_crm_coluna_sistema(l) IS NOT NULL THEN RAISE EXCEPTION 'Esta candidata já teve decisão da Lardan; a coluna dela acompanha a situação.'; END IF;
  INSERT INTO rep_crm_cards (lead_id, rep_party_id, etapa_id, nota) VALUES (_lead, eu, _etapa, nullif(btrim(_nota), ''))
  ON CONFLICT (lead_id) DO UPDATE SET etapa_id = EXCLUDED.etapa_id, nota = coalesce(EXCLUDED.nota, rep_crm_cards.nota), updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.rep_crm_mover(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_crm_mover(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_crm_etapa_nova(_rep uuid, _nome text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid; n int;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  PERFORM public.rep_crm_etapas_garantir(_rep);
  SELECT coalesce(max(ordem), 0) + 1 INTO n FROM rep_crm_etapas WHERE rep_party_id = _rep AND sistema IS NULL;
  IF n >= 50 THEN RAISE EXCEPTION 'Limite de etapas atingido.'; END IF;
  INSERT INTO rep_crm_etapas (rep_party_id, nome, ordem) VALUES (_rep, btrim(_nome), n) RETURNING id INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.rep_crm_etapa_nova(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_crm_etapa_nova(uuid, text) TO authenticated, service_role;

DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.rep_consultora_ficha_rep(uuid,uuid)'::regprocedure);
  IF position('DISTINCT ON (coalesce(cp.value_norm' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def,
    $a$coalesce((SELECT jsonb_agg(jsonb_build_object('kind',cp.kind::text,'value',cp.value)) FROM public.contact_points cp WHERE cp.party_id=p.id),'[]'::jsonb)$a$,
    $b$coalesce((SELECT jsonb_agg(jsonb_build_object('kind',x.kind::text,'value',x.value)) FROM (SELECT DISTINCT ON (coalesce(cp.value_norm, cp.value)) cp.kind, cp.value FROM public.contact_points cp WHERE cp.party_id=p.id ORDER BY coalesce(cp.value_norm, cp.value), (cp.kind = 'whatsapp') DESC, cp.is_primary DESC, cp.created_at) x),'[]'::jsonb)$b$);
  IF novo = def THEN RAISE EXCEPTION 'rep_consultora_ficha_rep não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $patch$;

CREATE TABLE IF NOT EXISTS public.contact_points_duplicados_log (
  id bigserial PRIMARY KEY,
  lote uuid NOT NULL,
  contato jsonb NOT NULL,
  mantido_id uuid NOT NULL,
  removido_por uuid NOT NULL,
  removido_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz
);
CREATE INDEX IF NOT EXISTS contact_points_duplicados_log_lote_idx ON public.contact_points_duplicados_log (lote);

CREATE OR REPLACE FUNCTION public.contatos_duplicados_previa() RETURNS TABLE (party_id uuid, nome text, numero text, manter_id uuid, manter_tipo text, remover_ids uuid[], remover_qtd int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.manage') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN QUERY
  WITH tel AS (
    SELECT cp.*, row_number() OVER (PARTITION BY cp.party_id, cp.value_norm ORDER BY (cp.kind = 'whatsapp') DESC, cp.is_primary DESC, cp.created_at, cp.id) rn
      FROM contact_points cp WHERE cp.kind <> 'email' AND cp.value_norm IS NOT NULL)
  SELECT k.party_id, p.display_name, k.value_norm, k.id, k.kind::text,
         array_agg(d.id ORDER BY d.created_at), count(d.id)::int
    FROM tel k JOIN tel d ON d.party_id = k.party_id AND d.value_norm = k.value_norm AND d.rn > 1
    JOIN parties p ON p.id = k.party_id
   WHERE k.rn = 1
   GROUP BY k.party_id, p.display_name, k.value_norm, k.id, k.kind;
END $$;
REVOKE ALL ON FUNCTION public.contatos_duplicados_previa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contatos_duplicados_previa() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contatos_duplicados_aplicar(_confirmacao text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lote uuid := gen_random_uuid(); n int := 0; pr record; rid uuid; virou_primario boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master aplica a limpeza.' USING errcode = '42501'; END IF;
  IF _confirmacao IS DISTINCT FROM 'REMOVER REPETIDOS' THEN RAISE EXCEPTION 'Digite REMOVER REPETIDOS para confirmar.'; END IF;
  FOR pr IN SELECT * FROM public.contatos_duplicados_previa() LOOP
    SELECT bool_or(is_primary) INTO virou_primario FROM contact_points WHERE id = ANY (pr.remover_ids);
    FOREACH rid IN ARRAY pr.remover_ids LOOP
      INSERT INTO contact_points_duplicados_log (lote, contato, mantido_id, removido_por)
      SELECT lote, to_jsonb(c), pr.manter_id, auth.uid() FROM contact_points c WHERE c.id = rid;
      DELETE FROM contact_points WHERE id = rid;
      n := n + 1;
    END LOOP;
    IF virou_primario THEN UPDATE contact_points SET is_primary = true WHERE id = pr.manter_id; END IF;
  END LOOP;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'contatos.duplicados_removidos', 'contact_points', lote::text, jsonb_build_object('removidos', n));
  RETURN jsonb_build_object('lote', lote, 'removidos', n);
END $$;
REVOKE ALL ON FUNCTION public.contatos_duplicados_aplicar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contatos_duplicados_aplicar(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contatos_duplicados_desfazer(_lote uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master desfaz.' USING errcode = '42501'; END IF;
  INSERT INTO contact_points (id, party_id, kind, label, value, value_norm, is_primary, created_at, updated_at)
  SELECT (l.contato->>'id')::uuid, (l.contato->>'party_id')::uuid, (l.contato->>'kind')::contact_kind, l.contato->>'label', l.contato->>'value',
         l.contato->>'value_norm', coalesce((l.contato->>'is_primary')::boolean, false), (l.contato->>'created_at')::timestamptz, now()
    FROM contact_points_duplicados_log l WHERE l.lote = _lote AND l.desfeito_em IS NULL
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE contact_points_duplicados_log SET desfeito_em = now() WHERE lote = _lote AND desfeito_em IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload) VALUES (auth.uid(), 'contatos.duplicados_desfeitos', 'contact_points', _lote::text, jsonb_build_object('restaurados', n));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.contatos_duplicados_desfazer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contatos_duplicados_desfazer(uuid) TO authenticated, service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rep_reativacao_pedidos', 'rep_cobrancas_parciais', 'rep_recibos', 'rep_visitas', 'contact_points_duplicados_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.rep_recibos_numero_seq FROM PUBLIC, anon, authenticated;