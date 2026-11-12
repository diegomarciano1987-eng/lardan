-- ============ 0293 — ajustes do Asaas (Diego, 12/11/2026) ============
-- 1/8) Pix da consultora com maleta aberta entra em 3.1.1 ligado a ela (adiantamento), sem exceção.
-- 2) No acerto, só abate o que ela pagou pelo app (adiantamentos); o resto vira o título do acerto.
-- 3) Negativação Serasa/SPC em 4.1.5. 4) Tarifa de boleto em 4.1.2. 5) Pix/TED e demais tarifas seguem 5.1.3.
-- 7a) Linha com o mesmo nº de fatura e valor de baixa já importada liga sozinha. 7b) Ligar linha a transferência interna.
-- 7c) "Baixas já realizadas" busca fora dos 60 dias. 9) TED judicial: 7.1.7 + centro Administrativo.
-- Nada aqui apaga lançamento; tudo automático tem motivo e desfazer.

ALTER TABLE public.asaas_auto_decisoes DROP CONSTRAINT IF EXISTS asaas_auto_decisoes_acao_check;
ALTER TABLE public.asaas_auto_decisoes ADD CONSTRAINT asaas_auto_decisoes_acao_check
  CHECK (acao IN ('baixa_titulo','baixa_com_juros','titulo_3_1_1','vinculo_ja_baixado','lancado_pela_mesa','excecao','adiantamento_maleta','titulo_judicial'));
ALTER TABLE public.asaas_auto_extrato DROP CONSTRAINT IF EXISTS asaas_auto_extrato_tipo_check;
ALTER TABLE public.asaas_auto_extrato ADD CONSTRAINT asaas_auto_extrato_tipo_check
  CHECK (tipo IN ('identificacao','tarifa','notificacoes','transferencia','negativacao','fatura_baixa'));

ALTER TABLE public.asaas_auto_config
  ADD COLUMN IF NOT EXISTS boleto_chart_id uuid,
  ADD COLUMN IF NOT EXISTS negativacao_chart_id uuid,
  ADD COLUMN IF NOT EXISTS judicial_chart_id uuid,
  ADD COLUMN IF NOT EXISTS judicial_cost_center_id uuid;
UPDATE public.asaas_auto_config cfg SET
  boleto_chart_id = coalesce(cfg.boleto_chart_id, (SELECT id FROM public.chart_of_accounts WHERE codigo = '4.1.2' ORDER BY id LIMIT 1)),
  negativacao_chart_id = coalesce(cfg.negativacao_chart_id, (SELECT id FROM public.chart_of_accounts WHERE codigo = '4.1.5' ORDER BY id LIMIT 1)),
  judicial_chart_id = coalesce(cfg.judicial_chart_id, (SELECT id FROM public.chart_of_accounts WHERE codigo = '7.1.7' ORDER BY id LIMIT 1)),
  judicial_cost_center_id = coalesce(cfg.judicial_cost_center_id, (SELECT id FROM public.cost_centers WHERE lower(codigo) = 'administrativo' ORDER BY id LIMIT 1))
 WHERE cfg.id;
COMMENT ON COLUMN public.asaas_auto_config.boleto_chart_id IS '0293: tarifa de emissão de boleto (4.1.2); vazio = tarifa_chart_id.';
COMMENT ON COLUMN public.asaas_auto_config.negativacao_chart_id IS '0293: negativação Serasa/SPC do mês (4.1.5); vazio = notificacao_chart_id.';
COMMENT ON COLUMN public.asaas_auto_config.judicial_chart_id IS '0293: TED judicial sem processo cadastrado (7.1.7).';
COMMENT ON COLUMN public.asaas_auto_config.judicial_cost_center_id IS '0293: centro de custo do TED judicial (Administrativo).';

-- buscas por nº de fatura (Mesa e automático)
CREATE INDEX IF NOT EXISTS financial_titles_descricao_trgm ON public.financial_titles USING gin (descricao public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS asaas_charges_invoice_idx ON public.asaas_charges ((raw->>'invoiceNumber')) WHERE raw ? 'invoiceNumber';

-- ---------- adiantamentos da consultora (Pix com maleta aberta) ----------
CREATE TABLE IF NOT EXISTS public.asaas_maleta_adiantamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.asaas_charges(id),
  decisao_id uuid,
  party_id uuid NOT NULL,
  title_id uuid NOT NULL,
  installment_id uuid,
  settlement_id uuid,
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  maletas uuid[] NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz, desfeito_motivo text
);
CREATE UNIQUE INDEX IF NOT EXISTS asaas_maleta_adiantamentos_charge_uq ON public.asaas_maleta_adiantamentos (charge_id) WHERE desfeito_em IS NULL;
CREATE INDEX IF NOT EXISTS asaas_maleta_adiantamentos_party_idx ON public.asaas_maleta_adiantamentos (party_id) WHERE desfeito_em IS NULL;
GRANT SELECT ON public.asaas_maleta_adiantamentos TO authenticated;
GRANT ALL ON public.asaas_maleta_adiantamentos TO service_role;
ALTER TABLE public.asaas_maleta_adiantamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY asaas_maleta_adiantamentos_ler ON public.asaas_maleta_adiantamentos FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.reconcile')));
COMMENT ON TABLE public.asaas_maleta_adiantamentos IS '0293: Pix/boleto da consultora com maleta aberta, lançado em 3.1.1 no nome dela e abatido no acerto (asaas_adiantamento_usos).';

