-- 0084 — Correções de segurança e cobrança (auditoria 16/10/2026)
-- Aditiva: só CREATE OR REPLACE de rotinas existentes (mesmas assinaturas), REVOKE e 1 coluna nova opcional.
-- Itens: privacidade do representante, reativação indevida, CPF de terceiros na cobrança da consultora,
-- leituras sem login, custo exposto, juros/multa e cartão na baixa automática do Asaas.

-- 1) Representante não assume nem abre consultora bloqueada/desligada de outra carteira
CREATE OR REPLACE FUNCTION public.rep_pode_assumir(_party uuid, _rep uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.rep_portal_pode(_rep) AND (
    public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro','cobranca']::public.app_role[])
    OR (
      -- bloqueada ou desligada nunca muda de carteira pelo portal: decisão do financeiro
      NOT EXISTS (SELECT 1 FROM public.parties p WHERE p.id=_party AND p.status::text IN ('bloqueado','desligado'))
      AND NOT EXISTS (SELECT 1 FROM public.consultant_profiles c JOIN public.parties p ON p.id=c.party_id
                   WHERE c.party_id=_party AND c.representative_party_id IS NOT NULL AND c.representative_party_id<>_rep AND p.status='ativo')))
$function$;

-- 2) Ficha fora da carteira: só nome, código, cidade e débitos (para poder cobrar e assumir)
CREATE OR REPLACE FUNCTION public.rep_consultora_ficha_rep(_party uuid, _rep uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE dono uuid; restrito boolean; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  SELECT representative_party_id INTO dono FROM public.consultant_profiles WHERE party_id=_party;
  IF coalesce(dono<>_rep,true) AND NOT public.rep_pode_assumir(_party,_rep) THEN RAISE EXCEPTION 'Consultora ativa na carteira de outro representante.'; END IF;
  -- Fora da própria carteira (e sem papel de gestão): nada de contato, endereço, cheques ou maletas.
  restrito := coalesce(dono<>_rep,true)
    AND NOT public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro','cobranca']::public.app_role[]);
  WITH ab AS (
    SELECT i.id installment_id, t.numero, i.vencimento,
      i.valor_cents - coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a WHERE a.installment_id=i.id),0) saldo_cents
    FROM public.financial_titles t JOIN public.financial_installments i ON i.title_id=t.id
    WHERE t.party_id=_party AND t.direction='receivable' AND t.status='ativo')
  SELECT jsonb_build_object(
    'id',p.id,'code',p.code,'nome',p.display_name,'status',p.status::text,'doc_masked',p.doc_masked,'rep',dono,
    'restrito',restrito,'na_carteira',coalesce(dono=_rep,false),'rep_nome',(SELECT display_name FROM public.parties WHERE id=dono),
    'contatos',CASE WHEN restrito THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('kind',cp.kind::text,'value',cp.value)) FROM public.contact_points cp WHERE cp.party_id=p.id),'[]'::jsonb) END,
    'endereco',CASE WHEN restrito THEN NULL::jsonb ELSE (SELECT jsonb_build_object('rua',a.street,'numero',a.street_number,'complemento',a.complement,'bairro',a.district,'cidade',a.city,'uf',a.uf,'cep',a.postal_code,'referencia',a.reference)
                FROM public.party_addresses a WHERE a.party_id=p.id ORDER BY a.is_primary DESC NULLS LAST LIMIT 1) END,
    'parcelas',coalesce((SELECT jsonb_agg(jsonb_build_object('installment_id',ab.installment_id,'numero',ab.numero,'vencimento',ab.vencimento,'saldo_cents',ab.saldo_cents,
                 'party_id',p.id,'display_name',p.display_name,'code',p.code) ORDER BY ab.vencimento) FROM ab WHERE ab.saldo_cents>0),'[]'::jsonb),
    'aberto_cents',coalesce((SELECT sum(saldo_cents) FROM ab WHERE saldo_cents>0),0),
    'vencido_cents',coalesce((SELECT sum(saldo_cents) FROM ab WHERE saldo_cents>0 AND vencimento<hoje),0),
    'maletas',CASE WHEN restrito THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('status',k.status::text,'desde',k.created_at) ORDER BY k.created_at DESC)
                FROM public.kit_cycles k WHERE k.consultora_party_id=p.id AND k.status::text NOT IN ('encerrada','cancelada')),'[]'::jsonb) END,
    'cheques',CASE WHEN restrito THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('numero',c.numero,'valor_cents',c.valor_cents,'bom_para',c.bom_para,'status',c.status) ORDER BY c.bom_para DESC)
                FROM public.fin_cheques c WHERE c.recebido_de_party_id=p.id),'[]'::jsonb) END) INTO r FROM public.parties p WHERE p.id=_party;
  RETURN r;
