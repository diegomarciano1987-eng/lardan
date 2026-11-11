-- lovable-cron-fallback-reviewed: Diego pediu processar a fila de avisos do Asaas a cada poucos minutos; avisos de Pix chegam antes da cobrança espelhada e precisam de reprocessamento por tempo, a cada 10 minutos (144 execuções/dia), com chave geral para desligar.
-- ============ 0285 — Asaas automático ============
CREATE TABLE IF NOT EXISTS public.asaas_auto_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ligado boolean NOT NULL DEFAULT false,
  corte date NOT NULL DEFAULT DATE '2026-10-01',
  juros_max_cents bigint NOT NULL DEFAULT 5000 CHECK (juros_max_cents >= 0),
  juros_max_pct numeric NOT NULL DEFAULT 10 CHECK (juros_max_pct >= 0 AND juros_max_pct <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.asaas_auto_config TO authenticated;
GRANT ALL ON public.asaas_auto_config TO service_role;
ALTER TABLE public.asaas_auto_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY asaas_auto_config_ler ON public.asaas_auto_config FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.reconcile')));
INSERT INTO public.asaas_auto_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.asaas_auto_config IS '0285: chave geral do Asaas automático, data de corte e limite de juros automáticos (menor entre centavos e % do saldo).';

CREATE TABLE IF NOT EXISTS public.asaas_auto_decisoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.asaas_charges(id),
  acao text NOT NULL CHECK (acao IN ('baixa_titulo','baixa_com_juros','titulo_3_1_1','vinculo_ja_baixado','lancado_pela_mesa','excecao')),
  motivo text NOT NULL,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  party_id uuid, title_id uuid, installment_id uuid, settlement_id uuid,
  valor_cents bigint, juros_cents bigint NOT NULL DEFAULT 0,
  actor_id uuid,
  tentativas int NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz, desfeito_por uuid, desfeito_motivo text
);
CREATE UNIQUE INDEX IF NOT EXISTS asaas_auto_decisoes_charge_ativa_uq ON public.asaas_auto_decisoes (charge_id) WHERE desfeito_em IS NULL;
CREATE INDEX IF NOT EXISTS asaas_auto_decisoes_atualizado_idx ON public.asaas_auto_decisoes (atualizado_em DESC);
GRANT SELECT ON public.asaas_auto_decisoes TO authenticated;
GRANT ALL ON public.asaas_auto_decisoes TO service_role;
ALTER TABLE public.asaas_auto_decisoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY asaas_auto_decisoes_ler ON public.asaas_auto_decisoes FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.reconcile')));
COMMENT ON TABLE public.asaas_auto_decisoes IS '0285: o que o Asaas automático fez (ou deixou na exceção) por cobrança; uma decisão ativa por pay_, desfazer guarda o histórico.';

