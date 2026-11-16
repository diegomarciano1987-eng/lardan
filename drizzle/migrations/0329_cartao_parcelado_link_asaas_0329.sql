-- 0329 — Cartão parcelado de verdade no link do Asaas (Diego, 16/11/2026).
-- Antes: o Lardan mandava "maxInstallmentCount" em /payments, campo que o Asaas ignora; todo link saía em 1x.
-- Agora: a parcela escolhida vai como parcelamento oficial (installmentCount + totalValue).
--   1x a 3x: sem juros (a Lardan absorve a taxa). 4x a 12x: a cliente paga a taxa do Asaas da conta Lardan
--   (3,49% de 2 a 6x, 3,99% de 7 a 12x, + R$ 0,49), calculada aqui para a Lardan receber o valor da venda.
-- Cada parcela do Asaas (um pay_) vira uma cobrança espelhada ligada à MESMA parcela do Lardan; cada uma
-- baixa só a sua parte (um pay_ = um lançamento) e leva junto a sua fração do acréscimo como juros.
-- Fluxos sem parcelas (Pix, boleto, cobrança da equipe, acordos) não mudam.

ALTER TABLE public.asaas_charge_intents
  ADD COLUMN IF NOT EXISTS parcelas_cartao smallint,
  ADD COLUMN IF NOT EXISTS acrescimo_cartao_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.asaas_charge_intents
  ADD CONSTRAINT asaas_intents_parcelas_cartao_ck CHECK (parcelas_cartao IS NULL OR parcelas_cartao BETWEEN 2 AND 12),
  ADD CONSTRAINT asaas_intents_acrescimo_cartao_ck CHECK (acrescimo_cartao_cents >= 0);
COMMENT ON COLUMN public.asaas_charge_intents.parcelas_cartao IS 'Cartão parcelado (2 a 12x). Nulo = à vista.';
COMMENT ON COLUMN public.asaas_charge_intents.acrescimo_cartao_cents IS 'Taxa do cartão paga pela cliente (só de 4x a 12x).';

ALTER TABLE public.asaas_charges
  ADD COLUMN IF NOT EXISTS acrescimo_cartao_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.asaas_charges
  ADD CONSTRAINT asaas_charges_acrescimo_cartao_ck CHECK (acrescimo_cartao_cents >= 0);
CREATE INDEX IF NOT EXISTS asaas_charges_parcelamento_idx ON public.asaas_charges (account_id, installment_external_id) WHERE installment_external_id IS NOT NULL;
COMMENT ON COLUMN public.asaas_charges.acrescimo_cartao_cents IS 'Parte desta parcela que é taxa do cartão paga pela cliente; entra como juros na baixa.';

-- Taxa do parcelamento paga pela cliente. Regra: 1x a 3x sem juros; 4x a 12x a cliente paga a taxa do Asaas.
CREATE OR REPLACE FUNCTION public.asaas_cartao_acrescimo(_base_cents bigint, _parcelas integer)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN _base_cents IS NULL OR _base_cents <= 0 OR _parcelas IS NULL OR _parcelas <= 3 THEN 0::bigint
              ELSE (ceil((_base_cents + 49)::numeric / (1 - CASE WHEN _parcelas <= 6 THEN 0.0349 ELSE 0.0399 END)))::bigint - _base_cents
         END
