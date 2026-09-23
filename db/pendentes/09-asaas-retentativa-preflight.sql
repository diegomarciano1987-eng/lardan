-- ============================================================
-- 09 — Asaas: espera de retentativa, preflight, posse com token,
--      paginação oficial (offset + limit). Pendente: somente ambiente isolado.
--
-- Sem BEGIN/COMMIT próprios: o pacote pendente inteiro é aplicado numa única
-- transação (tests/isolado/subir.sh) e a atualização a partir do pacote
-- anterior usa --single-transaction (tests/isolado/atualizar.sh).
-- Nada aqui cria liquidação, baixa, alocação ou lançamento no razão.
-- ============================================================

-- ---------- 1. estado explícito de espera ----------
ALTER TABLE public.asaas_charge_intents
  ADD COLUMN IF NOT EXISTS retomar_modo text,
  ADD COLUMN IF NOT EXISTS request_timeout_s integer NOT NULL DEFAULT 0;

ALTER TABLE public.asaas_charge_intents DROP CONSTRAINT IF EXISTS asaas_charge_intents_state_check;
ALTER TABLE public.asaas_charge_intents ADD CONSTRAINT asaas_charge_intents_state_check CHECK (
  state IN ('preparada','processando','aguardando_retentativa','criada','rejeitada','desconhecida','conciliacao','cancelada'));
ALTER TABLE public.asaas_charge_intents DROP CONSTRAINT IF EXISTS asaas_charge_intents_retomar_ck;
ALTER TABLE public.asaas_charge_intents ADD CONSTRAINT asaas_charge_intents_retomar_ck CHECK (
  (state <> 'aguardando_retentativa' AND retomar_modo IS NULL) OR
  (state = 'aguardando_retentativa' AND retomar_modo IN ('criar','consultar')
     AND next_attempt_at IS NOT NULL AND lease_until IS NULL
     AND failure_class IN ('credencial','limite','consulta_indisponivel')));
ALTER TABLE public.asaas_charge_intents DROP CONSTRAINT IF EXISTS asaas_charge_intents_timeout_ck;
ALTER TABLE public.asaas_charge_intents ADD CONSTRAINT asaas_charge_intents_timeout_ck CHECK (
  request_timeout_s BETWEEN 0 AND 120);