CREATE TABLE IF NOT EXISTS public.asaas_adiantamento_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adiantamento_id uuid NOT NULL REFERENCES public.asaas_maleta_adiantamentos(id),
  pre_baixa_id uuid NOT NULL REFERENCES public.kit_pre_baixas(id),
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  momento text NOT NULL CHECK (momento IN ('fechamento','conferencia')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asaas_adiantamento_usos_adi_idx ON public.asaas_adiantamento_usos (adiantamento_id);
CREATE INDEX IF NOT EXISTS asaas_adiantamento_usos_pb_idx ON public.asaas_adiantamento_usos (pre_baixa_id);
GRANT SELECT ON public.asaas_adiantamento_usos TO authenticated;
GRANT ALL ON public.asaas_adiantamento_usos TO service_role;
ALTER TABLE public.asaas_adiantamento_usos ENABLE ROW LEVEL SECURITY;
CREATE POLICY asaas_adiantamento_usos_ler ON public.asaas_adiantamento_usos FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.reconcile')));
COMMENT ON TABLE public.asaas_adiantamento_usos IS '0293: quanto de cada adiantamento da consultora foi abatido em qual acerto (pré-baixa); só insere.';

ALTER TABLE public.kit_pre_baixas ADD COLUMN IF NOT EXISTS adiantado_cents bigint NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.kit_pre_baixas.adiantado_cents IS '0293: Pix/boletos que a consultora já pagou com a maleta aberta, abatidos deste acerto.';

CREATE OR REPLACE FUNCTION public.asaas_adiantamento_disponivel(_party uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(sum(a.valor_cents - coalesce((SELECT sum(u.valor_cents) FROM public.asaas_adiantamento_usos u WHERE u.adiantamento_id = a.id), 0)), 0)::bigint
    FROM public.asaas_maleta_adiantamentos a
   WHERE a.desfeito_em IS NULL
     AND a.party_id = ANY(coalesce(public.party_e_unificadas(_party), ARRAY[]::uuid[]) || _party)
$$;
REVOKE ALL ON FUNCTION public.asaas_adiantamento_disponivel(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.asaas_adiantamento_consumir(_pb uuid, _party uuid, _max bigint, _momento text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; resto bigint := greatest(coalesce(_max, 0), 0); usado bigint := 0; livre bigint; parte bigint;
BEGIN
  IF resto = 0 THEN RETURN 0; END IF;
  FOR r IN SELECT a.id, a.valor_cents FROM public.asaas_maleta_adiantamentos a
            WHERE a.desfeito_em IS NULL
              AND a.party_id = ANY(coalesce(public.party_e_unificadas(_party), ARRAY[]::uuid[]) || _party)
            ORDER BY a.criado_em, a.id FOR UPDATE LOOP
    EXIT WHEN resto <= 0;
    livre := r.valor_cents - coalesce((SELECT sum(u.valor_cents) FROM public.asaas_adiantamento_usos u WHERE u.adiantamento_id = r.id), 0);
    CONTINUE WHEN livre <= 0;
    parte := least(livre, resto);
    INSERT INTO public.asaas_adiantamento_usos (adiantamento_id, pre_baixa_id, valor_cents, momento, criado_por)
    VALUES (r.id, _pb, parte, _momento, auth.uid());
    usado := usado + parte; resto := resto - parte;
  END LOOP;
  IF usado > 0 THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'asaas.adiantamento.abatido', 'kit_pre_baixas', _pb::text,
            jsonb_build_object('valor_cents', usado, 'momento', _momento, 'consultora', _party));
  END IF;
  RETURN usado;
END $$;
REVOKE ALL ON FUNCTION public.asaas_adiantamento_consumir(uuid,uuid,bigint,text) FROM PUBLIC, anon, authenticated;


CREATE FUNCTION pg_temp.troca(_def text, _de text, _para text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF position(_de IN _def) = 0 THEN RAISE EXCEPTION '0293: trecho não encontrado: %', left(_de, 120); END IF;
  RETURN replace(_def, _de, _para);
END $f$;

-- ---------- 0293: trocas nos núcleos do Asaas automático (sobre a versão em vigor; cada trecho precisa existir) ----------
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_receber_nucleo(uuid,uuid,boolean)'::regprocedure);
  novo := def;
  novo := pg_temp.troca(novo, $q$regra jsonb; dec uuid;
$q$, $q$regra jsonb; dec uuid;
  maletas uuid[]; jud jsonb; v_chart uuid; v_cc uuid; v_acao text; v_desc text; v_obs text; v_mot text;
$q$);
  novo := pg_temp.troca(novo, $q$  -- contas em aberto da pessoa (sem outra cobrança Asaas apontando para a parcela)
$q$, $q$  -- 0293: TED de tribunal. Com processo cadastrado: confere o acordo à mão. Sem processo: 7.1.7, centro Administrativo.
  IF c.billing_type = 'TRANSFER' OR coalesce(c.raw->>'description', '') ILIKE '%a partir de TED%' THEN
    jud := public.fin_judicial_por_historico(c.raw->>'description');
  END IF;
  IF jud IS NOT NULL AND (nullif(jud->>'party_id', '') IS NOT NULL OR cfg.judicial_chart_id IS NULL) THEN
    dec := public.asaas_auto_decidir(c.id, 'excecao',
      CASE WHEN cfg.judicial_chart_id IS NULL THEN 'TED judicial: conta 7.1.7 não configurada no automático'
           ELSE 'TED judicial de processo cadastrado: conferir o acordo judicial na Mesa' END,
      jsonb_build_object('judicial', jud), pid, NULL, NULL, NULL, valor, 0, _ator);
    RETURN jsonb_build_object('acao','excecao','motivo','ted_judicial','decisao',dec);
  END IF;

  -- contas em aberto da pessoa (sem outra cobrança Asaas apontando para a parcela)
$q$);
  novo := pg_temp.troca(novo, $q$    -- consultora com maleta Lardan em acerto: o Pix é desse acerto; 3.1.1 contaria a receita duas vezes
    IF EXISTS (SELECT 1 FROM public.kit_cycles k WHERE k.consultora_party_id = ANY(pessoas) AND k.status::text IN ('acerto','operacao','transito'))
       OR EXISTS (SELECT 1 FROM public.kit_pre_baixas pb WHERE pb.consultora_party_id = ANY(pessoas)
                    AND pb.encerrada_em IS NULL AND pb.status::text <> 'cancelada') THEN
      dec := public.asaas_auto_decidir(c.id, 'excecao', 'Consultora com maleta aberta (em vendas ou em acerto): confirmar se o Pix é dessa maleta',
        '{}'::jsonb, pid, NULL, NULL, NULL, valor, 0, _ator);
      RETURN jsonb_build_object('acao','excecao','motivo','maleta_em_acerto','decisao',dec);
    END IF;
$q$, $q$    -- 0293 (Diego, 12/11): consultora com maleta aberta (em vendas, trânsito ou acerto) não vai mais para a exceção:
    -- entra em 3.1.1 ligada a ela (adiantamento) e é abatida no acerto (asaas_adiantamento_consumir); TED judicial vai para 7.1.7.
    IF jud IS NULL THEN
      SELECT array_agg(DISTINCT z.x) INTO maletas FROM (
        SELECT k.id x FROM public.kit_cycles k WHERE k.consultora_party_id = ANY(pessoas) AND k.status::text IN ('acerto','operacao','transito')
        UNION
        SELECT pb.cycle_id FROM public.kit_pre_baixas pb WHERE pb.consultora_party_id = ANY(pessoas)
           AND pb.encerrada_em IS NULL AND pb.status::text <> 'cancelada') z WHERE z.x IS NOT NULL;
    END IF;
    IF jud IS NOT NULL THEN
      v_acao := 'titulo_judicial'; v_chart := cfg.judicial_chart_id; v_cc := cfg.judicial_cost_center_id;
      v_desc := 'TED judicial Asaas ' || c.external_id;
      v_obs := 'Lançado sozinho pelo Asaas: TED de tribunal sem processo cadastrado (7.1.7, centro Administrativo).';
      v_mot := 'TED judicial sem processo cadastrado: 7.1.7, centro Administrativo';
    ELSIF maletas IS NOT NULL THEN
      v_acao := 'adiantamento_maleta'; v_chart := (SELECT id FROM public.chart_of_accounts WHERE codigo = '3.1.1' ORDER BY id LIMIT 1); v_cc := NULL;
      v_desc := 'Pix da consultora (maleta aberta) Asaas ' || c.external_id;
      v_obs := 'Lançado sozinho pelo Asaas: pagamento da consultora com maleta aberta. Fica em 3.1.1 no nome dela e é abatido no acerto, onde as contas são redefinidas.';
      v_mot := 'Consultora com maleta aberta: 3.1.1 no nome dela, abatido no acerto';
    ELSE
      v_acao := 'titulo_3_1_1'; v_chart := (SELECT id FROM public.chart_of_accounts WHERE codigo = '3.1.1' ORDER BY id LIMIT 1); v_cc := NULL;
      v_desc := 'Recebimento Asaas ' || c.external_id;
      v_obs := 'Lançado sozinho pelo Asaas: recebimento sem nada em aberto da pessoa (3.1.1 Revenda de Mercadorias).';
      v_mot := 'Sem nada em aberto: título 3.1.1 criado e baixado';
    END IF;
$q$);
  novo := pg_temp.troca(novo, $q$'descricao', left('Recebimento Asaas ' || c.external_id || coalesce(' · ' || nullif(c.raw->>'description',''), ''), 300),$q$, $q$'descricao', left(v_desc || coalesce(' · ' || nullif(c.raw->>'description',''), ''), 300),$q$);
  novo := pg_temp.troca(novo, $q$'chart_account_id', (SELECT id FROM public.chart_of_accounts WHERE codigo = '3.1.1' ORDER BY id LIMIT 1),$q$, $q$'chart_account_id', v_chart, 'cost_center_id', v_cc,$q$);
  novo := pg_temp.troca(novo, $q$'observacao','Lançado sozinho pelo Asaas: recebimento sem nada em aberto da pessoa (3.1.1 Revenda de Mercadorias).',$q$, $q$'observacao', v_obs,$q$);
  novo := pg_temp.troca(novo, $q$PERFORM public.asaas_vincular_interno(c.id, tit, inst, 'Automático: título 3.1.1 criado para recebimento sem nada em aberto', _ator);$q$, $q$PERFORM public.asaas_vincular_interno(c.id, tit, inst, 'Automático: ' || v_mot, _ator);$q$);
  novo := pg_temp.troca(novo, $q$    dec := public.asaas_auto_decidir(c.id, 'titulo_3_1_1', 'Sem nada em aberto: título 3.1.1 criado e baixado',
      '{}'::jsonb, pid, tit, inst, nullif(b->>'settlement_id','')::uuid, valor, 0, _ator);
    RETURN jsonb_build_object('acao','titulo_3_1_1','decisao',dec,'title_id',tit,'baixa',b);$q$, $q$    dec := public.asaas_auto_decidir(c.id, v_acao, v_mot,
      CASE WHEN maletas IS NOT NULL THEN jsonb_build_object('maletas', to_jsonb(maletas))
           WHEN jud IS NOT NULL THEN jsonb_build_object('judicial', jud) ELSE '{}'::jsonb END,
      pid, tit, inst, nullif(b->>'settlement_id','')::uuid, valor, 0, _ator);
    IF v_acao = 'adiantamento_maleta' THEN
      INSERT INTO public.asaas_maleta_adiantamentos (charge_id, decisao_id, party_id, title_id, installment_id, settlement_id, valor_cents, maletas)
      VALUES (c.id, dec, pid, tit, inst, nullif(b->>'settlement_id','')::uuid, valor, maletas);
    END IF;
    RETURN jsonb_build_object('acao',v_acao,'decisao',dec,'title_id',tit,'baixa',b);$q$);
  EXECUTE novo;
END $patch$;
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_desfazer(uuid,text)'::regprocedure);
  novo := def;
  novo := pg_temp.troca(novo, $q$  IF d.acao = 'excecao' THEN RAISE EXCEPTION 'Exceção não tem lançamento para desfazer.'; END IF;
$q$, $q$  IF d.acao = 'excecao' THEN RAISE EXCEPTION 'Exceção não tem lançamento para desfazer.'; END IF;
  IF d.acao = 'adiantamento_maleta' AND EXISTS (SELECT 1 FROM public.asaas_maleta_adiantamentos ad JOIN public.asaas_adiantamento_usos u ON u.adiantamento_id = ad.id
                                                 WHERE ad.charge_id = d.charge_id AND ad.desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'Este Pix já foi abatido no acerto da maleta: não dá para desfazer por aqui.';
  END IF;
$q$);
  novo := pg_temp.troca(novo, $q$  IF d.acao IN ('titulo_3_1_1','lancado_pela_mesa') AND d.title_id IS NOT NULL THEN
    PERFORM public.fin_title_cancel(d.title_id, mot);
  END IF;
$q$, $q$  IF d.acao IN ('titulo_3_1_1','lancado_pela_mesa','adiantamento_maleta','titulo_judicial') AND d.title_id IS NOT NULL THEN
    PERFORM public.fin_title_cancel(d.title_id, mot);
  END IF;
  UPDATE public.asaas_maleta_adiantamentos SET desfeito_em = now(), desfeito_motivo = btrim(_motivo)
   WHERE charge_id = d.charge_id AND desfeito_em IS NULL;
$q$);
  novo := pg_temp.troca(novo, $q$'titulo_cancelado', d.acao IN ('titulo_3_1_1','lancado_pela_mesa'));$q$, $q$'titulo_cancelado', d.acao IN ('titulo_3_1_1','lancado_pela_mesa','adiantamento_maleta','titulo_judicial'));$q$);
  EXECUTE novo;
END $patch$;
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_extrato_nucleo(uuid,integer)'::regprocedure);
  novo := def;
  novo := pg_temp.troca(novo, $q$n_tr int := 0; v_tr bigint := 0;$q$, $q$n_tr int := 0; v_tr bigint := 0; n_fb int := 0; v_fb bigint := 0; n_neg int := 0; v_neg bigint := 0; fat text; tp_g text;$q$);
  novo := pg_temp.troca(novo, $q$  -- 2) tarifa do Pix/boleto que não está no razão (recebimento conciliado com baixa sem tarifa) -> 5.1.3
$q$, $q$  -- 1b) 0293: linha com o mesmo nº de fatura e o mesmo valor de uma baixa já importada (antecipação, taxa de antecipação,
  --     baixa da antecipação, taxa de cartão/boleto/Pix): liga à baixa existente, 1 para 1, nenhum lançamento novo
  FOR r IN
    SELECT f.id lid, f.financial_account_id conta, f.valor_cents v, f.kind, f.raw->>'type' tp,
           substring(f.raw->>'description' from 'fatura nr\. ([0-9]{6,})') fat
      FROM public.financial_statement_lines f
     WHERE f.status = 'pendente' AND f.conciliado_cents = 0 AND f.valor_cents > 0
       AND f.raw->>'type' IN ('RECEIVABLE_ANTICIPATION_GROSS_CREDIT','RECEIVABLE_ANTICIPATION_DEBIT','RECEIVABLE_ANTICIPATION_FEE','PAYMENT_FEE')
       AND f.raw->>'description' ~ 'fatura nr\. [0-9]{6,}'
       AND EXISTS (SELECT 1 FROM public.asaas_accounts a WHERE a.financial_account_id = f.financial_account_id)
       AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE f.id = ANY(e.line_ids) AND e.desfeito_em IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE e.tipo = 'fatura_baixa' AND e.chave = f.id::text)
     ORDER BY f.data, f.line_no LIMIT lim
  LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '40 seconds';
    BEGIN
      sid := NULL;
      SELECT count(*), min(x.id::text)::uuid INTO ns, sid FROM (
        SELECT DISTINCT s.id
          FROM public.financial_titles t
          JOIN public.financial_installments i ON i.title_id = t.id
          JOIN public.financial_allocations al ON al.installment_id = i.id
          JOIN public.financial_settlements s ON s.id = al.settlement_id
         WHERE t.status = 'ativo' AND t.descricao ILIKE '%fatura nr. ' || r.fat || '%'
           AND t.descricao ~ ('fatura nr\. ' || r.fat || '([^0-9]|$)')
           AND s.financial_account_id = r.conta
           AND s.direction = (CASE WHEN r.kind = 'entrada' THEN 'receivable' ELSE 'payable' END)::fin_direction
           AND NOT s.is_reversal AND NOT EXISTS (SELECT 1 FROM public.financial_settlements x WHERE x.reversed_of = s.id)
           AND NOT EXISTS (SELECT 1 FROM public.financial_reconciliations rc WHERE rc.settlement_id = s.id AND rc.status = 'ativa')
           AND abs(coalesce((SELECT sum(m.valor_cents) FROM public.financial_account_movements m WHERE m.settlement_id = s.id), 0)) = r.v) x;
      IF ns <> 1 THEN
        pulos := pulos || jsonb_build_object('fatura_' || CASE WHEN ns = 0 THEN 'sem_baixa' ELSE 'ambigua' END,
                   coalesce((pulos->>('fatura_' || CASE WHEN ns = 0 THEN 'sem_baixa' ELSE 'ambigua' END))::int, 0) + 1);
        CONTINUE;
      END IF;
      -- a mesma baixa não pode servir para duas linhas iguais
      IF (SELECT count(*) FROM public.financial_statement_lines f2
           WHERE f2.financial_account_id = r.conta AND f2.kind = r.kind AND f2.status = 'pendente' AND f2.conciliado_cents = 0
             AND f2.valor_cents = r.v AND f2.raw->>'description' ~ ('fatura nr\. ' || r.fat || '([^0-9]|$)')) <> 1 THEN
        pulos := pulos || jsonb_build_object('fatura_ambigua', coalesce((pulos->>'fatura_ambigua')::int, 0) + 1);
        CONTINUE;
      END IF;
      res := public.fin_reconcile_baixa_existente(ARRAY[r.lid], sid, 'asaas:fatura-baixa:' || r.lid,
        'Automático: mesmo nº de fatura (' || r.fat || ') e mesmo valor da baixa já importada; nenhum lançamento novo');
      INSERT INTO public.asaas_auto_extrato (tipo, chave, financial_account_id, line_ids, reconciliation_id, valor_cents, detalhe, motivo, actor_id)
      VALUES ('fatura_baixa', r.lid::text, r.conta, ARRAY[r.lid], nullif(res->>'id','')::uuid, r.v,
              jsonb_build_object('fatura', r.fat, 'tipo_linha', r.tp, 'settlement_id', sid),
              'Linha do extrato ligada à baixa já importada com o mesmo nº de fatura e valor (nenhum dinheiro novo)', _ator);
      n_fb := n_fb + 1; v_fb := v_fb + r.v;
    EXCEPTION WHEN OTHERS THEN erros := erros + 1; ult_erro := left('fatura ' || r.fat || ': ' || SQLERRM, 300);
    END;
  END LOOP;

  -- 2) tarifa do Pix/boleto que não está no razão (recebimento conciliado com baixa sem tarifa) -> 5.1.3; boleto -> 4.1.2 (0293)