END $function$;

-- 3) Cobrança/cheque do representante não reativa bloqueada nem desligada
CREATE OR REPLACE FUNCTION public.rep_reativar_interno(_party uuid, _actor uuid, _motivo text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.parties SET status='ativo', is_active=true, updated_at=now() WHERE id=_party AND status::text = 'inativo';  -- bloqueada/desligada só pelo financeiro
  IF FOUND THEN
    INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
    VALUES (_actor,'consultora.reativada_representante','parties',_party::text,jsonb_build_object('motivo',_motivo));
    RETURN true;
  END IF;
  IF EXISTS (SELECT 1 FROM public.parties WHERE id=_party AND status::text IN ('bloqueado','desligado')) THEN
    INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
    VALUES (_actor,'consultora.reativacao_recusada','parties',_party::text,
            jsonb_build_object('motivo',_motivo,'aviso','Consultora bloqueada/desligada: status mantido; decisão do financeiro.'));
  END IF;
  RETURN false;
END $function$;
-- 4) Consultora não cobra no CPF de consultora/representante/colaborador nem com nome que não confere; ator real auditado
CREATE OR REPLACE FUNCTION public.consultora_pagamento_titulo(_order uuid, _forma text, _doc text, _venc date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE eu uuid := public.my_party_id(); uid uuid := auth.uid(); o sales_orders; cfg consultora_cobranca_config;
  d text := regexp_replace(coalesce(_doc,''),'\D','','g'); party uuid; tid uuid; inst uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date; venc date; nome_c text; nome_cad text;
BEGIN
  IF uid IS NULL OR eu IS NULL OR NOT public.has_role(uid,'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  IF _forma NOT IN ('pix','cartao','depois') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id=_order AND consultora_party_id=eu FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status IN ('cancelado','concluido') THEN RAISE EXCEPTION 'Este pedido já foi encerrado.'; END IF;
  IF coalesce(o.subtotal_cents,0) <= 0 THEN RAISE EXCEPTION 'Pedido sem valor.'; END IF;
  SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
  IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
  IF o.pay_installment_id IS NOT NULL THEN
    IF o.pay_method IS DISTINCT FROM _forma THEN RAISE EXCEPTION 'Este pedido já tem uma cobrança gerada. Use a cobrança existente.'; END IF;
    RETURN jsonb_build_object('installment_id',o.pay_installment_id,'actor',cfg.ator_user_id,'forma',o.pay_method,'vencimento',o.pay_due_date);
  END IF;
  IF length(d) <> 11 OR NOT public.cpf_is_valid(d) THEN RAISE EXCEPTION 'CPF da cliente inválido. Confira os 11 números.'; END IF;
  venc := CASE WHEN _forma='depois' THEN coalesce(_venc, hoje + 7) ELSE hoje END;
  IF venc < hoje OR venc > hoje + 60 THEN RAISE EXCEPTION 'Escolha um vencimento entre hoje e 60 dias.'; END IF;
  SELECT display_name INTO nome_c FROM parties WHERE id=eu;
  IF d = (SELECT doc_digits FROM parties WHERE id=eu) THEN
    RAISE EXCEPTION 'Use o CPF da sua cliente, não o seu.';
  END IF;
  SELECT id, display_name INTO party, nome_cad FROM parties WHERE doc_digits=d AND is_active ORDER BY created_at LIMIT 1;
  IF party IS NOT NULL THEN
    -- CPF já cadastrado: só serve se for de uma CLIENTE (nunca consultora, representante, colaborador etc.)
    -- e se o primeiro nome conferir com o do pedido.
    IF EXISTS (SELECT 1 FROM party_roles pr WHERE pr.party_id=party AND pr.ended_at IS NULL AND pr.role::text <> 'cliente') THEN
      INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
      VALUES (uid,'consultora.cobranca_cpf_recusado','sales_orders',o.id::text,jsonb_build_object('motivo','cpf_de_cadastro_interno'));
      RAISE EXCEPTION 'Este CPF não pode ser usado nesta cobrança. Confira o CPF da cliente ou fale com o financeiro.';
    END IF;
    IF public.fin_unaccent_lower(split_part(btrim(coalesce(nome_cad,'')),' ',1))
       <> public.fin_unaccent_lower(split_part(btrim(coalesce(o.customer_name,'')),' ',1)) THEN
      INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
      VALUES (uid,'consultora.cobranca_cpf_recusado','sales_orders',o.id::text,jsonb_build_object('motivo','nome_nao_confere'));
      RAISE EXCEPTION 'Este CPF está cadastrado com outro nome (%***). Confira o CPF ou o nome da cliente no pedido.', left(coalesce(nome_cad,''),3);
    END IF;
  END IF;
  IF party IS NULL THEN
    INSERT INTO parties(kind,display_name,legal_name,doc,doc_digits,status,created_by)
    VALUES ('pessoa', o.customer_name, o.customer_name, d, d, 'ativo', uid) RETURNING id INTO party;
    INSERT INTO party_roles(party_id,role,created_by) VALUES (party,'cliente',uid);
  END IF;
  UPDATE sales_orders SET pay_method=_forma, pay_doc_masked='***.'||substr(d,4,3)||'.'||substr(d,7,3)||'-**', pay_due_date=venc, pay_party_id=party, payment_status='pendente' WHERE id=o.id;
  INSERT INTO sales_order_events(order_id,kind,to_status,actor_user_id,payload)
  VALUES (o.id,'pagamento.cobranca_lardan',o.status::text,uid,jsonb_build_object('forma',_forma,'vencimento',venc,'valor_cents',o.subtotal_cents));
  -- Assinatura técnica do financeiro; a cobrança sai em nome da Lardan.
  -- ator real: quem clicou fica registrado antes da assinatura técnica
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (uid,'consultora.cobranca_gerada','sales_orders',o.id::text,
          jsonb_build_object('ator_real',uid,'consultora',eu,'forma',_forma,'vencimento',venc,'valor_cents',o.subtotal_cents,'cliente',party));
  PERFORM public.pdv_como(cfg.ator_user_id);
  tid := public.fin_title_create(jsonb_build_object('direction','receivable','business_entity_id',cfg.business_entity_id,'party_id',party,
     'descricao','Pedido consultora '||o.code||' — '||coalesce(nome_c,'consultora'),'documento','PED-'||o.code,'emissao',hoje,'competencia',hoje,
     'valor_cents',o.subtotal_cents,'financial_account_id',cfg.financial_account_id,'origem','consultora','id_externo','pedido:'||o.id,'status','ativo',
     'parcelas',jsonb_build_array(jsonb_build_object('valor_cents',o.subtotal_cents,'vencimento',venc))));
  SELECT id INTO inst FROM financial_installments WHERE title_id=tid ORDER BY numero LIMIT 1;
  UPDATE sales_orders SET pay_title_id=tid, pay_installment_id=inst WHERE id=o.id;
  RETURN jsonb_build_object('installment_id',inst,'actor',cfg.ator_user_id,'forma',o.pay_method,'vencimento',venc);
END $function$;

-- 5) Sem login não se lê consultora pela maleta
CREATE OR REPLACE FUNCTION public.kit_consultora_info(_cycle uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'party_id', pa.id,
    'nome', pa.display_name,
    'praca', pr.nome,
    'cidade', (SELECT ad.city || '/' || ad.uf FROM party_addresses ad
                WHERE ad.party_id = pa.id ORDER BY ad.created_at LIMIT 1),
    'whatsapp', (SELECT ct.value FROM contact_points ct
                  WHERE ct.party_id = pa.id AND ct.kind = 'whatsapp'
                  ORDER BY ct.created_at LIMIT 1)
  )
  FROM kit_cycles kc
  JOIN parties pa ON pa.id = kc.consultora_party_id
  LEFT JOIN consultant_profiles cp ON cp.party_id = pa.id
  LEFT JOIN cob_pracas pr ON pr.id = cp.praca_id
  WHERE kc.id = _cycle
    AND public.kit_cycle_in_scope(kc.id);  -- a própria consultora, o representante da maleta e a equipe
$function$;
REVOKE ALL ON FUNCTION public.kit_consultora_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_consultora_info(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pracas_resumo()
 RETURNS TABLE(id uuid, codigo integer, nome text, ativo boolean, consultoras bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.codigo, p.nome, p.ativo,
         (SELECT count(*) FROM consultant_profiles cp JOIN parties pa ON pa.id = cp.party_id
          WHERE cp.praca_id = p.id AND pa.status NOT IN ('desligado','bloqueado')) AS consultoras
  FROM cob_pracas p
  WHERE public.is_staff(auth.uid())
  ORDER BY p.nome;
$function$;
REVOKE ALL ON FUNCTION public.pracas_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pracas_resumo() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pdv_membros_pin_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pdv_membros_pin_status(uuid) TO authenticated, service_role;

-- 6) Custo do estoque só para quem pode ver custo
CREATE OR REPLACE FUNCTION public.catalog_street_value()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'total_cents', coalesce(sum(coalesce(v.price_cents, p.price_cents, 0)), 0),
    'pecas', count(*),
    -- custo só para quem pode ver custo
    'custo_cents', CASE WHEN public.can_view_costs(auth.uid()) THEN coalesce(sum(coalesce(p.cost_price_cents, 0)), 0) END
  )
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.is_active and p.status <> 'arquivado';
$function$;

-- 8) Saldo da parcela igual ao da situação (fin_installment_refresh): juros/multa somam, desconto/abatimento subtraem.
--    Antes, a parcela com desconto aparecia "liquidada" mas com saldo > 0 para cobrança, Asaas e portal do representante.
CREATE OR REPLACE FUNCTION public.fin_installment_saldo(_installment uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT i.valor_cents
       + coalesce((SELECT sum(CASE WHEN j.kind IN ('juros','multa') THEN j.valor_cents
                                   WHEN j.kind IN ('desconto','abatimento') THEN -j.valor_cents
                                   ELSE 0 END)
                    FROM public.financial_adjustments j WHERE j.installment_id = i.id), 0)
       - coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a
                    WHERE a.installment_id = i.id), 0)
    FROM public.financial_installments i WHERE i.id = _installment
