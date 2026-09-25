
-- ============================================================
-- 07 — Asaas: executor interno, posse temporária, links e paginação
--
-- PENDENTE. Não aplicar ao banco compartilhado antes da validação isolada.
--
-- Corrige o que a auditoria do pacote 15 apontou:
--  * resultado de cobrança e entrada de eventos deixam de aceitar chamada do
--    navegador (authenticated). Só o executor interno do servidor (service_role)
--    grava o que o provedor devolveu, e sempre com conta, intenção, tentativa e
--    trabalhador conferidos;
--  * 'conciliacao' continua bloqueando nova intenção na mesma parcela;
--  * posse temporária (lease) com expiração e recuperação auditada: processo
--    interrompido não deixa a parcela presa e não autoriza reenvio sem consulta;
--  * rejeição ANTES da criação externa é diferente de resultado desconhecido;
--  * cliente externo criado é persistido na hora;
--  * endereço da fatura guardado no espelho e validado no servidor por modo e
--    ambiente; cobranças importadas também passam a ter link;
--  * modo de execução (simulado/conectado) separado do ambiente do provedor
--    (sandbox/produção);
--  * painel paginado por cursor estável, com busca por pessoa, título e situação.
--
-- Nada aqui chama rede, cria baixa, liquidação, obrigação nova ou documento fiscal.
-- ============================================================

-- ---------------- modo de execução x ambiente do provedor ----------------
ALTER TABLE public.asaas_accounts
  ADD COLUMN IF NOT EXISTS modo_execucao text NOT NULL DEFAULT 'simulado',
  ADD COLUMN IF NOT EXISTS ambiente_provedor text;

UPDATE public.asaas_accounts
   SET modo_execucao = CASE WHEN state IN ('sandbox_conectada','producao_conectada') THEN 'conectado' ELSE 'simulado' END,
       ambiente_provedor = CASE WHEN state IN ('sandbox_conectada','producao_conectada') THEN environment ELSE NULL END
 WHERE modo_execucao IS DISTINCT FROM CASE WHEN state IN ('sandbox_conectada','producao_conectada') THEN 'conectado' ELSE 'simulado' END;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_accounts_modo_ck') THEN
    ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_modo_ck CHECK (
      (modo_execucao = 'simulado' AND ambiente_provedor IS NULL)
      -- IS NOT NULL explícito: CHECK com resultado NULL passaria
      OR (modo_execucao = 'conectado' AND ambiente_provedor IS NOT NULL
          AND ambiente_provedor IN ('sandbox','producao')));
  END IF;
END $$;

-- ---------------- link da fatura no espelho ----------------
ALTER TABLE public.asaas_charges ADD COLUMN IF NOT EXISTS invoice_url text;
GRANT SELECT (invoice_url) ON public.asaas_charges TO authenticated;

ALTER TABLE public.asaas_charge_intents
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS rejeicao_fase text,
  ADD COLUMN IF NOT EXISTS recuperacoes integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_charge_intents_fase_ck') THEN
    ALTER TABLE public.asaas_charge_intents ADD CONSTRAINT asaas_charge_intents_fase_ck CHECK (
      rejeicao_fase IS NULL OR rejeicao_fase IN
        ('antes_do_provedor','cliente','provedor_recusou','sem_registro_apos_consulta'));
  END IF;
END $$;

-- conciliação continua viva: bloqueia outra intenção na mesma parcela
DROP INDEX IF EXISTS public.asaas_charge_intents_viva_uidx;
CREATE UNIQUE INDEX asaas_charge_intents_viva_uidx
  ON public.asaas_charge_intents (installment_id)
  WHERE state IN ('preparada','processando','criada','desconhecida','conciliacao');

/**
 * Formato aceito para o endereço da fatura, decidido no SERVIDOR pela conta.
 *  simulado: somente a página local de demonstração do próprio identificador;
 *  sandbox / produção: host oficial do ambiente, caminho /i/<código>.
 * Qualquer outra coisa é recusada — o navegador não informa endereço.
 */
