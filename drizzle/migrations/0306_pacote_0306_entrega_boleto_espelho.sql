-- 0306 — (1) segunda maleta "já está com ela": entrega oficial registrada, ela confirma e aceita no app;
--        (2) conciliação nunca põe o pagamento de um boleto Asaas na parcela de outro boleto;
--        (3) cadastro da cliente no Lardan espelhado no Asaas (Lardan manda; nunca apaga o que só o Asaas tem).

-- ============================================================ (1) entrega em mãos registrada pela equipe
CREATE OR REPLACE FUNCTION public.maleta_entregue_em_maos(_cycle uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles; v_motivo text := btrim(coalesce(_motivo, '')); r jsonb; v_rep text; v_cons text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  IF public.has_capability(uid, 'kit.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'Somente a equipe de maletas registra a entrega em mãos.' USING errcode = '42501';
  END IF;
  IF length(v_motivo) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.consultora_party_id IS NULL THEN RAISE EXCEPTION 'A maleta não tem consultora para receber.'; END IF;
  IF EXISTS (SELECT 1 FROM kit_acceptances a WHERE a.cycle_id = c.id) THEN RAISE EXCEPTION 'Esta maleta já foi aceita.'; END IF;
  IF c.status <> 'transito' THEN
    RAISE EXCEPTION '%', CASE WHEN c.status = 'recebida' THEN 'Ela já confirmou o recebimento: falta só o aceite das peças no app.'
                              ELSE 'A maleta precisa estar a caminho (em trânsito) com o representante.' END;
  END IF;
  IF c.custodian_party_id IS NULL OR EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.status IN ('pendente','transito')
                                               AND t.to_party_id IS DISTINCT FROM c.consultora_party_id) THEN
    RAISE EXCEPTION 'O representante ainda não confirmou que recebeu esta maleta. Ele confirma primeiro no app dele; depois registre a entrega.';
  END IF;
  SELECT display_name INTO v_rep FROM parties WHERE id = c.custodian_party_id;
  SELECT display_name INTO v_cons FROM parties WHERE id = c.consultora_party_id;
  -- rotina oficial: abre a entrega em trânsito para a consultora (ela confirma o recebimento e aceita peça a peça)
  r := public.kit_transfer_forward(_cycle, jsonb_build_object('note',
         left('Entregue em mãos por ' || coalesce(v_rep, 'representante') || ' — registrado pela equipe: ' || v_motivo, 500)));
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, reason, payload)
  VALUES (_cycle, 'entrega.em_maos_registrada', uid, v_motivo,
          jsonb_build_object('representante', c.custodian_party_id, 'consultora', c.consultora_party_id, 'entrega', r));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.entregue_em_maos', 'kit_cycles', _cycle::text,
          jsonb_build_object('consultora', c.consultora_party_id, 'representante', c.custodian_party_id, 'motivo', v_motivo, 'entrega', r));
  RETURN coalesce(r, '{}'::jsonb) || jsonb_build_object('consultora', v_cons, 'representante', v_rep);
