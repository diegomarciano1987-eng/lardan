-- 0299 — Baixa no Lardan espelhada no Asaas.
-- Quando uma parcela ligada a cobrança aberta no Asaas recebe baixa (manual, OFX, outra conta, desconto) ou o título
-- é cancelado, a cobrança antiga é cancelada no Asaas e, havendo saldo, nasce uma nova pelo saldo exato.
-- Nada aqui grava dinheiro: só cancela/cria cobranças pelo executor oficial. Acordos nunca são tocados.

CREATE TABLE public.asaas_saldo_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES public.financial_installments(id),
  title_id uuid NOT NULL REFERENCES public.financial_titles(id),
  party_id uuid,
  account_id uuid REFERENCES public.asaas_accounts(id),
  acao text NOT NULL CHECK (acao IN ('cancelar','substituir','reabrir','excecao')),
  motivo text NOT NULL,
  estado text NOT NULL DEFAULT 'pendente'
    CHECK (estado IN ('pendente','processando','concluida','excecao','falhou','ignorada','substituida','superada')),
  saldo_cents bigint NOT NULL,
  aberto_cents bigint NOT NULL,
  cobrancas jsonb NOT NULL DEFAULT '[]'::jsonb,
  novo_valor_cents bigint,
  novo_vencimento date,
  novo_billing_type text,
  intent_id uuid REFERENCES public.asaas_charge_intents(id),
  nova_charge_id uuid REFERENCES public.asaas_charges(id),
  impressao text NOT NULL,
  forcar boolean NOT NULL DEFAULT false,
  progresso boolean NOT NULL DEFAULT false,
  erro text,
  tentativas integer NOT NULL DEFAULT 0,
  worker text,
  lease_until timestamptz,
  proxima_em timestamptz,
  decidido_por uuid,
  decisao_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz
);
GRANT SELECT ON public.asaas_saldo_sync TO authenticated;
GRANT ALL ON public.asaas_saldo_sync TO service_role;
ALTER TABLE public.asaas_saldo_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financeiro le espelho de saldo" ON public.asaas_saldo_sync FOR SELECT TO authenticated
  USING ((SELECT public.asaas_ator_pode(auth.uid(), 'finance.receivable.view')));
CREATE UNIQUE INDEX asaas_saldo_sync_um_ativo ON public.asaas_saldo_sync(installment_id)
  WHERE estado IN ('pendente','processando','falhou');
CREATE INDEX asaas_saldo_sync_inst ON public.asaas_saldo_sync(installment_id, created_at DESC);
CREATE INDEX asaas_saldo_sync_estado ON public.asaas_saldo_sync(estado, created_at DESC);

