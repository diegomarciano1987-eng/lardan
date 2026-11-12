-- ============ 0295 — Asaas: fechar a Mesa (Diego, 12/11/2026) ============
-- a) Baixa desfeita e refeita (chave :rN:) liga sozinha a linha do extrato: a chave da conciliação automática pula as estornadas.
-- b) Cartão antecipado: recebimento (+V) e "Baixa da antecipação" (−V) do mesmo dia e fatura, com a antecipação já conciliada,
--    são conferidos como par neutro (nenhum lançamento; o dinheiro entrou na antecipação). Desfazer volta as duas para pendente.
-- c) Sugestão da Mesa para recebimento do Asaas usa a pessoa da própria cobrança (o histórico não identifica ninguém).
-- Nada aqui apaga lançamento.

ALTER TABLE public.asaas_auto_extrato DROP CONSTRAINT IF EXISTS asaas_auto_extrato_tipo_check;
ALTER TABLE public.asaas_auto_extrato ADD CONSTRAINT asaas_auto_extrato_tipo_check
  CHECK (tipo IN ('identificacao','tarifa','notificacoes','transferencia','negativacao','fatura_baixa','antecipacao_par'));

-- ---------- a) conciliação automática do extrato com a baixa do Asaas: chave livre depois de desfazer ----------
DO $patch$
DECLARE def text; ant text := $q$  v_key := 'asaas:extrato-auto:'||_payment;$q$;
BEGIN
  def := pg_get_functiondef('public.fin_asaas_extrato_autoconciliar(text)'::regprocedure);
  IF position(ant IN def) = 0 THEN RAISE EXCEPTION '0295: trecho da chave não encontrado em fin_asaas_extrato_autoconciliar'; END IF;
  EXECUTE replace(def, ant,
    $q$  -- 0295: depois de desfazer, a baixa refeita usa a próxima chave livre (:refeita:N); clique repetido continua idempotente
  v_key := public.fin_reconcile_chave_livre('asaas:extrato-auto:'||_payment);$q$);
END $patch$;
REVOKE ALL ON FUNCTION public.fin_asaas_extrato_autoconciliar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_asaas_extrato_autoconciliar(text) TO service_role;

