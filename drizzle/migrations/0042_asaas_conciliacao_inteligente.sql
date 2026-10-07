
-- 1) Cadastro automático de clientes do Asaas que não existem no Lardan (somente com CPF/CNPJ válido em tamanho)
CREATE OR REPLACE FUNCTION public.asaas_clientes_cadastrar(_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cu record; d text; pid uuid; novos int := 0; ligados int := 0;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  FOR cu IN SELECT * FROM asaas_customers WHERE party_id IS NULL AND length(regexp_replace(coalesce(doc,''),'\D','','g')) IN (11,14) LOOP
    d := regexp_replace(cu.doc,'\D','','g');
    SELECT min(id::text)::uuid INTO pid FROM parties WHERE doc_digits = d HAVING count(*) = 1;
    IF pid IS NULL AND NOT EXISTS (SELECT 1 FROM parties WHERE doc_digits = d) THEN
      INSERT INTO parties(kind, display_name, legal_name, doc, doc_digits, status, notes, created_by)
      VALUES (CASE WHEN length(d)=14 THEN 'organizacao' ELSE 'pessoa' END::party_kind,
              coalesce(nullif(trim(cu.name),''),'Cliente Asaas '||cu.external_id), cu.name, d, d, 'ativo',
              'Cadastrado automaticamente a partir do cliente Asaas '||cu.external_id, _actor)
      RETURNING id INTO pid;
      INSERT INTO party_roles(party_id, role, status, notes, created_by)
      VALUES (pid, 'cliente', 'ativo', 'Origem: cobrança Asaas', _actor);
      novos := novos + 1;
      INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
      VALUES (_actor,'asaas.cliente.cadastro_automatico','parties',pid, jsonb_build_object('asaas_customer', cu.external_id));
    END IF;
    IF pid IS NOT NULL THEN
      UPDATE asaas_customers SET party_id = pid, match_status = coalesce(match_status,'vinculado'), updated_at = now() WHERE id = cu.id;
      UPDATE asaas_charges SET party_id = pid WHERE party_id IS NULL AND account_id = cu.account_id AND customer_external_id = cu.external_id;
      ligados := ligados + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('novos', novos, 'ligados', ligados);
END $$;
REVOKE ALL ON FUNCTION public.asaas_clientes_cadastrar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_clientes_cadastrar(uuid) TO authenticated, service_role;

-- 2) Concilia UMA cobrança: mesma pessoa + saldo em aberto igual ao valor (vencimento não importa); desempate pela parcela mais antiga
CREATE OR REPLACE FUNCTION public.asaas_conciliar_cobranca(_charge uuid, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; pid uuid; inst uuid; tit uuid; n int; b jsonb := null;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  SELECT * INTO c FROM asaas_charges WHERE id = _charge;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok',false,'motivo','inexistente'); END IF;
  IF c.installment_id IS NOT NULL THEN
    IF c.external_status IN ('RECEIVED') THEN b := asaas_baixa_automatica(c.id); END IF;
    RETURN jsonb_build_object('ok',true,'ja_vinculada',true,'baixa',b);
  END IF;
  IF c.external_status NOT IN ('PENDING','OVERDUE','RECEIVED','DUNNING_REQUESTED') THEN
    RETURN jsonb_build_object('ok',false,'motivo','situacao_'||c.external_status);
  END IF;
  pid := c.party_id;
  IF pid IS NULL THEN
    SELECT coalesce(cu.party_id, (SELECT min(p.id::text)::uuid FROM parties p
             WHERE length(regexp_replace(coalesce(cu.doc,''),'\D','','g'))>=11 AND p.doc_digits = regexp_replace(cu.doc,'\D','','g') HAVING count(*)=1))
      INTO pid FROM asaas_customers cu WHERE cu.account_id=c.account_id AND cu.external_id=c.customer_external_id;
  END IF;
  IF pid IS NULL THEN RETURN jsonb_build_object('ok',false,'motivo','sem_cliente'); END IF;

  SELECT i.id, i.title_id, count(*) OVER () INTO inst, tit, n
    FROM financial_installments i JOIN financial_titles t ON t.id=i.title_id
   WHERE t.direction='receivable' AND t.status='ativo' AND t.party_id = pid
     AND public.fin_installment_saldo(i.id) = c.value_cents
     AND NOT EXISTS (SELECT 1 FROM asaas_charges x WHERE x.installment_id=i.id AND x.external_status<>'DELETED')
   ORDER BY i.vencimento, i.numero LIMIT 1;
  IF inst IS NULL THEN RETURN jsonb_build_object('ok',false,'motivo','sem_parcela_mesmo_valor','party_id',pid); END IF;

  PERFORM asaas_vincular_interno(c.id, tit, inst,
    CASE WHEN n=1 THEN 'Conciliação automática: mesma pessoa e mesmo valor em aberto (casamento único)'
         ELSE 'Conciliação automática: mesma pessoa e mesmo valor; '||n||' parcelas iguais, escolhida a mais antiga' END, _actor);
  IF c.external_status = 'RECEIVED' THEN b := asaas_baixa_automatica(c.id); END IF;
  RETURN jsonb_build_object('ok',true,'installment_id',inst,'title_id',tit,'candidatas',n,'baixa',b);
END $$;
REVOKE ALL ON FUNCTION public.asaas_conciliar_cobranca(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_conciliar_cobranca(uuid, uuid) TO authenticated, service_role;

-- 3) Rotina geral (mesma assinatura): cadastra clientes, concilia uma a uma (recebidas primeiro, mais antigas primeiro), baixa pendentes
CREATE OR REPLACE FUNCTION public.asaas_conciliacao_automatica(_actor uuid, _executar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; res jsonb; vinc int := 0; baixas int := 0; sem int := 0; cad jsonb := '{}'; pend jsonb;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN
    RAISE EXCEPTION 'Sem permissão para conciliar.';
  END IF;
  IF NOT _executar THEN
    RETURN jsonb_build_object('executado',false,'pendentes',
      (SELECT count(*) FROM asaas_charges WHERE installment_id IS NULL AND title_id IS NULL AND external_status='RECEIVED'));
  END IF;
  cad := asaas_clientes_cadastrar(_actor);
  FOR r IN SELECT id FROM asaas_charges WHERE installment_id IS NULL AND title_id IS NULL
             AND external_status IN ('PENDING','OVERDUE','RECEIVED','DUNNING_REQUESTED')
           ORDER BY (external_status='RECEIVED') DESC, coalesce(payment_date, due_date) LOOP
    res := asaas_conciliar_cobranca(r.id, _actor);
    IF (res->>'ok')::boolean THEN vinc := vinc+1;
      IF coalesce((res->'baixa'->>'baixa')::boolean,false) THEN baixas := baixas+1; END IF;
    ELSE sem := sem+1; END IF;
  END LOOP;
  pend := asaas_baixa_pendentes(true);
  baixas := baixas + coalesce((pend->>'baixadas')::int,0);
  INSERT INTO audit_logs(actor_id, action, entity, payload)
  VALUES (_actor,'asaas.conciliacao_automatica','asaas_charges',
          jsonb_build_object('vinculadas',vinc,'sem_par',sem,'baixas',baixas,'clientes',cad));
  RETURN jsonb_build_object('executado',true,'vinculadas',vinc,'ambiguas',0,'sem_par',sem,'baixas',baixas,'clientes',cad);
END $$;

-- 4) Mesa: dinheiro que caiu no Asaas sem título
CREATE OR REPLACE FUNCTION public.asaas_mesa_pendentes(_busca text DEFAULT NULL, _offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  WITH base AS (
    SELECT c.id, c.external_id, c.value_cents, coalesce(c.net_value_cents, c.value_cents - coalesce(c.fee_cents,0)) liquido_cents,
           c.payment_date, c.due_date, c.billing_type, c.party_id,
           coalesce(p.display_name, cu.name) nome,
           CASE WHEN length(regexp_replace(coalesce(cu.doc,''),'\D','','g'))=11
                THEN '***.'||substr(regexp_replace(cu.doc,'\D','','g'),4,3)||'.'||substr(regexp_replace(cu.doc,'\D','','g'),7,3)||'-**'
                ELSE cu.doc END doc,
           c.raw->>'description' descricao
      FROM asaas_charges c
      LEFT JOIN asaas_customers cu ON cu.account_id=c.account_id AND cu.external_id=c.customer_external_id
      LEFT JOIN parties p ON p.id=c.party_id
     WHERE c.external_status='RECEIVED' AND c.installment_id IS NULL AND c.title_id IS NULL
       AND (_busca IS NULL OR _busca='' OR coalesce(p.display_name,cu.name,'') ILIKE '%'||_busca||'%'
            OR c.external_id ILIKE '%'||_busca||'%' OR regexp_replace(coalesce(cu.doc,''),'\D','','g') LIKE '%'||regexp_replace(_busca,'\D','','g')||'%' AND length(regexp_replace(_busca,'\D','','g'))>=3)
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM base),'soma_cents',(SELECT coalesce(sum(value_cents),0) FROM base),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.payment_date DESC NULLS LAST) FROM
       (SELECT * FROM base ORDER BY payment_date DESC NULLS LAST LIMIT 50 OFFSET greatest(_offset,0)) b),'[]'))
    INTO res;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.asaas_mesa_pendentes(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_mesa_pendentes(text,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.asaas_mesa_candidatas(_charge uuid, _busca text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  SELECT * INTO c FROM asaas_charges WHERE id=_charge;
  RETURN coalesce((SELECT jsonb_agg(x) FROM (
    SELECT i.id installment_id, t.id title_id, t.numero, t.descricao, p.display_name nome, i.numero parcela,
           i.vencimento, i.valor_cents, public.fin_installment_saldo(i.id) saldo_cents, (t.party_id = c.party_id) mesma_pessoa
      FROM financial_installments i JOIN financial_titles t ON t.id=i.title_id LEFT JOIN parties p ON p.id=t.party_id
     WHERE t.direction='receivable' AND t.status='ativo' AND public.fin_installment_saldo(i.id) > 0
       AND NOT EXISTS (SELECT 1 FROM asaas_charges x WHERE x.installment_id=i.id AND x.external_status<>'DELETED')
       AND ( (coalesce(_busca,'')='' AND t.party_id = c.party_id)
          OR (coalesce(_busca,'')<>'' AND (p.display_name ILIKE '%'||_busca||'%' OR t.numero ILIKE '%'||_busca||'%' OR t.descricao ILIKE '%'||_busca||'%')) )
     ORDER BY (t.party_id = c.party_id) DESC, abs(public.fin_installment_saldo(i.id) - c.value_cents), i.vencimento
     LIMIT 30) x), '[]');
END $$;
REVOKE ALL ON FUNCTION public.asaas_mesa_candidatas(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_mesa_candidatas(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.asaas_mesa_vincular(_charge uuid, _installment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE tit uuid;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN RAISE EXCEPTION 'Sem permissão para dar baixa.'; END IF;
  SELECT title_id INTO tit FROM financial_installments WHERE id=_installment;
  IF tit IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM asaas_charges WHERE installment_id=_installment AND id<>_charge AND external_status<>'DELETED') THEN
    RAISE EXCEPTION 'Esta parcela já tem outra cobrança Asaas.';
  END IF;
  PERFORM asaas_vincular_interno(_charge, tit, _installment, 'Mesa de conciliação Asaas: vínculo escolhido manualmente', auth.uid());
  RETURN asaas_baixa_automatica(_charge);
END $$;
REVOKE ALL ON FUNCTION public.asaas_mesa_vincular(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_mesa_vincular(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.asaas_mesa_novo_titulo(_charge uuid, _descricao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; tit uuid; inst uuid; conta uuid; ext text;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN RAISE EXCEPTION 'Sem permissão para dar baixa.'; END IF;
  SELECT * INTO c FROM asaas_charges WHERE id=_charge FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança inexistente.'; END IF;
  IF c.installment_id IS NOT NULL THEN RAISE EXCEPTION 'Cobrança já vinculada.'; END IF;
  IF c.party_id IS NULL THEN RAISE EXCEPTION 'Cobrança sem cliente identificado: cadastre a pessoa antes.'; END IF;
  SELECT financial_account_id INTO conta FROM asaas_accounts WHERE id=c.account_id;
  ext := 'asaas:'||c.external_id;
  SELECT id INTO tit FROM financial_titles WHERE sistema_origem='asaas' AND id_externo=ext;
  IF tit IS NULL THEN
    tit := fin_title_create(jsonb_build_object(
      'direction','receivable','party_id',c.party_id,
      'descricao', coalesce(nullif(_descricao,''), nullif(c.raw->>'description',''), 'Recebimento Asaas '||c.external_id),
      'documento', c.external_id, 'emissao', coalesce(c.payment_date, c.due_date)::text,
      'competencia', coalesce(c.payment_date, c.due_date)::text, 'financial_account_id', conta,
      'valor_cents', c.value_cents, 'status','ativo','origem','conciliacao','sistema_origem','asaas','id_externo',ext,
      'observacao','Criado na mesa de conciliação Asaas',
      'parcelas', jsonb_build_array(jsonb_build_object('vencimento', coalesce(c.due_date,c.payment_date)::text,'valor_cents',c.value_cents))));
  END IF;
  SELECT id INTO inst FROM financial_installments WHERE title_id=tit ORDER BY numero LIMIT 1;
  PERFORM asaas_vincular_interno(_charge, tit, inst, 'Mesa de conciliação Asaas: título novo criado para o recebimento', auth.uid());
  RETURN asaas_baixa_automatica(_charge) || jsonb_build_object('title_id', tit);
END $$;
REVOKE ALL ON FUNCTION public.asaas_mesa_novo_titulo(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_mesa_novo_titulo(uuid,text) TO authenticated;