$function$;

-- 9) Transferência interna liberada só para o marcador da rotina do Asaas (mesmo padrão da baixa automática)
CREATE OR REPLACE FUNCTION public.fin_transfer_create(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_key text; v_ex financial_transfers%rowtype; v_valor bigint; v_data date; v_fp text;
begin
  -- a rotina interna do Asaas (crédito do cartão) usa o mesmo marcador da baixa automática
  if not (has_capability(auth.uid(),'finance.bank.manage')
          or coalesce(current_setting('lardan.baixa_asaas', true),'off') = 'on') then
    raise exception 'Sem permissão para transferir';
  end if;
  v_valor := (_payload->>'valor_cents')::bigint;
  if v_valor is null or v_valor <= 0 then raise exception 'Valor da transferência deve ser maior que zero'; end if;
  if (_payload->>'from_account_id') = (_payload->>'to_account_id') then
    raise exception 'Origem e destino da transferência precisam ser contas diferentes';
  end if;
  v_data := coalesce(nullif(_payload->>'data','')::date, current_date);
  v_key := nullif(_payload->>'idempotency_key','');
  v_fp := fin_fingerprint(jsonb_build_object('from',_payload->>'from_account_id','to',_payload->>'to_account_id',
            'data',v_data::text,'valor_cents',v_valor));
  if v_key is not null then
    select * into v_ex from financial_transfers where idempotency_key = v_key;
    if found then
      if v_ex.payload_fingerprint is not null and v_ex.payload_fingerprint <> v_fp then
        raise exception 'Colisão de chave de idempotência: a chave % já foi usada com outro conteúdo.', v_key
          using errcode = '23505';
      end if;
      return v_ex.id;
    end if;
  end if;
  insert into financial_transfers (from_account_id, to_account_id, data, valor_cents, referencia, motivo,
      idempotency_key, payload_fingerprint, created_by)
  values ((_payload->>'from_account_id')::uuid, (_payload->>'to_account_id')::uuid, v_data, v_valor,
      nullif(_payload->>'referencia',''), nullif(_payload->>'motivo',''), v_key, v_fp, auth.uid())
  returning id into v_id;
  insert into financial_account_movements (financial_account_id, kind, data, valor_cents, transfer_id, descricao, created_by)
  values ((_payload->>'from_account_id')::uuid, 'transferencia_saida', v_data, -v_valor, v_id, nullif(_payload->>'motivo',''), auth.uid()),
         ((_payload->>'to_account_id')::uuid, 'transferencia_entrada', v_data, v_valor, v_id, nullif(_payload->>'motivo',''), auth.uid());
  return v_id;
end $function$;
-- 7) Baixa automática do Asaas: juros/multa do Asaas e cartão pela conta "Cartão a receber"
ALTER TABLE public.asaas_accounts ADD COLUMN IF NOT EXISTS conta_cartao_receber_id uuid REFERENCES public.financial_accounts(id);
COMMENT ON COLUMN public.asaas_accounts.conta_cartao_receber_id IS
  'Conta de compensação para cartão: a baixa entra na data do pagamento e é transferida para a conta Asaas na data de crédito. Vazio = comportamento anterior.';