-- ---------- b) par neutro do cartão antecipado na rotina do extrato ----------
DO $patch$
DECLARE def text; novo text;
  pedacos text[][] := ARRAY[
    ARRAY[$q$n_tr int := 0; v_tr bigint := 0;$q$, $q$n_tr int := 0; v_tr bigint := 0; n_ap int := 0; v_ap bigint := 0;$q$],
    ARRAY[$q$  -- 2) tarifa do Pix/boleto que não está no razão$q$,
$q$  -- 1c) 0295: cartão antecipado. A antecipação (crédito) já entrou e quitou a venda; no vencimento o Asaas recebe o cartão (+V)
  --     e no mesmo dia tira o mesmo valor para pagar a antecipação (−V). O par soma zero: confere as duas linhas, nenhum lançamento.
  FOR r IN
    SELECT a.id aid, b.id bid, a.financial_account_id conta, a.valor_cents v, a.raw->>'paymentId' pay, b.raw->>'anticipationId' ant,
           substring(a.raw->>'description' from 'fatura nr\. ([0-9]{6,})') fat
      FROM public.financial_statement_lines a
      JOIN public.financial_statement_lines b
        ON b.financial_account_id = a.financial_account_id AND b.data = a.data AND b.kind = 'saida'
       AND b.raw->>'type' = 'RECEIVABLE_ANTICIPATION_DEBIT' AND b.status = 'pendente' AND b.conciliado_cents = 0
       AND b.valor_cents = a.valor_cents AND coalesce(b.raw->>'anticipationId', '') <> ''
       AND substring(b.raw->>'description' from 'fatura nr\. ([0-9]{6,})') = substring(a.raw->>'description' from 'fatura nr\. ([0-9]{6,})')
     WHERE a.kind = 'entrada' AND a.raw->>'type' = 'PAYMENT_RECEIVED' AND a.status = 'pendente' AND a.conciliado_cents = 0 AND a.valor_cents > 0
       AND coalesce(a.raw->>'paymentId', '') ~ '^pay_' AND a.raw->>'description' ~ 'fatura nr\. [0-9]{6,}'
       AND EXISTS (SELECT 1 FROM public.asaas_accounts ac WHERE ac.financial_account_id = a.financial_account_id)
       -- a antecipação (crédito) dessa operação já está conciliada, com o mesmo valor: o dinheiro já foi contado ali
       AND EXISTS (SELECT 1 FROM public.financial_statement_lines g
                    WHERE g.financial_account_id = a.financial_account_id AND g.raw->>'type' = 'RECEIVABLE_ANTICIPATION_GROSS_CREDIT'
                      AND g.raw->>'anticipationId' = b.raw->>'anticipationId' AND g.status = 'conciliada' AND g.valor_cents = a.valor_cents)
       -- o recebimento não virou baixa própria no sistema (senão ele já estaria contado por ela)
       AND NOT EXISTS (SELECT 1 FROM public.financial_settlements s
                        WHERE s.idempotency_key LIKE 'asaas:baixa:%:' || (a.raw->>'paymentId') AND NOT s.is_reversal
                          AND NOT EXISTS (SELECT 1 FROM public.financial_settlements x WHERE x.reversed_of = s.id))
       -- desfeito à mão uma vez: a rotina não refaz
       AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE e.tipo = 'antecipacao_par' AND e.chave = b.raw->>'anticipationId')
       AND NOT EXISTS (SELECT 1 FROM public.asaas_auto_extrato e WHERE (a.id = ANY(e.line_ids) OR b.id = ANY(e.line_ids)) AND e.desfeito_em IS NULL)
     ORDER BY a.data, a.line_no LIMIT lim
  LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '40 seconds';
    BEGIN
      -- 1 para 1: uma linha de recebimento e uma de baixa da antecipação
      IF (SELECT count(*) FROM public.financial_statement_lines a2 WHERE a2.financial_account_id = r.conta AND a2.raw->>'type' = 'PAYMENT_RECEIVED'
             AND a2.raw->>'paymentId' = r.pay AND a2.status = 'pendente') <> 1
         OR (SELECT count(*) FROM public.financial_statement_lines b2 WHERE b2.financial_account_id = r.conta AND b2.raw->>'type' = 'RECEIVABLE_ANTICIPATION_DEBIT'
             AND b2.raw->>'anticipationId' = r.ant AND b2.status = 'pendente') <> 1 THEN
        pulos := pulos || jsonb_build_object('antecipacao_ambigua', coalesce((pulos->>'antecipacao_ambigua')::int, 0) + 1);
        CONTINUE;
      END IF;
      PERFORM public.fin_statement_line_flag(r.aid, 'ignorada', left('Cartão antecipado: recebimento da fatura ' || r.fat
        || ' saiu no mesmo dia para pagar a antecipação (par soma zero; o dinheiro entrou na antecipação) — Asaas automático', 300));
      PERFORM public.fin_statement_line_flag(r.bid, 'ignorada', left('Cartão antecipado: baixa da antecipação da fatura ' || r.fat
        || ' com o recebimento do mesmo dia (par soma zero) — Asaas automático', 300));
      INSERT INTO public.asaas_auto_extrato (tipo, chave, financial_account_id, line_ids, charge_id, valor_cents, detalhe, motivo, actor_id)
      VALUES ('antecipacao_par', r.ant, r.conta, ARRAY[r.aid, r.bid],
              (SELECT c.id FROM public.asaas_charges c JOIN public.asaas_accounts ac ON ac.id = c.account_id
                WHERE ac.financial_account_id = r.conta AND c.external_id = r.pay LIMIT 1),
              r.v, jsonb_build_object('fatura', r.fat, 'pay', r.pay),
              'Cartão antecipado: recebimento e baixa da antecipação do mesmo valor conferidos juntos, sem lançamento', _ator);
      n_ap := n_ap + 1; v_ap := v_ap + r.v;
    EXCEPTION WHEN OTHERS THEN erros := erros + 1; ult_erro := left('antecipacao ' || r.fat || ': ' || SQLERRM, 300);
    END;
  END LOOP;

  -- 2) tarifa do Pix/boleto que não está no razão$q$],
    ARRAY[$q$'transferencias', n_tr, 'transferencias_cents', v_tr,$q$,
          $q$'transferencias', n_tr, 'transferencias_cents', v_tr, 'antecipacoes_neutras', n_ap, 'antecipacoes_neutras_cents', v_ap,$q$]
  ];
  i int;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_extrato_nucleo(uuid,integer)'::regprocedure);
  novo := def;
  FOR i IN 1 .. array_length(pedacos, 1) LOOP
    IF position(pedacos[i][1] IN novo) = 0 THEN RAISE EXCEPTION '0295: trecho % não encontrado em asaas_auto_extrato_nucleo', i; END IF;
    novo := replace(novo, pedacos[i][1], pedacos[i][2]);
  END LOOP;
  EXECUTE novo;