CREATE OR REPLACE FUNCTION public.asaas_intent_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF coalesce(current_setting('lardann.asaas_intent', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Intenção de cobrança só pelas rotinas oficiais.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.installment_id IS DISTINCT FROM OLD.installment_id
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.value_cents IS DISTINCT FROM OLD.value_cents
       OR NEW.internal_reference IS DISTINCT FROM OLD.internal_reference THEN
      RAISE EXCEPTION 'O conteúdo da intenção não muda depois de registrada.';
    END IF;
    IF OLD.external_id IS NOT NULL AND NEW.external_id IS DISTINCT FROM OLD.external_id THEN
      RAISE EXCEPTION 'O identificador externo da intenção não muda nem some.';
    END IF;
    IF OLD.state IN ('criada','rejeitada','cancelada') AND NEW.state <> OLD.state THEN
      RAISE EXCEPTION 'Intenção já resolvida não volta de estado.';
    END IF;
    IF NEW.state <> OLD.state AND NOT (
         (OLD.state = 'preparada'    AND NEW.state IN ('processando','cancelada'))
      OR (OLD.state = 'processando'  AND NEW.state IN ('criada','rejeitada','desconhecida','conciliacao','aguardando_retentativa'))
      OR (OLD.state = 'desconhecida' AND NEW.state IN ('criada','rejeitada','conciliacao','aguardando_retentativa'))
      OR (OLD.state = 'aguardando_retentativa' AND OLD.retomar_modo = 'criar'     AND NEW.state = 'processando')
      OR (OLD.state = 'aguardando_retentativa' AND OLD.retomar_modo = 'consultar' AND NEW.state = 'desconhecida')
      OR (OLD.state = 'conciliacao'  AND NEW.state IN ('cancelada'))) THEN
      RAISE EXCEPTION 'Transição de intenção inválida: % → %.', OLD.state, NEW.state;
    END IF;
    IF OLD.state = 'desconhecida' AND NEW.state = 'aguardando_retentativa' AND NEW.retomar_modo <> 'consultar' THEN
      RAISE EXCEPTION 'Resultado desconhecido só volta a ser executado por consulta ao provedor.';
    END IF;
    IF NEW.state = 'rejeitada' AND OLD.state = 'desconhecida'
       AND NEW.rejeicao_fase IS DISTINCT FROM 'sem_registro_apos_consulta' THEN
      RAISE EXCEPTION 'Resultado desconhecido só é encerrado depois de consultar o provedor.';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $fn$;

-- Intenções travadas pelo pacote anterior (processando sem posse, ou
-- desconhecida com prazo ignorado) passam ao estado explícito de espera.
DO $$
BEGIN
  PERFORM set_config('lardann.asaas_intent','on', true);
  WITH m AS (
    UPDATE public.asaas_charge_intents
       SET state='aguardando_retentativa', retomar_modo='criar',
           failure_class=coalesce(failure_class,'consulta_indisponivel'),
           next_attempt_at=coalesce(next_attempt_at, now())
     WHERE state='processando' AND lease_until IS NULL
     RETURNING id)
  INSERT INTO public.asaas_charge_intent_events(intent_id,de,para,detalhe,actor_id)
  SELECT id,'processando','aguardando_retentativa',jsonb_build_object('motivo','migracao_09_estado_travado'),NULL FROM m;
  WITH m AS (
    UPDATE public.asaas_charge_intents
       SET state='aguardando_retentativa', retomar_modo='consultar',
           failure_class=coalesce(failure_class,'consulta_indisponivel')
     WHERE state='desconhecida' AND lease_until IS NULL AND next_attempt_at IS NOT NULL
     RETURNING id)
  INSERT INTO public.asaas_charge_intent_events(intent_id,de,para,detalhe,actor_id)
  SELECT id,'desconhecida','aguardando_retentativa',jsonb_build_object('motivo','migracao_09_prazo_ignorado'),NULL FROM m;
  PERFORM set_config('lardann.asaas_intent','off', true);
END $$;

-- a espera continua viva: bloqueia outra intenção na mesma parcela
DROP INDEX IF EXISTS public.asaas_charge_intents_viva_uidx;
CREATE UNIQUE INDEX asaas_charge_intents_viva_uidx
  ON public.asaas_charge_intents (installment_id)
  WHERE state IN ('preparada','processando','aguardando_retentativa','criada','desconhecida','conciliacao');

-- ---------- 2. adiar: mesma intenção, prazo, auditoria ----------
DROP FUNCTION IF EXISTS public.asaas_exec_adiar(uuid,text,integer,uuid,text,text[],integer,text);
CREATE FUNCTION public.asaas_exec_adiar(_intent uuid,_worker text,_tentativa integer,_actor uuid,
  _classe text,_codigos text[],_repetir_em integer,_erro text,_agora timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE it public.asaas_charge_intents; base timestamptz := coalesce(_agora, now());
        segundos integer; prazo timestamptz; retomar text;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage');
  it := public.asaas_exec_posse(_intent,_worker,_tentativa);
  IF _classe NOT IN ('credencial','limite','consulta_indisponivel') THEN
    RAISE EXCEPTION 'Classe recuperável inválida.';
  END IF;
  segundos := CASE _classe
    WHEN 'credencial' THEN 3600                                   -- pendência operacional
    WHEN 'limite' THEN CASE WHEN _repetir_em BETWEEN 1 AND 86400 THEN _repetir_em ELSE 60 END  -- Retry-After válido
    ELSE CASE WHEN _repetir_em BETWEEN 1 AND 86400 THEN _repetir_em ELSE 300 END END;
  prazo := base + make_interval(secs => segundos);
  retomar := CASE WHEN it.state = 'desconhecida' THEN 'consultar' ELSE 'criar' END;
  PERFORM set_config('lardann.asaas_intent','on',true);
  UPDATE public.asaas_charge_intents
     SET state='aguardando_retentativa', retomar_modo=retomar, failure_class=_classe,
         failure_codes=_codigos, next_attempt_at=prazo, last_error=left(_erro,500), lease_until=NULL
   WHERE id=_intent;
  INSERT INTO public.asaas_charge_intent_events(intent_id,de,para,detalhe,actor_id)
  VALUES(_intent,it.state,'aguardando_retentativa',
    jsonb_build_object('classe',_classe,'codigos',_codigos,'next_attempt_at',prazo,'retomar',retomar,
                       'worker',_worker,'tentativa',_tentativa),_actor);
  PERFORM set_config('lardann.asaas_intent','off',true);
  RETURN jsonb_build_object('id',_intent,'state','aguardando_retentativa','failure_class',_classe,
    'next_attempt_at',prazo,'retomar',retomar,
    'pendencia_operacional', _classe = 'credencial');
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_adiar(uuid,text,integer,uuid,text,text[],integer,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_adiar(uuid,text,integer,uuid,text,text[],integer,text,timestamptz) TO service_role;

-- ---------- 3. reservar: respeita prazo e folga de requisição ----------
DROP FUNCTION IF EXISTS public.asaas_exec_reservar(uuid,text,uuid,integer);
CREATE FUNCTION public.asaas_exec_reservar(
  _intent uuid, _worker text, _actor uuid, _lease_segundos integer DEFAULT 120,
  _agora timestamptz DEFAULT NULL, _timeout_req integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE it record; conta record; pa record; modo text; lease integer; de text;
        agora timestamptz := coalesce(_agora, now()); tmo integer;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor, 'finance.receivable.manage');
  IF coalesce(btrim(_worker),'') = '' THEN RAISE EXCEPTION 'Trabalhador obrigatório.'; END IF;
  lease := least(greatest(coalesce(_lease_segundos,120),1),900);
  tmo := least(greatest(coalesce(_timeout_req,0),0),120);
  IF tmo >= lease THEN RAISE EXCEPTION 'A posse precisa durar mais que o tempo máximo da requisição.'; END IF;
  SELECT * INTO it FROM public.asaas_charge_intents WHERE id = _intent FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Intenção inexistente.'; END IF;
  SELECT * INTO conta FROM public.asaas_accounts WHERE id = it.account_id;
  de := it.state;

  PERFORM set_config('lardann.asaas_intent','on', true);
  IF it.state = 'preparada'
     OR (it.state = 'aguardando_retentativa' AND it.retomar_modo = 'criar' AND it.next_attempt_at <= agora) THEN
    UPDATE public.asaas_charge_intents
       SET state='processando', worker=_worker, processing_at=agora, attempts = attempts + 1,
           lease_until = agora + make_interval(secs => lease), request_timeout_s = tmo,
           retomar_modo = NULL, next_attempt_at = NULL
     WHERE id = _intent RETURNING * INTO it;
    INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
    VALUES (_intent, de, 'processando',
            jsonb_build_object('worker', _worker, 'tentativa', it.attempts, 'lease_s', lease,
                               'motivo', CASE WHEN de='preparada' THEN 'inicio' ELSE 'retentativa_apos_prazo' END), _actor);
    modo := 'criar';
  ELSIF it.state = 'processando' AND it.lease_until IS NOT NULL
        AND it.lease_until + make_interval(secs => it.request_timeout_s) < agora THEN
    -- a folga garante que nenhuma requisição do dono anterior ainda esteja em voo
    UPDATE public.asaas_charge_intents
       SET state='desconhecida', recuperacoes = recuperacoes + 1,
           last_error = 'Execução interrompida: posse expirou sem resultado. Consultar o provedor antes de qualquer reenvio.',
           worker=_worker, attempts = attempts + 1, lease_until = agora + make_interval(secs => lease),
           request_timeout_s = tmo
     WHERE id = _intent RETURNING * INTO it;
    INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
    VALUES (_intent, 'processando', 'desconhecida',
            jsonb_build_object('motivo','posse_expirada','worker', _worker, 'tentativa', it.attempts), _actor);
    modo := 'consultar';
  ELSIF (it.state = 'desconhecida' AND (it.lease_until IS NULL
            OR it.lease_until + make_interval(secs => it.request_timeout_s) < agora))
     OR (it.state = 'aguardando_retentativa' AND it.retomar_modo = 'consultar' AND it.next_attempt_at <= agora) THEN
    UPDATE public.asaas_charge_intents
       SET state='desconhecida', worker=_worker, attempts = attempts + 1,
           lease_until = agora + make_interval(secs => lease), request_timeout_s = tmo,
           retomar_modo = NULL, next_attempt_at = NULL
     WHERE id = _intent RETURNING * INTO it;
    INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
    VALUES (_intent, de, 'desconhecida',
            jsonb_build_object('motivo','consulta','worker', _worker, 'tentativa', it.attempts), _actor);
    modo := 'consultar';
  END IF;
  PERFORM set_config('lardann.asaas_intent','off', true);

  IF modo IS NULL THEN
    RETURN jsonb_build_object('id', it.id, 'reservada', false, 'state', it.state,
      'external_id', it.external_id, 'charge_id', it.charge_id,
      'failure_class', it.failure_class, 'next_attempt_at', it.next_attempt_at,
      'invoice_url', coalesce((SELECT invoice_url FROM public.asaas_charges WHERE id = it.charge_id), it.invoice_url));
  END IF;

  SELECT id, display_name, doc_canon INTO pa FROM public.parties WHERE id = it.party_id;
  RETURN jsonb_build_object('id', it.id, 'reservada', true, 'modo', modo, 'state', it.state,
    'tentativa', it.attempts, 'worker', _worker, 'lease_until', it.lease_until,
    'account_id', it.account_id, 'modo_execucao', conta.modo_execucao,
    'ambiente_provedor', conta.ambiente_provedor,
    'customer_external_id', it.customer_external_id, 'party_id', it.party_id,
    'devedor', jsonb_build_object('nome', pa.display_name, 'doc', pa.doc_canon),
    'valor_cents', it.value_cents, 'due_date', it.due_date, 'billing_type', it.billing_type,
    'internal_reference', it.internal_reference, 'external_id', it.external_id);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_reservar(uuid,text,uuid,integer,timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_reservar(uuid,text,uuid,integer,timestamptz,integer) TO service_role;

/** Renovação da posse da intenção durante chamada lenta. */
CREATE OR REPLACE FUNCTION public.asaas_exec_renovar(_intent uuid,_worker text,_tentativa integer,_segundos integer DEFAULT 120)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE it public.asaas_charge_intents;
BEGIN
  it := public.asaas_exec_posse(_intent,_worker,_tentativa);
  IF it.lease_until IS NULL OR it.lease_until < now() THEN RETURN false; END IF;
  PERFORM set_config('lardann.asaas_intent','on',true);
  UPDATE public.asaas_charge_intents SET lease_until = now() + make_interval(secs => least(greatest(_segundos,1),900))
   WHERE id=_intent;
  PERFORM set_config('lardann.asaas_intent','off',true);
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_renovar(uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_renovar(uuid,text,integer,integer) TO service_role;

-- ---------- 4. pendentes: só depois do prazo ----------
DROP FUNCTION IF EXISTS public.asaas_exec_pendentes(uuid,integer,integer);
CREATE FUNCTION public.asaas_exec_pendentes(
  _account uuid DEFAULT NULL, _preparada_seg integer DEFAULT 60, _limite integer DEFAULT 50,
  _agora timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'state', x.state, 'account_id', x.account_id)
                            ORDER BY x.created_at, x.id), '[]'::jsonb)
    FROM (SELECT id, state, account_id, created_at FROM public.asaas_charge_intents
           WHERE (_account IS NULL OR account_id = _account)
             AND ((state = 'preparada' AND created_at < coalesce(_agora, now()) - make_interval(secs => greatest(_preparada_seg,0)))
               OR (state = 'processando' AND lease_until IS NOT NULL
                   AND lease_until + make_interval(secs => request_timeout_s) < coalesce(_agora, now()))
               OR (state = 'desconhecida' AND (lease_until IS NULL
                   OR lease_until + make_interval(secs => request_timeout_s) < coalesce(_agora, now())))
               OR (state = 'aguardando_retentativa' AND next_attempt_at <= coalesce(_agora, now())))
           ORDER BY created_at, id
           LIMIT least(greatest(coalesce(_limite,50),1),200)) x;
$fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_pendentes(uuid,integer,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_pendentes(uuid,integer,integer,timestamptz) TO service_role;

-- ---------- 5. posse do cliente com token próprio ----------
ALTER TABLE public.asaas_customer_leases
  ADD COLUMN IF NOT EXISTS lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS request_timeout_s integer NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.asaas_exec_cliente_reservar(uuid,text,integer,uuid,integer);
CREATE FUNCTION public.asaas_exec_cliente_reservar(_intent uuid,_worker text,_tentativa integer,_actor uuid,
  _lease integer DEFAULT 120,_timeout_req integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE it public.asaas_charge_intents; cu record; l record; n integer; lease integer; tmo integer;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage');
  it := public.asaas_exec_posse(_intent,_worker,_tentativa);
  lease := least(greatest(coalesce(_lease,120),1),900);
  tmo := least(greatest(coalesce(_timeout_req,0),0),120);
  IF tmo >= lease THEN RAISE EXCEPTION 'A posse precisa durar mais que o tempo máximo da requisição.'; END IF;
  SELECT count(*) INTO n FROM public.asaas_customers WHERE account_id=it.account_id AND party_id=it.party_id AND match_status='vinculado';
  IF n>1 THEN RETURN jsonb_build_object('reservada',false,'revisao',true,'motivo','Mais de um cliente vinculado; escolha canônica obrigatória.'); END IF;
  SELECT * INTO cu FROM public.asaas_customers WHERE account_id=it.account_id AND party_id=it.party_id AND match_status='vinculado';
  IF cu.id IS NOT NULL THEN RETURN jsonb_build_object('reservada',false,'external_id',cu.external_id,'existente',true); END IF;

  INSERT INTO public.asaas_customer_leases(account_id,party_id,worker,lease_until,state,lease_token,request_timeout_s)
  VALUES(it.account_id,it.party_id,_worker,now()+make_interval(secs=>lease),'consultar',gen_random_uuid(),tmo)
  ON CONFLICT(account_id,party_id) DO UPDATE SET
    worker=excluded.worker, attempt=asaas_customer_leases.attempt+1, lease_until=excluded.lease_until,
    lease_token=gen_random_uuid(), request_timeout_s=excluded.request_timeout_s,
    -- quem assume depois de um 'criar' interrompido nunca cria antes de consultar
    state=CASE WHEN asaas_customer_leases.state IN ('criar','desconhecida') THEN 'desconhecida' ELSE 'consultar' END,
    updated_at=now()
  WHERE asaas_customer_leases.state IN ('concluida','revisao')
     OR asaas_customer_leases.lease_until + make_interval(secs => asaas_customer_leases.request_timeout_s) < now()
  RETURNING * INTO l;
  IF l.account_id IS NULL THEN
    RETURN jsonb_build_object('reservada',false,'ocupada',true);
  END IF;
  RETURN jsonb_build_object('reservada',true,'estado',l.state,'tentativa',l.attempt,'token',l.lease_token,'lease_until',l.lease_until);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_cliente_reservar(uuid,text,integer,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_cliente_reservar(uuid,text,integer,uuid,integer,integer) TO service_role;

/** Confere que o token ainda é o dono atual e vivo da posse do cliente. */
CREATE OR REPLACE FUNCTION public.asaas_cliente_posse(_account uuid,_party uuid,_worker text,_token uuid)
RETURNS public.asaas_customer_leases LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE l public.asaas_customer_leases;
BEGIN
  SELECT * INTO l FROM public.asaas_customer_leases WHERE account_id=_account AND party_id=_party FOR UPDATE;
  IF l.account_id IS NULL OR _token IS NULL OR l.lease_token <> _token OR l.worker <> _worker
     OR l.state IN ('concluida','revisao') OR l.lease_until < now() THEN
    RAISE EXCEPTION 'Posse do cliente perdida: outro trabalhador assumiu ou a posse expirou.' USING errcode='P0003';
  END IF;
  RETURN l;
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_cliente_posse(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.asaas_exec_cliente_renovar(_intent uuid,_worker text,_tentativa integer,_actor uuid,_token uuid,_lease integer DEFAULT 120)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE it public.asaas_charge_intents;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage');
  it := public.asaas_exec_posse(_intent,_worker,_tentativa);
  BEGIN
    PERFORM public.asaas_cliente_posse(it.account_id,it.party_id,_worker,_token);
  EXCEPTION WHEN SQLSTATE 'P0003' THEN RETURN false;
  END;
  UPDATE public.asaas_customer_leases SET lease_until=now()+make_interval(secs=>least(greatest(_lease,1),900)),updated_at=now()
   WHERE account_id=it.account_id AND party_id=it.party_id AND lease_token=_token;
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_cliente_renovar(uuid,text,integer,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_cliente_renovar(uuid,text,integer,uuid,uuid,integer) TO service_role;

DROP FUNCTION IF EXISTS public.asaas_exec_cliente_estado(uuid,text,integer,uuid,text,text);
CREATE FUNCTION public.asaas_exec_cliente_estado(_intent uuid,_worker text,_tentativa integer,_actor uuid,
  _token uuid,_state text,_erro text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE it public.asaas_charge_intents;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage');
  it := public.asaas_exec_posse(_intent,_worker,_tentativa);
  IF _state NOT IN('criar','desconhecida','concluida','revisao') THEN RAISE EXCEPTION 'Estado de cliente inválido.'; END IF;
  PERFORM public.asaas_cliente_posse(it.account_id,it.party_id,_worker,_token);
  -- 'desconhecida' é gravada depois que a chamada TERMINOU (com erro): a posse é
  -- liberada, mas quem assumir herda 'desconhecida' e consulta antes de criar.
  UPDATE public.asaas_customer_leases SET state=_state,last_error=left(_erro,500),
    lease_until=CASE WHEN _state IN('concluida','revisao','desconhecida') THEN now() ELSE lease_until END,updated_at=now()
   WHERE account_id=it.account_id AND party_id=it.party_id AND lease_token=_token;
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_cliente_estado(uuid,text,integer,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_cliente_estado(uuid,text,integer,uuid,uuid,text,text) TO service_role;

/** Persistir o cliente externo: somente o dono atual da posse (token). */
DROP FUNCTION IF EXISTS public.asaas_exec_cliente(uuid,text,integer,uuid,text,text);
CREATE FUNCTION public.asaas_exec_cliente(
  _intent uuid, _worker text, _tentativa integer, _actor uuid, _token uuid, _external_id text, _nome text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE it public.asaas_charge_intents; cu record;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor, 'finance.receivable.manage');
  it := public.asaas_exec_posse(_intent, _worker, _tentativa);
  IF coalesce(btrim(_external_id),'') = '' THEN RAISE EXCEPTION 'Cliente externo sem identificador.'; END IF;
  PERFORM public.asaas_cliente_posse(it.account_id, it.party_id, _worker, _token);

  SELECT * INTO cu FROM public.asaas_customers WHERE account_id = it.account_id AND external_id = _external_id;
  IF cu.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.asaas_customers WHERE account_id=it.account_id AND party_id=it.party_id
                AND match_status='vinculado' AND external_id <> _external_id) THEN
      RAISE EXCEPTION 'A pessoa já possui outro cliente externo vinculado: revisão humana obrigatória.';
    END IF;
    INSERT INTO public.asaas_customers (account_id, external_id, name, party_id, match_status, match_note)
    VALUES (it.account_id, _external_id, left(coalesce(_nome,'Cliente'),200), it.party_id, 'vinculado',
            'Cliente criado ou localizado pela Lardan para cobrança de parcela.')
    RETURNING * INTO cu;
  ELSIF cu.party_id IS NOT NULL AND cu.party_id <> it.party_id THEN
    RAISE EXCEPTION 'O cliente externo devolvido está vinculado a outra pessoa.';
  ELSIF cu.party_id IS NULL THEN
    UPDATE public.asaas_customers SET party_id = it.party_id, match_status = 'vinculado' WHERE id = cu.id;
  END IF;

  PERFORM set_config('lardann.asaas_intent','on', true);
  UPDATE public.asaas_charge_intents SET customer_external_id = _external_id WHERE id = _intent;
  PERFORM set_config('lardann.asaas_intent','off', true);
  UPDATE public.asaas_customer_leases SET state='concluida', lease_until=now(), updated_at=now()
   WHERE account_id=it.account_id AND party_id=it.party_id AND lease_token=_token;
  INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
  VALUES (_intent, it.state, it.state, jsonb_build_object('cliente_externo', _external_id), _actor);
  RETURN jsonb_build_object('customer_id', cu.id, 'external_id', _external_id);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_cliente(uuid,text,integer,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_cliente(uuid,text,integer,uuid,uuid,text,text) TO service_role;

-- ---------- 6. preflight: conta derivada do registro, sem efeito ----------
/** Ator do executor: ativo, com papel e com pessoa vinculada. */
CREATE OR REPLACE FUNCTION public.asaas_ator_pode(_actor uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT _actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
      JOIN public.role_capabilities rc ON rc.role = ur.role
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.user_id = _actor AND rc.capability = _cap AND p.is_active AND p.party_id IS NOT NULL)
$fn$;
REVOKE ALL ON FUNCTION public.asaas_ator_pode(uuid,text) FROM PUBLIC,anon,authenticated;

/** Leituras e preflight pedidos por usuário nunca aceitam ator nulo. */
CREATE OR REPLACE FUNCTION public.asaas_exec_exigir_usuario(_actor uuid,_cap text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
BEGIN
  IF _actor IS NULL OR NOT public.asaas_ator_pode(_actor,_cap) THEN
    RAISE EXCEPTION 'Sem permissão para esta operação de cobrança.';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_exigir_usuario(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

/** Situação sanitizada de uma conta, do ponto de vista do banco. */
CREATE OR REPLACE FUNCTION public.asaas_conta_situacao(_account uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.asaas_accounts WHERE id=_account;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok',false,'situacao','indisponivel','motivo','Conta de cobrança inexistente.'); END IF;
  IF a.state='suspensa' THEN RETURN jsonb_build_object('ok',false,'situacao','conta_suspensa','motivo','Conta de cobrança suspensa.','account_id',a.id); END IF;
  IF a.state='preparada' THEN RETURN jsonb_build_object('ok',false,'situacao','preparada','motivo','Conta preparada, ainda não habilitada para operar.','account_id',a.id); END IF;
  IF a.state='producao_conectada' OR a.environment='producao' THEN
    RETURN jsonb_build_object('ok',false,'situacao','indisponivel','motivo','Produção bloqueada nesta preparação.','account_id',a.id);
  END IF;
  IF NOT a.is_active OR a.config_status NOT IN ('simulacao_isolada','sandbox_configurado') THEN
    RETURN jsonb_build_object('ok',false,'situacao','indisponivel','motivo','Configuração da conta incoerente.','account_id',a.id);
  END IF;
  RETURN jsonb_build_object('ok',true,'account_id',a.id,'state',a.state,'modo',a.modo_execucao,
    'ambiente',a.ambiente_provedor,'secret_ref',a.secret_ref,'external_account_id',a.external_account_id,
    'invoice_host_confirmed',a.invoice_host_confirmed,
    'situacao',CASE WHEN a.state='simulada' THEN 'simulada' ELSE 'sandbox_configurado' END);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_conta_situacao(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.asaas_exec_preflight_parcela(_installment uuid,_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE i record; t record; n integer; a uuid;
BEGIN
  PERFORM public.asaas_exec_exigir_usuario(_actor,'finance.receivable.manage');
  SELECT * INTO i FROM public.financial_installments WHERE id=_installment;
  IF i.id IS NULL THEN RETURN jsonb_build_object('ok',false,'situacao','indisponivel','motivo','Parcela inexistente.'); END IF;
  SELECT * INTO t FROM public.financial_titles WHERE id=i.title_id;
  SELECT count(*) INTO n FROM public.asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default;
  IF n<>1 THEN RETURN jsonb_build_object('ok',false,'situacao','indisponivel','motivo','A empresa do título não possui conta de cobrança definida.'); END IF;
  SELECT id INTO a FROM public.asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default;
  RETURN public.asaas_conta_situacao(a);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_preflight_parcela(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_preflight_parcela(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_exec_preflight_conta(_account uuid,_actor uuid,_cap text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
BEGIN
  IF _cap NOT IN ('finance.import.run','finance.receivable.manage','finance.receivable.view') THEN
    RAISE EXCEPTION 'Capacidade inválida.';
  END IF;
  PERFORM public.asaas_exec_exigir_usuario(_actor,_cap);
  RETURN public.asaas_conta_situacao(_account);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_preflight_conta(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_preflight_conta(uuid,uuid,text) TO service_role;

/** Lista de contas para a resolução no servidor (sem segredo, só referência). */
CREATE OR REPLACE FUNCTION public.asaas_exec_contas(_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
BEGIN
  PERFORM public.asaas_exec_exigir_usuario(_actor,'finance.receivable.view');
  RETURN coalesce((SELECT jsonb_agg(public.asaas_conta_situacao(id) || jsonb_build_object('account_id',id,'nome',label)
    ORDER BY label,id) FROM public.asaas_accounts),'[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_contas(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_contas(uuid) TO service_role;

-- ---------- 7. paginação oficial: próximo = offset + limit ----------
CREATE OR REPLACE FUNCTION public.asaas_import_pagina(_run uuid,_offset integer,_limit integer,
 _raw_count integer,_next_offset integer,_itens jsonb,_has_more boolean,_clientes jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE r record;e jsonb;novos integer:=0;repetidos integer:=0;n integer;h text;esperado integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'finance.import.run') THEN RAISE EXCEPTION 'Sem permissão para importar recebíveis.'; END IF;
 IF _offset<0 OR _limit<1 OR _limit>100 OR _raw_count<0 OR _raw_count>_limit OR _has_more IS NULL THEN
   RAISE EXCEPTION 'Metadados de página incompatíveis.';
 END IF;
 -- Documentação do provedor: com hasMore=true, próximo offset = offset + limit
 -- solicitado. Independe da quantidade recebida e da mantida após filtro local.
 esperado := CASE WHEN _has_more THEN _offset+_limit ELSE _offset+_raw_count END;
 IF _next_offset<>esperado THEN
   RAISE EXCEPTION 'Avanço de cursor incompatível: esperado %, recebido %.',esperado,_next_offset;
 END IF;
 IF jsonb_array_length(coalesce(_itens,'[]'::jsonb))>_raw_count THEN
   RAISE EXCEPTION 'Mais itens mantidos que recebidos.';
 END IF;
 SELECT * INTO r FROM public.asaas_import_runs WHERE id=_run FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
 h:=encode(digest(concat_ws('|',_offset,_limit,_raw_count,_next_offset,_has_more,coalesce(_itens,'[]'::jsonb)::text),'sha256'),'hex');
 IF _offset<>r.offset_atual THEN
   IF EXISTS(SELECT 1 FROM public.asaas_import_pages WHERE run_id=_run AND requested_offset=_offset
      AND requested_limit=_limit AND raw_count=_raw_count AND next_offset=_next_offset AND page_hash=h) THEN
     RETURN jsonb_build_object('run_id',_run,'novos',0,'repetidos',jsonb_array_length(coalesce(_itens,'[]'::jsonb)),
       'offset',r.offset_atual,'has_more',r.has_more,'pagina_repetida',true);
   END IF;
   RAISE EXCEPTION 'Página fora de ordem: esperado %, recebido %.',r.offset_atual,_offset;
 END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(coalesce(_clientes,'[]'::jsonb)) LOOP
  INSERT INTO public.asaas_import_stage(run_id,account_id,tipo,external_id,payload)
  VALUES(_run,r.account_id,'cliente',e->>'id',e) ON CONFLICT(run_id,tipo,external_id) DO NOTHING;
 END LOOP;
 FOR e IN SELECT * FROM jsonb_array_elements(coalesce(_itens,'[]'::jsonb)) LOOP
  IF coalesce(e->>'id','')='' THEN RAISE EXCEPTION 'Cobrança sem identificador externo.'; END IF;
  INSERT INTO public.asaas_import_stage(run_id,account_id,tipo,external_id,payload)
  VALUES(_run,r.account_id,'cobranca',e->>'id',e) ON CONFLICT(run_id,tipo,external_id) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; IF n=1 THEN novos:=novos+1; ELSE repetidos:=repetidos+1; END IF;
 END LOOP;
 PERFORM set_config('lardann.asaas_import','on',true);
 INSERT INTO public.asaas_import_pages(run_id,requested_offset,requested_limit,raw_count,next_offset,kept_count,has_more,page_hash)
 VALUES(_run,_offset,_limit,_raw_count,_next_offset,jsonb_array_length(coalesce(_itens,'[]'::jsonb)),_has_more,h);
 UPDATE public.asaas_import_runs SET offset_atual=_next_offset,has_more=_has_more,page=page+1,
  status=CASE WHEN _has_more THEN 'em_andamento' ELSE 'pausada' END,
  last_page_offset=_offset,last_page_next_offset=_next_offset,last_page_raw_count=_raw_count,last_page_hash=h WHERE id=_run;
 PERFORM set_config('lardann.asaas_import','off',true);
 RETURN jsonb_build_object('run_id',_run,'novos',novos,'repetidos',repetidos,'offset',_next_offset,
  'has_more',_has_more,'quantidade_bruta',_raw_count,'quantidade_mantida',jsonb_array_length(coalesce(_itens,'[]'::jsonb)));
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_import_pagina(uuid,integer,integer,integer,integer,jsonb,boolean,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.asaas_import_pagina(uuid,integer,integer,integer,integer,jsonb,boolean,jsonb) TO authenticated;

-- ---------- 8. fila do painel mostra espera e pendência de credencial ----------
CREATE OR REPLACE FUNCTION public.asaas_receber_fila(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE lim integer := least(greatest(coalesce((_filtros->>'limite')::int,25),1),100);
        aid uuid := nullif(_filtros->>'account_id','')::uuid;
        ct timestamptz := nullif(_filtros#>>'{cursor,t}','')::timestamptz;
        cid uuid := nullif(_filtros#>>'{cursor,id}','')::uuid;
        itens jsonb; prox jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  WITH pagina AS (
    SELECT ci.* FROM public.asaas_charge_intents ci
     WHERE ci.state IN ('desconhecida','rejeitada','conciliacao','processando','aguardando_retentativa')
       AND (aid IS NULL OR ci.account_id=aid)
       AND (ct IS NULL OR (ci.created_at, ci.id) < (ct, cid))
     ORDER BY ci.created_at DESC, ci.id DESC LIMIT lim + 1)
  SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'state', p.state, 'erro', p.last_error,
            'fase', p.rejeicao_fase, 'attempts', p.attempts, 'installment_id', p.installment_id,
            'external_id', p.external_id, 'lease_until', p.lease_until, 'criada_em', p.created_at,
            'failure_class', p.failure_class, 'next_attempt_at', p.next_attempt_at,
            'pendencia_operacional', p.state='aguardando_retentativa' AND p.failure_class='credencial')
            ORDER BY p.created_at DESC, p.id DESC)
           FROM (SELECT * FROM pagina ORDER BY created_at DESC, id DESC LIMIT lim) p), '[]'::jsonb),
         (SELECT jsonb_build_object('t', q.created_at, 'id', q.id)
            FROM (SELECT * FROM pagina ORDER BY created_at DESC, id DESC OFFSET lim - 1 LIMIT 1) q
           WHERE (SELECT count(*) FROM pagina) > lim)
    INTO itens, prox;
  RETURN jsonb_build_object('itens', itens, 'proximo', prox, 'limite', lim);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_receber_fila(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_receber_fila(jsonb) TO authenticated;

-- a tela não lê mais o estado da conta direto do banco: a resolução é do servidor
REVOKE ALL ON FUNCTION public.asaas_receber_contas() FROM authenticated;

-- a preparação reconhece a espera como intenção viva (sem abrir outra)
CREATE OR REPLACE FUNCTION public.asaas_cobranca_preparar(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE conta record;i record;t record;cliente record;existente record;viva record;
 v_saldo bigint;v_hash text;v_ref text;v_key text;v_venc date;v_forma text;v_id uuid;v_party uuid;n integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão para preparar cobrança.'; END IF;
 SELECT * INTO i FROM public.financial_installments WHERE id=(_payload->>'installment_id')::uuid FOR UPDATE;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Parcela inexistente.'; END IF;
 SELECT * INTO t FROM public.financial_titles WHERE id=i.title_id;
 IF t.direction<>'receivable' OR t.status<>'ativo' OR t.approval_status='pendente' THEN RAISE EXCEPTION 'Título não está apto à cobrança.'; END IF;
 v_saldo:=public.fin_installment_saldo(i.id); IF coalesce(v_saldo,0)<=0 THEN RAISE EXCEPTION 'Parcela sem saldo devido.'; END IF;
 SELECT count(*) INTO n FROM public.asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default AND state IN('simulada','sandbox_conectada') AND is_active;
 IF n<>1 THEN RAISE EXCEPTION 'A empresa do título deve possuir exatamente uma conta Asaas executável.'; END IF;
 SELECT * INTO conta FROM public.asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default AND state IN('simulada','sandbox_conectada') AND is_active;
 v_party:=coalesce(t.pagador_party_id,t.party_id);
 SELECT count(*) INTO n FROM public.asaas_customers WHERE account_id=conta.id AND party_id=v_party AND match_status='vinculado';
 IF n>1 THEN RAISE EXCEPTION 'Mais de um cliente Asaas vinculado: defina o canônico antes de cobrar.'; END IF;
 SELECT * INTO cliente FROM public.asaas_customers WHERE account_id=conta.id AND party_id=v_party AND match_status='vinculado';
 IF cliente.id IS NULL AND coalesce((_payload->>'criar_cliente')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'Devedor sem cliente externo vinculado.'; END IF;
 SELECT * INTO existente FROM public.asaas_charges WHERE installment_id=i.id AND account_id=conta.id
  AND coalesce(external_status,'') NOT IN('DELETED','REFUNDED','CANCELED') LIMIT 1;
 IF existente.id IS NOT NULL THEN RETURN jsonb_build_object('reaproveitada',true,'charge_id',existente.id,'account_id',conta.id,
  'external_id',existente.external_id,'invoice_url',existente.invoice_url,'aviso','Cobrança ativa reaproveitada.'); END IF;
 v_venc:=coalesce(nullif(_payload->>'due_date','')::date,i.vencimento);IF v_venc<current_date THEN v_venc:=current_date;END IF;
 v_forma:=coalesce(nullif(_payload->>'billing_type',''),'UNDEFINED');v_ref:='lardan:installment:'||i.id;
 v_key:=coalesce(nullif(_payload->>'idempotency_key',''),v_ref||':'||v_saldo||':'||v_venc||':'||(SELECT count(*) FROM public.asaas_charge_intents x WHERE x.installment_id=i.id AND x.state IN('rejeitada','cancelada')));
 PERFORM pg_advisory_xact_lock(hashtextextended(v_key,0));
 v_hash:=public.fin_fingerprint(jsonb_build_object('account',conta.id,'installment',i.id,'party',v_party,'valor_cents',v_saldo,'due_date',v_venc,'billing_type',v_forma));
 SELECT * INTO existente FROM public.asaas_charge_intents WHERE idempotency_key=v_key;
 IF existente.id IS NOT NULL THEN
  IF existente.content_hash<>v_hash THEN RAISE EXCEPTION 'Colisão de chave: esta chave já foi usada com outro conteúdo.' USING errcode='23505';END IF;
  RETURN jsonb_build_object('id',existente.id,'account_id',existente.account_id,'repetida',true,'state',existente.state,'invoice_url',existente.invoice_url,'external_id',existente.external_id,'internal_reference',existente.internal_reference);
 END IF;
 SELECT * INTO viva FROM public.asaas_charge_intents WHERE installment_id=i.id AND state IN('preparada','processando','aguardando_retentativa','criada','desconhecida','conciliacao') LIMIT 1;
 IF viva.id IS NOT NULL THEN RETURN jsonb_build_object('id',viva.id,'account_id',viva.account_id,'repetida',true,'state',viva.state,'invoice_url',viva.invoice_url,'external_id',viva.external_id,'internal_reference',viva.internal_reference);END IF;
 PERFORM set_config('lardann.asaas_intent','on',true);
 INSERT INTO public.asaas_charge_intents(account_id,title_id,installment_id,party_id,customer_external_id,criar_cliente,value_cents,due_date,billing_type,internal_reference,idempotency_key,content_hash,simulado,created_by)
 VALUES(conta.id,t.id,i.id,v_party,cliente.external_id,cliente.id IS NULL,v_saldo,v_venc,v_forma,v_ref||':'||left(md5(v_key),8),v_key,v_hash,conta.modo_execucao='simulado',auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.asaas_charge_intent_events(intent_id,de,para,detalhe,actor_id) VALUES(v_id,NULL,'preparada',jsonb_build_object('valor_cents',v_saldo),auth.uid());
 PERFORM set_config('lardann.asaas_intent','off',true);
 RETURN jsonb_build_object('id',v_id,'account_id',conta.id,'state','preparada','internal_reference',v_ref||':'||left(md5(v_key),8));
END $fn$;

-- ---------- 9. usuário sem pessoa vinculada também é recusado nas rotinas do navegador ----------
-- Todas as rotinas asaas_* chamadas pelo navegador passam a exigir o mesmo
-- critério do executor (ativo + papel + pessoa vinculada). A troca é feita
-- sobre a definição vigente de cada rotina, dentro desta mesma transação.
DO $$
DECLARE f record; def text; novo text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
            WHERE ns.nspname='public' AND p.proname LIKE 'asaas\_%' AND p.proname NOT LIKE 'asaas\_exec\_%'
  LOOP
    def := pg_get_functiondef(f.oid);
    IF position('public.has_capability(auth.uid()' IN def) > 0 THEN
      novo := replace(def, 'public.has_capability(auth.uid()', 'public.asaas_ator_pode(auth.uid()');
      EXECUTE novo;
    END IF;
  END LOOP;
END $$;
