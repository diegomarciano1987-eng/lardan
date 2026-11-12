-- 0303 — Espelho Lardan → Asaas também para vencimento e valor da parcela.
-- Mudou o vencimento/valor no Lardan (fin_installment_editar ou qualquer UPDATE): nasce um pedido; a rotina de 1 minuto
-- atualiza a MESMA cobrança no Asaas (PUT /payments/{id}), depois de conferir lá que ela segue em aberto.
-- Cobrança criada pelo Lardan e excluída direto no Asaas não é reemitida sozinha (decisão do Diego, caso Simone): vira exceção.
-- Nada aqui lança dinheiro.

ALTER TABLE public.asaas_saldo_sync DROP CONSTRAINT asaas_saldo_sync_acao_check;
ALTER TABLE public.asaas_saldo_sync ADD CONSTRAINT asaas_saldo_sync_acao_check
  CHECK (acao IN ('cancelar','substituir','reabrir','alterar','excecao'));

CREATE TABLE public.asaas_espelho_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES public.financial_installments(id),
  origem text NOT NULL CHECK (origem IN ('parcela_alterada','manual')),
  antes jsonb,
  depois jsonb,
  actor_id uuid,
  motivo text,
  job_id uuid REFERENCES public.asaas_saldo_sync(id),
  resultado text,
  atendido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.asaas_espelho_pedidos TO authenticated;
GRANT ALL ON public.asaas_espelho_pedidos TO service_role;
ALTER TABLE public.asaas_espelho_pedidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financeiro le pedidos do espelho" ON public.asaas_espelho_pedidos FOR SELECT TO authenticated
  USING ((SELECT public.asaas_ator_pode(auth.uid(), 'finance.receivable.view')));
CREATE UNIQUE INDEX asaas_espelho_pedidos_um_aberto ON public.asaas_espelho_pedidos(installment_id) WHERE atendido_em IS NULL;
CREATE INDEX asaas_espelho_pedidos_abertos ON public.asaas_espelho_pedidos(created_at) WHERE atendido_em IS NULL;

-- Vencimento/valor mudou no Lardan com cobrança aberta no Asaas → pedido de espelho.
CREATE OR REPLACE FUNCTION public.asaas_espelho_parcela_mudou()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.vencimento IS NOT DISTINCT FROM OLD.vencimento AND NEW.valor_cents IS NOT DISTINCT FROM OLD.valor_cents THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.installment_id = NEW.id AND c.external_status IN ('PENDING','OVERDUE')) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.asaas_espelho_pedidos (installment_id, origem, antes, depois, actor_id)
  VALUES (NEW.id, 'parcela_alterada', jsonb_build_object('vencimento', OLD.vencimento, 'valor_cents', OLD.valor_cents),
          jsonb_build_object('vencimento', NEW.vencimento, 'valor_cents', NEW.valor_cents), auth.uid())
  ON CONFLICT (installment_id) WHERE atendido_em IS NULL
  DO UPDATE SET depois = EXCLUDED.depois, actor_id = coalesce(EXCLUDED.actor_id, asaas_espelho_pedidos.actor_id), updated_at = now();
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_espelho_parcela_mudou() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS asaas_espelho_parcela_mudou ON public.financial_installments;
CREATE TRIGGER asaas_espelho_parcela_mudou AFTER UPDATE OF vencimento, valor_cents ON public.financial_installments
  FOR EACH ROW EXECUTE FUNCTION public.asaas_espelho_parcela_mudou();