CREATE OR REPLACE FUNCTION public.asaas_fatura_url_valida(_account uuid, _external_id text, _url text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce((
    SELECT CASE
      WHEN _url IS NULL OR _external_id IS NULL THEN false
      WHEN a.modo_execucao = 'simulado' THEN
        _external_id ~ '^sim_[A-Za-z0-9_-]{1,160}$' AND _url = '/financeiro/simulacao/' || _external_id
      WHEN a.ambiente_provedor = 'sandbox' THEN
        _url ~ '^https://sandbox\.asaas\.com/i/[A-Za-z0-9]{6,64}$'
      WHEN a.ambiente_provedor = 'producao' THEN
        _url ~ '^https://www\.asaas\.com/i/[A-Za-z0-9]{6,64}$'
      ELSE false END
      FROM public.asaas_accounts a WHERE a.id = _account), false)
$fn$;
REVOKE ALL ON FUNCTION public.asaas_fatura_url_valida(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_fatura_url_valida(uuid,text,text) TO service_role;

/** Identificador externo coerente com o modo da conta. */
CREATE OR REPLACE FUNCTION public.asaas_external_id_valido(_account uuid, _external_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce((
    SELECT CASE
      WHEN _external_id IS NULL THEN false
      WHEN a.modo_execucao = 'simulado' THEN _external_id ~ '^sim_[A-Za-z0-9_-]{1,160}$'
      ELSE _external_id ~ '^pay_[A-Za-z0-9]{4,64}$' END
      FROM public.asaas_accounts a WHERE a.id = _account), false)
$fn$;
REVOKE ALL ON FUNCTION public.asaas_external_id_valido(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_external_id_valido(uuid,text) TO service_role;

/**
 * Guarda do link no espelho: na entrada vinda da importação, aproveita o
 * endereço do payload somente se válido; qualquer troca posterior exige rotina
 * oficial e endereço válido para a conta.
 */
CREATE OR REPLACE FUNCTION public.asaas_charge_link_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE candidato text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.invoice_url IS NULL THEN
    candidato := NEW.raw->>'invoiceUrl';
    IF candidato IS NOT NULL AND public.asaas_fatura_url_valida(NEW.account_id, NEW.external_id, candidato) THEN
      NEW.invoice_url := candidato;
    END IF;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.invoice_url IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.invoice_url IS DISTINCT FROM OLD.invoice_url) THEN
    IF TG_OP = 'UPDATE' AND coalesce(current_setting('lardann.asaas_link', true),'off') <> 'on' THEN
      RAISE EXCEPTION 'Endereço da fatura só muda pela rotina oficial.';
    END IF;
    IF NEW.invoice_url IS NOT NULL
       AND NOT public.asaas_fatura_url_valida(NEW.account_id, NEW.external_id, NEW.invoice_url) THEN
      RAISE EXCEPTION 'Endereço de fatura inválido para o modo e o ambiente desta conta.';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS asaas_charge_link_guard ON public.asaas_charges;
CREATE TRIGGER asaas_charge_link_guard BEFORE INSERT OR UPDATE ON public.asaas_charges
  FOR EACH ROW EXECUTE FUNCTION public.asaas_charge_link_guard();

-- espelhos existentes: recupera o link do payload quando válido
DO $$
BEGIN
  PERFORM set_config('lardann.asaas_link','on', true);
  UPDATE public.asaas_charges c SET invoice_url = c.raw->>'invoiceUrl'
   WHERE c.invoice_url IS NULL AND c.raw ? 'invoiceUrl'
     AND public.asaas_fatura_url_valida(c.account_id, c.external_id, c.raw->>'invoiceUrl');
  UPDATE public.asaas_charges c SET invoice_url = ci.invoice_url
    FROM public.asaas_charge_intents ci
   WHERE ci.charge_id = c.id AND c.invoice_url IS NULL AND ci.invoice_url IS NOT NULL
     AND public.asaas_fatura_url_valida(c.account_id, c.external_id, ci.invoice_url);
  PERFORM set_config('lardann.asaas_link','off', true);
END $$;

-- ---------------- guarda de transição da intenção ----------------
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
      OR (OLD.state = 'processando'  AND NEW.state IN ('criada','rejeitada','desconhecida','conciliacao'))
      OR (OLD.state = 'desconhecida' AND NEW.state IN ('criada','rejeitada','conciliacao'))
      OR (OLD.state = 'conciliacao'  AND NEW.state IN ('cancelada'))) THEN
      RAISE EXCEPTION 'Transição de intenção inválida: % → %.', OLD.state, NEW.state;
    END IF;
    IF NEW.state = 'rejeitada' AND OLD.state = 'desconhecida'
       AND NEW.rejeicao_fase IS DISTINCT FROM 'sem_registro_apos_consulta' THEN
      RAISE EXCEPTION 'Resultado desconhecido só é encerrado depois de consultar o provedor.';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $fn$;

-- ---------------- ator do executor ----------------
/**
 * Capacidade do usuário em nome de quem o executor age. Não depende de
 * auth.uid(): o executor roda com o papel interno do servidor. Nunca exposta.
 */
CREATE OR REPLACE FUNCTION public.asaas_ator_pode(_actor uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT _actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
      JOIN public.role_capabilities rc ON rc.role = ur.role
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.user_id = _actor AND rc.capability = _cap AND p.is_active)
$fn$;
REVOKE ALL ON FUNCTION public.asaas_ator_pode(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_ator_pode(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_exec_exigir(_actor uuid, _cap text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  -- ator nulo = rotina agendada do próprio servidor (registrado como "sistema")
  IF _actor IS NOT NULL AND NOT public.asaas_ator_pode(_actor, _cap) THEN
    RAISE EXCEPTION 'Sem permissão para esta operação de cobrança.';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_exigir(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_exigir(uuid,text) TO service_role;

/** Vínculo interno cobrança → parcela, com o ator do executor. Só por rotinas internas. */
CREATE OR REPLACE FUNCTION public.asaas_vincular_interno(_charge uuid, _title uuid, _installment uuid, _motivo text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança inexistente.'; END IF;
  IF c.title_id IS NOT NULL THEN
    IF c.title_id = _title AND c.installment_id IS NOT DISTINCT FROM _installment THEN RETURN; END IF;
    RAISE EXCEPTION 'Esta cobrança já aponta para outro título ou parcela: conciliar.';
  END IF;
  PERFORM set_config('lardann.asaas_link','on', true);
  UPDATE public.asaas_charges
     SET title_id = _title, installment_id = _installment, reconcile_status = 'vinculado',
         reconcile_note = _motivo, linked_by = _actor, linked_at = now()
   WHERE id = _charge;
  PERFORM set_config('lardann.asaas_link','off', true);
  INSERT INTO public.asaas_charge_changes (charge_id, campo, de, para, origem, actor_user_id)
  VALUES (_charge, 'title_id', NULL, _title::text, 'executor_interno', _actor),
         (_charge, 'installment_id', NULL, _installment::text, 'executor_interno', _actor);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_actor, 'asaas.charge.vincular_interno', 'asaas_charges', _charge,
          jsonb_build_object('title_id', _title, 'installment_id', _installment, 'motivo', _motivo));
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_vincular_interno(uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------- o navegador não grava resultado nem evento ----------------
DROP FUNCTION IF EXISTS public.asaas_cobranca_resultado(uuid,jsonb);
DROP FUNCTION IF EXISTS public.asaas_cobranca_processando(uuid,text);

/**
 * Reserva a intenção para UM trabalhador, com posse temporária.
 *  preparada               → processando (modo 'criar')
 *  processando expirada    → desconhecida auditada, depois posse de CONSULTA
 *  desconhecida sem posse  → posse de CONSULTA (nunca reenvio direto)
 * Qualquer outro caso: não reservada, devolve o estado atual.
 */
CREATE OR REPLACE FUNCTION public.asaas_exec_reservar(
  _intent uuid, _worker text, _actor uuid, _lease_segundos integer DEFAULT 120
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE it record; conta record; pa record; modo text; lease integer;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor, 'finance.receivable.manage');
  IF coalesce(btrim(_worker),'') = '' THEN RAISE EXCEPTION 'Trabalhador obrigatório.'; END IF;
  lease := least(greatest(coalesce(_lease_segundos,120),1),900);
  SELECT * INTO it FROM public.asaas_charge_intents WHERE id = _intent FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Intenção inexistente.'; END IF;
  SELECT * INTO conta FROM public.asaas_accounts WHERE id = it.account_id;

  PERFORM set_config('lardann.asaas_intent','on', true);
  IF it.state = 'preparada' THEN
    UPDATE public.asaas_charge_intents
       SET state='processando', worker=_worker, processing_at=now(), attempts = attempts + 1,
           lease_until = now() + make_interval(secs => lease)
     WHERE id = _intent RETURNING * INTO it;
    INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
    VALUES (_intent, 'preparada', 'processando',
            jsonb_build_object('worker', _worker, 'tentativa', it.attempts, 'lease_s', lease), _actor);
    modo := 'criar';
  ELSIF it.state = 'processando' AND it.lease_until IS NOT NULL AND it.lease_until < now() THEN
    UPDATE public.asaas_charge_intents
       SET state='desconhecida', recuperacoes = recuperacoes + 1,
           last_error = 'Execução interrompida: posse expirou sem resultado. Consultar o provedor antes de qualquer reenvio.',
           worker=_worker, attempts = attempts + 1, lease_until = now() + make_interval(secs => lease)
     WHERE id = _intent RETURNING * INTO it;
    INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
    VALUES (_intent, 'processando', 'desconhecida',
            jsonb_build_object('motivo','posse_expirada','worker', _worker, 'tentativa', it.attempts), _actor);
    modo := 'consultar';
  ELSIF it.state = 'desconhecida' AND (it.lease_until IS NULL OR it.lease_until < now()) THEN
    UPDATE public.asaas_charge_intents
       SET worker=_worker, attempts = attempts + 1, lease_until = now() + make_interval(secs => lease)
     WHERE id = _intent RETURNING * INTO it;
    INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
    VALUES (_intent, 'desconhecida', 'desconhecida',
            jsonb_build_object('motivo','consulta','worker', _worker, 'tentativa', it.attempts), _actor);
    modo := 'consultar';
  END IF;
  PERFORM set_config('lardann.asaas_intent','off', true);

  IF modo IS NULL THEN
    RETURN jsonb_build_object('id', it.id, 'reservada', false, 'state', it.state,
      'external_id', it.external_id, 'charge_id', it.charge_id,
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
REVOKE ALL ON FUNCTION public.asaas_exec_reservar(uuid,text,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_reservar(uuid,text,uuid,integer) TO service_role;

/** Confere que quem grava ainda é o dono da posse e da tentativa. */
CREATE OR REPLACE FUNCTION public.asaas_exec_posse(_intent uuid, _worker text, _tentativa integer)
RETURNS public.asaas_charge_intents LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE it public.asaas_charge_intents;
BEGIN
  SELECT * INTO it FROM public.asaas_charge_intents WHERE id = _intent FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Intenção inexistente.'; END IF;
  IF it.state NOT IN ('processando','desconhecida') THEN
    RAISE EXCEPTION 'Intenção não está em execução (estado %).', it.state USING errcode = 'P0002';
  END IF;
  IF it.worker IS DISTINCT FROM _worker OR it.attempts IS DISTINCT FROM _tentativa THEN
    RAISE EXCEPTION 'Posse perdida: outro trabalhador ou outra tentativa assumiu esta intenção.' USING errcode = 'P0003';
  END IF;
  RETURN it;
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_posse(uuid,text,integer) FROM PUBLIC, anon, authenticated, service_role;

/** Cliente externo criado ou localizado: persistido imediatamente. */
CREATE OR REPLACE FUNCTION public.asaas_exec_cliente(
  _intent uuid, _worker text, _tentativa integer, _actor uuid, _external_id text, _nome text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE it public.asaas_charge_intents; cu record;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor, 'finance.receivable.manage');
  it := public.asaas_exec_posse(_intent, _worker, _tentativa);
  IF coalesce(btrim(_external_id),'') = '' THEN RAISE EXCEPTION 'Cliente externo sem identificador.'; END IF;

  SELECT * INTO cu FROM public.asaas_customers WHERE account_id = it.account_id AND external_id = _external_id;
  IF cu.id IS NULL THEN
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
  INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
  VALUES (_intent, it.state, it.state, jsonb_build_object('cliente_externo', _external_id), _actor);
  RETURN jsonb_build_object('customer_id', cu.id, 'external_id', _external_id);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_cliente(uuid,text,integer,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_cliente(uuid,text,integer,uuid,text,text) TO service_role;

/**
 * Resultado do adaptador, gravado SOMENTE pelo executor interno.
 *  criada        — identificador externo obrigatório e coerente com a conta;
 *                  link opcional (pode ser recuperado depois), validado;
 *  rejeitada     — com a fase: antes_do_provedor | cliente | provedor_recusou |
 *                  sem_registro_apos_consulta (esta última só depois de consultar);
 *  desconhecida  — resposta perdida; libera a posse para consulta posterior.
 * Saldo que mudou no meio vira 'conciliacao', preservando ID e vínculo.
 */
CREATE OR REPLACE FUNCTION public.asaas_exec_resultado(
  _intent uuid, _worker text, _tentativa integer, _actor uuid, _payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE it public.asaas_charge_intents; res text; fase text; v_ext text; v_url text;
        v_charge uuid; v_saldo bigint; outro record; de text; aviso_url text;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor, 'finance.receivable.manage');
  IF _payload IS NULL THEN RAISE EXCEPTION 'Resultado vazio.'; END IF;
  res := _payload->>'resultado';
  IF res IS NULL OR res NOT IN ('criada','rejeitada','desconhecida') THEN
    RAISE EXCEPTION 'Resultado inválido.';
  END IF;
  it := public.asaas_exec_posse(_intent, _worker, _tentativa);
  de := it.state;

  PERFORM set_config('lardann.asaas_intent','on', true);

  IF res = 'desconhecida' THEN
    UPDATE public.asaas_charge_intents
       SET state='desconhecida', lease_until = NULL,
           last_error = left(coalesce(_payload->>'erro','Resposta não recebida do provedor.'),500)
     WHERE id=_intent;

  ELSIF res = 'rejeitada' THEN
    fase := _payload->>'fase';
    IF fase IS NULL OR fase NOT IN ('antes_do_provedor','cliente','provedor_recusou','sem_registro_apos_consulta') THEN
      RAISE EXCEPTION 'Rejeição sem fase válida.';
    END IF;
    IF de = 'desconhecida' AND fase <> 'sem_registro_apos_consulta' THEN
      RAISE EXCEPTION 'Resultado desconhecido só é encerrado depois de consultar o provedor.';
    END IF;
    IF de = 'processando' AND fase = 'sem_registro_apos_consulta' THEN
      RAISE EXCEPTION 'Consulta sem registro só vale para resultado desconhecido.';
    END IF;
    UPDATE public.asaas_charge_intents
       SET state='rejeitada', rejeicao_fase = fase, lease_until = NULL, resolved_at = now(),
           last_error = left(coalesce(_payload->>'erro','Rejeitada.'),500)
     WHERE id=_intent;

  ELSE
    v_ext := nullif(btrim(coalesce(_payload->>'external_id','')),'');
    IF NOT public.asaas_external_id_valido(it.account_id, v_ext) THEN
      RAISE EXCEPTION 'Identificador externo ausente ou incompatível com o modo da conta.';
    END IF;
    v_url := nullif(btrim(coalesce(_payload->>'invoice_url','')),'');
    IF v_url IS NOT NULL AND NOT public.asaas_fatura_url_valida(it.account_id, v_ext, v_url) THEN
      -- a cobrança existe; o endereço estranho não é exibido nem guardado
      aviso_url := 'Endereço devolvido não confere com o ambiente da conta; não foi guardado.';
      v_url := NULL;
    END IF;

    SELECT * INTO outro FROM public.asaas_charges
      WHERE account_id = it.account_id AND external_id = v_ext;
    IF outro.id IS NOT NULL AND outro.installment_id IS NOT NULL AND outro.installment_id <> it.installment_id THEN
      UPDATE public.asaas_charge_intents
         SET state='conciliacao', external_id = v_ext, lease_until = NULL,
             last_error = 'O identificador devolvido já está ligado a outra parcela.'
       WHERE id=_intent;
      PERFORM set_config('lardann.asaas_intent','off', true);
      INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
      VALUES (_intent, de, 'conciliacao', jsonb_build_object('external_id', v_ext, 'motivo','id_em_outra_parcela'), _actor);
      RETURN jsonb_build_object('id',_intent,'state','conciliacao','external_id', v_ext,
        'aviso','Identificador já ligado a outra parcela. Encaminhado para conciliação.');
    END IF;

    v_charge := outro.id;
    IF v_charge IS NULL THEN
      PERFORM set_config('lardann.asaas_link','on', true);
      INSERT INTO public.asaas_charges
        (account_id, external_id, customer_external_id, value_cents, due_date, billing_type,
         external_status, party_id, reconcile_status, raw, invoice_url)
      VALUES (it.account_id, v_ext, it.customer_external_id, it.value_cents, it.due_date,
              it.billing_type, coalesce(nullif(_payload->>'status',''),'PENDING'), it.party_id,
              'pendente', '{}'::jsonb, v_url)
      RETURNING id INTO v_charge;
      PERFORM set_config('lardann.asaas_link','off', true);
    ELSIF v_url IS NOT NULL AND outro.invoice_url IS NULL THEN
      PERFORM set_config('lardann.asaas_link','on', true);
      UPDATE public.asaas_charges SET invoice_url = v_url WHERE id = v_charge;
      PERFORM set_config('lardann.asaas_link','off', true);
    END IF;
    PERFORM public.asaas_vincular_interno(v_charge, it.title_id, it.installment_id,
      'Cobrança preparada pela Lardan', _actor);
    v_url := coalesce(v_url, outro.invoice_url);

    v_saldo := public.fin_installment_saldo(it.installment_id);
    IF v_saldo IS DISTINCT FROM it.value_cents THEN
      UPDATE public.asaas_charge_intents
         SET state='conciliacao', external_id = v_ext, invoice_url = v_url, charge_id = v_charge,
             lease_until = NULL,
             last_error='Saldo da parcela mudou durante o processamento.'
       WHERE id=_intent;
      PERFORM set_config('lardann.asaas_intent','off', true);
      INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
      VALUES (_intent, de, 'conciliacao',
              jsonb_build_object('saldo_atual', v_saldo, 'valor_intencao', it.value_cents, 'external_id', v_ext), _actor);
      RETURN jsonb_build_object('id',_intent,'state','conciliacao','invoice_url', v_url,
        'external_id', v_ext, 'charge_id', v_charge,
        'aviso','Cobrança existe no provedor, mas o saldo mudou. Encaminhado para conciliação; nenhuma outra será criada.');
    END IF;

    UPDATE public.asaas_charge_intents
       SET state='criada', external_id = v_ext, invoice_url = v_url, charge_id = v_charge,
           lease_until = NULL, resolved_at = now(), last_error = aviso_url
     WHERE id=_intent;
  END IF;

  PERFORM set_config('lardann.asaas_intent','off', true);
  SELECT * INTO it FROM public.asaas_charge_intents WHERE id=_intent;
  INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
  VALUES (_intent, de, it.state,
          jsonb_build_object('external_id', it.external_id, 'fase', it.rejeicao_fase,
                             'worker', _worker, 'tentativa', _tentativa), _actor);

  RETURN jsonb_build_object('id',_intent,'state',it.state,'invoice_url',it.invoice_url,
    'external_id', it.external_id, 'charge_id', it.charge_id, 'simulado', it.simulado,
    'fase', it.rejeicao_fase, 'erro', it.last_error,
    'aviso','Gerar link não liquida a parcela, não comprova venda e não emite nota fiscal.');
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_resultado(uuid,text,integer,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_resultado(uuid,text,integer,uuid,jsonb) TO service_role;

/** Link obtido do provedor para uma cobrança já espelhada (criada ou importada). */
CREATE OR REPLACE FUNCTION public.asaas_exec_link(_charge uuid, _actor uuid, _url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c record;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor, 'finance.receivable.manage');
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança inexistente.'; END IF;
  IF NOT public.asaas_fatura_url_valida(c.account_id, c.external_id, _url) THEN
    RAISE EXCEPTION 'Endereço de fatura inválido para o modo e o ambiente desta conta.';
  END IF;
  IF c.invoice_url IS NOT DISTINCT FROM _url THEN
    RETURN jsonb_build_object('charge_id', c.id, 'invoice_url', c.invoice_url, 'repetido', true);
  END IF;
  PERFORM set_config('lardann.asaas_link','on', true);
  UPDATE public.asaas_charges SET invoice_url = _url WHERE id = _charge;
  PERFORM set_config('lardann.asaas_link','off', true);
  PERFORM set_config('lardann.asaas_intent','on', true);
  UPDATE public.asaas_charge_intents SET invoice_url = _url
   WHERE charge_id = _charge AND invoice_url IS NULL;
  PERFORM set_config('lardann.asaas_intent','off', true);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_actor, 'asaas.charge.link', 'asaas_charges', _charge, jsonb_build_object('origem','consulta_provedor'));
  RETURN jsonb_build_object('charge_id', c.id, 'invoice_url', _url, 'repetido', false);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_link(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_link(uuid,uuid,text) TO service_role;

/** Dados mínimos para o executor consultar o link de uma cobrança espelhada. */
CREATE OR REPLACE FUNCTION public.asaas_exec_cobranca(_charge uuid, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c record; a record;
BEGIN
  PERFORM public.asaas_exec_exigir(_actor, 'finance.receivable.manage');
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança inexistente.'; END IF;
  SELECT * INTO a FROM public.asaas_accounts WHERE id = c.account_id;
  RETURN jsonb_build_object('charge_id', c.id, 'account_id', c.account_id, 'external_id', c.external_id,
    'invoice_url', c.invoice_url, 'modo_execucao', a.modo_execucao, 'ambiente_provedor', a.ambiente_provedor);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_cobranca(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_cobranca(uuid,uuid) TO service_role;

/**
 * Intenções que precisam de retomada: preparadas que nunca começaram,
 * processando com posse vencida e desconhecidas sem posse ativa.
 */
CREATE OR REPLACE FUNCTION public.asaas_exec_pendentes(
  _account uuid DEFAULT NULL, _preparada_seg integer DEFAULT 60, _limite integer DEFAULT 50
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'state', x.state, 'account_id', x.account_id)
                            ORDER BY x.created_at, x.id), '[]'::jsonb)
    FROM (SELECT id, state, account_id, created_at FROM public.asaas_charge_intents
           WHERE (_account IS NULL OR account_id = _account)
             AND ((state = 'preparada' AND created_at < now() - make_interval(secs => greatest(_preparada_seg,0)))
               OR (state = 'processando' AND lease_until < now())
               OR (state = 'desconhecida' AND (lease_until IS NULL OR lease_until < now())))
           ORDER BY created_at, id
           LIMIT least(greatest(coalesce(_limite,50),1),500)) x
$fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_pendentes(uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_pendentes(uuid,integer,integer) TO service_role;

-- ---------------- eventos: só pelo caminho confiável do servidor ----------------
DROP FUNCTION IF EXISTS public.asaas_evento_registrar(jsonb);

/**
 * Persiste o evento antes de qualquer efeito. Chamado SOMENTE pelo servidor,
 * depois de validar a autenticidade da entrega e identificar a conta.
 *  _origem = 'provedor'  → conta conectada; evento de simulação é recusado;
 *  _origem = 'simulacao' → conta em modo simulado; exige ator com permissão
 *                          de conciliação (demonstração isolada).
 */
CREATE OR REPLACE FUNCTION public.asaas_evento_registrar(_payload jsonb, _origem text, _actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE conta record; v_id uuid; novo boolean := true; tipo record;
BEGIN
  IF _payload IS NULL THEN RAISE EXCEPTION 'Evento vazio.'; END IF;
  SELECT * INTO conta FROM public.asaas_accounts WHERE id = nullif(_payload->>'account_id','')::uuid;
  IF conta.id IS NULL THEN RAISE EXCEPTION 'Evento sem conta identificada.'; END IF;
  IF _origem = 'simulacao' THEN
    IF conta.modo_execucao <> 'simulado' THEN
      RAISE EXCEPTION 'Evento simulado não entra em conta conectada.';
    END IF;
    IF NOT public.asaas_ator_pode(_actor, 'finance.reconcile') THEN
      RAISE EXCEPTION 'Sem permissão para gerar evento de demonstração.';
    END IF;
  ELSIF _origem = 'provedor' THEN
    IF conta.modo_execucao <> 'conectado' THEN
      RAISE EXCEPTION 'Conta sem conexão: evento do provedor recusado.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Origem de evento inválida.';
  END IF;
  IF coalesce(_payload->>'external_id','') = '' THEN RAISE EXCEPTION 'Evento sem identificador.'; END IF;
  IF coalesce(_payload->>'event','') = '' THEN RAISE EXCEPTION 'Evento sem tipo.'; END IF;
  IF length(_payload::text) > 200000 THEN RAISE EXCEPTION 'Mensagem grande demais.'; END IF;

  SELECT * INTO tipo FROM public.asaas_event_types WHERE event = _payload->>'event';

  INSERT INTO public.asaas_events
    (account_id, external_id, event, charge_external_id, event_at, received_at, status,
     classification, payload)
  VALUES (conta.id, _payload->>'external_id', _payload->>'event', _payload->>'charge_external_id',
          coalesce(nullif(_payload->>'event_at','')::timestamptz, now()), now(), 'na_fila',
          CASE WHEN tipo.event IS NULL THEN 'desconhecido' ELSE 'conhecido' END,
          coalesce(_payload->'payload','{}'::jsonb) || jsonb_build_object('_origem', _origem))
  ON CONFLICT (account_id, external_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    novo := false;
    SELECT id INTO v_id FROM public.asaas_events
      WHERE account_id = conta.id AND external_id = _payload->>'external_id';
  END IF;
  RETURN jsonb_build_object('id', v_id, 'novo', novo, 'conhecido', tipo.event IS NOT NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_evento_registrar(jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_evento_registrar(jsonb,text,uuid) TO service_role;

-- ---------------- painel paginado ----------------
DROP FUNCTION IF EXISTS public.asaas_receber_painel(jsonb);

/**
 * Parcelas a receber com a cobrança ao lado. Paginação por cursor estável
 * (vencimento, id): nada some nem repete entre páginas.
 * Filtros: busca (pessoa, número ou descrição do título), situacao
 * (sem_cobranca | com_link | pendente_link | em_processamento | conciliacao |
 * desconhecida | rejeitada), limite (1–100) e cursor {v, id}.
 */
CREATE OR REPLACE FUNCTION public.asaas_receber_parcelas(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE lim integer := least(greatest(coalesce((_filtros->>'limite')::int,25),1),100);
        busca text := nullif(btrim(coalesce(_filtros->>'busca','')),'');
        sit text := nullif(_filtros->>'situacao','');
        aid uuid := nullif(_filtros->>'account_id','')::uuid;
        cv date := nullif(_filtros#>>'{cursor,v}','')::date;
        cid uuid := nullif(_filtros#>>'{cursor,id}','')::uuid;
        itens jsonb; prox jsonb; total bigint;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  IF sit IS NOT NULL AND sit NOT IN ('sem_cobranca','com_link','pendente_link','em_processamento',
                                     'conciliacao','desconhecida','rejeitada') THEN
    RAISE EXCEPTION 'Situação de filtro inválida.';
  END IF;

  WITH base AS (
    SELECT i.id, i.vencimento, i.valor_cents, i.settlement_status, t.id AS title_id, t.numero,
           t.descricao, pa.display_name AS pessoa,
            coalesce(ch.account_id,ci.account_id) AS account_id,
            ch.id AS ch_id, ch.external_id AS ch_ext, ch.external_status AS ch_status,
           ch.billing_type AS ch_forma, ch.invoice_url AS ch_url,
           ci.id AS ci_id, ci.state AS ci_state, ci.simulado AS ci_sim, ci.last_error AS ci_erro,
           ci.rejeicao_fase AS ci_fase
      FROM public.financial_installments i
      JOIN public.financial_titles t ON t.id = i.title_id
      LEFT JOIN public.parties pa ON pa.id = coalesce(t.pagador_party_id, t.party_id)
      LEFT JOIN LATERAL (SELECT * FROM public.asaas_charges c WHERE c.installment_id = i.id
                          ORDER BY c.imported_at DESC, c.id LIMIT 1) ch ON true
      LEFT JOIN LATERAL (SELECT * FROM public.asaas_charge_intents x WHERE x.installment_id = i.id
                          ORDER BY x.created_at DESC, x.id LIMIT 1) ci ON true
     WHERE t.direction = 'receivable' AND t.status <> 'cancelado'
       AND (aid IS NULL OR ch.account_id = aid OR ci.account_id = aid OR
            (ch.id IS NULL AND ci.id IS NULL AND EXISTS (
              SELECT 1 FROM public.asaas_accounts aa
               WHERE aa.id=aid AND aa.owner_entity_id=t.business_entity_id AND aa.billing_default)))
       AND (busca IS NULL OR pa.display_name ILIKE '%' || busca || '%'
            OR t.numero::text ILIKE '%' || busca || '%' OR t.descricao ILIKE '%' || busca || '%')
       AND (sit IS NULL
            OR (sit = 'sem_cobranca' AND ch.id IS NULL AND ci.id IS NULL)
            OR (sit = 'com_link' AND ch.invoice_url IS NOT NULL)
            OR (sit = 'pendente_link' AND ch.id IS NOT NULL AND ch.invoice_url IS NULL)
            OR (sit = 'em_processamento' AND ci.state IN ('preparada','processando'))
            OR (sit = 'conciliacao' AND ci.state = 'conciliacao')
            OR (sit = 'desconhecida' AND ci.state = 'desconhecida')
            OR (sit = 'rejeitada' AND ci.state = 'rejeitada'))
  ), pagina AS (
    SELECT * FROM base
     WHERE cv IS NULL OR (vencimento, id) > (cv, cid)
     ORDER BY vencimento, id
     LIMIT lim + 1
  )
  SELECT (SELECT count(*) FROM base),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
             'installment_id', p.id, 'account_id',p.account_id,'title_id', p.title_id, 'numero', p.numero,
            'descricao', p.descricao, 'pessoa', p.pessoa, 'vencimento', p.vencimento,
            'valor_cents', p.valor_cents, 'saldo_cents', public.fin_installment_saldo(p.id),
            'settlement_status', p.settlement_status,
            'cobranca', CASE WHEN p.ch_id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', p.ch_id, 'external_id', p.ch_ext, 'status', p.ch_status,
               'billing_type', p.ch_forma, 'invoice_url', p.ch_url) END,
            'intencao', CASE WHEN p.ci_id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', p.ci_id, 'state', p.ci_state, 'simulado', p.ci_sim, 'erro', p.ci_erro,
               'fase', p.ci_fase) END)
            ORDER BY p.vencimento, p.id)
           FROM (SELECT * FROM pagina ORDER BY vencimento, id LIMIT lim) p), '[]'::jsonb),
         (SELECT jsonb_build_object('v', q.vencimento, 'id', q.id)
            FROM (SELECT * FROM pagina ORDER BY vencimento, id OFFSET lim - 1 LIMIT 1) q
           WHERE (SELECT count(*) FROM pagina) > lim)
    INTO total, itens, prox;

  RETURN jsonb_build_object('itens', itens, 'proximo', prox, 'total', total, 'limite', lim);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_receber_parcelas(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_receber_parcelas(jsonb) TO authenticated;

/** Fila de intenções problemáticas, paginada por (created_at, id). */
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
     WHERE ci.state IN ('desconhecida','rejeitada','conciliacao','processando')
       AND (aid IS NULL OR ci.account_id=aid)
       AND (ct IS NULL OR (ci.created_at, ci.id) < (ct, cid))
     ORDER BY ci.created_at DESC, ci.id DESC LIMIT lim + 1)
  SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'state', p.state, 'erro', p.last_error,
            'fase', p.rejeicao_fase, 'attempts', p.attempts, 'installment_id', p.installment_id,
            'external_id', p.external_id, 'lease_until', p.lease_until, 'criada_em', p.created_at)
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

/** Ocorrências pendentes de revisão, paginadas por (event_at, id). */
CREATE OR REPLACE FUNCTION public.asaas_receber_ocorrencias(_filtros jsonb DEFAULT '{}'::jsonb)
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
    SELECT ev.* FROM public.asaas_events ev
     WHERE ev.status = 'na_fila' AND (aid IS NULL OR ev.account_id=aid)
       AND (ct IS NULL OR (ev.event_at, ev.id) < (ct, cid))
     ORDER BY ev.event_at DESC, ev.id DESC LIMIT lim + 1)
  SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'event', p.event, 'status', p.status,
            'classificacao', p.classification, 'cobranca', p.charge_external_id,
            'quando', p.event_at, 'nota', p.last_error) ORDER BY p.event_at DESC, p.id DESC)
           FROM (SELECT * FROM pagina ORDER BY event_at DESC, id DESC LIMIT lim) p), '[]'::jsonb),
         (SELECT jsonb_build_object('t', q.event_at, 'id', q.id)
            FROM (SELECT * FROM pagina ORDER BY event_at DESC, id DESC OFFSET lim - 1 LIMIT 1) q
           WHERE (SELECT count(*) FROM pagina) > lim)
    INTO itens, prox;
  RETURN jsonb_build_object('itens', itens, 'proximo', prox, 'limite', lim);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_receber_ocorrencias(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_receber_ocorrencias(jsonb) TO authenticated;

/** Contas Asaas para a tela: modo e ambiente separados. */
CREATE OR REPLACE FUNCTION public.asaas_receber_contas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.label,
      'modo', a.modo_execucao, 'ambiente', a.ambiente_provedor, 'estado', a.state,
      'conectada', a.is_active, 'empresa', a.owner_entity_id) ORDER BY a.label, a.id)
    FROM public.asaas_accounts a), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_receber_contas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_receber_contas() TO authenticated;