$q$);
  novo := pg_temp.troca(novo, $q$      SELECT f.id lid, f.financial_account_id conta, f.valor_cents v, f.data, f.raw->>'paymentId' pay
$q$, $q$      SELECT f.id lid, f.financial_account_id conta, f.valor_cents v, f.data, f.raw->>'paymentId' pay,
             (coalesce(f.raw->>'description', '') ILIKE 'Taxa de boleto%' AND cfg.boleto_chart_id IS NOT NULL) boleto
$q$);
  novo := pg_temp.troca(novo, $q$         -- a baixa ligada ao recebimento não descontou tarifa (senão ela já está no razão)
$q$, $q$         -- 0293: tarifa que já está numa baixa importada (mesmo nº de fatura e valor) nunca é relançada (a etapa 1b liga)
         AND NOT EXISTS (SELECT 1 FROM public.financial_titles tt
                          WHERE substring(f.raw->>'description' from 'fatura nr\. ([0-9]{6,})') IS NOT NULL
                            AND tt.status = 'ativo' AND tt.direction = 'payable' AND tt.valor_cents = f.valor_cents
                            AND tt.descricao ILIKE '%fatura nr. ' || substring(f.raw->>'description' from 'fatura nr\. ([0-9]{6,})') || '%')
         -- a baixa ligada ao recebimento não descontou tarifa (senão ela já está no razão)
$q$);
  novo := pg_temp.troca(novo, $q$          'descricao', 'Tarifa Asaas do recebimento ' || r.pay, 'documento', r.pay,
          'chart_account_id', cfg.tarifa_chart_id, 'cost_center_id', cfg.tarifa_cost_center_id, 'business_entity_id', ent,
          'observacao', 'Lançado sozinho pelo Asaas: tarifa do recebimento ' || r.pay || ' (5.1.3)'));$q$, $q$          'descricao', CASE WHEN r.boleto THEN 'Tarifa Asaas de emissão do boleto ' ELSE 'Tarifa Asaas do recebimento ' END || r.pay, 'documento', r.pay,
          'chart_account_id', CASE WHEN r.boleto THEN cfg.boleto_chart_id ELSE cfg.tarifa_chart_id END,
          'cost_center_id', cfg.tarifa_cost_center_id, 'business_entity_id', ent,
          'observacao', 'Lançado sozinho pelo Asaas: tarifa do recebimento ' || r.pay || CASE WHEN r.boleto THEN ' (boleto, 4.1.2)' ELSE ' (5.1.3)' END));$q$);
  novo := pg_temp.troca(novo, $q$                jsonb_build_object('pay', r.pay, 'settlement_id', res->>'settlement_id'), 'Tarifa do Pix/boleto lançada em 5.1.3 (Asaas - Sistema Pagamento)', _ator);$q$, $q$                jsonb_build_object('pay', r.pay, 'settlement_id', res->>'settlement_id', 'boleto', r.boleto),
                CASE WHEN r.boleto THEN 'Tarifa de emissão do boleto lançada em 4.1.2 (Asaas - Sistema Pagamento)'
                     ELSE 'Tarifa do Pix lançada em 5.1.3 (Asaas - Sistema Pagamento)' END, _ator);$q$);
  novo := pg_temp.troca(novo, $q$  -- 3) notificações (WhatsApp, SMS, robô de voz) e negativação: um título por mês em 5.1.1, só de mês já fechado (+3 dias)