END $patch$;

-- desfazer o par neutro devolve as duas linhas para pendente
DO $patch$
DECLARE def text;
  ant text := $q$  ELSIF e.tipo = 'transferencia' THEN
    PERFORM public.fin_statement_line_flag(e.line_ids[1], 'pendente', mot);$q$;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_extrato_desfazer(uuid,text)'::regprocedure);
  IF position(ant IN def) = 0 THEN RAISE EXCEPTION '0295: trecho não encontrado em asaas_auto_extrato_desfazer'; END IF;
  EXECUTE replace(def, ant, $q$  ELSIF e.tipo IN ('transferencia','antecipacao_par') THEN
    FOR a IN SELECT x.lid FROM unnest(e.line_ids) x(lid) LOOP
      IF (SELECT status FROM public.financial_statement_lines WHERE id = a.lid) = 'ignorada' THEN
        PERFORM public.fin_statement_line_flag(a.lid, 'pendente', mot);
      END IF;
    END LOOP;$q$);
END $patch$;

-- ---------- c) palpite da Mesa: pessoa da cobrança do Asaas ----------
DO $patch$
DECLARE def text; novo text;
  pedacos text[][] := ARRAY[
    ARRAY[$q$v_cdesc text; v_cc uuid;$q$, $q$v_cdesc text; v_cc uuid; v_cparty uuid; v_asaas boolean;$q$],
    ARRAY[$q$  -- Recebimento judicial: sugere 7.1.7$q$,
$q$  -- 0295: recebimento do Asaas: a pessoa vem da própria cobrança. O histórico "Cobrança recebida - fatura nr." é igual
  --       para todas e apontava a pessoa mais frequente das conciliações antigas (ex.: Fatima Marcelino).
  if v_kind = 'entrada' then
    select true, c.party_id into v_asaas, v_cparty
      from financial_statement_lines fl join asaas_accounts a on a.financial_account_id = fl.financial_account_id
      left join asaas_charges c on c.account_id = a.id and c.external_id = fl.raw->>'paymentId'
     where fl.id = _line and coalesce(fl.raw->>'paymentId', '') ~ '^pay_' limit 1;
    if coalesce(v_asaas, false) then
      v_res := v_res || jsonb_build_object('party_id', v_cparty,
        'party_nome', (select coalesce(display_name, legal_name) from parties where id = v_cparty));
    end if;
  end if;
  -- Recebimento judicial: sugere 7.1.7$q$]
  ];
  i int;
BEGIN
  def := pg_get_functiondef('public.fin_mesa_palpite(uuid)'::regprocedure);
  novo := def;
  FOR i IN 1 .. array_length(pedacos, 1) LOOP
    IF position(pedacos[i][1] IN novo) = 0 THEN RAISE EXCEPTION '0295: trecho % não encontrado em fin_mesa_palpite', i; END IF;
    novo := replace(novo, pedacos[i][1], pedacos[i][2]);
  END LOOP;
  EXECUTE novo;
END $patch$;