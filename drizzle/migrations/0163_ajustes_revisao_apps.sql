-- 0163 — Ajustes da revisão dos pacotes 0158–0162. Não remove coluna e pode rodar duas vezes.
-- 1. Pagamento da cliente (Pix/cartão/dinheiro) dá baixa no pedido SEM concluir o pedido: a conclusão continua
--    exigindo o registro da venda (regra de order_set_status). "Aguardando pagamento" pago volta para "em atendimento".
--    Pedidos concluídos sozinhos pela 0160 voltam para "em atendimento" (fica registrado).
-- 2. Início da consultora: pedido já pago não aparece mais como pendência de pagamento.
-- 3. Acerto: cliente que pagou à Lardan DEPOIS do fechamento entra na conferência (vira crédito, nunca pagamento em dobro);
--    acerto com valor ≤ 0 não fica preso em "aguardando pagamento"; motivo da pendência diz todas as causas.
-- 4. Meu financeiro: os 60 acertos mostrados são os mais recentes. Minha equipe: "ativa" por indicada.
-- 5. Liga: maleta do SmallData sem cobrança não conta (mesma regra do BI).
-- 6. Dinheiro recebido pelo representante em parcela com link do Asaas aberto: avisa e abre tarefa para a cobrança
--    cancelar o link (evita a cliente pagar duas vezes).