$q$, $q$  -- 3) notificações (WhatsApp, SMS, robô de voz) um título por mês em 5.1.1; negativação Serasa/SPC outro título por mês em 4.1.5 (0293); só mês fechado (+3 dias)
$q$);
  novo := pg_temp.troca(novo, $q$      SELECT f.financial_account_id conta, date_trunc('month', f.data)::date mes, array_agg(f.id ORDER BY f.data, f.line_no) ids,$q$, $q$      SELECT f.financial_account_id conta, date_trunc('month', f.data)::date mes,
             CASE WHEN coalesce(f.raw->>'type', '') ~ 'DUNNING' THEN 'negativacao' ELSE 'notificacoes' END grupo,
             array_agg(f.id ORDER BY f.data, f.line_no) ids,$q$);
  novo := pg_temp.troca(novo, $q$       GROUP BY 1, 2 ORDER BY 2 LIMIT 24$q$, $q$       GROUP BY 1, 2, 3 ORDER BY 2, 3 LIMIT 48$q$);
  novo := pg_temp.troca(novo, $q$          pulos := pulos || jsonb_build_object('notificacoes_' || to_char(g.mes, 'YYYY-MM'), 'periodo_fechado');$q$, $q$          pulos := pulos || jsonb_build_object(g.grupo || '_' || to_char(g.mes, 'YYYY-MM'), 'periodo_fechado');$q$);
  novo := pg_temp.troca(novo, $q$         WHERE e.tipo = 'notificacoes' AND e.chave LIKE g.conta || ':' || to_char(g.mes, 'YYYY-MM') || '%';$q$, $q$         WHERE e.tipo = g.grupo AND e.chave LIKE g.conta || ':' || to_char(g.mes, 'YYYY-MM') || '%';$q$);
  novo := pg_temp.troca(novo, $q$          'descricao', 'Notificações e negativação Asaas ' || to_char(g.mes, 'MM/YYYY') || CASE WHEN k > 0 THEN ' (complemento)' ELSE '' END,
          'documento', 'ASAAS-NOTIF-' || to_char(g.mes, 'YYYY-MM'),$q$, $q$          'descricao', CASE WHEN g.grupo = 'negativacao' THEN 'Negativação Serasa/SPC Asaas ' ELSE 'Notificações Asaas (WhatsApp, SMS e robô de voz) ' END
                       || to_char(g.mes, 'MM/YYYY') || CASE WHEN k > 0 THEN ' (complemento)' ELSE '' END,
          'documento', CASE WHEN g.grupo = 'negativacao' THEN 'ASAAS-NEGAT-' ELSE 'ASAAS-NOTIF-' END || to_char(g.mes, 'YYYY-MM'),$q$);
  novo := pg_temp.troca(novo, $q$          'chart_account_id', cfg.notificacao_chart_id, 'cost_center_id', cfg.notificacao_cost_center_id,$q$, $q$          'chart_account_id', CASE WHEN g.grupo = 'negativacao' THEN coalesce(cfg.negativacao_chart_id, cfg.notificacao_chart_id) ELSE cfg.notificacao_chart_id END,
          'cost_center_id', cfg.notificacao_cost_center_id,$q$);
  novo := pg_temp.troca(novo, $q$'id_externo', 'asaas:notificacoes:' || ch,$q$, $q$'id_externo', 'asaas:' || g.grupo || ':' || ch,$q$);
  novo := pg_temp.troca(novo, $q$          'observacao', 'Lançado sozinho pelo Asaas: ' || g.n || ' tarifas de notificação/negativação do mês (5.1.1)',$q$, $q$          'observacao', 'Lançado sozinho pelo Asaas: ' || g.n || CASE WHEN g.grupo = 'negativacao' THEN ' taxas de negativação Serasa/SPC do mês (4.1.5)' ELSE ' tarifas de notificação do mês (5.1.1)' END,$q$);
  novo := pg_temp.troca(novo, $q$          'observacao', 'Automático: notificações e negativação do Asaas ' || to_char(g.mes, 'MM/YYYY'),
          'idempotency_key', 'asaas:notificacoes:' || ch));$q$, $q$          'observacao', 'Automático: ' || CASE WHEN g.grupo = 'negativacao' THEN 'negativação' ELSE 'notificações' END || ' do Asaas ' || to_char(g.mes, 'MM/YYYY'),
          'idempotency_key', 'asaas:' || g.grupo || ':' || ch));$q$);
  novo := pg_temp.troca(novo, $q$        VALUES ('notificacoes', ch, g.conta, g.ids, tit, nullif(res->>'id','')::uuid, g.v,
                jsonb_build_object('mes', to_char(g.mes, 'YYYY-MM'), 'linhas', g.n, 'settlement_id', res->>'settlement_id'),
                'Notificações e negativação do mês em um título 5.1.1 (Asaas - Sistema Pagamento)', _ator);
        n_not := n_not + 1; v_not := v_not + g.v;$q$, $q$        VALUES (g.grupo, ch, g.conta, g.ids, tit, nullif(res->>'id','')::uuid, g.v,
                jsonb_build_object('mes', to_char(g.mes, 'YYYY-MM'), 'linhas', g.n, 'settlement_id', res->>'settlement_id'),
                CASE WHEN g.grupo = 'negativacao' THEN 'Negativação Serasa/SPC do mês em um título 4.1.5 (Asaas - Sistema Pagamento)'
                     ELSE 'Notificações do mês em um título 5.1.1 (Asaas - Sistema Pagamento)' END, _ator);
        IF g.grupo = 'negativacao' THEN n_neg := n_neg + 1; v_neg := v_neg + g.v; ELSE n_not := n_not + 1; v_not := v_not + g.v; END IF;$q$);
  novo := pg_temp.troca(novo, $q$         AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE e.tipo = 'transferencia' AND e.transfer_id = m.transfer_id AND e.desfeito_em IS NULL);$q$, $q$         AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE e.tipo = 'transferencia' AND e.transfer_id = m.transfer_id AND e.desfeito_em IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.fin_extrato_transferencias v WHERE v.transfer_id = m.transfer_id AND v.financial_account_id = r.conta AND v.desfeito_em IS NULL);$q$);
  novo := pg_temp.troca(novo, $q$'tarifas', n_tar, 'tarifas_cents', v_tar, 'notificacoes_meses', n_not, 'notificacoes_cents', v_not,$q$, $q$'faturas_ligadas', n_fb, 'faturas_ligadas_cents', v_fb, 'tarifas', n_tar, 'tarifas_cents', v_tar, 'notificacoes_meses', n_not, 'notificacoes_cents', v_not,
    'negativacao_meses', n_neg, 'negativacao_cents', v_neg,$q$);
  EXECUTE novo;