-- Núcleo único da preparação de cobrança: a tela continua chamando asaas_cobranca_preparar (mesmo comportamento);
-- o espelho de saldo chama com _saldo=true, que ignora cobranças já excluídas/pagas da mesma parcela.
CREATE OR REPLACE FUNCTION public.asaas_cobranca_preparar_nucleo(_payload jsonb, _actor uuid, _saldo boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE conta record;i record;t record;cliente record;existente record;viva record;
 v_saldo bigint;v_hash text;v_ref text;v_key text;v_venc date;v_forma text;v_id uuid;v_party uuid;n integer;
BEGIN
 IF _actor IS NOT NULL AND NOT public.asaas_ator_pode(_actor,'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão para preparar cobrança.'; END IF;
 SELECT * INTO i FROM public.financial_installments WHERE id=(_payload->>'installment_id')::uuid FOR UPDATE;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Parcela inexistente.'; END IF;
 SELECT * INTO t FROM public.financial_titles WHERE id=i.title_id;
 IF t.direction<>'receivable' OR t.status<>'ativo' OR t.approval_status='pendente' THEN RAISE EXCEPTION 'Título não está apto à cobrança.'; END IF;
 v_saldo:=public.fin_installment_saldo(i.id); IF coalesce(v_saldo,0)<=0 THEN RAISE EXCEPTION 'Parcela sem saldo devido.'; END IF;
 SELECT count(*) INTO n FROM public.asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default AND state IN('simulada','sandbox_conectada','producao_conectada') AND is_active;
 IF n<>1 THEN RAISE EXCEPTION 'A empresa do título deve possuir exatamente uma conta Asaas executável.'; END IF;
 SELECT * INTO conta FROM public.asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default AND state IN('simulada','sandbox_conectada','producao_conectada') AND is_active;
 v_party:=coalesce(t.pagador_party_id,t.party_id);
 SELECT count(*) INTO n FROM public.asaas_customers WHERE account_id=conta.id AND party_id=v_party AND match_status='vinculado';
 IF n>1 THEN RAISE EXCEPTION 'Mais de um cliente Asaas vinculado: defina o canônico antes de cobrar.'; END IF;
 SELECT * INTO cliente FROM public.asaas_customers WHERE account_id=conta.id AND party_id=v_party AND match_status='vinculado';
 IF cliente.id IS NULL AND coalesce((_payload->>'criar_cliente')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'Devedor sem cliente externo vinculado.'; END IF;
 SELECT * INTO existente FROM public.asaas_charges WHERE installment_id=i.id AND account_id=conta.id
  AND coalesce(external_status,'') NOT IN('DELETED','REFUNDED','CANCELED')
  AND (NOT _saldo OR external_status IN ('PENDING','OVERDUE')) LIMIT 1;
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
 SELECT * INTO viva FROM public.asaas_charge_intents x WHERE x.installment_id=i.id AND x.state IN('preparada','processando','aguardando_retentativa','criada','desconhecida','conciliacao')
  AND (NOT _saldo OR x.state NOT IN ('criada','conciliacao') OR EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.id=x.charge_id AND c.external_status IN ('PENDING','OVERDUE')))
  LIMIT 1;
 IF viva.id IS NOT NULL THEN RETURN jsonb_build_object('id',viva.id,'account_id',viva.account_id,'repetida',true,'state',viva.state,'invoice_url',viva.invoice_url,'external_id',viva.external_id,'internal_reference',viva.internal_reference);END IF;
 PERFORM set_config('lardann.asaas_intent','on',true);
 INSERT INTO public.asaas_charge_intents(account_id,title_id,installment_id,party_id,customer_external_id,criar_cliente,value_cents,due_date,billing_type,internal_reference,idempotency_key,content_hash,simulado,created_by)
 VALUES(conta.id,t.id,i.id,v_party,cliente.external_id,cliente.id IS NULL,v_saldo,v_venc,v_forma,v_ref||':'||left(md5(v_key),8),v_key,v_hash,conta.modo_execucao='simulado',_actor) RETURNING id INTO v_id;
 INSERT INTO public.asaas_charge_intent_events(intent_id,de,para,detalhe,actor_id) VALUES(v_id,NULL,'preparada',jsonb_build_object('valor_cents',v_saldo),_actor);
 PERFORM set_config('lardann.asaas_intent','off',true);
 RETURN jsonb_build_object('id',v_id,'account_id',conta.id,'state','preparada','internal_reference',v_ref||':'||left(md5(v_key),8));
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cobranca_preparar_nucleo(jsonb,uuid,boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cobranca_preparar_nucleo(jsonb,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_cobranca_preparar(_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.asaas_ator_pode(auth.uid(),'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão para preparar cobrança.'; END IF;
 RETURN public.asaas_cobranca_preparar_nucleo(_payload, auth.uid(), false);
END $function$;

-- Intenção cuja cobrança o espelho de saldo cancelou no Asaas passa a 'cancelada' (libera a parcela para a nova).
-- Só com o marcador interno do espelho; qualquer outro caminho continua sem poder mexer em intenção resolvida.
CREATE OR REPLACE FUNCTION public.asaas_intent_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE espelho boolean := coalesce(current_setting('lardann.asaas_saldo', true), 'off') = 'on';
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
    IF espelho AND OLD.state IN ('criada','conciliacao') AND NEW.state = 'cancelada' THEN
      IF NOT EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.id = OLD.charge_id AND c.external_status = 'DELETED') THEN
        RAISE EXCEPTION 'Só cancela a intenção depois de a cobrança estar excluída no Asaas.';
      END IF;
      NEW.updated_at := now();
      RETURN NEW;
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
END $function$;

-- Cancelamento feito pelo espelho de saldo não é "cobrança excluída no Asaas" (alerta 0297): a troca é nossa.
CREATE OR REPLACE FUNCTION public.asaas_divergencia_detectar()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_title uuid; v_party uuid; v_st text; v_saldo bigint; v_vivas int;
BEGIN
  IF OLD.external_status = 'DELETED' AND NEW.external_status IS DISTINCT FROM 'DELETED' THEN
    UPDATE public.asaas_divergencia_alertas SET resolvido_em = now(), resolucao = 'Cobrança restaurada no Asaas'
     WHERE charge_id = NEW.id AND tipo = 'cobranca_excluida' AND resolvido_em IS NULL;
  END IF;
  IF coalesce(current_setting('lardann.asaas_saldo', true), 'off') = 'on' THEN RETURN NEW; END IF;
  IF NEW.installment_id IS NULL THEN RETURN NEW; END IF;
  SELECT t.id, t.party_id, t.status::text INTO v_title, v_party, v_st
    FROM public.financial_installments i JOIN public.financial_titles t ON t.id = i.title_id
   WHERE i.id = NEW.installment_id AND t.direction = 'receivable';
  IF v_title IS NULL OR v_st <> 'ativo' THEN RETURN NEW; END IF;
  v_saldo := public.fin_installment_saldo(NEW.installment_id);
  IF coalesce(v_saldo, 0) <= 0 THEN RETURN NEW; END IF;
  IF NEW.external_status = 'DELETED' AND OLD.external_status IS DISTINCT FROM 'DELETED' THEN
    SELECT count(*) INTO v_vivas FROM public.asaas_charges
     WHERE installment_id = NEW.installment_id AND id <> NEW.id AND external_status <> 'DELETED';
    IF v_vivas = 0 THEN
      INSERT INTO public.asaas_divergencia_alertas (charge_id, installment_id, title_id, party_id, tipo, antes, depois, saldo_cents)
      VALUES (NEW.id, NEW.installment_id, v_title, v_party, 'cobranca_excluida',
              jsonb_build_object('status', OLD.external_status, 'valor_cents', OLD.value_cents, 'vencimento', OLD.due_date),
              jsonb_build_object('status', 'DELETED'), v_saldo)
      ON CONFLICT (charge_id, tipo) WHERE resolvido_em IS NULL DO NOTHING;
    END IF;
  ELSIF NEW.external_status IN ('PENDING','OVERDUE') AND NEW.value_cents IS DISTINCT FROM OLD.value_cents THEN
    INSERT INTO public.asaas_divergencia_alertas (charge_id, installment_id, title_id, party_id, tipo, antes, depois, saldo_cents)
    VALUES (NEW.id, NEW.installment_id, v_title, v_party, 'valor_alterado',
            jsonb_build_object('valor_cents', OLD.value_cents), jsonb_build_object('valor_cents', NEW.value_cents), v_saldo)
    ON CONFLICT (charge_id, tipo) WHERE resolvido_em IS NULL DO UPDATE SET depois = EXCLUDED.depois, saldo_cents = EXCLUDED.saldo_cents;
  ELSIF NEW.external_status IN ('PENDING','OVERDUE') AND NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO public.asaas_divergencia_alertas (charge_id, installment_id, title_id, party_id, tipo, antes, depois, saldo_cents)
    VALUES (NEW.id, NEW.installment_id, v_title, v_party, 'vencimento_alterado',
            jsonb_build_object('vencimento', OLD.due_date), jsonb_build_object('vencimento', NEW.due_date), v_saldo)
    ON CONFLICT (charge_id, tipo) WHERE resolvido_em IS NULL DO UPDATE SET depois = EXCLUDED.depois, saldo_cents = EXCLUDED.saldo_cents;
  END IF;
  RETURN NEW;
END $function$;

-- Plano para uma parcela: o que precisa mudar no Asaas para espelhar o saldo do Lardan. Só leitura.
CREATE OR REPLACE FUNCTION public.asaas_saldo_plano(_inst uuid, _forcar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE i record; t record; v_party uuid; v_saldo bigint; v_efetivo bigint; v_aberto bigint := 0; v_n int := 0;
  v_cobr jsonb := '[]'::jsonb; v_acordo boolean := false; v_em_acordo boolean; v_judicial boolean; v_gerida boolean;
  v_acao text := 'nada'; v_motivo text := NULL; v_valor bigint; v_venc date; v_billing text; v_conta uuid; v_clientes int; v_impr text;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; v_contas int; r record;
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
    v_venc := r.due_date; v_billing := r.billing_type;
  END LOOP;
  v_impr := md5(v_efetivo || ':' || t.status || ':' || v_cobr::text);
  IF v_acordo THEN
    RETURN jsonb_build_object('acao','nada','motivo','cobranca_de_acordo','saldo_cents',v_efetivo,'aberto_cents',v_aberto,'impressao',v_impr);
  END IF;
  v_em_acordo := EXISTS (SELECT 1 FROM public.cob_simulacoes s WHERE _inst = ANY(s.installment_ids)
                          AND s.status IN ('simulada','aguardando_entrada','efetivada'));
  v_judicial := EXISTS (SELECT 1 FROM public.cob_judicial_processos jp WHERE jp.party_id = v_party)
             OR EXISTS (SELECT 1 FROM public.cob_judicial j WHERE j.party_id = v_party);
  v_gerida := EXISTS (SELECT 1 FROM public.asaas_saldo_sync s WHERE s.installment_id = _inst AND s.estado = 'concluida'
                       AND s.acao IN ('cancelar','substituir','reabrir'));

  IF v_aberto > v_efetivo THEN
    IF v_efetivo = 0 THEN
      v_acao := 'cancelar'; v_motivo := CASE WHEN t.status <> 'ativo' THEN 'titulo_cancelado' ELSE 'quitada' END;
    ELSE
      v_acao := 'substituir'; v_motivo := 'baixa_parcial'; v_valor := v_efetivo;
      v_venc := greatest(hoje, coalesce(v_venc, hoje));
    END IF;
  ELSIF v_gerida AND t.status = 'ativo' AND v_efetivo > v_aberto AND v_efetivo >= 500 AND v_n <= 1 THEN
    v_acao := 'reabrir'; v_motivo := 'estorno'; v_valor := v_efetivo;
    v_venc := greatest(hoje, coalesce(v_venc, i.vencimento, hoje)); v_billing := coalesce(v_billing,
      (SELECT s.novo_billing_type FROM public.asaas_saldo_sync s WHERE s.installment_id = _inst AND s.novo_billing_type IS NOT NULL ORDER BY s.created_at DESC LIMIT 1),
      (SELECT (s.cobrancas->0->>'billing_type') FROM public.asaas_saldo_sync s WHERE s.installment_id = _inst ORDER BY s.created_at DESC LIMIT 1));
  ELSE
    RETURN jsonb_build_object('acao','nada','motivo','em_dia','saldo_cents',v_efetivo,'aberto_cents',v_aberto,'impressao',v_impr);
  END IF;

  IF v_acao IN ('substituir','reabrir') THEN
    IF v_billing IS NULL OR v_billing NOT IN ('BOLETO','PIX','CREDIT_CARD','UNDEFINED') THEN v_billing := 'UNDEFINED'; END IF;
    IF v_em_acordo THEN v_acao := 'excecao'; v_motivo := 'parcela_em_acordo';
    ELSIF v_judicial AND NOT _forcar THEN v_acao := 'excecao'; v_motivo := 'cliente_judicial';
    ELSIF v_n > 1 AND NOT _forcar THEN v_acao := 'excecao'; v_motivo := 'varias_cobrancas';
    ELSIF v_valor < 500 THEN
      IF v_acao = 'substituir' THEN v_acao := 'cancelar'; v_motivo := 'saldo_abaixo_minimo'; v_valor := NULL;
      ELSE v_acao := 'excecao'; v_motivo := 'saldo_abaixo_minimo'; END IF;
    ELSIF t.approval_status = 'pendente' THEN v_acao := 'excecao'; v_motivo := 'titulo_nao_aprovado';
    ELSE
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

-- Cria (ou atualiza) a tarefa de uma parcela a partir do plano. Interno.
CREATE OR REPLACE FUNCTION public.asaas_saldo_enfileirar(_inst uuid, _forcar boolean DEFAULT false, _actor uuid DEFAULT NULL, _motivo text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p jsonb; v_id uuid; ult record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.asaas_saldo_sync WHERE installment_id = _inst AND estado IN ('pendente','processando','falhou')) THEN RETURN NULL; END IF;
  p := public.asaas_saldo_plano(_inst, _forcar);
  IF p->>'acao' = 'nada' THEN RETURN NULL; END IF;
  SELECT * INTO ult FROM public.asaas_saldo_sync WHERE installment_id = _inst ORDER BY created_at DESC LIMIT 1;
  IF NOT _forcar AND ult.id IS NOT NULL AND ult.impressao = p->>'impressao' AND ult.estado IN ('excecao','ignorada','concluida') THEN RETURN NULL; END IF;
  UPDATE public.asaas_saldo_sync SET estado = 'substituida', updated_at = now() WHERE installment_id = _inst AND estado = 'excecao' AND NOT progresso;
  INSERT INTO public.asaas_saldo_sync (installment_id, title_id, party_id, account_id, acao, motivo, estado, saldo_cents, aberto_cents,
    cobrancas, novo_valor_cents, novo_vencimento, novo_billing_type, impressao, forcar, decidido_por, decisao_motivo, concluida_em)
  VALUES (_inst, (p->>'title_id')::uuid, (p->>'party_id')::uuid, (p->>'account_id')::uuid, p->>'acao', p->>'motivo',
    CASE WHEN p->>'acao' = 'excecao' THEN 'excecao' ELSE 'pendente' END,
    (p->>'saldo_cents')::bigint, (p->>'aberto_cents')::bigint, p->'cobrancas', (p->>'novo_valor_cents')::bigint,
    (p->>'novo_vencimento')::date, p->>'novo_billing_type', p->>'impressao', _forcar, _actor, _motivo, NULL)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_enfileirar(uuid,boolean,uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_enfileirar(uuid,boolean,uuid,text) TO service_role;

-- Varredura: toda parcela com cobrança aberta que cobra mais do que o saldo (ou já gerida e reaberta por estorno).
CREATE OR REPLACE FUNCTION public.asaas_saldo_varrer()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record; n int := 0;
BEGIN
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
     WHERE s.estado = 'concluida' AND s.acao IN ('cancelar','substituir','reabrir') AND t.status = 'ativo'
       AND coalesce(public.fin_installment_saldo(s.installment_id),0) >= 500
       AND coalesce(public.fin_installment_saldo(s.installment_id),0) >
           coalesce((SELECT sum(c.value_cents) FROM public.asaas_charges c WHERE c.installment_id = s.installment_id
                      AND c.external_status IN ('PENDING','OVERDUE')),0)
  LOOP
    IF public.asaas_saldo_enfileirar(r.inst) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_varrer() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_varrer() TO service_role;

-- Reserva tarefas para o servidor executar (somente serviço). Replaneja tarefas sem progresso.
CREATE OR REPLACE FUNCTION public.asaas_saldo_reservar(_worker text, _limite integer DEFAULT 20)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; p jsonb; saida jsonb := '[]'::jsonb; v_int record; v_varridas int;
BEGIN
  IF coalesce(btrim(_worker),'') = '' THEN RAISE EXCEPTION 'Trabalhador obrigatório.'; END IF;
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
          impressao = p->>'impressao', updated_at = now(), lease_until = NULL WHERE id = s.id;
        CONTINUE;
      END IF;
      UPDATE public.asaas_saldo_sync SET acao = p->>'acao', motivo = p->>'motivo', saldo_cents = (p->>'saldo_cents')::bigint,
        aberto_cents = (p->>'aberto_cents')::bigint, cobrancas = p->'cobrancas', novo_valor_cents = (p->>'novo_valor_cents')::bigint,
        novo_vencimento = (p->>'novo_vencimento')::date, novo_billing_type = p->>'novo_billing_type', impressao = p->>'impressao',
        account_id = coalesce((p->>'account_id')::uuid, account_id)
       WHERE id = s.id;
    END IF;
    UPDATE public.asaas_saldo_sync SET estado = 'processando', worker = _worker, tentativas = tentativas + 1,
      lease_until = now() + interval '5 minutes', updated_at = now() WHERE id = s.id RETURNING * INTO s;
    SELECT id, state INTO v_int FROM public.asaas_charge_intents WHERE id = s.intent_id;
    saida := saida || jsonb_build_array(jsonb_build_object('id', s.id, 'acao', s.acao, 'motivo', s.motivo,
      'cancelar', (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(s.cobrancas) e
                    WHERE coalesce(e->>'resultado','') NOT IN ('cancelada','ja_excluida')),
      'intent_id', s.intent_id, 'intent_state', v_int.state));
  END LOOP;
  RETURN jsonb_build_object('varridas', v_varridas, 'tarefas', saida);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_reservar(text,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_reservar(text,integer) TO service_role;

-- Resultado do cancelamento de UMA cobrança no Asaas (somente serviço).
CREATE OR REPLACE FUNCTION public.asaas_saldo_cancelamento(_job uuid, _worker text, _charge uuid, _resultado text, _status_remoto text, _erro text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; c record; v_cobr jsonb; v_it record;
BEGIN
  IF _resultado NOT IN ('cancelada','ja_excluida','paga_no_asaas','falhou') THEN RAISE EXCEPTION 'Resultado inválido.'; END IF;
  SELECT * INTO s FROM public.asaas_saldo_sync WHERE id = _job FOR UPDATE;
  IF s.id IS NULL OR s.estado <> 'processando' OR s.worker IS DISTINCT FROM _worker THEN RAISE EXCEPTION 'Tarefa fora da posse deste trabalhador.'; END IF;
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge FOR UPDATE;
  IF c.id IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.cobrancas) e WHERE (e->>'charge_id')::uuid = _charge) THEN
    RAISE EXCEPTION 'Cobrança não pertence a esta tarefa.'; END IF;
  SELECT jsonb_agg(CASE WHEN (e->>'charge_id')::uuid = _charge
           THEN e || jsonb_build_object('resultado', _resultado, 'status_remoto', _status_remoto, 'erro', left(_erro,300), 'em', now())
           ELSE e END ORDER BY ord) INTO v_cobr
    FROM jsonb_array_elements(s.cobrancas) WITH ORDINALITY x(e, ord);
  IF _resultado IN ('cancelada','ja_excluida') THEN
    PERFORM set_config('lardann.asaas_link','on', true);
    PERFORM set_config('lardann.asaas_saldo','on', true);
    UPDATE public.asaas_charges SET external_status = 'DELETED',
      reconcile_note = left('Cancelada pelo Lardan: ' || CASE s.motivo WHEN 'baixa_parcial' THEN 'baixa parcial, nova cobrança pelo saldo'
        WHEN 'quitada' THEN 'parcela quitada no Lardan' WHEN 'titulo_cancelado' THEN 'título cancelado no Lardan'
        WHEN 'saldo_abaixo_minimo' THEN 'saldo abaixo do mínimo do Asaas' WHEN 'estorno' THEN 'estorno de baixa, nova cobrança pelo saldo'
        ELSE s.motivo END, 300)
     WHERE id = _charge AND external_status IN ('PENDING','OVERDUE');
    PERFORM set_config('lardann.asaas_intent','on', true);
    FOR v_it IN SELECT id, state FROM public.asaas_charge_intents WHERE charge_id = _charge AND state IN ('criada','conciliacao') FOR UPDATE LOOP
      UPDATE public.asaas_charge_intents SET state = 'cancelada', resolved_at = now(),
             last_error = 'Cobrança cancelada no Asaas pelo espelho de saldo (' || s.motivo || ').' WHERE id = v_it.id;
      INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
      VALUES (v_it.id, v_it.state, 'cancelada', jsonb_build_object('motivo', 'espelho_saldo', 'tarefa', _job), s.decidido_por);
    END LOOP;
    PERFORM set_config('lardann.asaas_intent','off', true);
    PERFORM set_config('lardann.asaas_saldo','off', true);
    PERFORM set_config('lardann.asaas_link','off', true);
    UPDATE public.asaas_saldo_sync SET cobrancas = v_cobr, progresso = true, erro = NULL, updated_at = now() WHERE id = _job;
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (s.decidido_por, 'asaas.saldo.cancelar', 'asaas_charges', _charge,
      jsonb_build_object('tarefa', _job, 'external_id', c.external_id, 'valor_cents', c.value_cents, 'motivo', s.motivo, 'resultado', _resultado));
    RETURN jsonb_build_object('continuar', true);
  ELSIF _resultado = 'paga_no_asaas' THEN
    UPDATE public.asaas_saldo_sync SET cobrancas = v_cobr, estado = 'excecao', motivo = 'pago_no_asaas', lease_until = NULL,
      erro = 'A cobrança ' || c.external_id || ' já consta paga no Asaas (' || coalesce(_status_remoto,'?') || '): conferir pagamento em dobro.', updated_at = now()
     WHERE id = _job;
    RETURN jsonb_build_object('continuar', false);
  ELSE
    UPDATE public.asaas_saldo_sync SET cobrancas = v_cobr, estado = 'falhou', lease_until = NULL, erro = left(coalesce(_erro,'Falha ao cancelar no Asaas.'),500),
      proxima_em = now() + make_interval(mins => least(5 * tentativas, 60)), updated_at = now()
     WHERE id = _job;
    RETURN jsonb_build_object('continuar', false);
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_cancelamento(uuid,text,uuid,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_cancelamento(uuid,text,uuid,text,text,text) TO service_role;

-- Depois de cancelar: prepara a cobrança nova pelo saldo ATUAL (ou conclui quando não há nova). Somente serviço.
CREATE OR REPLACE FUNCTION public.asaas_saldo_preparar(_job uuid, _worker text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; v_saldo bigint; t record; it jsonb; v_venc date; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO s FROM public.asaas_saldo_sync WHERE id = _job FOR UPDATE;
  IF s.id IS NULL OR s.estado <> 'processando' OR s.worker IS DISTINCT FROM _worker THEN RAISE EXCEPTION 'Tarefa fora da posse deste trabalhador.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s.cobrancas) e WHERE coalesce(e->>'resultado','') NOT IN ('cancelada','ja_excluida')) THEN
    RAISE EXCEPTION 'Ainda há cobrança antiga a cancelar.'; END IF;
  IF s.intent_id IS NOT NULL AND (SELECT x.state FROM public.asaas_charge_intents x WHERE x.id = s.intent_id) NOT IN ('rejeitada','cancelada') THEN
    RETURN jsonb_build_object('executar', true, 'intent_id', s.intent_id); END IF;
  IF s.acao = 'cancelar' THEN
    UPDATE public.asaas_saldo_sync SET estado = 'concluida', lease_until = NULL, concluida_em = now(), updated_at = now(), erro = NULL WHERE id = _job;
    RETURN jsonb_build_object('executar', false, 'estado', 'concluida');
  END IF;
  SELECT * INTO t FROM public.financial_titles WHERE id = s.title_id;
  v_saldo := CASE WHEN t.status = 'ativo' THEN greatest(coalesce(public.fin_installment_saldo(s.installment_id),0),0) ELSE 0 END;
  IF v_saldo < 500 THEN
    UPDATE public.asaas_saldo_sync SET estado = 'concluida', lease_until = NULL, concluida_em = now(), updated_at = now(), novo_valor_cents = NULL,
      motivo = CASE WHEN v_saldo = 0 THEN 'quitada' ELSE 'saldo_abaixo_minimo' END,
      erro = CASE WHEN v_saldo = 0 THEN NULL ELSE 'Saldo abaixo do mínimo do Asaas (R$ 5,00): cobrar por fora.' END WHERE id = _job;
    RETURN jsonb_build_object('executar', false, 'estado', 'concluida');
  END IF;
  v_venc := greatest(hoje, coalesce(s.novo_vencimento, hoje));
  BEGIN
    it := public.asaas_cobranca_preparar_nucleo(jsonb_build_object('installment_id', s.installment_id, 'billing_type', coalesce(s.novo_billing_type,'UNDEFINED'),
      'due_date', v_venc, 'idempotency_key', 'saldo:' || s.id || ':' || v_saldo || ':' || (SELECT count(*) FROM public.asaas_charge_intents x WHERE x.idempotency_key LIKE 'saldo:' || s.id || ':%' AND x.state IN ('rejeitada','cancelada')), 'criar_cliente', false), NULL, true);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.asaas_saldo_sync SET estado = 'excecao', motivo = 'nova_cobranca_recusada', lease_until = NULL, updated_at = now(),
      erro = left('Cobrança antiga cancelada, mas a nova não pôde ser preparada: ' || SQLERRM, 500) WHERE id = _job;
    RETURN jsonb_build_object('executar', false, 'estado', 'excecao');
  END;
  IF coalesce((it->>'reaproveitada')::boolean, false) THEN
    UPDATE public.asaas_saldo_sync SET estado = 'excecao', motivo = 'cobranca_viva_encontrada', lease_until = NULL, updated_at = now(),
      erro = 'Já existe outra cobrança aberta para a parcela: conferir.' WHERE id = _job;
    RETURN jsonb_build_object('executar', false, 'estado', 'excecao');
  END IF;
  UPDATE public.asaas_saldo_sync SET intent_id = (it->>'id')::uuid, novo_valor_cents = v_saldo, novo_vencimento = v_venc, progresso = true, updated_at = now()
   WHERE id = _job;
  RETURN jsonb_build_object('executar', true, 'intent_id', (it->>'id')::uuid);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_preparar(uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_preparar(uuid,text) TO service_role;

-- Fecha a tarefa conforme o estado da intenção executada (somente serviço).
CREATE OR REPLACE FUNCTION public.asaas_saldo_concluir(_job uuid, _worker text, _erro text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; it record;
BEGIN
  SELECT * INTO s FROM public.asaas_saldo_sync WHERE id = _job FOR UPDATE;
  IF s.id IS NULL OR s.estado <> 'processando' OR s.worker IS DISTINCT FROM _worker THEN RAISE EXCEPTION 'Tarefa fora da posse deste trabalhador.'; END IF;
  IF s.intent_id IS NULL THEN
    UPDATE public.asaas_saldo_sync SET estado = 'falhou', lease_until = NULL, erro = left(coalesce(_erro,'Interrompida.'),500),
      proxima_em = now() + make_interval(mins => least(5 * tentativas, 60)), updated_at = now() WHERE id = _job;
    RETURN jsonb_build_object('estado','falhou');
  END IF;
  SELECT * INTO it FROM public.asaas_charge_intents WHERE id = s.intent_id;
  IF it.state IN ('criada','conciliacao') AND it.charge_id IS NOT NULL THEN
    UPDATE public.asaas_saldo_sync SET estado = 'concluida', nova_charge_id = it.charge_id, lease_until = NULL, concluida_em = now(), updated_at = now(),
      erro = CASE WHEN it.state = 'conciliacao' THEN 'Cobrança nova criada; saldo mudou durante a troca e será conferido de novo.' ELSE NULL END WHERE id = _job;
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (s.decidido_por, 'asaas.saldo.nova_cobranca', 'asaas_charges', it.charge_id,
      jsonb_build_object('tarefa', _job, 'external_id', it.external_id, 'valor_cents', it.value_cents, 'vencimento', it.due_date, 'motivo', s.motivo));
    RETURN jsonb_build_object('estado','concluida');
  ELSIF it.state IN ('rejeitada','cancelada') THEN
    UPDATE public.asaas_saldo_sync SET estado = 'excecao', motivo = 'nova_cobranca_recusada', lease_until = NULL, updated_at = now(),
      erro = left('Cobrança antiga cancelada; o Asaas recusou a nova: ' || coalesce(it.last_error, _erro, ''), 500) WHERE id = _job;
    RETURN jsonb_build_object('estado','excecao');
  ELSE
    UPDATE public.asaas_saldo_sync SET estado = 'falhou', lease_until = NULL, erro = left(coalesce(_erro, it.last_error, 'Nova cobrança ainda sem confirmação do Asaas.'),500),
      proxima_em = now() + make_interval(mins => least(2 * tentativas, 30)), updated_at = now() WHERE id = _job;
    RETURN jsonb_build_object('estado','falhou');
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_concluir(uuid,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_concluir(uuid,text,text) TO service_role;

-- Decisão humana sobre uma exceção (financeiro): substituir pelo saldo (mesmo com várias cobranças/judicial), ignorar ou tentar de novo.
CREATE OR REPLACE FUNCTION public.asaas_saldo_decidir(_job uuid, _decisao text, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; v_novo uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.asaas_ator_pode(auth.uid(), 'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem acesso ao financeiro.'; END IF;
  IF _decisao NOT IN ('substituir','ignorar','tentar') THEN RAISE EXCEPTION 'Decisão inválida.'; END IF;
  IF length(btrim(coalesce(_motivo,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO s FROM public.asaas_saldo_sync WHERE id = _job FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF s.estado NOT IN ('excecao','falhou') THEN RAISE EXCEPTION 'Só exceções ou falhas recebem decisão.'; END IF;
  IF _decisao = 'ignorar' THEN
    UPDATE public.asaas_saldo_sync SET estado = 'ignorada', decidido_por = auth.uid(), decisao_motivo = left(_motivo,500), lease_until = NULL, updated_at = now() WHERE id = _job;
  ELSE
    IF s.motivo = 'parcela_em_acordo' THEN RAISE EXCEPTION 'Parcela dentro de acordo: resolva pelo acordo.'; END IF;
    IF _decisao = 'substituir' AND s.progresso THEN RAISE EXCEPTION 'Esta tarefa já mexeu no Asaas: use "Tentar de novo".'; END IF;
    UPDATE public.asaas_saldo_sync SET estado = CASE WHEN s.progresso THEN 'falhou' ELSE 'substituida' END, proxima_em = now(),
      tentativas = CASE WHEN s.progresso THEN 0 ELSE tentativas END,
      decidido_por = auth.uid(), decisao_motivo = left(_motivo,500), updated_at = now() WHERE id = _job;
    IF NOT s.progresso THEN
      v_novo := public.asaas_saldo_enfileirar(s.installment_id, _decisao = 'substituir', auth.uid(), left(_motivo,500));
      IF v_novo IS NULL THEN RAISE EXCEPTION 'Nada a fazer: o Asaas já confere com o Lardan ou há tarefa em andamento.'; END IF;
      IF (SELECT estado FROM public.asaas_saldo_sync WHERE id = v_novo) = 'excecao' THEN
        RAISE EXCEPTION 'Continua sem poder trocar: %', (SELECT motivo FROM public.asaas_saldo_sync WHERE id = v_novo); END IF;
    END IF;
  END IF;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'asaas.saldo.decidir', 'asaas_saldo_sync', _job, jsonb_build_object('decisao', _decisao, 'motivo', left(_motivo,500), 'nova_tarefa', v_novo));
  RETURN jsonb_build_object('ok', true, 'nova_tarefa', v_novo);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_decidir(uuid,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_decidir(uuid,text,text) TO authenticated;

-- Painel: resumo + últimas tarefas, com nome/código da pessoa e número do título.
CREATE OR REPLACE FUNCTION public.asaas_saldo_painel(_limite integer DEFAULT 150)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.asaas_ator_pode(auth.uid(), 'finance.receivable.view') THEN RAISE EXCEPTION 'Sem acesso ao financeiro.'; END IF;
  RETURN jsonb_build_object(
    'resumo', (SELECT jsonb_build_object(
        'concluidas', count(*) FILTER (WHERE estado = 'concluida'),
        'canceladas_cents', coalesce(sum(aberto_cents) FILTER (WHERE estado = 'concluida'),0),
        'novas', count(*) FILTER (WHERE estado = 'concluida' AND nova_charge_id IS NOT NULL),
        'novas_cents', coalesce(sum(novo_valor_cents) FILTER (WHERE estado = 'concluida' AND nova_charge_id IS NOT NULL),0),
        'excecoes', count(*) FILTER (WHERE estado = 'excecao'),
        'andamento', count(*) FILTER (WHERE estado IN ('pendente','processando','falhou'))) FROM public.asaas_saldo_sync),
    'tarefas', (SELECT coalesce(jsonb_agg(x ORDER BY x.prioridade, x.created_at DESC), '[]'::jsonb) FROM (
        SELECT s.id, s.acao, s.motivo, s.estado, s.saldo_cents, s.aberto_cents, s.cobrancas, s.novo_valor_cents, s.novo_vencimento,
               s.erro, s.decisao_motivo, s.created_at, s.concluida_em, s.tentativas,
               t.numero titulo_numero, p.display_name pessoa, p.code pessoa_codigo,
               nc.external_id nova_external_id, nc.invoice_url nova_invoice_url,
               CASE s.estado WHEN 'excecao' THEN 0 WHEN 'falhou' THEN 1 WHEN 'processando' THEN 2 WHEN 'pendente' THEN 2 ELSE 3 END prioridade
          FROM public.asaas_saldo_sync s
          JOIN public.financial_titles t ON t.id = s.title_id
          LEFT JOIN public.parties p ON p.id = s.party_id
          LEFT JOIN public.asaas_charges nc ON nc.id = s.nova_charge_id
         WHERE s.estado NOT IN ('substituida','superada')
         ORDER BY CASE s.estado WHEN 'excecao' THEN 0 WHEN 'falhou' THEN 1 ELSE 2 END, s.created_at DESC
         LIMIT least(greatest(coalesce(_limite,150),1),500)) x));
END $function$;
REVOKE ALL ON FUNCTION public.asaas_saldo_painel(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asaas_saldo_painel(integer) TO authenticated;