-- ───────────────────────── 1) pagamento não conclui o pedido ─────────────────────────
CREATE OR REPLACE FUNCTION public.pedido_pagamento_sincronizar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o sales_orders; saldo bigint; novo sales_order_status;
BEGIN
  FOR o IN SELECT * FROM sales_orders WHERE pay_installment_id = NEW.installment_id AND payment_status IN ('pendente', 'pago') FOR UPDATE LOOP
    saldo := public.fin_installment_saldo(o.pay_installment_id);
    IF coalesce(saldo, 1) <= 0 AND o.payment_status = 'pendente' THEN
      novo := CASE WHEN o.status = 'aguardando_pagamento' THEN 'em_atendimento'::sales_order_status ELSE o.status END;
      UPDATE sales_orders SET payment_status = 'pago', pay_paid_at = now(), status = novo WHERE id = o.id;
      INSERT INTO sales_order_events (order_id, kind, from_status, to_status, actor_user_id, payload)
      VALUES (o.id, 'pagamento.recebido_lardan', o.status::text, novo::text, NULL, jsonb_build_object('valor_cents', o.subtotal_cents, 'abate_acerto', true, 'automatico', true));
    ELSIF coalesce(saldo, 0) > 0 AND o.payment_status = 'pago' THEN
      UPDATE sales_orders SET payment_status = 'estornado' WHERE id = o.id;
      INSERT INTO sales_order_events (order_id, kind, from_status, to_status, actor_user_id, payload)
      VALUES (o.id, 'pagamento.estornado', o.status::text, o.status::text, NULL, jsonb_build_object('automatico', true));
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.pedido_pagamento_sincronizar() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consultora_pedido_pago_dinheiro(_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); o sales_orders; novo sales_order_status;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id = _order AND consultora_party_id = eu FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status = 'cancelado' THEN RAISE EXCEPTION 'Este pedido foi cancelado.'; END IF;
  IF o.pay_installment_id IS NOT NULL AND o.pay_method IS DISTINCT FROM 'dinheiro' THEN
    RAISE EXCEPTION 'Este pedido já tem uma cobrança da Lardan (Pix/cartão). Se ela pagou em dinheiro, cancele a cobrança com o financeiro.';
  END IF;
  IF o.payment_status = 'pago' THEN RETURN jsonb_build_object('repetido', true); END IF;
  novo := CASE WHEN o.status = 'aguardando_pagamento' THEN 'em_atendimento'::sales_order_status ELSE o.status END;
  UPDATE sales_orders SET pay_method = 'dinheiro', payment_status = 'pago', pay_paid_at = now(), status = novo WHERE id = o.id;
  INSERT INTO sales_order_events (order_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (o.id, 'pagamento.dinheiro', o.status::text, novo::text, auth.uid(), jsonb_build_object('valor_cents', o.subtotal_cents, 'abate_acerto', false));
  RETURN jsonb_build_object('repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.consultora_pedido_pago_dinheiro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_pedido_pago_dinheiro(uuid) TO authenticated, service_role;

-- pedidos que a 0160 concluiu sozinha (Pix automático ou "pagou em dinheiro") voltam para "em atendimento"
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT o.id FROM sales_orders o
            WHERE o.status = 'concluido'
              AND EXISTS (SELECT 1 FROM sales_order_events e WHERE e.order_id = o.id AND e.to_status = 'concluido'
                            AND ((e.kind = 'pagamento.recebido_lardan' AND e.payload->>'automatico' = 'true') OR e.kind = 'pagamento.dinheiro'))
              AND NOT EXISTS (SELECT 1 FROM sales_order_events e WHERE e.order_id = o.id AND e.kind = 'pedido.correcao_0163') LOOP
    UPDATE sales_orders SET status = 'em_atendimento' WHERE id = r.id;
    INSERT INTO sales_order_events (order_id, kind, from_status, to_status, actor_user_id, note)
    VALUES (r.id, 'pedido.correcao_0163', 'concluido', 'em_atendimento', NULL, 'Pagamento não conclui o pedido: conclusão exige o registro da venda.');
    n := n + 1;
  END LOOP;
  IF n > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'pedidos.correcao_0163', 'sales_orders', 'lote', jsonb_build_object('pedidos', n));
  END IF;
END $$;

-- ───────────────────────── 2) Início: pedido pago não é pendência de pagamento ─────────────────────────
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.consultant_home()'::regprocedure);
  IF position('''pago'', o.payment_status = ''pago''' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def,
    $a$'total_cents', o.subtotal_cents, 'dias', hoje - (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'status', o.status) ORDER BY o.created_at), '[]')
                               FROM sales_orders o WHERE o.consultora_party_id = eu AND o.status IN ('em_atendimento', 'aguardando_pagamento')),$a$,
    $b$'total_cents', o.subtotal_cents, 'dias', hoje - (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'status', o.status, 'pago', o.payment_status = 'pago') ORDER BY o.created_at), '[]')
                               FROM sales_orders o WHERE o.consultora_party_id = eu AND o.status IN ('em_atendimento', 'aguardando_pagamento')
                                 AND o.payment_status IS DISTINCT FROM 'pago'),$b$);
  IF novo = def THEN RAISE EXCEPTION 'consultant_home não tem o formato esperado.'; END IF;
  def := novo;
  novo := replace(def,
    $a$'pedidos_abertos', (SELECT count(*) FROM sales_orders WHERE consultora_party_id = eu AND status IN ('aguardando_atendimento', 'em_atendimento', 'aguardando_pagamento')),$a$,
    $b$'pedidos_abertos', (SELECT count(*) FROM sales_orders WHERE consultora_party_id = eu AND (status = 'aguardando_atendimento'
                           OR (status IN ('em_atendimento', 'aguardando_pagamento') AND payment_status IS DISTINCT FROM 'pago'))),$b$);
  IF novo = def THEN RAISE EXCEPTION 'consultant_home (pedidos_abertos) não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $patch$;

-- ───────────────────────── 3) acerto ─────────────────────────
CREATE OR REPLACE FUNCTION public.pre_baixa_pago(_pb public.kit_pre_baixas) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _pb.status IN ('fechada', 'encerrada', 'pendencia') AND (
    coalesce(_pb.valor_pagar_cents, 0) <= 0
    OR EXISTS (SELECT 1 FROM financial_installments i WHERE i.id = _pb.installment_id AND i.settlement_status IN ('liquidado', 'excedente')))