-- Transfere "Cartão a receber" -> conta Asaas quando o Asaas credita (RECEIVED com credit_date). Idempotente.
CREATE OR REPLACE FUNCTION public.asaas_cartao_creditar(_charge uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c record; conta uuid; conta_cartao uuid; s record; liquido bigint; chave text; dia date;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; t uuid;
BEGIN
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge;
  IF c.id IS NULL OR c.billing_type IS DISTINCT FROM 'CREDIT_CARD' THEN RETURN NULL; END IF;
  SELECT financial_account_id, conta_cartao_receber_id INTO conta, conta_cartao FROM public.asaas_accounts WHERE id = c.account_id;
  IF conta IS NULL OR conta_cartao IS NULL THEN RETURN NULL; END IF;
  IF c.external_status <> 'RECEIVED' OR c.credit_date IS NULL THEN
    RETURN jsonb_build_object('transferido', false, 'motivo', 'aguardando_credito');
  END IF;
  SELECT * INTO s FROM public.financial_settlements
   WHERE idempotency_key = 'asaas:baixa:' || c.account_id || ':' || c.external_id AND financial_account_id = conta_cartao;
  IF s.id IS NULL THEN RETURN jsonb_build_object('transferido', false, 'motivo', 'baixa_nao_esta_na_conta_cartao'); END IF;
  -- líquido que ficou na conta cartão por causa desta baixa (valor menos a tarifa lançada junto)
  SELECT coalesce(sum(valor_cents),0) INTO liquido FROM public.financial_account_movements
   WHERE settlement_id = s.id AND financial_account_id = conta_cartao;
  IF liquido <= 0 THEN RETURN jsonb_build_object('transferido', false, 'motivo', 'sem_valor'); END IF;
  chave := 'asaas:credito:' || c.account_id || ':' || c.external_id;
  dia := least(c.credit_date, hoje);
  PERFORM set_config('lardan.baixa_asaas', 'on', true);
  BEGIN
    t := public.fin_transfer_create(jsonb_build_object('from_account_id', conta_cartao, 'to_account_id', conta,
          'data', dia::text, 'valor_cents', liquido, 'idempotency_key', chave,
          'referencia', 'Asaas ' || c.external_id, 'motivo', 'Crédito do cartão na conta Asaas'));
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('lardan.baixa_asaas', 'off', true);
    RETURN jsonb_build_object('transferido', false, 'motivo', 'motor_recusou', 'erro', SQLERRM);
  END;
  PERFORM set_config('lardan.baixa_asaas', 'off', true);
  RETURN jsonb_build_object('transferido', true, 'transfer_id', t, 'valor_cents', liquido, 'data', dia);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_cartao_creditar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cartao_creditar(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_baixa_automatica(_charge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; conta uuid; conta_cartao uuid; destino uuid; parcela uuid; saldo bigint; valor bigint; tarifa bigint;
  extra bigint := 0; explicado bigint; juros bigint := 0; cartao boolean := false; transf jsonb := null;
  dia date; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb; chave text;
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
    transf := public.asaas_cartao_creditar(c.id);
    RETURN jsonb_build_object('baixa', false, 'motivo', 'ja_baixada_pelo_asaas', 'repetido', true, 'credito_cartao', transf);
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
      RETURN jsonb_build_object('baixa', false, 'motivo', 'valor_pago_maior_que_saldo', 'pago_cents', valor, 'saldo_cents', saldo);
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
      'observacao', CASE WHEN juros > 0 THEN 'Baixa automática: recebimento confirmado pelo Asaas (com juros/multa do Asaas)'
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
    'installment_id', parcela, 'valor_cents', valor, 'tarifa_cents', tarifa, 'data', dia);
END $function$;