-- Plano: o que mudar no Asaas para ficar igual ao Lardan. Só leitura.
CREATE OR REPLACE FUNCTION public.asaas_saldo_plano(_inst uuid, _forcar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE i record; t record; v_party uuid; v_saldo bigint; v_efetivo bigint; v_aberto bigint := 0; v_n int := 0;
  v_cobr jsonb := '[]'::jsonb; v_acordo boolean := false; v_em_acordo boolean; v_judicial boolean; v_gerida boolean;
  v_acao text := 'nada'; v_motivo text := NULL; v_valor bigint; v_venc date; v_billing text; v_conta uuid; v_clientes int; v_impr text;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; v_contas int; r record;
  v_pedido boolean; v_due_atual date; v_ext_del boolean := false;
BEGIN
  SELECT * INTO i FROM public.financial_installments WHERE id = _inst;
  IF i.id IS NULL THEN RETURN jsonb_build_object('acao','nada','motivo','parcela_inexistente'); END IF;
  SELECT * INTO t FROM public.financial_titles WHERE id = i.title_id;
  IF t.direction <> 'receivable' THEN RETURN jsonb_build_object('acao','nada','motivo','nao_receber'); END IF;
  v_party := coalesce(t.pagador_party_id, t.party_id);
  v_saldo := coalesce(public.fin_installment_saldo(_inst), 0);
  v_efetivo := CASE WHEN t.status = 'ativo' THEN greatest(v_saldo, 0) ELSE 0 END;
  FOR r IN
    SELECT c.id, c.external_id, c.value_cents, c.due_date, c.billing_type, c.external_status, c.account_id,
           EXISTS (SELECT 1 FROM public.asaas_charge_intents x WHERE x.acordo_simulacao_id IS NOT NULL
                    AND (x.charge_id = c.id OR (x.account_id = c.account_id AND x.external_id = c.external_id))) acordo
      FROM public.asaas_charges c
     WHERE c.external_status IN ('PENDING','OVERDUE')
       AND (c.installment_id = _inst OR (c.installment_id IS NULL AND EXISTS (
              SELECT 1 FROM public.asaas_charge_matches m WHERE m.charge_id = c.id AND m.status = 'confirmado' AND m.installment_id = _inst)))
       AND NOT EXISTS (SELECT 1 FROM public.asaas_baixas_outra_forma b WHERE b.charge_id = c.id)
     ORDER BY c.due_date, c.external_id
  LOOP
    v_n := v_n + 1; v_aberto := v_aberto + r.value_cents; v_acordo := v_acordo OR r.acordo; v_conta := coalesce(v_conta, r.account_id);
    v_cobr := v_cobr || jsonb_build_array(jsonb_build_object('charge_id', r.id, 'external_id', r.external_id, 'valor_cents', r.value_cents,
      'vencimento', r.due_date, 'billing_type', r.billing_type, 'status', r.external_status, 'resultado', NULL));
    v_venc := r.due_date; v_due_atual := r.due_date; v_billing := r.billing_type;
  END LOOP;
  v_pedido := EXISTS (SELECT 1 FROM public.asaas_espelho_pedidos pe WHERE pe.installment_id = _inst AND pe.atendido_em IS NULL);
  -- sem pedido a impressão é a mesma de antes (0299): decisões já tomadas continuam valendo
  v_impr := md5(v_efetivo || ':' || t.status || ':' || v_cobr::text || CASE WHEN v_pedido THEN ':venc:' || i.vencimento ELSE '' END);
  IF v_acordo THEN
    RETURN jsonb_build_object('acao','nada','motivo','cobranca_de_acordo','saldo_cents',v_efetivo,'aberto_cents',v_aberto,'impressao',v_impr);
  END IF;
  v_em_acordo := EXISTS (SELECT 1 FROM public.cob_simulacoes s WHERE _inst = ANY(s.installment_ids)
                          AND s.status IN ('simulada','aguardando_entrada','efetivada'));
  v_judicial := EXISTS (SELECT 1 FROM public.cob_judicial_processos jp WHERE jp.party_id = v_party)
             OR EXISTS (SELECT 1 FROM public.cob_judicial j WHERE j.party_id = v_party);
  v_gerida := EXISTS (SELECT 1 FROM public.asaas_saldo_sync s WHERE s.installment_id = _inst AND s.estado = 'concluida'
                       AND s.acao IN ('cancelar','substituir','reabrir','alterar'));

  IF v_aberto > v_efetivo THEN
    IF v_efetivo = 0 THEN
      v_acao := 'cancelar'; v_motivo := CASE WHEN t.status <> 'ativo' THEN 'titulo_cancelado' ELSE 'quitada' END;
    ELSIF v_pedido AND v_n = 1 AND t.status = 'ativo' AND i.vencimento >= hoje THEN
      -- 0303: valor/vencimento editado no Lardan → a mesma cobrança acompanha
      v_acao := 'alterar'; v_motivo := 'valor_alterado'; v_valor := v_efetivo; v_venc := i.vencimento;
    ELSE
      v_acao := 'substituir'; v_motivo := 'baixa_parcial'; v_valor := v_efetivo;
      -- 0303: o vencimento do Lardan manda (nunca no passado)
      v_venc := greatest(hoje, coalesce(i.vencimento, v_venc, hoje));
    END IF;
  ELSIF v_gerida AND t.status = 'ativo' AND v_efetivo > v_aberto AND v_efetivo >= 500 AND v_n <= 1 THEN
    v_acao := 'reabrir'; v_motivo := 'estorno'; v_valor := v_efetivo;
    v_venc := greatest(hoje, coalesce(i.vencimento, v_venc, hoje)); v_billing := coalesce(v_billing,
      (SELECT s.novo_billing_type FROM public.asaas_saldo_sync s WHERE s.installment_id = _inst AND s.novo_billing_type IS NOT NULL ORDER BY s.created_at DESC LIMIT 1),
      (SELECT (s.cobrancas->0->>'billing_type') FROM public.asaas_saldo_sync s WHERE s.installment_id = _inst ORDER BY s.created_at DESC LIMIT 1));
    -- a última cobrança que o Lardan criou foi excluída direto no Asaas (não por nós): ninguém reemite sozinho
    v_ext_del := v_n = 0 AND EXISTS (
      SELECT 1 FROM public.asaas_saldo_sync s JOIN public.asaas_charges c ON c.id = s.nova_charge_id
       WHERE s.id = (SELECT s2.id FROM public.asaas_saldo_sync s2 WHERE s2.installment_id = _inst AND s2.estado = 'concluida'
                      AND s2.nova_charge_id IS NOT NULL ORDER BY s2.concluida_em DESC NULLS LAST, s2.created_at DESC LIMIT 1)
         AND c.external_status = 'DELETED'
         AND NOT EXISTS (SELECT 1 FROM public.asaas_saldo_sync s3, jsonb_array_elements(s3.cobrancas) e
                          WHERE s3.installment_id = _inst AND e->>'charge_id' = c.id::text AND e->>'resultado' = 'cancelada')
         AND NOT EXISTS (SELECT 1 FROM public.asaas_cobranca_cancelamentos k WHERE k.charge_id = c.id AND k.resultado IN ('cancelada','ja_excluida')));
  ELSIF v_pedido AND t.status = 'ativo' AND v_n >= 1 AND (v_n > 1 OR v_due_atual IS DISTINCT FROM i.vencimento OR v_aberto <> v_efetivo) THEN
    v_acao := 'alterar'; v_motivo := CASE WHEN v_aberto <> v_efetivo THEN 'valor_alterado' ELSE 'vencimento_alterado' END;
    v_valor := v_efetivo; v_venc := i.vencimento;
  ELSE
    RETURN jsonb_build_object('acao','nada','motivo','em_dia','saldo_cents',v_efetivo,'aberto_cents',v_aberto,'impressao',v_impr);
  END IF;

  IF v_acao IN ('substituir','reabrir','alterar') THEN
    IF v_billing IS NULL OR v_billing NOT IN ('BOLETO','PIX','CREDIT_CARD','UNDEFINED') THEN v_billing := 'UNDEFINED'; END IF;
    IF v_em_acordo THEN v_acao := 'excecao'; v_motivo := 'parcela_em_acordo';
    ELSIF v_acao = 'alterar' AND v_n > 1 THEN v_acao := 'excecao'; v_motivo := 'varias_cobrancas';
    ELSIF v_judicial AND NOT _forcar THEN v_acao := 'excecao'; v_motivo := 'cliente_judicial';
    ELSIF v_n > 1 AND NOT _forcar THEN v_acao := 'excecao'; v_motivo := 'varias_cobrancas';
    ELSIF v_acao = 'reabrir' AND v_ext_del AND NOT _forcar THEN v_acao := 'excecao'; v_motivo := 'excluida_no_asaas';
    ELSIF v_acao = 'alterar' AND i.vencimento < hoje THEN v_acao := 'excecao'; v_motivo := 'vencimento_no_passado';
    ELSIF v_valor < 500 THEN
      IF v_acao = 'substituir' THEN v_acao := 'cancelar'; v_motivo := 'saldo_abaixo_minimo'; v_valor := NULL;
      ELSE v_acao := 'excecao'; v_motivo := 'saldo_abaixo_minimo'; END IF;
    ELSIF t.approval_status = 'pendente' THEN v_acao := 'excecao'; v_motivo := 'titulo_nao_aprovado';
    ELSIF v_acao <> 'alterar' THEN
      SELECT count(*) INTO v_contas FROM public.asaas_accounts a WHERE a.owner_entity_id = t.business_entity_id AND a.billing_default
         AND a.state IN ('simulada','sandbox_conectada','producao_conectada') AND a.is_active;
      IF v_contas <> 1 THEN v_acao := 'excecao'; v_motivo := 'conta_asaas';
      ELSE
        SELECT a.id INTO v_conta FROM public.asaas_accounts a WHERE a.owner_entity_id = t.business_entity_id AND a.billing_default
           AND a.state IN ('simulada','sandbox_conectada','producao_conectada') AND a.is_active;
        SELECT count(*) INTO v_clientes FROM public.asaas_customers cu WHERE cu.account_id = v_conta AND cu.party_id = v_party AND cu.match_status = 'vinculado';
        IF v_clientes <> 1 THEN v_acao := 'excecao'; v_motivo := CASE WHEN v_clientes = 0 THEN 'cliente_sem_vinculo' ELSE 'cliente_duplicado' END; END IF;
      END IF;
    END IF;
  END IF;
  IF v_acao IN ('cancelar','excecao') THEN v_valor := CASE WHEN v_acao='excecao' THEN v_valor ELSE NULL END; END IF;
  IF v_acao = 'cancelar' THEN v_venc := NULL; v_billing := NULL; END IF;

  RETURN jsonb_build_object('acao', v_acao, 'motivo', v_motivo, 'saldo_cents', v_efetivo, 'aberto_cents', v_aberto, 'n', v_n,
    'cobrancas', v_cobr, 'novo_valor_cents', v_valor, 'novo_vencimento', v_venc, 'novo_billing_type', v_billing,
    'impressao', v_impr, 'account_id', v_conta, 'party_id', v_party, 'title_id', t.id);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_plano(uuid,boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_plano(uuid,boolean) TO service_role;

-- Varredura: (1) parcelas cobrando mais que o saldo / reabertas por estorno (0299); (2) pedidos de vencimento/valor (0303).
CREATE OR REPLACE FUNCTION public.asaas_saldo_varrer()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record; n int := 0; p jsonb; v_id uuid; ult record;
BEGIN
  UPDATE public.asaas_espelho_pedidos pe SET atendido_em = now(), resultado = s.estado, updated_at = now()
    FROM public.asaas_saldo_sync s
   WHERE pe.atendido_em IS NULL AND pe.job_id = s.id AND s.estado IN ('concluida','ignorada','superada');
  FOR r IN
    WITH ch AS (
      SELECT coalesce(c.installment_id, (SELECT m.installment_id FROM public.asaas_charge_matches m
               WHERE m.charge_id = c.id AND m.status = 'confirmado' AND m.installment_id IS NOT NULL
               ORDER BY m.decidido_em DESC NULLS LAST LIMIT 1)) inst, c.value_cents
        FROM public.asaas_charges c
       WHERE c.external_status IN ('PENDING','OVERDUE')
         AND NOT EXISTS (SELECT 1 FROM public.asaas_baixas_outra_forma b WHERE b.charge_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM public.asaas_charge_intents x WHERE x.acordo_simulacao_id IS NOT NULL
                          AND (x.charge_id = c.id OR (x.account_id = c.account_id AND x.external_id = c.external_id)))
    ), g AS (SELECT inst, sum(value_cents) aberto FROM ch WHERE inst IS NOT NULL GROUP BY inst)
    SELECT g.inst FROM g JOIN public.financial_installments i ON i.id = g.inst JOIN public.financial_titles t ON t.id = i.title_id
     WHERE g.aberto > CASE WHEN t.status = 'ativo' THEN greatest(coalesce(public.fin_installment_saldo(g.inst),0),0) ELSE 0 END
    UNION
    SELECT DISTINCT s.installment_id FROM public.asaas_saldo_sync s JOIN public.financial_titles t ON t.id = s.title_id
     WHERE s.estado = 'concluida' AND s.acao IN ('cancelar','substituir','reabrir','alterar') AND t.status = 'ativo'
       AND coalesce(public.fin_installment_saldo(s.installment_id),0) >= 500
       AND coalesce(public.fin_installment_saldo(s.installment_id),0) >
           coalesce((SELECT sum(c.value_cents) FROM public.asaas_charges c WHERE c.installment_id = s.installment_id
                      AND c.external_status IN ('PENDING','OVERDUE')),0)
  LOOP
    IF public.asaas_saldo_enfileirar(r.inst) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  FOR r IN
    SELECT pe.id, pe.installment_id FROM public.asaas_espelho_pedidos pe
     WHERE pe.atendido_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.asaas_saldo_sync s WHERE s.installment_id = pe.installment_id AND s.estado IN ('pendente','processando','falhou'))
     ORDER BY pe.created_at LIMIT 100
  LOOP
    p := public.asaas_saldo_plano(r.installment_id, false);
    IF p->>'acao' = 'nada' THEN
      UPDATE public.asaas_espelho_pedidos SET atendido_em = now(), resultado = 'ja_confere', updated_at = now() WHERE id = r.id;
      CONTINUE;
    END IF;
    v_id := public.asaas_saldo_enfileirar(r.installment_id);
    IF v_id IS NOT NULL THEN
      n := n + 1;
      UPDATE public.asaas_espelho_pedidos SET job_id = v_id, updated_at = now() WHERE id = r.id;
    ELSE
      SELECT * INTO ult FROM public.asaas_saldo_sync WHERE installment_id = r.installment_id ORDER BY created_at DESC LIMIT 1;
      IF ult.id IS NOT NULL THEN
        UPDATE public.asaas_espelho_pedidos SET job_id = ult.id, updated_at = now(),
          atendido_em = CASE WHEN ult.estado = 'ignorada' THEN now() END, resultado = CASE WHEN ult.estado = 'ignorada' THEN 'ignorada' END
         WHERE id = r.id AND (job_id IS DISTINCT FROM ult.id OR ult.estado = 'ignorada');
      END IF;
    END IF;
  END LOOP;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_varrer() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_varrer() TO service_role;

-- Reserva: igual ao 0299, mais os dados da alteração. Só trabalhador "saldo2-" (que sabe alterar) recebe tarefa 'alterar'.
CREATE OR REPLACE FUNCTION public.asaas_saldo_reservar(_worker text, _limite integer DEFAULT 20)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; p jsonb; saida jsonb := '[]'::jsonb; v_int record; v_varridas int; v_sabe_alterar boolean;
BEGIN
  IF coalesce(btrim(_worker),'') = '' THEN RAISE EXCEPTION 'Trabalhador obrigatório.'; END IF;
  v_sabe_alterar := _worker LIKE 'saldo2-%';
  v_varridas := public.asaas_saldo_varrer();
  FOR s IN
    SELECT * FROM public.asaas_saldo_sync
     WHERE estado = 'pendente'
        OR (estado = 'falhou' AND coalesce(proxima_em, now()) <= now() AND tentativas < 8)
        OR (estado = 'processando' AND lease_until < now())
     ORDER BY created_at
     LIMIT least(greatest(coalesce(_limite,20),1),100)
     FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT s.progresso THEN
      p := public.asaas_saldo_plano(s.installment_id, s.forcar);
      IF p->>'acao' = 'nada' THEN
        UPDATE public.asaas_saldo_sync SET estado = 'superada', erro = 'Nada a fazer: Asaas já confere com o Lardan.', updated_at = now(), concluida_em = now(), lease_until = NULL WHERE id = s.id;
        CONTINUE;
      ELSIF p->>'acao' = 'excecao' THEN
        UPDATE public.asaas_saldo_sync SET estado = 'excecao', acao = 'excecao', motivo = p->>'motivo', saldo_cents = (p->>'saldo_cents')::bigint,
          aberto_cents = (p->>'aberto_cents')::bigint, cobrancas = p->'cobrancas', novo_valor_cents = (p->>'novo_valor_cents')::bigint,
          novo_vencimento = (p->>'novo_vencimento')::date, impressao = p->>'impressao', updated_at = now(), lease_until = NULL WHERE id = s.id;
        CONTINUE;
      END IF;
      UPDATE public.asaas_saldo_sync SET acao = p->>'acao', motivo = p->>'motivo', saldo_cents = (p->>'saldo_cents')::bigint,
        aberto_cents = (p->>'aberto_cents')::bigint, cobrancas = p->'cobrancas', novo_valor_cents = (p->>'novo_valor_cents')::bigint,
        novo_vencimento = (p->>'novo_vencimento')::date, novo_billing_type = p->>'novo_billing_type', impressao = p->>'impressao',
        account_id = coalesce((p->>'account_id')::uuid, account_id)
       WHERE id = s.id RETURNING * INTO s;
    END IF;
    IF s.acao = 'alterar' AND NOT v_sabe_alterar THEN CONTINUE; END IF;
    UPDATE public.asaas_saldo_sync SET estado = 'processando', worker = _worker, tentativas = tentativas + 1,
      lease_until = now() + interval '5 minutes', updated_at = now() WHERE id = s.id RETURNING * INTO s;
    SELECT id, state INTO v_int FROM public.asaas_charge_intents WHERE id = s.intent_id;
    saida := saida || jsonb_build_array(jsonb_build_object('id', s.id, 'acao', s.acao, 'motivo', s.motivo,
      'cancelar', CASE WHEN s.acao = 'alterar' THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(s.cobrancas) e
                    WHERE coalesce(e->>'resultado','') NOT IN ('cancelada','ja_excluida')) END,
      'alvo', CASE WHEN s.acao = 'alterar' THEN s.cobrancas->0 END,
      'novo_valor_cents', s.novo_valor_cents, 'novo_vencimento', s.novo_vencimento,
      'intent_id', s.intent_id, 'intent_state', v_int.state));
  END LOOP;
  RETURN jsonb_build_object('varridas', v_varridas, 'tarefas', saida);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_reservar(text,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_reservar(text,integer) TO service_role;

-- Resultado da alteração no Asaas (somente serviço). Espelha a nova data/valor na cópia local sem abrir alerta 0297.
CREATE OR REPLACE FUNCTION public.asaas_saldo_alteracao(_job uuid, _worker text, _resultado text, _status_remoto text, _erro text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; c record; v_charge uuid;
BEGIN
  IF _resultado NOT IN ('alterada','ja_igual','ja_excluida','paga_no_asaas','falhou') THEN RAISE EXCEPTION 'Resultado inválido.'; END IF;
  SELECT * INTO s FROM public.asaas_saldo_sync WHERE id = _job FOR UPDATE;
  IF s.id IS NULL OR s.estado <> 'processando' OR s.worker IS DISTINCT FROM _worker THEN RAISE EXCEPTION 'Tarefa fora da posse deste trabalhador.'; END IF;
  IF s.acao <> 'alterar' THEN RAISE EXCEPTION 'Tarefa não é de alteração.'; END IF;
  v_charge := (s.cobrancas->0->>'charge_id')::uuid;
  SELECT * INTO c FROM public.asaas_charges WHERE id = v_charge FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança da tarefa não encontrada.'; END IF;
  IF _resultado IN ('alterada','ja_igual') THEN
    PERFORM set_config('lardann.asaas_link','on', true);
    PERFORM set_config('lardann.asaas_saldo','on', true);
    UPDATE public.asaas_charges SET due_date = s.novo_vencimento, value_cents = s.novo_valor_cents,
      external_status = CASE WHEN _status_remoto IN ('PENDING','OVERDUE') THEN _status_remoto ELSE external_status END,
      reconcile_note = left('Atualizada pelo Lardan: ' || CASE s.motivo WHEN 'valor_alterado' THEN 'valor e vencimento iguais aos do Lardan'
                                                            ELSE 'vencimento igual ao do Lardan' END, 300),
      updated_at = now()
     WHERE id = v_charge;
    PERFORM set_config('lardann.asaas_saldo','off', true);
    PERFORM set_config('lardann.asaas_link','off', true);
    UPDATE public.asaas_saldo_sync SET estado = 'concluida', progresso = true, lease_until = NULL, concluida_em = now(), erro = NULL, updated_at = now(),
      cobrancas = jsonb_set(cobrancas, '{0}', (cobrancas->0) || jsonb_build_object('resultado', _resultado, 'status_remoto', _status_remoto, 'em', now()))
     WHERE id = _job;
    UPDATE public.asaas_espelho_pedidos SET atendido_em = now(), resultado = 'concluida', job_id = _job, updated_at = now()
     WHERE installment_id = s.installment_id AND atendido_em IS NULL;
    UPDATE public.asaas_divergencia_alertas SET resolvido_em = now(), resolucao = 'Asaas atualizado com o vencimento/valor do Lardan'
     WHERE charge_id = v_charge AND tipo IN ('vencimento_alterado','valor_alterado') AND resolvido_em IS NULL;
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (s.decidido_por, 'asaas.saldo.alterar', 'asaas_charges', v_charge,
      jsonb_build_object('tarefa', _job, 'external_id', c.external_id, 'antes', jsonb_build_object('vencimento', c.due_date, 'valor_cents', c.value_cents),
        'depois', jsonb_build_object('vencimento', s.novo_vencimento, 'valor_cents', s.novo_valor_cents), 'motivo', s.motivo, 'resultado', _resultado));
    RETURN jsonb_build_object('estado', 'concluida');
  ELSIF _resultado = 'paga_no_asaas' THEN
    UPDATE public.asaas_saldo_sync SET estado = 'excecao', motivo = 'pago_no_asaas', lease_until = NULL, updated_at = now(),
      erro = 'A cobrança ' || c.external_id || ' já consta paga no Asaas (' || coalesce(_status_remoto,'?') || '): nada foi alterado.' WHERE id = _job;
    RETURN jsonb_build_object('estado', 'excecao');
  ELSIF _resultado = 'ja_excluida' THEN
    -- excluída fora do Lardan: a cópia local acompanha e o alerta 0297 avisa (sem a marca do espelho)
    PERFORM set_config('lardann.asaas_link','on', true);
    UPDATE public.asaas_charges SET external_status = 'DELETED', updated_at = now() WHERE id = v_charge AND external_status IN ('PENDING','OVERDUE');
    PERFORM set_config('lardann.asaas_link','off', true);
    UPDATE public.asaas_saldo_sync SET estado = 'excecao', motivo = 'excluida_no_asaas', lease_until = NULL, updated_at = now(),
      erro = 'A cobrança ' || c.external_id || ' foi excluída direto no Asaas: decida se reemite pelo saldo.' WHERE id = _job;
    RETURN jsonb_build_object('estado', 'excecao');
  ELSE
    UPDATE public.asaas_saldo_sync SET estado = 'falhou', lease_until = NULL, erro = left(coalesce(_erro,'Falha ao alterar no Asaas.'),500),
      proxima_em = now() + make_interval(mins => least(5 * tentativas, 60)), updated_at = now() WHERE id = _job;
    RETURN jsonb_build_object('estado', 'falhou');
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_alteracao(uuid,text,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_alteracao(uuid,text,text,text,text) TO service_role;

-- Defesa: tarefa de alteração nunca passa pelo caminho de cancelar/criar.
CREATE OR REPLACE FUNCTION public.asaas_saldo_sync_guarda_alterar()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.acao = 'alterar' AND NEW.intent_id IS NOT NULL THEN RAISE EXCEPTION 'Alteração não cria cobrança nova.'; END IF;
  IF NEW.acao = 'alterar' AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.cobrancas) e WHERE e->>'resultado' = 'cancelada') THEN
    RAISE EXCEPTION 'Alteração não cancela cobrança.'; END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS asaas_saldo_sync_guarda_alterar ON public.asaas_saldo_sync;
CREATE TRIGGER asaas_saldo_sync_guarda_alterar BEFORE INSERT OR UPDATE ON public.asaas_saldo_sync
  FOR EACH ROW EXECUTE FUNCTION public.asaas_saldo_sync_guarda_alterar();

-- Botão "Levar o Lardan ao Asaas" (financeiro): pede o espelho de uma parcela, com motivo.
CREATE OR REPLACE FUNCTION public.asaas_espelho_pedir(_inst uuid, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.asaas_ator_pode(auth.uid(), 'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem acesso ao financeiro.'; END IF;
  IF length(btrim(coalesce(_motivo,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 5 letras).'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.installment_id = _inst AND c.external_status IN ('PENDING','OVERDUE')) THEN
    RAISE EXCEPTION 'Esta parcela não tem cobrança aberta no Asaas.'; END IF;
  INSERT INTO public.asaas_espelho_pedidos (installment_id, origem, actor_id, motivo, depois)
  VALUES (_inst, 'manual', auth.uid(), left(btrim(_motivo),500),
          (SELECT jsonb_build_object('vencimento', i.vencimento, 'valor_cents', i.valor_cents) FROM public.financial_installments i WHERE i.id = _inst))
  ON CONFLICT (installment_id) WHERE atendido_em IS NULL
  DO UPDATE SET motivo = EXCLUDED.motivo, actor_id = EXCLUDED.actor_id, updated_at = now()
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'asaas.espelho.pedir', 'financial_installments', _inst, jsonb_build_object('pedido', v_id, 'motivo', left(btrim(_motivo),500)));
  RETURN jsonb_build_object('ok', true, 'pedido', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_espelho_pedir(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asaas_espelho_pedir(uuid,text) TO authenticated;

-- Diferenças AGORA entre a parcela do Lardan e a cobrança aberta no Asaas (uma cobrança, fora de acordo).
-- Vencimento: Asaas antes do Lardan, ou Lardan no futuro diferente do Asaas (cobrança gerada depois do vencimento não é diferença).
CREATE OR REPLACE FUNCTION public.asaas_espelho_diferencas(_limite integer DEFAULT 200)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.asaas_ator_pode(auth.uid(), 'finance.receivable.view') THEN RAISE EXCEPTION 'Sem acesso ao financeiro.'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x.lardan_vencimento), '[]'::jsonb) FROM (
    SELECT c.id charge_id, c.external_id, c.external_status, c.invoice_url, c.due_date asaas_vencimento, c.value_cents asaas_valor_cents,
           i.id installment_id, i.vencimento lardan_vencimento, i.valor_cents parcela_valor_cents, d.saldo lardan_saldo_cents,
           t.id title_id, t.numero titulo_numero, p.display_name pessoa, p.code pessoa_codigo,
           (c.value_cents <> d.saldo) valor_diferente,
           (c.due_date <> i.vencimento AND (c.due_date < i.vencimento OR i.vencimento >= hoje)) vencimento_diferente,
           (i.vencimento >= hoje AND d.saldo >= 500) pode_levar,
           (SELECT s.estado FROM public.asaas_saldo_sync s WHERE s.installment_id = i.id ORDER BY s.created_at DESC LIMIT 1) tarefa_estado,
           (SELECT s.motivo FROM public.asaas_saldo_sync s WHERE s.installment_id = i.id ORDER BY s.created_at DESC LIMIT 1) tarefa_motivo,
           EXISTS (SELECT 1 FROM public.asaas_espelho_pedidos pe WHERE pe.installment_id = i.id AND pe.atendido_em IS NULL) pedido_aberto
      FROM public.asaas_charges c
      JOIN public.financial_installments i ON i.id = c.installment_id
      JOIN public.financial_titles t ON t.id = i.title_id
      LEFT JOIN public.parties p ON p.id = coalesce(t.pagador_party_id, t.party_id)
      CROSS JOIN LATERAL (SELECT greatest(coalesce(public.fin_installment_saldo(i.id),0),0) saldo) d
     WHERE c.external_status IN ('PENDING','OVERDUE') AND t.direction = 'receivable' AND t.status = 'ativo'
       AND NOT EXISTS (SELECT 1 FROM public.asaas_baixas_outra_forma b WHERE b.charge_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.asaas_charge_intents x WHERE x.acordo_simulacao_id IS NOT NULL
                        AND (x.charge_id = c.id OR (x.account_id = c.account_id AND x.external_id = c.external_id)))
       AND (SELECT count(*) FROM public.asaas_charges c2 WHERE c2.installment_id = i.id AND c2.external_status IN ('PENDING','OVERDUE')) = 1
       AND (c.value_cents <> d.saldo OR (c.due_date <> i.vencimento AND (c.due_date < i.vencimento OR i.vencimento >= hoje)))
     LIMIT least(greatest(coalesce(_limite,200),1),500)) x);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_espelho_diferencas(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asaas_espelho_diferencas(integer) TO authenticated;

-- Editar o valor da parcela com cobrança aberta no Asaas agora é permitido: o espelho atualiza a cobrança.
-- Continua recusado quando a cobrança aberta é de acordo (acordo nunca é tocado pelo espelho).
DO $migration$
DECLARE d text; antigo text := $a$if exists (select 1 from asaas_charges c where c.installment_id = _installment and c.external_status in ('PENDING','OVERDUE')) and _valor_cents <> v_i.valor_cents
    then raise exception 'Parcela com cobrança Asaas aberta: cancele a cobrança antes de mudar o valor';$a$;
  novo text := $n$if exists (select 1 from asaas_charges c where c.installment_id = _installment and c.external_status in ('PENDING','OVERDUE')
      and exists (select 1 from asaas_charge_intents x where x.acordo_simulacao_id is not null and (x.charge_id = c.id or (x.account_id = c.account_id and x.external_id = c.external_id))))
      and _valor_cents <> v_i.valor_cents
    then raise exception 'Parcela com cobrança de acordo aberta no Asaas: resolva pelo acordo antes de mudar o valor';$n$;
BEGIN
  d := pg_get_functiondef('public.fin_installment_editar(uuid,date,bigint,text)'::regprocedure);
  IF position('resolva pelo acordo antes de mudar o valor' in d) > 0 THEN RETURN; END IF;
  IF position(antigo in d) = 0 THEN RAISE EXCEPTION 'Definição inesperada da edição de parcela'; END IF;
  EXECUTE replace(d, antigo, novo);
END $migration$;