$$;
REVOKE ALL ON FUNCTION public.pre_baixa_pago(public.kit_pre_baixas) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE def text; novo text; antes text;
BEGIN
  def := pg_get_functiondef('public.pre_baixa_conferir(uuid,jsonb,boolean)'::regprocedure);
  IF position('rec_novo' IN def) > 0 THEN RETURN; END IF;
  novo := def;
  antes := novo; novo := replace(novo, 'valor_final bigint; dif bigint;', 'valor_final bigint; rec_novo bigint; dif bigint;');
  IF novo = antes THEN RAISE EXCEPTION 'pre_baixa_conferir: declaração não encontrada.'; END IF;
  antes := novo; novo := replace(novo, '  valor_final := vend_final - com - p.recebido_lardan_cents;',
    '  rec_novo := public.pre_baixa_recebido_lardan(_cycle);
  valor_final := vend_final - com - rec_novo;');
  IF novo = antes THEN RAISE EXCEPTION 'pre_baixa_conferir: cálculo não encontrado.'; END IF;
  antes := novo; novo := replace(novo, $a$'valor_pre_baixa_cents', p.valor_pagar_cents, 'diferenca_cents', dif,$a$,
    $b$'valor_pre_baixa_cents', p.valor_pagar_cents, 'recebido_lardan_cents', rec_novo, 'recebido_depois_cents', rec_novo - p.recebido_lardan_cents, 'diferenca_cents', dif,$b$);
  IF novo = antes THEN RAISE EXCEPTION 'pre_baixa_conferir: retorno não encontrado.'; END IF;
  antes := novo; novo := replace(novo, $a$'descricao', 'Diferença do acerto (peças que faltaram na maleta)'$a$, $b$'descricao', 'Diferença do acerto da maleta'$b$);
  IF novo = antes THEN RAISE EXCEPTION 'pre_baixa_conferir: título não encontrado.'; END IF;
  antes := novo; novo := replace(novo,
    $a$         pendencia_motivo = CASE WHEN dif > 0 THEN faltam || ' peça(s) faltando na maleta: cobradas como vendidas pelo preço da remessa.'
                                 WHEN dif < 0 THEN voltaram || ' peça(s) marcadas como vendidas voltaram: crédito de ' || to_char(-dif / 100.0, 'FM999G999G990D00') || ' a devolver à consultora.'
                            END,$a$,
    $b$         recebido_lardan_cents = rec_novo,
         pendencia_motivo = CASE WHEN dif <> 0 THEN concat_ws(' ',
                                   CASE WHEN faltam > 0 THEN faltam || ' peça(s) faltando na maleta: cobradas como vendidas pelo preço da remessa.' END,
                                   CASE WHEN voltaram > 0 THEN voltaram || ' peça(s) marcadas como vendidas voltaram.' END,
                                   CASE WHEN rec_novo <> p.recebido_lardan_cents THEN 'Cliente pagou à Lardan depois do fechamento.' END,
                                   CASE WHEN dif > 0 THEN 'Diferença a cobrar: R$ ' || replace(to_char(dif / 100.0, 'FM999999990.00'), '.', ',') || '.'
                                        ELSE 'Crédito a devolver à consultora: R$ ' || replace(to_char(-dif / 100.0, 'FM999999990.00'), '.', ',') || '.' END) END,$b$);
  IF novo = antes THEN RAISE EXCEPTION 'pre_baixa_conferir: motivo não encontrado.'; END IF;
  EXECUTE novo;
END $patch$;

-- ───────────────────────── 4) Meu financeiro / Minha equipe ─────────────────────────
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.consultora_meu_financeiro()'::regprocedure);
  IF position(') u ORDER BY (u.x->>''data'') DESC NULLS LAST LIMIT 60' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def, $a$'acertos', coalesce((SELECT jsonb_agg(x ORDER BY x->>'data' DESC) FROM ($a$,
                       $b$'acertos', coalesce((SELECT jsonb_agg(x ORDER BY x->>'data' DESC) FROM (SELECT u.x FROM ($b$);
  novo := replace(novo, $a$        ORDER BY 1 LIMIT 60) s), '[]'::jsonb),$a$, $b$        ) u ORDER BY (u.x->>'data') DESC NULLS LAST LIMIT 60) s), '[]'::jsonb),$b$);
  IF novo = def OR position('SELECT u.x FROM (' IN novo) = 0 OR position(') u ORDER BY' IN novo) = 0 THEN
    RAISE EXCEPTION 'consultora_meu_financeiro não tem o formato esperado.';
  END IF;
  EXECUTE novo;