END $patch$;
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_extrato_desfazer(uuid,text)'::regprocedure);
  novo := def;
  novo := pg_temp.troca(novo, $q$  IF e.tipo = 'identificacao' THEN
$q$, $q$  IF e.tipo IN ('identificacao','fatura_baixa') THEN
$q$);
  novo := pg_temp.troca(novo, $q$    SELECT * INTO c FROM public.asaas_charges WHERE id = e.charge_id FOR UPDATE;
    IF c.title_id = e.title_id THEN$q$, $q$  END IF;
  IF e.tipo = 'identificacao' THEN
    SELECT * INTO c FROM public.asaas_charges WHERE id = e.charge_id FOR UPDATE;
    IF c.title_id = e.title_id THEN$q$);
  novo := pg_temp.troca(novo, $q$  ELSIF e.tipo IN ('tarifa','notificacoes') THEN$q$, $q$  ELSIF e.tipo IN ('tarifa','notificacoes','negativacao') THEN$q$);
  EXECUTE novo;
END $patch$;


-- ---------- 0293: acerto abate os Pix que a consultora já pagou com a maleta aberta ----------
CREATE OR REPLACE FUNCTION public.pre_baixa_calculo(_pb uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE p kit_pre_baixas; vendido bigint; outros bigint; base bigint; pct numeric; com bigint; recebido bigint; aguardando bigint;
  disponivel bigint; adiantado bigint;
BEGIN
  SELECT * INTO p FROM kit_pre_baixas WHERE id = _pb;
  SELECT coalesce(sum(qtd_vendida::bigint * preco_cents), 0) INTO vendido FROM kit_pre_baixa_itens WHERE pre_baixa_id = _pb;
  SELECT coalesce(sum(coalesce(o.vendido_final_cents, o.total_vendido_cents)), 0) INTO outros
    FROM kit_pre_baixas o WHERE o.remessa_id = p.remessa_id AND p.remessa_id IS NOT NULL
     AND o.consultora_party_id = p.consultora_party_id AND o.id <> p.id AND o.status IN ('fechada', 'encerrada', 'pendencia');
  base := vendido + outros;
  pct := public.pre_baixa_faixa(base);
  com := round(vendido * pct / 100);
  recebido := public.pre_baixa_recebido_lardan(p.cycle_id);
  SELECT coalesce(sum(i.quantity::bigint * i.unit_price_cents), 0) INTO aguardando
    FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id
   WHERE i.cycle_id = p.cycle_id AND o.status <> 'cancelado' AND o.payment_status = 'pendente'
     AND o.pay_installment_id IS NOT NULL AND coalesce(o.pay_method, '') <> 'dinheiro';
  -- 0293: Pix/boletos que a consultora pagou pelo app com a maleta aberta (asaas_maleta_adiantamentos)
  disponivel := public.asaas_adiantamento_disponivel(p.consultora_party_id);
  IF p.status = 'aberta' THEN adiantado := least(disponivel, greatest(vendido - com - recebido, 0));
  ELSE adiantado := coalesce(p.adiantado_cents, 0); END IF;
  RETURN jsonb_build_object('vendido_cents', vendido, 'base_faixa_cents', base, 'comissao_pct', pct,
                            'comissao_cents', com, 'recebido_lardan_cents', recebido, 'aguardando_lardan_cents', aguardando,
                            'adiantado_consultora_cents', adiantado, 'adiantamento_disponivel_cents', disponivel,
                            'valor_pagar_cents', vendido - com - recebido - adiantado);
END $function$;

CREATE OR REPLACE FUNCTION public.pre_baixa_fechar(_cycle uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); v uuid; p kit_pre_baixas; calc jsonb; cfg consultora_cobranca_config; tid uuid; inst uuid;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; k text; nome text; adi bigint;
BEGIN
  v := public.pre_baixa_abrir(_cycle);
  SELECT * INTO p FROM kit_pre_baixas WHERE id = v FOR UPDATE;
  IF p.status <> 'aberta' THEN
    RETURN jsonb_build_object('pre_baixa', p.id, 'repetida', true, 'installment_id', p.installment_id,
      'actor', (SELECT ator_user_id FROM consultora_cobranca_config WHERE id), 'valor_pagar_cents', p.valor_pagar_cents,
      'vencimento', greatest(coalesce(p.prazo, hoje), hoje));
  END IF;
  calc := public.pre_baixa_calculo(v);
  -- 0293: abate os Pix que ela já pagou (trava os adiantamentos; o que sobrar fica para o próximo acerto)
  adi := public.asaas_adiantamento_consumir(v, p.consultora_party_id, coalesce((calc->>'adiantado_consultora_cents')::bigint, 0), 'fechamento');
  IF adi <> coalesce((calc->>'adiantado_consultora_cents')::bigint, 0) THEN
    calc := calc || jsonb_build_object('adiantado_consultora_cents', adi,
      'valor_pagar_cents', (calc->>'vendido_cents')::bigint - (calc->>'comissao_cents')::bigint - (calc->>'recebido_lardan_cents')::bigint - adi);
  END IF;
  UPDATE kit_pre_baixas SET status = 'fechada', total_vendido_cents = (calc->>'vendido_cents')::bigint,
         base_faixa_cents = (calc->>'base_faixa_cents')::bigint, comissao_pct = (calc->>'comissao_pct')::numeric,
         comissao_cents = (calc->>'comissao_cents')::bigint, valor_pagar_cents = (calc->>'valor_pagar_cents')::bigint,
         recebido_lardan_cents = (calc->>'recebido_lardan_cents')::bigint, adiantado_cents = adi,
         fechada_em = now(), fechada_por = uid, updated_at = now()
   WHERE id = v;
  IF (calc->>'valor_pagar_cents')::bigint > 0 THEN
    SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
    IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
    SELECT kk.code INTO k FROM kits kk JOIN kit_cycles c ON c.kit_id = kk.id WHERE c.id = _cycle;
    SELECT display_name INTO nome FROM parties WHERE id = p.consultora_party_id;
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (uid, 'pre_baixa.fechada', 'kit_pre_baixas', v::text, calc || jsonb_build_object('ator_real', uid));
    PERFORM public.pdv_como(cfg.ator_user_id);
    tid := public.fin_title_create(jsonb_build_object('direction', 'receivable', 'business_entity_id', cfg.business_entity_id,
      'party_id', p.consultora_party_id, 'descricao', 'Acerto da maleta ' || coalesce(k, '') || ' — ' || coalesce(nome, 'consultora'),
      'documento', 'ACERTO-' || coalesce(k, left(v::text, 8)), 'emissao', hoje, 'competencia', hoje,
      'valor_cents', (calc->>'valor_pagar_cents')::bigint, 'financial_account_id', cfg.financial_account_id,
      'origem', 'pre_baixa', 'sistema_origem', 'pre_baixa', 'id_externo', 'prebaixa:' || v, 'status', 'ativo',
      'observacao', CASE WHEN adi > 0 THEN 'Já abatidos R$ ' || replace(to_char(adi / 100.0, 'FM999999990.00'), '.', ',')
                                           || ' de Pix/boletos que a consultora pagou pelo app com a maleta aberta.' END,
      'parcelas', jsonb_build_array(jsonb_build_object('valor_cents', (calc->>'valor_pagar_cents')::bigint,
                                                       'vencimento', greatest(coalesce(p.prazo, hoje), hoje)))));
    SELECT id INTO inst FROM financial_installments WHERE title_id = tid ORDER BY numero LIMIT 1;
    UPDATE kit_pre_baixas SET title_id = tid, installment_id = inst WHERE id = v;
  END IF;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  SELECT _cycle, 'pre_baixa.fechada', c.status, c.status, uid, calc FROM kit_cycles c WHERE c.id = _cycle;
  RETURN jsonb_build_object('pre_baixa', v, 'repetida', false, 'installment_id', inst,
    'actor', (SELECT ator_user_id FROM consultora_cobranca_config WHERE id), 'valor_pagar_cents', (calc->>'valor_pagar_cents')::bigint,
    'adiantado_consultora_cents', adi, 'vencimento', greatest(coalesce(p.prazo, hoje), hoje));
END $function$;

DO $patch$
DECLARE def text; novo text;
  pedacos text[][] := ARRAY[
    ARRAY['desconhecida text;', 'desconhecida text; adi_extra bigint := 0; adi_usado bigint;'],
    ARRAY[E'  valor_final := vend_final - com - rec_novo;\n  dif := valor_final - p.valor_pagar_cents;',
          E'  valor_final := vend_final - com - rec_novo - coalesce(p.adiantado_cents, 0);\n  dif := valor_final - p.valor_pagar_cents;\n'
          || E'  -- 0293: diferença a cobrar abate primeiro os Pix que a consultora pagou pelo app depois do fechamento\n'
          || E'  IF dif > 0 THEN adi_extra := least(public.asaas_adiantamento_disponivel(p.consultora_party_id), dif); END IF;\n'
          || E'  valor_final := valor_final - adi_extra; dif := dif - adi_extra;'],
    ARRAY[E'''pre_baixa_paga'', public.pre_baixa_pago(p), ''itens'', itens);',
          E'''pre_baixa_paga'', public.pre_baixa_pago(p), ''itens'', itens,\n    ''adiantado_consultora_cents'', coalesce(p.adiantado_cents, 0) + adi_extra, ''adiantado_depois_cents'', adi_extra);'],
    ARRAY[E'  IF NOT coalesce(_aplicar, false) THEN RETURN ret || jsonb_build_object(''aplicado'', false); END IF;\n',
          E'  IF NOT coalesce(_aplicar, false) THEN RETURN ret || jsonb_build_object(''aplicado'', false); END IF;\n'
          || E'  IF adi_extra > 0 THEN\n'
          || E'    adi_usado := public.asaas_adiantamento_consumir(p.id, p.consultora_party_id, adi_extra, ''conferencia'');\n'
          || E'    IF adi_usado <> adi_extra THEN RAISE EXCEPTION ''Os Pix da consultora mudaram durante a conferência. Confira de novo.''; END IF;\n'
          || E'  END IF;\n'],
    ARRAY[E'recebido_lardan_cents = rec_novo,\n         pendencia_motivo',
          E'recebido_lardan_cents = rec_novo, adiantado_cents = coalesce(p.adiantado_cents, 0) + adi_extra,\n         pendencia_motivo']
  ];
  i int;
BEGIN
  def := pg_get_functiondef('public.pre_baixa_conferir(uuid,jsonb,boolean)'::regprocedure);
  novo := def;
  FOR i IN 1 .. array_length(pedacos, 1) LOOP
    IF position(pedacos[i][1] IN novo) = 0 THEN RAISE EXCEPTION '0293: trecho % não encontrado em pre_baixa_conferir', i; END IF;
    novo := replace(novo, pedacos[i][1], pedacos[i][2]);
  END LOOP;
  EXECUTE novo;
END $patch$;

-- ---------- 0293: Mesa — ligar linha do extrato a uma transferência interna ----------
CREATE TABLE IF NOT EXISTS public.fin_extrato_transferencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.financial_statement_lines(id),
  transfer_id uuid NOT NULL REFERENCES public.financial_transfers(id),
  financial_account_id uuid NOT NULL,
  valor_cents bigint NOT NULL,
  observacao text,
  criado_por uuid, criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz, desfeito_por uuid, desfeito_motivo text
);
CREATE UNIQUE INDEX IF NOT EXISTS fin_extrato_transferencias_linha_uq ON public.fin_extrato_transferencias (line_id) WHERE desfeito_em IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fin_extrato_transferencias_transf_uq ON public.fin_extrato_transferencias (transfer_id, financial_account_id) WHERE desfeito_em IS NULL;
GRANT SELECT ON public.fin_extrato_transferencias TO authenticated;
GRANT ALL ON public.fin_extrato_transferencias TO service_role;
ALTER TABLE public.fin_extrato_transferencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY fin_extrato_transferencias_ler ON public.fin_extrato_transferencias FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.statement.view')));
COMMENT ON TABLE public.fin_extrato_transferencias IS '0293: linha do extrato conferida contra uma transferência entre contas já lançada (sem receita nem despesa); desfazer devolve a linha para pendente.';