-- registro único da decisão (exceção pode ser reavaliada; ação executada é final até ser desfeita)
CREATE OR REPLACE FUNCTION public.asaas_auto_decidir(_charge uuid, _acao text, _motivo text, _detalhe jsonb,
  _party uuid, _title uuid, _inst uuid, _settlement uuid, _valor bigint, _juros bigint, _actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.asaas_auto_decisoes AS d (charge_id, acao, motivo, detalhe, party_id, title_id, installment_id,
         settlement_id, valor_cents, juros_cents, actor_id)
  VALUES (_charge, _acao, _motivo, coalesce(_detalhe, '{}'::jsonb), _party, _title, _inst, _settlement, _valor, coalesce(_juros, 0), _actor)
  ON CONFLICT (charge_id) WHERE desfeito_em IS NULL DO UPDATE
     SET acao = EXCLUDED.acao, motivo = EXCLUDED.motivo, detalhe = EXCLUDED.detalhe, party_id = EXCLUDED.party_id,
         title_id = EXCLUDED.title_id, installment_id = EXCLUDED.installment_id, settlement_id = EXCLUDED.settlement_id,
         valor_cents = EXCLUDED.valor_cents, juros_cents = EXCLUDED.juros_cents, actor_id = EXCLUDED.actor_id,
         tentativas = d.tentativas + 1, atualizado_em = now()
   WHERE d.acao = 'excecao'
  RETURNING id INTO v;
  IF _acao <> 'excecao' THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (_actor, 'asaas.auto.' || _acao, 'asaas_charges', _charge,
            jsonb_build_object('decisao', v, 'motivo', _motivo, 'title_id', _title, 'installment_id', _inst,
                               'settlement_id', _settlement, 'valor_cents', _valor, 'juros_cents', coalesce(_juros, 0)) || coalesce(_detalhe, '{}'::jsonb));
  END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_decidir(uuid,text,text,jsonb,uuid,uuid,uuid,uuid,bigint,bigint,uuid) FROM PUBLIC, anon, authenticated;

-- id_externo livre para o título preso ao pay_ (título cancelado antes não bloqueia: ganha sufixo)
CREATE OR REPLACE FUNCTION public.asaas_titulo_ext_livre(_external text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN n = 0 THEN 'asaas:' || _external ELSE 'asaas:' || _external || ':refeito:' || n END
    FROM (SELECT count(*)::int n FROM public.financial_titles
           WHERE sistema_origem = 'asaas' AND (id_externo = 'asaas:' || _external OR id_externo LIKE 'asaas:' || _external || ':refeito:%')) x
$$;
REVOKE ALL ON FUNCTION public.asaas_titulo_ext_livre(text) FROM PUBLIC, anon, authenticated;

-- núcleo: decide e executa para UMA cobrança recebida e sem vínculo
CREATE OR REPLACE FUNCTION public.asaas_auto_receber_nucleo(_charge uuid, _ator uuid, _manual boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; cfg record; d record; pid uuid; pessoas uuid[]; valor bigint; chave text; res jsonb; b jsonb;
  tit uuid; inst uuid; n int; nx int; nj int; conta uuid; ent uuid; ext text; dia date; regra jsonb; dec uuid;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO cfg FROM public.asaas_auto_config WHERE id;
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('acao','ignorado','motivo','cobranca_inexistente'); END IF;
  SELECT * INTO d FROM public.asaas_auto_decisoes WHERE charge_id = c.id AND desfeito_em IS NULL;
  IF d.id IS NOT NULL AND d.acao <> 'excecao' THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','ja_decidido','decisao',d.id);
  END IF;
  IF NOT _manual AND EXISTS (SELECT 1 FROM public.asaas_auto_decisoes WHERE charge_id = c.id AND desfeito_em IS NOT NULL) THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','desfeito_fica_manual');
  END IF;
  IF c.external_status <> 'RECEIVED' THEN RETURN jsonb_build_object('acao','ignorado','motivo','nao_recebida'); END IF;
  IF c.title_id IS NOT NULL OR c.installment_id IS NOT NULL THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','ja_vinculada');
  END IF;
  chave := 'asaas:baixa:' || c.account_id || ':' || c.external_id;
  IF EXISTS (SELECT 1 FROM public.financial_settlements
              WHERE idempotency_key = chave OR idempotency_key LIKE 'asaas:baixa:' || c.account_id || ':r%:' || c.external_id) THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','ja_tem_baixa');
  END IF;
  IF EXISTS (SELECT 1 FROM public.asaas_charge_intents WHERE acordo_simulacao_id IS NOT NULL
               AND (charge_id = c.id OR (account_id = c.account_id AND external_id = c.external_id))) THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','parcela_de_acordo');
  END IF;
  IF EXISTS (SELECT 1 FROM public.asaas_baixas_outra_forma WHERE charge_id = c.id) THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','pago_por_outra_forma');
  END IF;
  SELECT financial_account_id, owner_entity_id INTO conta, ent FROM public.asaas_accounts WHERE id = c.account_id;
  IF conta IS NULL THEN RETURN jsonb_build_object('acao','ignorado','motivo','conta_asaas_sem_conta_financeira'); END IF;
  -- um pay_ = um lançamento: a linha do extrato já foi conciliada à mão com outra conta
  IF EXISTS (SELECT 1 FROM public.financial_statement_lines l
              WHERE l.financial_account_id = conta AND l.kind = 'entrada' AND l.raw->>'paymentId' = c.external_id
                AND l.status IN ('conciliada','parcial')) THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','extrato_ja_conciliado');
  END IF;
  valor := coalesce(c.received_cents, c.value_cents);

  -- 0) já baixada pela importação (vínculo confirmado pelo nº da fatura): só liga, nenhum lançamento novo
  IF c.party_id IS NOT NULL THEN
    SELECT m.installment_id, i.title_id INTO inst, tit
      FROM public.asaas_charge_matches m JOIN public.financial_installments i ON i.id = m.installment_id
      JOIN public.financial_titles t ON t.id = i.title_id
     WHERE m.charge_id = c.id AND m.status = 'confirmado' AND i.settlement_status = 'liquidado'
       AND coalesce(t.pagador_party_id, t.party_id) = c.party_id
       AND NOT EXISTS (SELECT 1 FROM public.asaas_charges x WHERE x.installment_id = i.id AND x.id <> c.id AND x.external_status <> 'DELETED')
     ORDER BY m.decidido_em DESC NULLS LAST LIMIT 1;
    IF inst IS NOT NULL THEN
      PERFORM public.asaas_vincular_interno(c.id, tit, inst,
        'Automático: cobrança já baixada pela importação (vínculo confirmado pelo número da fatura); nenhum lançamento novo', _ator);
      dec := public.asaas_auto_decidir(c.id, 'vinculo_ja_baixado', 'Já estava baixada pela importação; só foi ligada à cobrança',
        '{}'::jsonb, c.party_id, tit, inst, NULL, valor, 0, _ator);
      RETURN jsonb_build_object('acao','vinculo_ja_baixado','decisao',dec,'title_id',tit,'installment_id',inst);
    END IF;
  END IF;

  IF NOT _manual AND coalesce(c.payment_date, c.confirmed_date) < cfg.corte THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','antes_do_corte');
  END IF;

  -- 1) pay_ / nº da fatura / código+remessa / CPF com valor único (rotina oficial de vínculo)
  res := public.asaas_conciliar_cobranca(c.id, _ator);
  IF coalesce((res->>'ok')::boolean, false) THEN
    b := res->'baixa';
    IF coalesce((b->>'baixa')::boolean, false) THEN
      PERFORM public.fin_asaas_extrato_autoconciliar(c.external_id);
      dec := public.asaas_auto_decidir(c.id,
        CASE WHEN coalesce((b->>'juros_cents')::bigint, 0) > 0 THEN 'baixa_com_juros' ELSE 'baixa_titulo' END,
        'Casou com a conta em aberto da pessoa (fatura, código ou CPF com valor único)',
        jsonb_build_object('regra','conciliar_cobranca'), c.party_id, nullif(res->>'title_id','')::uuid,
        nullif(res->>'installment_id','')::uuid, nullif(b->>'settlement_id','')::uuid, valor, coalesce((b->>'juros_cents')::bigint, 0), _ator);
      RETURN jsonb_build_object('acao','baixa_titulo','decisao',dec,'baixa',b);
    END IF;
    dec := public.asaas_auto_decidir(c.id, 'excecao', 'Ligada à conta, mas a baixa foi recusada: ' || coalesce(b->>'motivo', 'sem motivo'),
      jsonb_build_object('baixa', b), c.party_id, nullif(res->>'title_id','')::uuid, nullif(res->>'installment_id','')::uuid, NULL, valor, 0, _ator);
    RETURN jsonb_build_object('acao','excecao','motivo','baixa_recusada','decisao',dec,'baixa',b);
  END IF;

  SELECT party_id INTO pid FROM public.asaas_charges WHERE id = c.id;
  pid := coalesce(pid, nullif(res->>'party_id','')::uuid);
  IF pid IS NULL THEN
    dec := public.asaas_auto_decidir(c.id, 'excecao', 'Pagador sem cadastro identificado (sem CPF, código ou fatura conhecidos)',
      jsonb_build_object('conciliar', res), NULL, NULL, NULL, NULL, valor, 0, _ator);
    RETURN jsonb_build_object('acao','excecao','motivo','sem_pessoa','decisao',dec);
  END IF;
  IF c.party_id IS NULL THEN
    PERFORM set_config('lardann.asaas_link', 'on', true);
    UPDATE public.asaas_charges SET party_id = pid WHERE id = c.id;
    PERFORM set_config('lardann.asaas_link', 'off', true);
  END IF;
  pessoas := coalesce(public.party_e_unificadas(pid), ARRAY[]::uuid[]);
  IF NOT pid = ANY(pessoas) THEN pessoas := pessoas || pid; END IF;

  -- contas em aberto da pessoa (sem outra cobrança Asaas apontando para a parcela)
  WITH ab AS (
    SELECT i.id, i.title_id, public.fin_installment_saldo(i.id) s
      FROM public.financial_installments i JOIN public.financial_titles t ON t.id = i.title_id
     WHERE t.direction = 'receivable' AND t.status = 'ativo' AND coalesce(t.pagador_party_id, t.party_id) = pid
       AND NOT EXISTS (SELECT 1 FROM public.asaas_charges x WHERE x.installment_id = i.id AND x.external_status <> 'DELETED'))
  SELECT count(*) FILTER (WHERE s > 0),
         count(*) FILTER (WHERE s = valor),
         count(*) FILTER (WHERE s > 0 AND s < valor AND valor - s <= least(cfg.juros_max_cents, floor(s * cfg.juros_max_pct / 100)::bigint))
    INTO n, nx, nj FROM ab;

  IF coalesce(n, 0) = 0 THEN
    -- consultora com maleta Lardan em acerto: o Pix é desse acerto; 3.1.1 contaria a receita duas vezes
    IF EXISTS (SELECT 1 FROM public.kit_cycles k WHERE k.consultora_party_id = ANY(pessoas) AND k.status = 'acerto')
       OR EXISTS (SELECT 1 FROM public.kit_pre_baixas pb WHERE pb.consultora_party_id = ANY(pessoas)
                    AND pb.encerrada_em IS NULL AND pb.status::text <> 'cancelada') THEN
      dec := public.asaas_auto_decidir(c.id, 'excecao', 'Consultora com maleta em acerto: confirmar se o Pix é desse acerto',
        '{}'::jsonb, pid, NULL, NULL, NULL, valor, 0, _ator);
      RETURN jsonb_build_object('acao','excecao','motivo','maleta_em_acerto','decisao',dec);
    END IF;
    regra := public.fin_approval_rule();
    IF coalesce((regra->>'exigir')::boolean, false) AND valor >= coalesce((regra->>'valor_minimo_cents')::bigint, 0) THEN
      dec := public.asaas_auto_decidir(c.id, 'excecao', 'A regra de aprovação exige rascunho para este valor',
        '{}'::jsonb, pid, NULL, NULL, NULL, valor, 0, _ator);
      RETURN jsonb_build_object('acao','excecao','motivo','regra_aprovacao','decisao',dec);
    END IF;
    dia := least(coalesce(c.payment_date, c.confirmed_date, hoje), hoje);
    ext := public.asaas_titulo_ext_livre(c.external_id);
    tit := public.fin_title_create(jsonb_build_object(
      'direction','receivable','party_id',pid,
      'descricao', left('Recebimento Asaas ' || c.external_id || coalesce(' · ' || nullif(c.raw->>'description',''), ''), 300),
      'documento', c.external_id, 'emissao', dia::text, 'competencia', dia::text,
      'business_entity_id', ent, 'financial_account_id', conta,
      'chart_account_id', (SELECT id FROM public.chart_of_accounts WHERE codigo = '3.1.1' ORDER BY id LIMIT 1),
      'valor_cents', valor, 'status','ativo','origem','conciliacao','sistema_origem','asaas','id_externo',ext,
      'observacao','Lançado sozinho pelo Asaas: recebimento sem nada em aberto da pessoa (3.1.1 Revenda de Mercadorias).',
      'parcelas', jsonb_build_array(jsonb_build_object('vencimento', dia::text, 'valor_cents', valor))));
    SELECT id INTO inst FROM public.financial_installments WHERE title_id = tit ORDER BY numero LIMIT 1;
    PERFORM public.asaas_vincular_interno(c.id, tit, inst, 'Automático: título 3.1.1 criado para recebimento sem nada em aberto', _ator);
    b := public.asaas_baixa_automatica(c.id);
    IF NOT coalesce((b->>'baixa')::boolean, false) THEN
      RAISE EXCEPTION 'Baixa automática recusada (%): nada foi lançado.', coalesce(b->>'motivo', '?');
    END IF;
    PERFORM public.fin_asaas_extrato_autoconciliar(c.external_id);
    dec := public.asaas_auto_decidir(c.id, 'titulo_3_1_1', 'Sem nada em aberto: título 3.1.1 criado e baixado',
      '{}'::jsonb, pid, tit, inst, nullif(b->>'settlement_id','')::uuid, valor, 0, _ator);
    RETURN jsonb_build_object('acao','titulo_3_1_1','decisao',dec,'title_id',tit,'baixa',b);
  END IF;

  -- 2) valor exato único da pessoa (sem cobrança concorrente do mesmo valor) ou 3) diferença pequena = juros
  IF nx = 1 OR (nx = 0 AND nj = 1) THEN
    IF NOT EXISTS (SELECT 1 FROM public.asaas_charges y WHERE y.id <> c.id AND y.installment_id IS NULL
                     AND y.external_status NOT IN ('DELETED','REFUNDED') AND coalesce(y.received_cents, y.value_cents) = valor
                     AND y.party_id = pid) THEN
      SELECT i.id, i.title_id INTO inst, tit
        FROM public.financial_installments i JOIN public.financial_titles t ON t.id = i.title_id
       WHERE t.direction = 'receivable' AND t.status = 'ativo' AND coalesce(t.pagador_party_id, t.party_id) = pid
         AND NOT EXISTS (SELECT 1 FROM public.asaas_charges x WHERE x.installment_id = i.id AND x.external_status <> 'DELETED')
         AND CASE WHEN nx = 1 THEN public.fin_installment_saldo(i.id) = valor
                  ELSE public.fin_installment_saldo(i.id) > 0 AND public.fin_installment_saldo(i.id) < valor
                       AND valor - public.fin_installment_saldo(i.id) <= least(cfg.juros_max_cents, floor(public.fin_installment_saldo(i.id) * cfg.juros_max_pct / 100)::bigint) END
       LIMIT 1;
      PERFORM public.asaas_vincular_interno(c.id, tit, inst,
        CASE WHEN nx = 1 THEN 'Automático: única conta em aberto da pessoa com o mesmo valor'
             ELSE 'Automático: única conta em aberto da pessoa; diferença pequena lançada como juros' END, _ator);
      b := public.asaas_baixa_automatica(c.id);
      IF NOT coalesce((b->>'baixa')::boolean, false) THEN
        RAISE EXCEPTION 'Baixa automática recusada (%): nada foi lançado.', coalesce(b->>'motivo', '?');
      END IF;
    PERFORM public.fin_asaas_extrato_autoconciliar(c.external_id);
      dec := public.asaas_auto_decidir(c.id, CASE WHEN coalesce((b->>'juros_cents')::bigint, 0) > 0 THEN 'baixa_com_juros' ELSE 'baixa_titulo' END,
        CASE WHEN nx = 1 THEN 'Única conta em aberto da pessoa com o mesmo valor'
             ELSE 'Pagou um pouco a mais: diferença lançada como juros na própria baixa' END,
        '{}'::jsonb, pid, tit, inst, nullif(b->>'settlement_id','')::uuid, valor, coalesce((b->>'juros_cents')::bigint, 0), _ator);
      RETURN jsonb_build_object('acao', CASE WHEN nx = 1 THEN 'baixa_titulo' ELSE 'baixa_com_juros' END, 'decisao', dec, 'baixa', b);
    END IF;
  END IF;

  dec := public.asaas_auto_decidir(c.id, 'excecao',
    'O valor não casa com nenhuma conta em aberto da pessoa (' || n || ' em aberto)',
    jsonb_build_object('abertas', n, 'mesmo_valor', nx, 'com_juros', nj), pid, NULL, NULL, NULL, valor, 0, _ator);
  RETURN jsonb_build_object('acao','excecao','motivo','valor_nao_casa','decisao',dec,'abertas',n);
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_receber_nucleo(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;

-- entrada: sessão de usuário (Mesa) ou serviço/agendamento (responsável técnico da cobrança)
CREATE OR REPLACE FUNCTION public.asaas_auto_receber(_charge uuid, _manual boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ator uuid; prev text; r jsonb; servico boolean; trocou boolean := false;
BEGIN
  servico := coalesce(auth.role(), '') = 'service_role' OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin'));
  IF NOT servico AND NOT (public.has_capability(auth.uid(), 'finance.settlement.create') AND public.has_capability(auth.uid(), 'finance.receivable.manage')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar recebimentos do Asaas.';
  END IF;
  IF NOT _manual AND NOT coalesce((SELECT ligado FROM public.asaas_auto_config WHERE id), false) THEN
    RETURN jsonb_build_object('acao','ignorado','motivo','automatico_desligado');
  END IF;
  ator := auth.uid();
  IF ator IS NULL THEN
    SELECT ator_user_id INTO ator FROM public.consultora_cobranca_config WHERE id;
    IF ator IS NULL THEN RAISE EXCEPTION 'Responsável técnico da cobrança não configurado.'; END IF;
    prev := current_setting('request.jwt.claims', true);
    PERFORM public.pdv_como(ator);
    trocou := true;
  END IF;
  r := public.asaas_auto_receber_nucleo(_charge, ator, _manual);
  IF trocou THEN PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true); END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_receber(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_auto_receber(uuid,boolean) TO authenticated, service_role;

-- rotina a cada poucos minutos: fila de avisos + baixa automática + limpeza de avisos só informativos
CREATE OR REPLACE FUNCTION public.asaas_auto_rodar(_limite int DEFAULT 150)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ator uuid; prev text; r record; res jsonb; t0 timestamptz := clock_timestamp();
  fila_ok int := 0; fila_erro int := 0; conta jsonb := '{}'::jsonb; erros int := 0; k text; info int := 0; recebidos int := 0;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin'))) THEN
    RAISE EXCEPTION 'Somente a rotina automática roda esta função.';
  END IF;
  IF NOT coalesce((SELECT ligado FROM public.asaas_auto_config WHERE id), false) THEN
    RETURN jsonb_build_object('desligado', true);
  END IF;
  SELECT ator_user_id INTO ator FROM public.consultora_cobranca_config WHERE id;
  IF ator IS NULL THEN RAISE EXCEPTION 'Responsável técnico da cobrança não configurado.'; END IF;
  prev := current_setting('request.jwt.claims', true);
  PERFORM public.pdv_como(ator);

  -- 1) avisos ainda não processados cuja cobrança já está espelhada
  FOR r IN SELECT e.id FROM public.asaas_events e
            WHERE e.status = 'na_fila' AND e.processed_at IS NULL
              AND EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.account_id = e.account_id AND c.external_id = e.charge_external_id)
            ORDER BY e.received_at LIMIT 100 LOOP
    BEGIN PERFORM public.asaas_evento_processar(r.id); fila_ok := fila_ok + 1;
    EXCEPTION WHEN OTHERS THEN fila_erro := fila_erro + 1; END;
  END LOOP;

  -- 2) recebidas sem vínculo (exceções são reavaliadas no máximo a cada 50 minutos)
  FOR r IN SELECT c.id FROM public.asaas_charges c
            WHERE c.external_status = 'RECEIVED' AND c.installment_id IS NULL AND c.title_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_decisoes d WHERE d.charge_id = c.id
                                AND (d.desfeito_em IS NOT NULL OR d.acao <> 'excecao' OR d.atualizado_em > now() - interval '50 minutes'))
            ORDER BY c.payment_date DESC NULLS LAST LIMIT greatest(coalesce(_limite, 150), 1) LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '45 seconds';
    BEGIN
      res := public.asaas_auto_receber_nucleo(r.id, ator, false);
      k := coalesce(res->>'acao', '?') || CASE WHEN res->>'acao' = 'ignorado' THEN ':' || coalesce(res->>'motivo','') ELSE '' END;
      conta := conta || jsonb_build_object(k, coalesce((conta->>k)::int, 0) + 1);
    EXCEPTION WHEN OTHERS THEN
      erros := erros + 1;
      PERFORM public.asaas_auto_decidir(r.id, 'excecao', left('Erro ao lançar sozinho: ' || SQLERRM, 400), '{}'::jsonb,
        NULL, NULL, NULL, NULL, NULL, 0, ator);
    END;
  END LOOP;

  -- 3) avisos só informativos já processados (vencida, cartão confirmado) saem da fila de decisão
  UPDATE public.asaas_events e SET status = 'processado'
    FROM public.asaas_event_types t
   WHERE t.event = e.event AND e.status = 'na_fila' AND e.processed_at IS NOT NULL
     AND t.efeito_recebivel IN ('atraso','confirmado_sem_baixa') AND NOT t.revisao_manual;
  GET DIAGNOSTICS info = ROW_COUNT;
  -- recebimentos cujo pay_ já está ligado e baixado também saem
  UPDATE public.asaas_events e SET status = 'processado', last_error = NULL
    FROM public.asaas_charges c JOIN public.financial_installments i ON i.id = c.installment_id
   WHERE c.account_id = e.account_id AND c.external_id = e.charge_external_id
     AND e.status = 'na_fila' AND e.processed_at IS NOT NULL AND e.event = 'PAYMENT_RECEIVED'
     AND i.settlement_status = 'liquidado';
  GET DIAGNOSTICS recebidos = ROW_COUNT;

  PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);
  RETURN jsonb_build_object('fila_processados', fila_ok, 'fila_erros', fila_erro, 'cobrancas', conta, 'erros', erros,
    'avisos_informativos_fechados', info, 'avisos_recebidos_fechados', recebidos,
    'ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int);
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_rodar(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_auto_rodar(int) TO service_role;

-- prévia sem gravar nada: executa cada decisão e desfaz em seguida
CREATE OR REPLACE FUNCTION public.asaas_auto_previa(_limite int DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ator uuid; prev text; r record; res jsonb; det text; k text; conta jsonb := '{}'::jsonb; soma jsonb := '{}'::jsonb;
  itens jsonb := '[]'::jsonb; v bigint;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin'))) THEN
    RAISE EXCEPTION 'Somente o serviço roda a prévia.';
  END IF;
  SELECT ator_user_id INTO ator FROM public.consultora_cobranca_config WHERE id;
  prev := current_setting('request.jwt.claims', true);
  PERFORM public.pdv_como(ator);
  FOR r IN SELECT c.id, c.external_id, coalesce(c.received_cents, c.value_cents) valor, c.payment_date FROM public.asaas_charges c
            WHERE c.external_status = 'RECEIVED' AND c.installment_id IS NULL AND c.title_id IS NULL
            ORDER BY c.payment_date DESC NULLS LAST LIMIT _limite LOOP
    BEGIN
      res := public.asaas_auto_receber_nucleo(r.id, ator, false);
      RAISE EXCEPTION USING ERRCODE = 'LDPRV', MESSAGE = 'previa', DETAIL = res::text;
    EXCEPTION
      WHEN SQLSTATE 'LDPRV' THEN
        GET STACKED DIAGNOSTICS det = PG_EXCEPTION_DETAIL;
        res := det::jsonb;
      WHEN OTHERS THEN
        res := jsonb_build_object('acao','erro','motivo', left(SQLERRM, 200));
    END;
    k := coalesce(res->>'acao','?') || CASE WHEN res->>'acao' IN ('ignorado','excecao','erro') THEN ':' || coalesce(res->>'motivo','') ELSE '' END;
    conta := conta || jsonb_build_object(k, coalesce((conta->>k)::int, 0) + 1);
    soma := soma || jsonb_build_object(k, coalesce((soma->>k)::bigint, 0) + coalesce(r.valor, 0));
    IF jsonb_array_length(itens) < 400 AND res->>'acao' <> 'ignorado' THEN
      itens := itens || jsonb_build_object('pay', r.external_id, 'valor', r.valor, 'dia', r.payment_date, 'acao', k);
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);
  RETURN jsonb_build_object('quantidade', conta, 'valor_cents', soma, 'itens', itens);
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_previa(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_auto_previa(int) TO service_role;

-- Mesa: "Não, é novo" numa linha com pay_ lança preso à cobrança (classificação escolhida na Mesa)
CREATE OR REPLACE FUNCTION public.asaas_extrato_lancar(_line uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l record; c record; conta uuid; ent uuid; pid uuid; tit uuid; inst uuid; b jsonb; ext text; dia date; valor bigint;
  regra jsonb; dec uuid; chave text; ls text;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT (public.has_capability(auth.uid(), 'finance.reconcile') AND public.has_capability(auth.uid(), 'finance.settlement.create')
          AND public.has_capability(auth.uid(), 'finance.receivable.manage')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar recebimentos do Asaas.';
  END IF;
  SELECT * INTO l FROM public.financial_statement_lines WHERE id = _line FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Linha do extrato não encontrada.'; END IF;
  IF l.kind <> 'entrada' OR coalesce(l.raw->>'paymentId', '') NOT LIKE 'pay\_%' THEN
    RAISE EXCEPTION 'Esta linha não é recebimento de uma cobrança do Asaas.';
  END IF;
  IF l.status NOT IN ('pendente','parcial','divergente') THEN
    RAISE EXCEPTION 'Esta linha já foi conciliada (situação: %).', l.status;
  END IF;
  SELECT ch.* INTO c FROM public.asaas_charges ch JOIN public.asaas_accounts a ON a.id = ch.account_id
   WHERE ch.external_id = l.raw->>'paymentId' AND a.financial_account_id = l.financial_account_id FOR UPDATE OF ch;
  IF c.id IS NULL THEN RAISE EXCEPTION 'A cobrança % ainda não chegou ao espelho do Asaas: busque as cobranças e tente de novo.', l.raw->>'paymentId'; END IF;
  SELECT financial_account_id, owner_entity_id INTO conta, ent FROM public.asaas_accounts WHERE id = c.account_id;
  chave := 'asaas:baixa:' || c.account_id || ':' || c.external_id;
  IF EXISTS (SELECT 1 FROM public.financial_settlements x
              WHERE (x.idempotency_key = chave OR x.idempotency_key LIKE 'asaas:baixa:' || c.account_id || ':r%:' || c.external_id)
                AND NOT x.is_reversal AND NOT EXISTS (SELECT 1 FROM public.financial_settlements r WHERE r.reversed_of = x.id)) THEN
    RAISE EXCEPTION 'Esta cobrança % já tem baixa no sistema: use "Sim, já existe" e vincule à baixa.', c.external_id;
  END IF;
  IF c.installment_id IS NOT NULL THEN
    b := public.asaas_baixa_automatica(c.id);
    IF NOT coalesce((b->>'baixa')::boolean, false) THEN
      RAISE EXCEPTION 'A cobrança já está ligada a uma conta, mas a baixa foi recusada: %.', coalesce(b->>'motivo', '?');
    END IF;
    PERFORM public.fin_asaas_extrato_autoconciliar(c.external_id);
    SELECT status::text INTO ls FROM public.financial_statement_lines WHERE id = l.id;
    RETURN jsonb_build_object('acao','baixa_titulo','title_id',c.title_id,'baixa',b,'linha',ls);
  END IF;
  pid := nullif(_payload->>'party_id','')::uuid;
  IF pid IS NULL THEN RAISE EXCEPTION 'Escolha quem pagou.'; END IF;
  IF c.party_id IS NOT NULL AND c.party_id <> pid THEN
    RAISE EXCEPTION 'A cobrança % é de outra pessoa no Asaas: escolha a mesma pessoa ou acerte o cadastro.', c.external_id;
  END IF;
  IF c.external_status <> 'RECEIVED' THEN RAISE EXCEPTION 'A cobrança ainda não consta como recebida no Asaas.'; END IF;
  valor := coalesce(c.received_cents, c.value_cents);
  regra := public.fin_approval_rule();
  IF coalesce((regra->>'exigir')::boolean, false) AND valor >= coalesce((regra->>'valor_minimo_cents')::bigint, 0) THEN
    RAISE EXCEPTION 'A regra de aprovação exige que este lançamento nasça em rascunho.';
  END IF;
  IF c.party_id IS NULL THEN
    PERFORM set_config('lardann.asaas_link', 'on', true);
    UPDATE public.asaas_charges SET party_id = pid WHERE id = c.id;
    PERFORM set_config('lardann.asaas_link', 'off', true);
  END IF;
  dia := least(coalesce(c.payment_date, c.confirmed_date, l.data, hoje), hoje);
  ext := public.asaas_titulo_ext_livre(c.external_id);
  tit := public.fin_title_create(jsonb_build_object(
    'direction','receivable','party_id',pid,
    'descricao', coalesce(nullif(_payload->>'descricao',''), 'Recebimento Asaas ' || c.external_id),
    'documento', coalesce(nullif(_payload->>'documento',''), c.external_id),
    'emissao', dia::text, 'competencia', coalesce(nullif(_payload->>'competencia',''), dia::text),
    'observacao', concat_ws(' · ', nullif(_payload->>'observacao',''), 'Lançado pela Mesa preso à cobrança ' || c.external_id),
    'cost_center_id', _payload->>'cost_center_id', 'chart_account_id', _payload->>'chart_account_id',
    'payment_method_id', _payload->>'payment_method_id',
    'business_entity_id', ent, 'financial_account_id', conta,
    'valor_cents', valor, 'status','ativo','origem','conciliacao','sistema_origem','asaas','id_externo',ext,
    'parcelas', jsonb_build_array(jsonb_build_object('vencimento', dia::text, 'valor_cents', valor))));
  SELECT id INTO inst FROM public.financial_installments WHERE title_id = tit ORDER BY numero LIMIT 1;
  PERFORM public.asaas_vincular_interno(c.id, tit, inst, 'Mesa: lançamento novo preso à cobrança do Asaas', auth.uid());
  PERFORM set_config('lardan.asaas_refazer', 'on', true);
  b := public.asaas_baixa_automatica(c.id);
  PERFORM set_config('lardan.asaas_refazer', 'off', true);
  IF NOT coalesce((b->>'baixa')::boolean, false) THEN
    RAISE EXCEPTION 'A baixa pela cobrança foi recusada (%): nada foi lançado.', coalesce(b->>'motivo', '?');
  END IF;
    PERFORM public.fin_asaas_extrato_autoconciliar(c.external_id);
  -- exceção anterior desta cobrança fica resolvida pela Mesa
  UPDATE public.asaas_auto_decisoes SET desfeito_em = now(), desfeito_por = auth.uid(), desfeito_motivo = 'Resolvida na Mesa'
   WHERE charge_id = c.id AND desfeito_em IS NULL AND acao = 'excecao';
  dec := public.asaas_auto_decidir(c.id, 'lancado_pela_mesa', 'Lançado na Mesa preso à cobrança (classificação escolhida na Mesa)',
    '{}'::jsonb, pid, tit, inst, nullif(b->>'settlement_id','')::uuid, valor, coalesce((b->>'juros_cents')::bigint, 0), auth.uid());
  SELECT status::text INTO ls FROM public.financial_statement_lines WHERE id = l.id;
  RETURN jsonb_build_object('acao','lancado_pela_mesa','decisao',dec,'title_id',tit,'baixa',b,'linha',ls);
END $$;
REVOKE ALL ON FUNCTION public.asaas_extrato_lancar(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_extrato_lancar(uuid,jsonb) TO authenticated;

-- desfazer: estorna a baixa (e a conciliação da linha), solta o vínculo e cancela o título criado sozinho
CREATE OR REPLACE FUNCTION public.asaas_auto_desfazer(_decisao uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d record; c record; s record; rc record; chave text; mot text; estornos int := 0;
BEGIN
  IF NOT (public.has_capability(auth.uid(), 'finance.reconcile.undo') AND public.has_capability(auth.uid(), 'finance.settlement.reverse')) THEN
    RAISE EXCEPTION 'Sem permissão para desfazer lançamentos do Asaas.';
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo para desfazer.'; END IF;
  SELECT * INTO d FROM public.asaas_auto_decisoes WHERE id = _decisao FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Lançamento automático não encontrado.'; END IF;
  IF d.desfeito_em IS NOT NULL THEN RAISE EXCEPTION 'Este lançamento já foi desfeito.'; END IF;
  IF d.acao = 'excecao' THEN RAISE EXCEPTION 'Exceção não tem lançamento para desfazer.'; END IF;
  SELECT * INTO c FROM public.asaas_charges WHERE id = d.charge_id FOR UPDATE;
  mot := 'Desfeito (Asaas automático): ' || btrim(_motivo);
  chave := 'asaas:baixa:' || c.account_id || ':' || c.external_id;
  FOR s IN SELECT fs.id, fs.financial_account_id, fs.data FROM public.financial_settlements fs
            WHERE (fs.idempotency_key = chave OR fs.idempotency_key LIKE 'asaas:baixa:' || c.account_id || ':r%:' || c.external_id)
              AND NOT fs.is_reversal
              AND NOT EXISTS (SELECT 1 FROM public.financial_settlements r WHERE r.reversed_of = fs.id) LOOP
    FOR rc IN SELECT id FROM public.financial_reconciliations WHERE settlement_id = s.id AND status = 'ativa' LOOP
      PERFORM public.fin_reconcile_undo(rc.id, mot);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.financial_settlements r WHERE r.reversed_of = s.id) THEN
      PERFORM public.fin_settlement_reverse(s.id, mot);
    END IF;
    -- a tarifa lançada junto com a baixa volta também (o relançamento cria a dele)
    INSERT INTO public.financial_account_movements (financial_account_id, kind, data, valor_cents, settlement_id, descricao, created_by)
    SELECT m.financial_account_id, 'ajuste', m.data, -m.valor_cents,
           (SELECT r.id FROM public.financial_settlements r WHERE r.reversed_of = s.id LIMIT 1),
           left('Estorno da tarifa: ' || mot, 300), auth.uid()
      FROM public.financial_account_movements m
     WHERE m.settlement_id = s.id AND m.descricao = 'Tarifa de processamento' AND m.valor_cents < 0;
    estornos := estornos + 1;
  END LOOP;
  IF c.title_id IS NOT NULL THEN
    PERFORM set_config('lardann.asaas_link', 'on', true);
    UPDATE public.asaas_charges SET title_id = NULL, installment_id = NULL, reconcile_status = 'pendente',
           reconcile_note = left(mot, 500), linked_by = NULL, linked_at = NULL
     WHERE id = c.id;
    PERFORM set_config('lardann.asaas_link', 'off', true);
    INSERT INTO public.asaas_charge_changes (charge_id, campo, de, para, origem, actor_user_id)
    VALUES (c.id, 'title_id', c.title_id::text, NULL, 'executor_interno', auth.uid()),
           (c.id, 'installment_id', c.installment_id::text, NULL, 'executor_interno', auth.uid());
  END IF;
  IF d.acao IN ('titulo_3_1_1','lancado_pela_mesa') AND d.title_id IS NOT NULL THEN
    PERFORM public.fin_title_cancel(d.title_id, mot);
  END IF;
  UPDATE public.asaas_auto_decisoes SET desfeito_em = now(), desfeito_por = auth.uid(), desfeito_motivo = btrim(_motivo) WHERE id = d.id;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'asaas.auto.desfazer', 'asaas_charges', c.id,
          jsonb_build_object('decisao', d.id, 'acao', d.acao, 'motivo', btrim(_motivo), 'estornos', estornos, 'title_id', d.title_id));
  RETURN jsonb_build_object('ok', true, 'estornos', estornos, 'titulo_cancelado', d.acao IN ('titulo_3_1_1','lancado_pela_mesa'));
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_desfazer(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_auto_desfazer(uuid,text) TO authenticated;

-- relatório do que foi feito sozinho e o que ficou na exceção
CREATE OR REPLACE FUNCTION public.asaas_auto_relatorio(_de date, _ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ini timestamptz; fim timestamptz;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'finance.reconcile') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  ini := (coalesce(_de, current_date)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  fim := ((coalesce(_ate, _de, current_date) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  RETURN jsonb_build_object(
    'config', (SELECT to_jsonb(x) - 'id' FROM public.asaas_auto_config x WHERE id),
    'resumo', coalesce((SELECT jsonb_agg(jsonb_build_object('acao', acao, 'qtd', qtd, 'valor_cents', v, 'juros_cents', j) ORDER BY acao)
       FROM (SELECT acao, count(*) qtd, coalesce(sum(valor_cents),0) v, coalesce(sum(juros_cents),0) j
               FROM public.asaas_auto_decisoes WHERE desfeito_em IS NULL AND atualizado_em >= ini AND atualizado_em < fim GROUP BY acao) z), '[]'::jsonb),
    'excecoes_abertas', (SELECT count(*) FROM public.asaas_auto_decisoes WHERE desfeito_em IS NULL AND acao = 'excecao'),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.quando DESC) FROM (
       SELECT d.id, d.acao, d.motivo, d.valor_cents, d.juros_cents, d.atualizado_em quando, d.desfeito_em, d.desfeito_motivo,
              c.external_id pay, c.payment_date, c.billing_type, p.display_name pessoa, p.code pessoa_codigo, t.numero titulo_numero
         FROM public.asaas_auto_decisoes d JOIN public.asaas_charges c ON c.id = d.charge_id
         LEFT JOIN public.parties p ON p.id = d.party_id
         LEFT JOIN public.financial_titles t ON t.id = d.title_id
        WHERE (d.atualizado_em >= ini AND d.atualizado_em < fim) OR (d.acao = 'excecao' AND d.desfeito_em IS NULL)
        ORDER BY d.atualizado_em DESC LIMIT 500) y), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_relatorio(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_auto_relatorio(date,date) TO authenticated;

-- extrato de hora em hora pelo serviço: mesma rotina oficial de extratos, em nome do responsável técnico
CREATE OR REPLACE FUNCTION public.asaas_extrato_gravar_servico(_arquivo jsonb, _linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ator uuid; prev text; reg jsonb; st jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Somente o serviço grava o extrato automático.'; END IF;
  SELECT ator_user_id INTO ator FROM public.consultora_cobranca_config WHERE id;
  IF ator IS NULL THEN RAISE EXCEPTION 'Responsável técnico da cobrança não configurado.'; END IF;
  prev := current_setting('request.jwt.claims', true);
  PERFORM public.pdv_como(ator);
  reg := public.fin_statement_file_register(_arquivo);
  IF NOT (coalesce((reg->>'repetido')::boolean, false) AND coalesce((reg->>'concluido')::boolean, true)) THEN
    st := public.fin_statement_lines_stage((reg->>'import_id')::uuid, _linhas);
  END IF;
  PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);
  RETURN jsonb_build_object('registro', reg, 'linhas', st, 'ator', ator);
END $$;
REVOKE ALL ON FUNCTION public.asaas_extrato_gravar_servico(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_extrato_gravar_servico(jsonb,jsonb) TO service_role;

-- agendamento no banco (a cada 10 minutos); a chave geral asaas_auto_config.ligado controla tudo
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('asaas-automatico', '*/10 * * * *', 'SELECT public.asaas_auto_rodar(150)');
  END IF;
END $cron$;
CREATE OR REPLACE FUNCTION public.asaas_baixa_automatica(_charge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; conta uuid; conta_cartao uuid; destino uuid; parcela uuid; saldo bigint; valor bigint; tarifa bigint;
  extra bigint := 0; explicado bigint; juros bigint := 0; cartao boolean := false; transf jsonb := null;
  dia date; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb; chave text; lim_tol bigint; tolerancia boolean := false;
BEGIN
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'cobranca_inexistente'); END IF;
  IF c.external_status NOT IN ('RECEIVED','CONFIRMED') THEN
    RETURN jsonb_build_object('baixa', false, 'motivo', 'nao_recebida');
  END IF;
  -- cobrança de parcela de acordo: rotina própria que abate as dívidas originais
  DECLARE ai uuid; BEGIN
    SELECT id INTO ai FROM public.asaas_charge_intents WHERE acordo_simulacao_id IS NOT NULL
      AND (charge_id = c.id OR (account_id = c.account_id AND external_id = c.external_id)) LIMIT 1;
    IF ai IS NOT NULL THEN RETURN public.cob_acordo_baixa(c.id, ai); END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.asaas_baixas_outra_forma WHERE charge_id = c.id) THEN
    RETURN jsonb_build_object('baixa', false, 'motivo', 'pago_por_outra_forma', 'revisao_manual', true);
  END IF;
  parcela := c.installment_id;
  IF parcela IS NULL THEN
    SELECT m.installment_id INTO parcela FROM public.asaas_charge_matches m
     WHERE m.charge_id = c.id AND m.status = 'confirmado' AND m.installment_id IS NOT NULL
     ORDER BY m.decidido_em DESC NULLS LAST LIMIT 1;
  END IF;
  IF parcela IS NULL THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'sem_parcela_vinculada'); END IF;
  SELECT financial_account_id, conta_cartao_receber_id INTO conta, conta_cartao FROM public.asaas_accounts WHERE id = c.account_id;
  IF conta IS NULL THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'conta_asaas_sem_conta_financeira'); END IF;
  -- Cartão: a cliente pagou em payment_date, mas o dinheiro só cai na conta Asaas em credit_date.
  -- Com a conta "Cartão a receber" configurada, a baixa vai para ela e o crédito vira transferência.
  cartao := c.billing_type = 'CREDIT_CARD' AND conta_cartao IS NOT NULL;
  destino := CASE WHEN cartao THEN conta_cartao ELSE conta END;
  chave := 'asaas:baixa:' || c.account_id || ':' || c.external_id;
  IF EXISTS (SELECT 1 FROM public.financial_settlements WHERE idempotency_key = chave) THEN
    -- 0285: só o "lançar de novo" da Mesa, depois de desfazer, abre uma chave nova (asaas:baixa:<conta>:rN:<pay_>);
    -- estorno comum continua impedindo nova baixa automática da mesma cobrança.
    IF coalesce(current_setting('lardan.asaas_refazer', true), 'off') = 'on'
       AND NOT EXISTS (SELECT 1 FROM public.financial_settlements x
                        WHERE (x.idempotency_key = chave OR x.idempotency_key LIKE 'asaas:baixa:' || c.account_id || ':r%:' || c.external_id)
                          AND NOT x.is_reversal AND NOT EXISTS (SELECT 1 FROM public.financial_settlements r WHERE r.reversed_of = x.id)) THEN
      SELECT 'asaas:baixa:' || c.account_id || ':r' || count(*) || ':' || c.external_id INTO chave
        FROM public.financial_settlements x
       WHERE (x.idempotency_key = 'asaas:baixa:' || c.account_id || ':' || c.external_id
              OR x.idempotency_key LIKE 'asaas:baixa:' || c.account_id || ':r%:' || c.external_id) AND NOT x.is_reversal;
    ELSE
      transf := public.asaas_cartao_creditar(c.id);
      RETURN jsonb_build_object('baixa', false, 'motivo', 'ja_baixada_pelo_asaas', 'repetido', true, 'credito_cartao', transf);
    END IF;
  END IF;
  saldo := public.fin_installment_saldo(parcela);
  valor := coalesce(c.received_cents, c.value_cents);
  tarifa := greatest(coalesce(c.fee_cents, CASE WHEN c.net_value_cents IS NOT NULL THEN valor - c.net_value_cents END, 0), 0);
  IF coalesce(saldo,0) <= 0 THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'parcela_ja_quitada'); END IF;
  IF valor IS NULL OR valor <= 0 THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'valor_ausente'); END IF;
  IF valor > saldo THEN
    -- Juros e multa cobrados pelo próprio Asaas: aceitos só quando explicam a diferença (tolerância de 1 centavo).
    extra := valor - saldo;
    explicado := nullif(coalesce(c.interest_cents,0) + coalesce(c.fine_cents,0), 0);
    IF explicado IS NULL AND nullif(c.raw->>'interestValue','') IS NOT NULL THEN
      explicado := round((c.raw->>'interestValue')::numeric * 100)::bigint;
    END IF;
    IF explicado IS NULL AND nullif(c.raw->>'originalValue','') IS NOT NULL
       AND abs(round((c.raw->>'originalValue')::numeric * 100)::bigint - saldo) <= 1 THEN
      explicado := extra;
    END IF;
    IF explicado IS NULL OR abs(extra - explicado) > 1 THEN
      -- 0285: diferença pequena paga a mais vira juros na própria baixa, sem aprovação, até o menor
      -- entre o teto em centavos e o percentual do saldo (asaas_auto_config). Acima disso: exceção.
      SELECT least(coalesce(juros_max_cents, 0), floor(saldo * coalesce(juros_max_pct, 0) / 100)::bigint)
        INTO lim_tol FROM public.asaas_auto_config WHERE id;
      IF extra > coalesce(lim_tol, 0) THEN
        RETURN jsonb_build_object('baixa', false, 'motivo', 'valor_pago_maior_que_saldo', 'pago_cents', valor, 'saldo_cents', saldo,
                                  'limite_juros_cents', coalesce(lim_tol, 0));
      END IF;
      tolerancia := true;
    END IF;
    juros := extra;
  END IF;
  IF tarifa >= valor THEN RETURN jsonb_build_object('baixa', false, 'motivo', 'tarifa_invalida'); END IF;
  dia := least(coalesce(c.payment_date, c.confirmed_date, hoje), hoje);
  PERFORM set_config('lardan.baixa_asaas', 'on', true);
  BEGIN
    r := public.fin_settlement_create_ajustes(jsonb_build_object(
      'direction', 'receivable',
      'financial_account_id', destino,
      'data', dia::text,
      'valor_cents', valor,
      'tarifa_cents', tarifa,
      'juros_cents', juros,
      'referencia', 'Asaas ' || c.external_id,
      'observacao', CASE WHEN tolerancia THEN 'Baixa automática: recebimento confirmado pelo Asaas (diferença paga a mais lançada como juros, dentro do limite automático)'
                         WHEN juros > 0 THEN 'Baixa automática: recebimento confirmado pelo Asaas (com juros/multa do Asaas)'
                         ELSE 'Baixa automática: recebimento confirmado pelo Asaas' END,
      'idempotency_key', chave,
      'alocacoes', jsonb_build_array(jsonb_build_object('installment_id', parcela, 'valor_cents', valor))));
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('lardan.baixa_asaas', 'off', true);
    RETURN jsonb_build_object('baixa', false, 'motivo', 'motor_recusou', 'erro', SQLERRM);
  END;
  PERFORM set_config('lardan.baixa_asaas', 'off', true);
  IF cartao THEN transf := public.asaas_cartao_creditar(c.id); END IF;
  RETURN jsonb_build_object('baixa', true, 'conta', destino, 'juros_cents', juros, 'credito_cartao', transf, 'settlement_id', r->>'id', 'repetido', coalesce((r->>'repetido')::boolean,false),
    'installment_id', parcela, 'juros_tolerancia', tolerancia, 'valor_cents', valor, 'tarifa_cents', tarifa, 'data', dia);
END $function$;
CREATE OR REPLACE FUNCTION public.fin_mesa_novo_conciliar(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l financial_statement_lines%rowtype; v_dir fin_direction; v_ext text; v_title uuid; v_inst uuid;
  v_tarifa bigint := coalesce((_payload->>'tarifa_cents')::bigint,0); v_valor bigint; v_regra jsonb;
  v_key text; v_ex financial_reconciliations%rowtype; v_rec jsonb;
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  if v_tarifa < 0 then raise exception 'Tarifa não pode ser negativa'; end if;
  select * into l from financial_statement_lines where id = nullif(_payload->>'line_id','')::uuid for update;
  if l.id is null then raise exception 'Linha do extrato não encontrada'; end if;
  v_ext := 'extrato:' || l.id; v_key := 'mesa-novo:' || l.id;
  v_key := public.fin_reconcile_chave_livre(v_key);

  select * into v_ex from financial_reconciliations where idempotency_key = v_key;
  if found then
    select id into v_title from financial_titles where sistema_origem = 'extrato' and id_externo = v_ext;
    return jsonb_build_object('id', v_ex.id, 'settlement_id', v_ex.settlement_id, 'title_id', v_title, 'repetido', true);
  end if;
  if exists (select 1 from financial_titles where sistema_origem = 'extrato' and id_externo = v_ext) then
    raise exception 'Já existe um lançamento criado para esta linha do extrato. Use "Vincular a existente" para conciliar com ele.';
  end if;
  if l.status not in ('pendente','parcial','divergente') then
    raise exception 'Linha % não está disponível para conciliação (situação: %)', l.line_no, l.status;
  end if;

  -- 0285: um pay_ = um lançamento. Recebimento de cobrança espelhada do Asaas não vira título "do extrato":
  -- o lançamento nasce preso ao pay_ (asaas_extrato_lancar), e a baixa concilia a linha sozinha.
  if l.kind = 'entrada' and coalesce(l.raw->>'paymentId', '') like 'pay\_%' and exists (
       select 1 from asaas_charges c join asaas_accounts a on a.id = c.account_id
        where c.external_id = l.raw->>'paymentId' and a.financial_account_id = l.financial_account_id) then
    raise exception 'Este recebimento é da cobrança % do Asaas: o lançamento precisa nascer preso a ela para não duplicar. Use "Lançar pela cobrança do Asaas".', l.raw->>'paymentId';
  end if;

  v_dir := case when l.kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;
  v_valor := (l.valor_cents - l.conciliado_cents) + case when l.kind = 'entrada' then v_tarifa else -v_tarifa end;
  if v_valor <= 0 then raise exception 'Tarifa maior que o valor da linha'; end if;

  v_regra := fin_approval_rule();
  if coalesce((v_regra->>'exigir')::boolean,false) and v_valor >= coalesce((v_regra->>'valor_minimo_cents')::bigint,0) then
    raise exception 'A regra de aprovação exige que este lançamento nasça em rascunho. Crie o título em Pagar e receber, aprove e depois concilie.';
  end if;

  v_title := fin_title_create(jsonb_build_object(
    'direction', v_dir, 'party_id', _payload->>'party_id', 'descricao', _payload->>'descricao',
    'documento', _payload->>'documento', 'emissao', l.data::text,
    'competencia', coalesce(nullif(_payload->>'competencia',''), l.data::text),
    'observacao', _payload->>'observacao', 'cost_center_id', _payload->>'cost_center_id',
    'chart_account_id', _payload->>'chart_account_id', 'payment_method_id', _payload->>'payment_method_id',
    'business_entity_id', _payload->>'business_entity_id', 'financial_account_id', l.financial_account_id,
    'valor_cents', v_valor, 'status', 'ativo', 'origem', 'conciliacao',
    'sistema_origem', 'extrato', 'id_externo', v_ext,
    'parcelas', jsonb_build_array(jsonb_build_object('vencimento', l.data::text, 'valor_cents', v_valor))));
  select id into v_inst from financial_installments where title_id = v_title order by numero limit 1;

  v_rec := fin_reconcile(jsonb_build_object('line_ids', jsonb_build_array(l.id),
    'alocacoes', jsonb_build_array(jsonb_build_object('installment_id', v_inst, 'valor_cents', v_valor)),
    'tarifa_cents', v_tarifa, 'observacao', _payload->>'observacao', 'idempotency_key', v_key));
  return v_rec || jsonb_build_object('title_id', v_title);
end $function$;