$function$;
REVOKE ALL ON FUNCTION public.asaas_cartao_acrescimo(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_cartao_acrescimo(bigint, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asaas_cobranca_preparar_nucleo(_payload jsonb, _actor uuid, _saldo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE conta record;i record;t record;cliente record;existente record;viva record;
 v_saldo bigint;v_hash text;v_parc int;v_parc_pedida int;v_acr bigint:=0;v_n_exist int;v_ref text;v_key text;v_venc date;v_forma text;v_id uuid;v_party uuid;n integer;
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
 IF n>1 AND public.asaas_cliente_principal_id(conta.id,v_party) IS NULL THEN PERFORM public.asaas_cliente_principal_escolher(conta.id,v_party,_actor); END IF;
 IF n>1 AND public.asaas_cliente_principal_id(conta.id,v_party) IS NULL THEN RAISE EXCEPTION 'Mais de um cliente Asaas vinculado e nenhum principal.'; END IF;
 SELECT * INTO cliente FROM public.asaas_customers WHERE id=public.asaas_cliente_principal_id(conta.id,v_party);
 IF cliente.id IS NULL AND coalesce((_payload->>'criar_cliente')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'Devedor sem cliente externo vinculado.'; END IF;
 -- 0329: cartão parcelado (só quando o pedido informa as parcelas; os outros fluxos seguem iguais)
 IF _payload ? 'parcelas_cartao' AND coalesce(nullif(_payload->>'billing_type',''),'UNDEFINED')='CREDIT_CARD' THEN
  v_parc_pedida:=coalesce(nullif(_payload->>'parcelas_cartao','')::int,1);
  IF v_parc_pedida<1 OR v_parc_pedida>12 THEN RAISE EXCEPTION 'Parcelas do cartão: de 1 a 12.'; END IF;
  v_parc:=CASE WHEN v_parc_pedida>1 THEN v_parc_pedida END;
  v_acr:=public.asaas_cartao_acrescimo(v_saldo,v_parc);
 END IF;
 SELECT * INTO existente FROM public.asaas_charges WHERE installment_id=i.id AND account_id=conta.id
  AND coalesce(external_status,'') NOT IN('DELETED','REFUNDED','CANCELED')
  AND (NOT _saldo OR external_status IN ('PENDING','OVERDUE')) ORDER BY coalesce(installment_number,0), imported_at LIMIT 1;
 IF existente.id IS NOT NULL AND v_parc_pedida IS NOT NULL THEN
  v_n_exist:=CASE WHEN existente.installment_external_id IS NULL THEN 1 ELSE (SELECT count(*) FROM public.asaas_charges z WHERE z.account_id=existente.account_id AND z.installment_external_id=existente.installment_external_id AND coalesce(z.external_status,'') NOT IN ('DELETED','REFUNDED','CANCELED')) END;
  IF v_n_exist<>v_parc_pedida THEN
   RAISE EXCEPTION 'Esta venda já tem um link de cartão em %x. Para mudar para %x, peça ao financeiro para cancelar o link atual no Asaas e gere de novo.', v_n_exist, v_parc_pedida;
  END IF;
 END IF;
 IF existente.id IS NOT NULL THEN RETURN jsonb_build_object('reaproveitada',true,'charge_id',existente.id,'account_id',conta.id,
  'external_id',existente.external_id,'invoice_url',existente.invoice_url,'aviso','Cobrança ativa reaproveitada.'); END IF;
 v_venc:=coalesce(nullif(_payload->>'due_date','')::date,i.vencimento);IF v_venc<current_date THEN v_venc:=current_date;END IF;
 v_forma:=coalesce(nullif(_payload->>'billing_type',''),'UNDEFINED');v_ref:='lardan:installment:'||i.id;
 v_key:=coalesce(nullif(_payload->>'idempotency_key',''),v_ref||':'||v_saldo||':'||v_venc||':'||(SELECT count(*) FROM public.asaas_charge_intents x WHERE x.installment_id=i.id AND x.state IN('rejeitada','cancelada')));
 IF v_parc>1 AND nullif(_payload->>'idempotency_key','') IS NULL THEN v_key:=v_key||':x'||v_parc; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_key,0));
 v_hash:=public.fin_fingerprint(jsonb_build_object('account',conta.id,'installment',i.id,'party',v_party,'valor_cents',v_saldo,'due_date',v_venc,'billing_type',v_forma));
 IF v_parc>1 THEN v_hash:=public.fin_fingerprint(jsonb_build_object('base',v_hash,'parcelas_cartao',v_parc,'acrescimo_cartao_cents',v_acr)); END IF;
 SELECT * INTO existente FROM public.asaas_charge_intents WHERE idempotency_key=v_key;
 IF existente.id IS NOT NULL THEN
  IF existente.content_hash<>v_hash THEN RAISE EXCEPTION 'Colisão de chave: esta chave já foi usada com outro conteúdo.' USING errcode='23505';END IF;
  RETURN jsonb_build_object('id',existente.id,'account_id',existente.account_id,'repetida',true,'state',existente.state,'invoice_url',existente.invoice_url,'external_id',existente.external_id,'internal_reference',existente.internal_reference);
 END IF;
 SELECT * INTO viva FROM public.asaas_charge_intents x WHERE x.installment_id=i.id AND x.state IN('preparada','processando','aguardando_retentativa','criada','desconhecida','conciliacao')
  AND (NOT _saldo OR x.state NOT IN ('criada','conciliacao') OR EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.id=x.charge_id AND c.external_status IN ('PENDING','OVERDUE')))
  LIMIT 1;
 IF viva.id IS NOT NULL AND v_parc_pedida IS NOT NULL AND coalesce(viva.parcelas_cartao,1)<>v_parc_pedida THEN
  RAISE EXCEPTION 'Esta venda já tem um link de cartão em %x sendo gerado. Aguarde um minuto e tente de novo.', coalesce(viva.parcelas_cartao,1);
 END IF;
 IF viva.id IS NOT NULL THEN RETURN jsonb_build_object('id',viva.id,'account_id',viva.account_id,'repetida',true,'state',viva.state,'invoice_url',viva.invoice_url,'external_id',viva.external_id,'internal_reference',viva.internal_reference);END IF;
 PERFORM set_config('lardann.asaas_intent','on',true);
 INSERT INTO public.asaas_charge_intents(account_id,title_id,installment_id,party_id,customer_external_id,criar_cliente,value_cents,due_date,billing_type,internal_reference,idempotency_key,content_hash,simulado,created_by,parcelas_cartao,acrescimo_cartao_cents)
 VALUES(conta.id,t.id,i.id,v_party,cliente.external_id,cliente.id IS NULL,v_saldo,v_venc,v_forma,v_ref||':'||left(md5(v_key),8),v_key,v_hash,conta.modo_execucao='simulado',_actor,v_parc,v_acr) RETURNING id INTO v_id;
 INSERT INTO public.asaas_charge_intent_events(intent_id,de,para,detalhe,actor_id) VALUES(v_id,NULL,'preparada',jsonb_build_object('valor_cents',v_saldo,'parcelas_cartao',v_parc,'acrescimo_cartao_cents',v_acr),_actor);
 PERFORM set_config('lardann.asaas_intent','off',true);
 RETURN jsonb_build_object('id',v_id,'account_id',conta.id,'state','preparada','internal_reference',v_ref||':'||left(md5(v_key),8));
END $function$;

CREATE OR REPLACE FUNCTION public.asaas_exec_reservar(_intent uuid, _worker text, _actor uuid, _lease_segundos integer DEFAULT 120, _agora timestamp with time zone DEFAULT NULL::timestamp with time zone, _timeout_req integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'internal_reference', it.internal_reference, 'external_id', it.external_id,
    'parcelas_cartao', it.parcelas_cartao, 'acrescimo_cartao_cents', it.acrescimo_cartao_cents);
END $function$;

CREATE OR REPLACE FUNCTION public.asaas_exec_resultado(_intent uuid, _worker text, _tentativa integer, _actor uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE it public.asaas_charge_intents; res text; fase text; v_ext text; v_url text;
        v_charge uuid; v_saldo bigint; outro record; de text; aviso_url text;
        v_parc_ext text; irma jsonb; v_iext text; v_iurl text; v_icid uuid; o2 record; v_soma bigint;
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
      VALUES (it.account_id, v_ext, it.customer_external_id,
              -- 0329: no cartão parcelado esta é a 1ª parcela; o valor vem do Asaas
              CASE WHEN it.parcelas_cartao > 1 THEN coalesce(nullif(_payload->>'valor_cents','')::bigint, it.value_cents) ELSE it.value_cents END,
              CASE WHEN it.parcelas_cartao > 1 THEN coalesce(nullif(_payload->>'vencimento','')::date, it.due_date) ELSE it.due_date END,
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

    -- 0329: cartão parcelado — cada parcela do Asaas vira uma cobrança ligada à mesma parcela do Lardan
    IF it.parcelas_cartao > 1 THEN
      v_parc_ext := nullif(btrim(coalesce(_payload->>'parcelamento','')),'');
      IF v_parc_ext IS NULL THEN
        aviso_url := concat_ws(' ', aviso_url, 'Parcelamento sem identificador: parcelas seguintes ficam para conciliação.');
      ELSE
        PERFORM set_config('lardann.asaas_link','on', true);
        UPDATE public.asaas_charges SET installment_external_id = v_parc_ext, installment_count = it.parcelas_cartao,
               installment_number = coalesce(nullif(_payload->>'parcela_numero','')::int, 1)
         WHERE id = v_charge AND installment_external_id IS NULL;
        FOR irma IN SELECT x FROM jsonb_array_elements(coalesce(_payload->'irmas','[]'::jsonb)) x LOOP
          v_iext := nullif(btrim(coalesce(irma->>'external_id','')),'');
          CONTINUE WHEN v_iext IS NULL OR v_iext = v_ext;
          IF NOT public.asaas_external_id_valido(it.account_id, v_iext) THEN
            aviso_url := concat_ws(' ', aviso_url, 'Parcela ' || v_iext || ' com identificador inválido: não registrada.');
            CONTINUE;
          END IF;
          v_iurl := nullif(btrim(coalesce(irma->>'invoice_url','')),'');
          IF v_iurl IS NOT NULL AND NOT public.asaas_fatura_url_valida(it.account_id, v_iext, v_iurl) THEN v_iurl := NULL; END IF;
          PERFORM set_config('lardann.asaas_link','on', true);  -- asaas_vincular_interno desliga ao terminar
          SELECT * INTO o2 FROM public.asaas_charges WHERE account_id = it.account_id AND external_id = v_iext;
          IF o2.id IS NOT NULL AND o2.installment_id IS NOT NULL AND o2.installment_id <> it.installment_id THEN
            aviso_url := concat_ws(' ', aviso_url, 'Parcela ' || v_iext || ' já ligada a outra parcela: conciliar.');
            CONTINUE;
          END IF;
          IF o2.id IS NULL THEN
            INSERT INTO public.asaas_charges
              (account_id, external_id, customer_external_id, value_cents, due_date, billing_type,
               external_status, party_id, reconcile_status, raw, invoice_url, installment_external_id, installment_number, installment_count)
            VALUES (it.account_id, v_iext, it.customer_external_id, (irma->>'valor_cents')::bigint, (irma->>'vencimento')::date,
                    it.billing_type, coalesce(nullif(irma->>'status',''),'PENDING'), it.party_id, 'pendente', '{}'::jsonb, v_iurl,
                    v_parc_ext, nullif(irma->>'parcela_numero','')::int, it.parcelas_cartao)
            RETURNING id INTO v_icid;
          ELSE
            v_icid := o2.id;
            UPDATE public.asaas_charges SET installment_external_id = coalesce(installment_external_id, v_parc_ext),
                   installment_number = coalesce(installment_number, nullif(irma->>'parcela_numero','')::int),
                   installment_count = coalesce(installment_count, it.parcelas_cartao)
             WHERE id = v_icid;
          END IF;
          PERFORM public.asaas_vincular_interno(v_icid, it.title_id, it.installment_id,
            'Parcela do cartão (parcelamento preparado pela Lardan)', _actor);
        END LOOP;
        PERFORM set_config('lardann.asaas_link','on', true);
        -- a taxa paga pela cliente é dividida entre as parcelas, na proporção do valor (soma = acréscimo da intenção)
        IF it.acrescimo_cartao_cents > 0 THEN
          WITH pl AS (
            SELECT id, value_cents, sum(value_cents) OVER () tot,
                   row_number() OVER (ORDER BY installment_number DESC NULLS LAST, external_id DESC) rn
              FROM public.asaas_charges
             WHERE account_id = it.account_id AND installment_external_id = v_parc_ext AND installment_id = it.installment_id
          ), parte AS (
            SELECT id, rn, floor(it.acrescimo_cartao_cents * value_cents::numeric / nullif(tot,0))::bigint v FROM pl
          )
          UPDATE public.asaas_charges c
             SET acrescimo_cartao_cents = CASE WHEN p.rn = 1
                   THEN it.acrescimo_cartao_cents - (SELECT coalesce(sum(p2.v),0) FROM parte p2 WHERE p2.rn > 1)
                   ELSE p.v END
            FROM parte p WHERE c.id = p.id;
        END IF;
        PERFORM set_config('lardann.asaas_link','off', true);
        SELECT sum(value_cents) INTO v_soma FROM public.asaas_charges
         WHERE account_id = it.account_id AND installment_external_id = v_parc_ext AND installment_id = it.installment_id;
        IF v_soma IS DISTINCT FROM it.value_cents + it.acrescimo_cartao_cents THEN
          aviso_url := concat_ws(' ', aviso_url, 'Soma das parcelas do Asaas (' || coalesce(v_soma,0) || ') difere do esperado ('
                       || (it.value_cents + it.acrescimo_cartao_cents) || '): conferir.');
        END IF;
      END IF;
    END IF;
    v_url := coalesce(v_url, outro.invoice_url);

    v_saldo := public.fin_installment_saldo(it.installment_id);
    IF it.acordo_simulacao_id IS NULL AND v_saldo IS DISTINCT FROM it.value_cents THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.asaas_baixa_automatica(_charge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; conta uuid; conta_cartao uuid; destino uuid; parcela uuid; saldo bigint; valor bigint; tarifa bigint;
  extra bigint := 0; explicado bigint; juros bigint := 0; cartao boolean := false; transf jsonb := null;
  dia date; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb; chave text; lim_tol bigint; tolerancia boolean := false; acr bigint := 0;
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
  -- 0329: parte da taxa do cartão parcelado paga pela cliente: entra como juros nesta mesma baixa
  acr := greatest(coalesce(c.acrescimo_cartao_cents, 0), 0);
  saldo := saldo + acr;
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
  juros := juros + acr;
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
      'observacao', CASE WHEN acr > 0 AND juros = acr THEN 'Baixa automática: recebimento confirmado pelo Asaas (com a taxa do cartão parcelado, paga pela cliente)'
                         WHEN tolerancia THEN 'Baixa automática: recebimento confirmado pelo Asaas (diferença paga a mais lançada como juros, dentro do limite automático)'
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

CREATE OR REPLACE FUNCTION public.asaas_saldo_plano(_inst uuid, _forcar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT c.id, c.external_id, c.value_cents, c.acrescimo_cartao_cents, c.due_date, c.billing_type, c.external_status, c.account_id,
           EXISTS (SELECT 1 FROM public.asaas_charge_intents x WHERE x.acordo_simulacao_id IS NOT NULL
                    AND (x.charge_id = c.id OR (x.account_id = c.account_id AND x.external_id = c.external_id))) acordo
      FROM public.asaas_charges c
     WHERE c.external_status IN ('PENDING','OVERDUE')
       AND (c.installment_id = _inst OR (c.installment_id IS NULL AND EXISTS (
              SELECT 1 FROM public.asaas_charge_matches m WHERE m.charge_id = c.id AND m.status = 'confirmado' AND m.installment_id = _inst)))
       AND NOT EXISTS (SELECT 1 FROM public.asaas_baixas_outra_forma b WHERE b.charge_id = c.id)
     ORDER BY c.due_date, c.external_id
  LOOP
    v_n := v_n + 1; v_aberto := v_aberto + r.value_cents - coalesce(r.acrescimo_cartao_cents, 0); v_acordo := v_acordo OR r.acordo; v_conta := coalesce(v_conta, r.account_id);
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
        -- 0312: vários cadastros com principal definido contam como um (a nova cobrança sai no principal)
        IF v_clientes > 1 AND public.asaas_cliente_principal_id(v_conta, v_party) IS NOT NULL THEN v_clientes := 1; END IF;
        IF v_clientes <> 1 THEN v_acao := 'excecao'; v_motivo := CASE WHEN v_clientes = 0 THEN 'cliente_sem_vinculo' ELSE 'cliente_duplicado' END; END IF;
      END IF;
    END IF;
  END IF;
  -- 0309: cobrança aberta maior que o saldo e a nova não pode nascer sozinha: cancela a antiga mesmo assim;
  -- a parcela volta como exceção ("reabrir") para a equipe gerar a nova pela tela.
  IF v_acao = 'excecao' AND v_aberto > v_efetivo AND v_n = 1 AND NOT v_em_acordo
     AND v_motivo IN ('cliente_sem_vinculo','cliente_duplicado','conta_asaas','titulo_nao_aprovado','cliente_judicial') THEN
    v_acao := 'cancelar'; v_motivo := 'baixa_parcial_sem_reemissao';
  END IF;
  IF v_acao IN ('cancelar','excecao') THEN v_valor := CASE WHEN v_acao='excecao' THEN v_valor ELSE NULL END; END IF;
  IF v_acao = 'cancelar' THEN v_venc := NULL; v_billing := NULL; END IF;

  RETURN jsonb_build_object('acao', v_acao, 'motivo', v_motivo, 'saldo_cents', v_efetivo, 'aberto_cents', v_aberto, 'n', v_n,
    'cobrancas', v_cobr, 'novo_valor_cents', v_valor, 'novo_vencimento', v_venc, 'novo_billing_type', v_billing,
    'impressao', v_impr, 'account_id', v_conta, 'party_id', v_party, 'title_id', t.id);
END $function$;

CREATE OR REPLACE FUNCTION public.asaas_saldo_varrer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; n int := 0; p jsonb; v_id uuid; ult record;
BEGIN
  UPDATE public.asaas_espelho_pedidos pe SET atendido_em = now(), resultado = s.estado, updated_at = now()
    FROM public.asaas_saldo_sync s
   WHERE pe.atendido_em IS NULL AND pe.job_id = s.id AND s.estado IN ('concluida','ignorada','superada');
  FOR r IN
    WITH ch AS (
      SELECT coalesce(c.installment_id, (SELECT m.installment_id FROM public.asaas_charge_matches m
               WHERE m.charge_id = c.id AND m.status = 'confirmado' AND m.installment_id IS NOT NULL
               ORDER BY m.decidido_em DESC NULLS LAST LIMIT 1)) inst, c.value_cents - coalesce(c.acrescimo_cartao_cents, 0) AS value_cents
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
           coalesce((SELECT sum(c.value_cents - coalesce(c.acrescimo_cartao_cents, 0)) FROM public.asaas_charges c WHERE c.installment_id = s.installment_id
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