CREATE OR REPLACE FUNCTION public.fin_mesa_transferencias(_line_id uuid, _busca text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l financial_statement_lines%rowtype; v_res jsonb; v_b text := nullif(btrim(coalesce(_busca, '')), '');
BEGIN
  IF NOT has_capability(auth.uid(), 'finance.reconcile') THEN RAISE EXCEPTION 'Sem permissão para conciliar'; END IF;
  SELECT * INTO l FROM financial_statement_lines WHERE id = _line_id;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Linha não encontrada'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.mesmo_valor DESC, abs(z.data - l.data)), '[]'::jsonb) INTO v_res FROM (
    SELECT tr.id, m.data, abs(m.valor_cents) valor_cents, (abs(m.valor_cents) = l.valor_cents - l.conciliado_cents) mesmo_valor,
           tr.referencia, tr.motivo, fo.nome conta_origem, fd.nome conta_destino
      FROM financial_account_movements m
      JOIN financial_transfers tr ON tr.id = m.transfer_id
      LEFT JOIN financial_accounts fo ON fo.id = tr.from_account_id
      LEFT JOIN financial_accounts fd ON fd.id = tr.to_account_id
     WHERE m.financial_account_id = l.financial_account_id
       AND m.kind = (CASE WHEN l.kind = 'entrada' THEN 'transferencia_entrada' ELSE 'transferencia_saida' END)::fin_movement_kind
       AND NOT tr.is_reversal AND NOT EXISTS (SELECT 1 FROM financial_transfers x WHERE x.reversed_of = tr.id)
       AND NOT EXISTS (SELECT 1 FROM fin_extrato_transferencias v WHERE v.transfer_id = tr.id AND v.financial_account_id = l.financial_account_id AND v.desfeito_em IS NULL)
       AND NOT EXISTS (SELECT 1 FROM asaas_auto_extrato e WHERE e.tipo = 'transferencia' AND e.transfer_id = tr.id AND e.desfeito_em IS NULL
                         AND e.financial_account_id = l.financial_account_id)
       AND (CASE WHEN v_b IS NULL THEN m.data BETWEEN l.data - 15 AND l.data + 15
                 ELSE (concat_ws(' ', tr.referencia, tr.motivo, fo.nome, fd.nome) ILIKE '%' || v_b || '%'
                       OR replace(to_char(abs(m.valor_cents) / 100.0, 'FM999999990.00'), '.', ',') = replace(v_b, '.', ',')) END)
     ORDER BY (abs(m.valor_cents) = l.valor_cents - l.conciliado_cents) DESC, abs(m.data - l.data) LIMIT 30) z;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.fin_mesa_transferencias(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_mesa_transferencias(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fin_mesa_ligar_transferencia(_line_id uuid, _transfer_id uuid, _observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l financial_statement_lines%rowtype; tr financial_transfers%rowtype; v_mov bigint; v_id uuid; v_ex uuid;
BEGIN
  IF NOT (has_capability(auth.uid(), 'finance.reconcile') AND has_capability(auth.uid(), 'finance.statement.flag')) THEN
    RAISE EXCEPTION 'Sem permissão para conferir linhas do extrato';
  END IF;
  SELECT * INTO l FROM financial_statement_lines WHERE id = _line_id FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Linha não encontrada'; END IF;
  SELECT id INTO v_ex FROM fin_extrato_transferencias WHERE line_id = l.id AND transfer_id = _transfer_id AND desfeito_em IS NULL;
  IF v_ex IS NOT NULL THEN RETURN jsonb_build_object('id', v_ex, 'repetido', true); END IF;
  IF l.status NOT IN ('pendente', 'divergente') OR l.conciliado_cents <> 0 THEN
    RAISE EXCEPTION 'Linha % não está disponível (situação: %). Desfaça o que estiver ligado a ela antes.', l.line_no, l.status;
  END IF;
  SELECT * INTO tr FROM financial_transfers WHERE id = _transfer_id FOR UPDATE;
  IF tr.id IS NULL OR tr.is_reversal OR EXISTS (SELECT 1 FROM financial_transfers x WHERE x.reversed_of = tr.id) THEN
    RAISE EXCEPTION 'Transferência não encontrada ou estornada';
  END IF;
  SELECT abs(m.valor_cents) INTO v_mov FROM financial_account_movements m
   WHERE m.transfer_id = tr.id AND m.financial_account_id = l.financial_account_id
     AND m.kind = (CASE WHEN l.kind = 'entrada' THEN 'transferencia_entrada' ELSE 'transferencia_saida' END)::fin_movement_kind
   LIMIT 1;
  IF v_mov IS NULL THEN RAISE EXCEPTION 'Esta transferência não passa pela conta desta linha (ou está no sentido contrário).'; END IF;
  IF v_mov <> l.valor_cents THEN
    RAISE EXCEPTION 'Valor diferente: a linha tem R$ % e a transferência R$ %.',
      replace(to_char(l.valor_cents / 100.0, 'FM999999990.00'), '.', ','), replace(to_char(v_mov / 100.0, 'FM999999990.00'), '.', ',');
  END IF;
  IF EXISTS (SELECT 1 FROM fin_extrato_transferencias v WHERE v.transfer_id = tr.id AND v.financial_account_id = l.financial_account_id AND v.desfeito_em IS NULL)
     OR EXISTS (SELECT 1 FROM asaas_auto_extrato e WHERE e.tipo = 'transferencia' AND e.transfer_id = tr.id AND e.desfeito_em IS NULL
                  AND e.financial_account_id = l.financial_account_id) THEN
    RAISE EXCEPTION 'Esta transferência já está ligada a outra linha do extrato desta conta.';
  END IF;
  INSERT INTO fin_extrato_transferencias (line_id, transfer_id, financial_account_id, valor_cents, observacao, criado_por)
  VALUES (l.id, tr.id, l.financial_account_id, l.valor_cents, nullif(btrim(coalesce(_observacao, '')), ''), auth.uid()) RETURNING id INTO v_id;
  PERFORM fin_statement_line_flag(l.id, 'ignorada',
    left('Ligada à transferência entre contas de ' || to_char(tr.data, 'DD/MM/YYYY') || ' (sem receita nem despesa)'
         || coalesce(' — ' || nullif(btrim(coalesce(_observacao, '')), ''), ''), 300));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'fin.extrato.transferencia.ligar', 'financial_statement_lines', l.id::text,
          jsonb_build_object('vinculo', v_id, 'transfer_id', tr.id, 'valor_cents', l.valor_cents));
  RETURN jsonb_build_object('id', v_id, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.fin_mesa_ligar_transferencia(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_mesa_ligar_transferencia(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fin_mesa_desligar_transferencia(_line_id uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v fin_extrato_transferencias%rowtype;
BEGIN
  IF NOT (has_capability(auth.uid(), 'finance.reconcile') AND has_capability(auth.uid(), 'finance.statement.flag')) THEN
    RAISE EXCEPTION 'Sem permissão para conferir linhas do extrato';
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo para desfazer.'; END IF;
  SELECT * INTO v FROM fin_extrato_transferencias WHERE line_id = _line_id AND desfeito_em IS NULL FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Esta linha não está ligada a uma transferência.'; END IF;
  UPDATE fin_extrato_transferencias SET desfeito_em = now(), desfeito_por = auth.uid(), desfeito_motivo = btrim(_motivo) WHERE id = v.id;
  PERFORM fin_statement_line_flag(_line_id, 'pendente', left('Desligada da transferência: ' || btrim(_motivo), 300));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'fin.extrato.transferencia.desligar', 'financial_statement_lines', _line_id::text,
          jsonb_build_object('vinculo', v.id, 'transfer_id', v.transfer_id, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fin_mesa_desligar_transferencia(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_mesa_desligar_transferencia(uuid,text) TO authenticated;

-- ---------- 0293: "Baixas já realizadas" acha baixa de qualquer data pela cobrança (pay_ / nº da fatura), título ou nome ----------
CREATE OR REPLACE FUNCTION public.fin_mesa_baixas_existentes(_line_id uuid, _busca text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare l financial_statement_lines%rowtype; v_dir fin_direction; v_res jsonb; v_b text := nullif(btrim(coalesce(_busca, '')), '');
  v_fat text; v_pays text[]; v_ids uuid[];
begin
  if not has_capability(auth.uid(),'finance.reconcile') then raise exception 'Sem permissão para conciliar'; end if;
  select * into l from financial_statement_lines where id = _line_id;
  if l.id is null then raise exception 'Linha não encontrada'; end if;
  v_dir := case when l.kind = 'entrada' then 'receivable' else 'payable' end::fin_direction;
  v_fat := substring(coalesce(l.raw->>'description', l.historico, '') from 'fatura nr\. ([0-9]{6,})');
  -- cobranças do Asaas procuradas: a da própria linha, e a da busca (pay_… ou nº da fatura)
  select array_agg(distinct p) into v_pays from (
    select nullif(l.raw->>'paymentId', '') p
    union select v_b where v_b like 'pay\_%'
    union select c.external_id from asaas_charges c join asaas_accounts a on a.id = c.account_id
     where a.financial_account_id = l.financial_account_id and c.raw ? 'invoiceNumber'
       and c.raw->>'invoiceNumber' in (v_fat, case when v_b ~ '^[0-9]{6,}$' then v_b end)
  ) z where p like 'pay\_%';
  -- baixas fora da janela de 60 dias: pela cobrança, ou pelo nº da fatura/título/documento/nome na busca
  select array_agg(distinct x) into v_ids from (
    select s.id x from financial_settlements s join asaas_accounts a on a.financial_account_id = l.financial_account_id
      join unnest(coalesce(v_pays, '{}'::text[])) p on true
     where s.idempotency_key = 'asaas:baixa:' || a.id || ':' || p
        or (s.idempotency_key >= 'asaas:baixa:' || a.id || ':r' and s.idempotency_key < 'asaas:baixa:' || a.id || ':s'
            and s.idempotency_key like '%:' || p)
    union
    select al.settlement_id from financial_titles t join financial_installments i on i.title_id = t.id
      join financial_allocations al on al.installment_id = i.id
     where t.direction = v_dir and (
             (v_fat is not null and t.descricao ilike '%fatura nr. ' || v_fat || '%')
          or (v_b is not null and length(v_b) >= 4 and (t.descricao ilike '%' || v_b || '%' or t.numero = v_b or t.documento = v_b
               or t.party_id in (select pp.id from parties pp where length(v_b) >= 4 and pp.display_name ilike '%' || v_b || '%' limit 50))))
  ) z;
  with base as (
    select s.id, s.data, s.valor_cents,
      abs(coalesce((select sum(m.valor_cents) from financial_account_movements m where m.settlement_id = s.id),0)) liquido,
      (select string_agg(distinct coalesce(t.numero,'') || ' ' || coalesce(t.descricao,'') || coalesce(' · ' || p.display_name,''), ' | ')
         from financial_allocations a join financial_installments i on i.id = a.installment_id
         join financial_titles t on t.id = i.title_id left join parties p on p.id = t.party_id
        where a.settlement_id = s.id) titulos,
      not (s.data between l.data - 60 and l.data + 60) fora_janela,
      (s.id = any(coalesce(v_ids, '{}'::uuid[]))) achada_pela_busca
    from financial_settlements s
    where s.financial_account_id = l.financial_account_id and s.direction = v_dir
      and not s.is_reversal
      and (s.data between l.data - 60 and l.data + 60 or s.id = any(coalesce(v_ids, '{}'::uuid[])))
      and not exists (select 1 from financial_settlements r where r.reversed_of = s.id)
      and not exists (select 1 from financial_reconciliations rc where rc.settlement_id = s.id and not rc.is_reversal
                        and not exists (select 1 from financial_reconciliations rr where rr.reversed_of = rc.id))
  )
  select coalesce(jsonb_agg(to_jsonb(b) order by b.achada_pela_busca desc, abs(b.liquido - (l.valor_cents - l.conciliado_cents)), abs(b.data - l.data)), '[]'::jsonb)
    into v_res
  from (select * from base
         where v_b is null or achada_pela_busca or coalesce(titulos,'') ilike '%' || v_b || '%'
         order by achada_pela_busca desc, abs(liquido - (l.valor_cents - l.conciliado_cents)), abs(data - l.data) limit 40) b;
  return v_res;
end $function$;

-- ---------- 0293: palpite da Mesa para TED judicial: 7.1.7 + centro Administrativo (lê também a descrição da cobrança do Asaas) ----------
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.fin_mesa_palpite(uuid)'::regprocedure);
  novo := replace(def, 'v_717 uuid; v_nome text;', 'v_717 uuid; v_nome text; v_cdesc text; v_cc uuid;');
  novo := replace(novo, E'    v_jud := fin_judicial_por_historico(v_hist);\n',
    E'    select c.raw->>''description'' into v_cdesc from financial_statement_lines fl join asaas_accounts a on a.financial_account_id = fl.financial_account_id\n'
    || E'      join asaas_charges c on c.account_id = a.id and c.external_id = fl.raw->>''paymentId'' where fl.id = _line limit 1;\n'
    || E'    v_jud := fin_judicial_por_historico(concat_ws('' '', v_hist, v_cdesc));\n');
  novo := replace(novo, E'      select id into v_717 from chart_of_accounts where codigo = ''7.1.7'' limit 1;\n',
    E'      select id into v_717 from chart_of_accounts where codigo = ''7.1.7'' limit 1;\n'
    || E'      select coalesce((select judicial_cost_center_id from asaas_auto_config where id), (select id from cost_centers where lower(codigo) = ''administrativo'' limit 1)) into v_cc;\n');
  novo := replace(novo, E'''chart_account_id'', v_717, ''party_id''', E'''chart_account_id'', v_717, ''cost_center_id'', v_cc, ''party_id''');
  IF novo = def OR position('v_cdesc' IN novo) = 0 OR position('''cost_center_id'', v_cc' IN novo) = 0 OR position('into v_cc' IN novo) = 0 THEN
    RAISE EXCEPTION '0293: trecho do palpite judicial não encontrado';
  END IF;
  EXECUTE novo;
END $patch$;