END $function$;
REVOKE ALL ON FUNCTION public.maleta_entregue_em_maos(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.maleta_entregue_em_maos(uuid, text) TO authenticated, service_role;

-- transferir (ou segunda maleta) + registrar que já está com ela, numa transação só
CREATE OR REPLACE FUNCTION public.remessa_maleta_transferir_entregue(_cycle uuid, _consultora uuid, _motivo text, _segunda boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r jsonb; e jsonb;
BEGIN
  IF _consultora IS NULL THEN RAISE EXCEPTION 'Escolha a consultora que já está com a maleta.'; END IF;
  r := CASE WHEN coalesce(_segunda, false) THEN public.remessa_maleta_segunda(_cycle, _consultora, _motivo)
            ELSE public.remessa_maleta_transferir(_cycle, _consultora, _motivo) END;
  e := public.maleta_entregue_em_maos(_cycle, _motivo);
  RETURN coalesce(r, '{}'::jsonb) || jsonb_build_object('entrega_registrada', true, 'entrega', e);
END $function$;
REVOKE ALL ON FUNCTION public.remessa_maleta_transferir_entregue(uuid, uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remessa_maleta_transferir_entregue(uuid, uuid, text, boolean) TO authenticated, service_role;

-- ============================================================ (2) pagamento de um boleto só na parcela dele
CREATE OR REPLACE FUNCTION public.fin_conc_boleto_certo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE l record; c record; o record; v_num text;
BEGIN
  IF NEW.installment_id IS NULL OR NEW.line_id IS NULL THEN RETURN NEW; END IF;
  SELECT id, kind, financial_account_id, raw->>'paymentId' AS pay INTO l FROM financial_statement_lines WHERE id = NEW.line_id;
  IF l.id IS NULL OR l.kind <> 'entrada' OR coalesce(l.pay, '') !~ '^pay_' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM financial_installments i JOIN financial_titles t ON t.id = i.title_id
                  WHERE i.id = NEW.installment_id AND t.direction = 'receivable') THEN RETURN NEW; END IF;
  SELECT ch.id, ch.external_id, ch.account_id, ch.installment_id, ch.due_date, ch.value_cents INTO c
    FROM asaas_charges ch JOIN asaas_accounts a ON a.id = ch.account_id
   WHERE ch.external_id = l.pay AND a.financial_account_id = l.financial_account_id LIMIT 1;
  IF c.id IS NULL THEN RETURN NEW; END IF;
  -- parcela de acordo: a baixa oficial espalha o pagamento nas parcelas originais
  IF EXISTS (SELECT 1 FROM asaas_charge_intents ai WHERE ai.acordo_simulacao_id IS NOT NULL
               AND (ai.charge_id = c.id OR (ai.account_id = c.account_id AND ai.external_id = c.external_id))) THEN RETURN NEW; END IF;
  IF c.installment_id IS NOT NULL AND c.installment_id <> NEW.installment_id THEN
    SELECT t.numero INTO v_num FROM financial_installments i JOIN financial_titles t ON t.id = i.title_id WHERE i.id = c.installment_id;
    RAISE EXCEPTION 'Esta linha é o pagamento do boleto % (venc. %, R$ %), que pertence ao título %. Concilie na parcela dele.',
      c.external_id, to_char(c.due_date, 'DD/MM/YYYY'), to_char(c.value_cents / 100.0, 'FM999G990D00'), coalesce(v_num, '?');
  END IF;
  IF c.installment_id IS NULL THEN
    SELECT x.external_id, x.due_date, x.value_cents INTO o FROM asaas_charges x
     WHERE x.installment_id = NEW.installment_id AND x.id <> c.id AND x.external_status <> 'DELETED'
     ORDER BY x.due_date LIMIT 1;
    IF o.external_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta linha é o pagamento do boleto % (venc. %, R$ %), mas a parcela escolhida é cobrada por outro boleto (%, venc. %). Ligue o boleto % à parcela certa antes de conciliar.',
        c.external_id, to_char(c.due_date, 'DD/MM/YYYY'), to_char(c.value_cents / 100.0, 'FM999G990D00'),
        o.external_id, to_char(o.due_date, 'DD/MM/YYYY'), c.external_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fin_conc_boleto_certo() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_fin_conc_boleto_certo ON public.financial_reconciliation_allocations;
CREATE TRIGGER trg_fin_conc_boleto_certo BEFORE INSERT ON public.financial_reconciliation_allocations
  FOR EACH ROW EXECUTE FUNCTION public.fin_conc_boleto_certo();

-- ============================================================ (3) espelho do cadastro Lardan → Asaas
CREATE TABLE public.asaas_cliente_espelho (
  customer_id uuid PRIMARY KEY REFERENCES public.asaas_customers(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  account_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'pendente'
    CHECK (estado IN ('pendente','processando','igual','atualizado','diferente','excluido_no_asaas','erro')),
  motivo text,
  diferencas jsonb NOT NULL DEFAULT '[]'::jsonb,
  erro text,
  tentativas int NOT NULL DEFAULT 0,
  worker text,
  pedido_em timestamptz NOT NULL DEFAULT now(),
  reservado_em timestamptz,
  conferido_em timestamptz,
  enviado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asaas_cliente_espelho_party ON public.asaas_cliente_espelho (party_id);
CREATE INDEX asaas_cliente_espelho_fila ON public.asaas_cliente_espelho (estado, pedido_em);
COMMENT ON TABLE public.asaas_cliente_espelho IS '0306: situação do espelho do cadastro Lardan → cliente Asaas (uma linha por cliente Asaas vinculada).';

CREATE TABLE public.asaas_cliente_espelho_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  party_id uuid NOT NULL,
  external_id text NOT NULL,
  campos jsonb NOT NULL,
  origem text NOT NULL DEFAULT 'rotina',
  actor_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asaas_cliente_espelho_log_party ON public.asaas_cliente_espelho_log (party_id, criado_em DESC);
COMMENT ON TABLE public.asaas_cliente_espelho_log IS '0306: o que o Lardan mudou no cadastro da cliente no Asaas (de → para), confirmado por nova leitura.';

GRANT SELECT ON public.asaas_cliente_espelho TO authenticated;
GRANT SELECT ON public.asaas_cliente_espelho_log TO authenticated;
GRANT ALL ON public.asaas_cliente_espelho TO service_role;
GRANT ALL ON public.asaas_cliente_espelho_log TO service_role;
ALTER TABLE public.asaas_cliente_espelho ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_cliente_espelho_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY asaas_cliente_espelho_ler ON public.asaas_cliente_espelho FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.receivable.view')) OR (SELECT public.cob_pode(auth.uid())));
CREATE POLICY asaas_cliente_espelho_log_ler ON public.asaas_cliente_espelho_log FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'finance.receivable.view')) OR (SELECT public.cob_pode(auth.uid())));

-- dados do cadastro Lardan no formato do Asaas (somente serviço: dado pessoal)
CREATE OR REPLACE FUNCTION public.asaas_cliente_dados_lardan(_party uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'name', nullif(btrim(coalesce(nullif(btrim(p.legal_name), ''), p.display_name)), ''),
    'cpfCnpj', CASE WHEN length(coalesce(p.doc_digits, '')) IN (11, 14) THEN p.doc_digits END,
    'email', (SELECT lower(btrim(cp.value)) FROM contact_points cp
               WHERE cp.party_id = _party AND cp.kind::text = 'email' AND btrim(cp.value) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
               ORDER BY cp.is_primary DESC, cp.updated_at DESC LIMIT 1),
    'mobilePhone', (SELECT x.d FROM (
        SELECT right(regexp_replace(cp.value, '\D', '', 'g'), 11) AS d, regexp_replace(cp.value, '\D', '', 'g') AS bruto,
               cp.kind::text AS k, cp.is_primary, cp.updated_at
          FROM contact_points cp WHERE cp.party_id = _party AND cp.kind::text IN ('whatsapp','telefone')) x
       WHERE (length(x.bruto) = 11 OR (length(x.bruto) = 13 AND x.bruto LIKE '55%')) AND substr(x.d, 3, 1) = '9'
       ORDER BY (x.k = 'whatsapp') DESC, x.is_primary DESC, x.updated_at DESC LIMIT 1),
    'phone', (SELECT x.d FROM (
        SELECT right(regexp_replace(cp.value, '\D', '', 'g'), 10) AS d, regexp_replace(cp.value, '\D', '', 'g') AS bruto,
               cp.is_primary, cp.updated_at
          FROM contact_points cp WHERE cp.party_id = _party AND cp.kind::text = 'telefone') x
       WHERE (length(x.bruto) = 10 OR (length(x.bruto) = 12 AND x.bruto LIKE '55%')) AND substr(x.d, 3, 1) IN ('2','3','4','5')
       ORDER BY x.is_primary DESC, x.updated_at DESC LIMIT 1),
    'postalCode', CASE WHEN length(regexp_replace(coalesce(a.postal_code, ''), '\D', '', 'g')) = 8 THEN regexp_replace(a.postal_code, '\D', '', 'g') END,
    'address', nullif(btrim(a.street), ''),
    'addressNumber', CASE WHEN a.no_number THEN 'S/N' ELSE nullif(btrim(a.street_number), '') END,
    'complement', nullif(btrim(a.complement), ''),
    'province', nullif(btrim(a.district), ''))
  FROM parties p
  LEFT JOIN LATERAL (SELECT * FROM party_addresses pa WHERE pa.party_id = _party ORDER BY pa.is_primary DESC, pa.updated_at DESC LIMIT 1) a ON true
  WHERE p.id = _party
$function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_dados_lardan(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_dados_lardan(uuid) TO service_role;

-- pedir conferência/atualização de todas as clientes Asaas vinculadas à pessoa
CREATE OR REPLACE FUNCTION public.asaas_cliente_espelho_pedir(_party uuid, _motivo text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE n int;
BEGIN
  IF _party IS NULL THEN RETURN 0; END IF;
  INSERT INTO asaas_cliente_espelho (customer_id, party_id, account_id, estado, motivo, pedido_em, atualizado_em)
  SELECT c.id, c.party_id, c.account_id, 'pendente', left(coalesce(_motivo, 'cadastro alterado'), 200), now(), now()
    FROM asaas_customers c WHERE c.party_id = _party AND c.match_status = 'vinculado'
  ON CONFLICT (customer_id) DO UPDATE
     SET party_id = EXCLUDED.party_id, account_id = EXCLUDED.account_id,
         estado = CASE WHEN asaas_cliente_espelho.estado = 'processando' THEN 'processando' ELSE 'pendente' END,
         motivo = EXCLUDED.motivo, pedido_em = now(), tentativas = 0, atualizado_em = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_espelho_pedir(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_espelho_pedir(uuid, text) TO service_role;

-- gatilhos: qualquer mudança no cadastro pede o espelho (nunca derruba o salvamento do cadastro)
CREATE OR REPLACE FUNCTION public.asaas_cliente_espelho_gatilho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_party uuid; v_motivo text;
BEGIN
  IF TG_TABLE_NAME = 'parties' THEN
    IF NEW.display_name IS NOT DISTINCT FROM OLD.display_name AND NEW.legal_name IS NOT DISTINCT FROM OLD.legal_name
       AND NEW.doc_digits IS NOT DISTINCT FROM OLD.doc_digits THEN RETURN NEW; END IF;
    v_party := NEW.id; v_motivo := 'nome/CPF alterado';
  ELSIF TG_TABLE_NAME = 'asaas_customers' THEN
    IF NEW.match_status <> 'vinculado' OR NEW.party_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.party_id IS NOT DISTINCT FROM OLD.party_id AND OLD.match_status = 'vinculado' THEN RETURN NEW; END IF;
    v_party := NEW.party_id; v_motivo := 'cliente Asaas vinculada';
  ELSE
    v_party := CASE WHEN TG_OP = 'DELETE' THEN OLD.party_id ELSE NEW.party_id END;
    v_motivo := CASE WHEN TG_TABLE_NAME = 'party_addresses' THEN 'endereço alterado' ELSE 'contato alterado' END;
  END IF;
  BEGIN
    PERFORM public.asaas_cliente_espelho_pedir(v_party, v_motivo);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- o espelho nunca impede salvar o cadastro; a próxima alteração ou o botão pedem de novo
  END;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_espelho_gatilho() FROM public, anon, authenticated;

CREATE TRIGGER trg_asaas_espelho_contato AFTER INSERT OR UPDATE OR DELETE ON public.contact_points
  FOR EACH ROW EXECUTE FUNCTION public.asaas_cliente_espelho_gatilho();
CREATE TRIGGER trg_asaas_espelho_endereco AFTER INSERT OR UPDATE OR DELETE ON public.party_addresses
  FOR EACH ROW EXECUTE FUNCTION public.asaas_cliente_espelho_gatilho();
CREATE TRIGGER trg_asaas_espelho_pessoa AFTER UPDATE OF display_name, legal_name, doc_digits ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.asaas_cliente_espelho_gatilho();
CREATE TRIGGER trg_asaas_espelho_cliente AFTER INSERT OR UPDATE OF party_id, match_status ON public.asaas_customers
  FOR EACH ROW EXECUTE FUNCTION public.asaas_cliente_espelho_gatilho();

-- rotina (servidor): reserva as próximas
CREATE OR REPLACE FUNCTION public.asaas_cliente_espelho_proximos(_worker text, _limite int DEFAULT 15, _party uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r jsonb;
BEGIN
  IF coalesce(btrim(_worker), '') = '' THEN RAISE EXCEPTION 'Worker obrigatório.'; END IF;
  WITH alvo AS (
    SELECT e.customer_id FROM asaas_cliente_espelho e
     WHERE (_party IS NULL OR e.party_id = _party)
       AND (e.estado = 'pendente'
            OR (e.estado = 'processando' AND e.reservado_em < now() - interval '10 minutes')
            OR (e.estado = 'erro' AND e.tentativas < 5 AND e.atualizado_em < now() - make_interval(mins => 15 * greatest(e.tentativas, 1))))
     ORDER BY e.pedido_em
     LIMIT greatest(1, least(coalesce(_limite, 15), 50))
     FOR UPDATE SKIP LOCKED),
  marcado AS (
    UPDATE asaas_cliente_espelho e SET estado = 'processando', worker = _worker, reservado_em = clock_timestamp(), tentativas = e.tentativas + 1
      FROM alvo WHERE e.customer_id = alvo.customer_id RETURNING e.customer_id, e.party_id, e.account_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object('customer_id', m.customer_id, 'party_id', m.party_id, 'account_id', m.account_id,
           'external_id', c.external_id, 'lardan', public.asaas_cliente_dados_lardan(m.party_id))), '[]'::jsonb) INTO r
    FROM marcado m JOIN asaas_customers c ON c.id = m.customer_id;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_espelho_proximos(text, int, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_espelho_proximos(text, int, uuid) TO service_role;

-- rotina (servidor): grava o resultado depois de conferir de novo no Asaas
CREATE OR REPLACE FUNCTION public.asaas_cliente_espelho_registrar(_customer uuid, _worker text, _estado text, _diferencas jsonb,
  _enviados jsonb DEFAULT '{}'::jsonb, _erro text DEFAULT NULL, _actor uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE e asaas_cliente_espelho; v text; v_ext text;
BEGIN
  IF _estado NOT IN ('igual','atualizado','diferente','excluido_no_asaas','erro') THEN RAISE EXCEPTION 'Estado inválido: %', _estado; END IF;
  SELECT * INTO e FROM asaas_cliente_espelho WHERE customer_id = _customer FOR UPDATE;
  IF e.customer_id IS NULL OR e.estado <> 'processando' OR e.worker IS DISTINCT FROM _worker THEN RETURN 'ignorado'; END IF;
  -- cadastro mudou de novo enquanto conferíamos: volta para a fila
  v := CASE WHEN e.pedido_em > e.reservado_em THEN 'pendente' ELSE _estado END;
  UPDATE asaas_cliente_espelho
     SET estado = v, diferencas = coalesce(_diferencas, '[]'::jsonb), erro = left(_erro, 500), worker = NULL,
         conferido_em = now(), atualizado_em = now(),
         tentativas = CASE WHEN _estado = 'erro' THEN tentativas ELSE 0 END,
         enviado_em = CASE WHEN coalesce(_enviados, '{}'::jsonb) <> '{}'::jsonb THEN now() ELSE enviado_em END
   WHERE customer_id = _customer;
  IF coalesce(_enviados, '{}'::jsonb) <> '{}'::jsonb THEN
    SELECT external_id INTO v_ext FROM asaas_customers WHERE id = _customer;
    INSERT INTO asaas_cliente_espelho_log (customer_id, party_id, external_id, campos, origem, actor_id)
    VALUES (_customer, e.party_id, v_ext, _enviados, CASE WHEN _actor IS NULL THEN 'rotina' ELSE 'botao' END, _actor);
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (_actor, 'asaas.cliente_espelho', 'parties', e.party_id::text, jsonb_build_object('cliente', v_ext, 'campos', _enviados));
  END IF;
  RETURN v;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_espelho_registrar(uuid, text, text, jsonb, jsonb, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_espelho_registrar(uuid, text, text, jsonb, jsonb, text, uuid) TO service_role;

-- leitura para a ficha da cobrança
CREATE OR REPLACE FUNCTION public.asaas_cliente_espelho_situacao(_party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_capability(auth.uid(), 'finance.receivable.view') OR public.cob_pode(auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN jsonb_build_object(
    'vinculadas', (SELECT count(*) FROM asaas_customers c WHERE c.party_id = _party AND c.match_status = 'vinculado'),
    'clientes', coalesce((SELECT jsonb_agg(jsonb_build_object('external_id', c.external_id, 'estado', e.estado, 'diferencas', e.diferencas,
                   'erro', e.erro, 'conferido_em', e.conferido_em, 'enviado_em', e.enviado_em, 'pedido_em', e.pedido_em) ORDER BY c.external_id)
                FROM asaas_cliente_espelho e JOIN asaas_customers c ON c.id = e.customer_id WHERE e.party_id = _party), '[]'::jsonb),
    'ultimas', coalesce((SELECT jsonb_agg(x ORDER BY x->>'criado_em' DESC) FROM (
                 SELECT jsonb_build_object('external_id', l.external_id, 'campos', l.campos, 'origem', l.origem, 'criado_em', l.criado_em) x
                   FROM asaas_cliente_espelho_log l WHERE l.party_id = _party ORDER BY l.criado_em DESC LIMIT 10) s), '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cliente_espelho_situacao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_espelho_situacao(uuid) TO authenticated, service_role;

-- primeira passada: todas as clientes Asaas já vinculadas entram na fila (a rotina confere uma a uma)
INSERT INTO public.asaas_cliente_espelho (customer_id, party_id, account_id, estado, motivo)
SELECT c.id, c.party_id, c.account_id, 'pendente', 'primeira conferência (0306)'
  FROM public.asaas_customers c WHERE c.match_status = 'vinculado' AND c.party_id IS NOT NULL
ON CONFLICT (customer_id) DO NOTHING;