END $patch$;

DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.minha_equipe()'::regprocedure);
  IF position('p.status = ''ativo'' AND EXISTS' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def,
    $a$'ativa', public.lider_indicadas_ativas(eu) > 0 AND EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id = p.id AND coalesce(c.shipped_at, c.created_at) > now() - interval '90 days'))$a$,
    $b$'ativa', p.status = 'ativo' AND EXISTS (SELECT 1 FROM kit_cycles c WHERE c.consultora_party_id = p.id AND c.status NOT IN ('cancelada', 'rascunho', 'montagem')
                                                AND coalesce(c.shipped_at, c.created_at) > now() - interval '90 days'))$b$);
  IF novo = def THEN RAISE EXCEPTION 'minha_equipe não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $patch$;

-- ───────────────────────── 5) Liga: maleta do SmallData sem cobrança não conta ─────────────────────────
CREATE OR REPLACE FUNCTION public.liga_ciclos(_party uuid, _min bigint) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT count(*) FROM kit_pre_baixas p WHERE p.consultora_party_id = _party AND p.status IN ('encerrada', 'pendencia')
            AND p.encerrada_em > now() - interval '12 months' AND coalesce(p.vendido_final_cents, p.total_vendido_cents) >= _min)::int
       + (SELECT count(*) FROM legado_maletas m WHERE m.codcli = ANY (public.legado_codigos_da_pessoa(_party)) AND m.tipo = 'remessa'
            AND NOT m.sem_cobranca AND m.fechamento > (now() - interval '12 months')::date AND coalesce(m.valor_venda_cents, m.valor_vendido_cents, 0) >= _min)::int
$$;
REVOKE ALL ON FUNCTION public.liga_ciclos(uuid, bigint) FROM PUBLIC, anon, authenticated;

-- ───────────────────────── 6) dinheiro com link do Asaas aberto: aviso + tarefa ─────────────────────────
DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.rep_dinheiro_receber(uuid,bigint,uuid,text)'::regprocedure);
  IF position('aviso_asaas' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def, $a$  RETURN public.rep_recibo_json(r) || jsonb_build_object('repetido', false);$a$,
    $b$  IF EXISTS (SELECT 1 FROM asaas_charges ch WHERE ch.installment_id = _installment AND ch.external_status IN ('PENDING', 'OVERDUE')) THEN
    INSERT INTO cob_tarefas (party_id, titulo, vence_em, autor_id, installment_ids, origem)
    VALUES (t.party_id, 'Cancelar o link do Asaas: parcela recebida em dinheiro pelo representante (recibo ' || r.numero || ')', hoje, uid, ARRAY[_installment], 'manual');
    RETURN public.rep_recibo_json(r) || jsonb_build_object('repetido', false, 'aviso_asaas', true);
  END IF;
  RETURN public.rep_recibo_json(r) || jsonb_build_object('repetido', false);$b$);
  IF novo = def THEN RAISE EXCEPTION 'rep_dinheiro_receber não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $patch$;

-- ───────────────────────── 7) índices das leituras novas (app abre o Início toda hora) ─────────────────────────
-- devedor do título = pagador, ou a própria pessoa (mesma expressão usada em consultant_home, Meu financeiro e dívida aberta)
CREATE INDEX IF NOT EXISTS financial_titles_devedor_idx ON public.financial_titles ((coalesce(pagador_party_id, party_id)));
CREATE INDEX IF NOT EXISTS fiscal_documents_recipient_idx ON public.fiscal_documents (recipient_party_id) WHERE recipient_party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fiscal_documents_debtor_idx ON public.fiscal_documents (debtor_party_id) WHERE debtor_party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fiscal_documents_cycle_idx ON public.fiscal_documents (cycle_id) WHERE cycle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_order_items_cycle_idx ON public.sales_order_items (cycle_id);
