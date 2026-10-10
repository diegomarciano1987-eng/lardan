-- Espelho operacional: o representante dono da carteira OU master/diretoria/financeiro/cobranca (rep_portal_pode) podem agir.
CREATE OR REPLACE FUNCTION public.rep_parcela_cobravel(_inst uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE dono uuid := public.rep_parcela_dono(_inst); saldo bigint;
BEGIN
  IF dono IS NULL OR NOT public.rep_portal_pode(dono) THEN RAISE EXCEPTION 'Parcela fora da sua carteira.'; END IF;
  saldo := public.fin_installment_saldo(_inst);
  IF coalesce(saldo,0) <= 0 THEN RAISE EXCEPTION 'Parcela já quitada.'; END IF;
  RETURN jsonb_build_object('rep',dono,'saldo_cents',saldo,'user',auth.uid());
END $fn$;

CREATE OR REPLACE FUNCTION public.rep_asaas_preparar(_actor uuid, _rep_user uuid, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE inst uuid := (_payload->>'installment_id')::uuid; rep uuid; cons uuid; dono uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.consultora_cobranca_config WHERE ator_user_id=_actor) THEN RAISE EXCEPTION 'Assinatura técnica inválida.'; END IF;
  dono := public.rep_parcela_dono(inst);
  SELECT party_id INTO rep FROM public.profiles WHERE id=_rep_user;
  IF dono IS NULL OR NOT (
       (rep = dono AND public.has_role(_rep_user,'representante'))
       OR public.has_any_role(_rep_user, ARRAY['master','diretoria','financeiro','cobranca']::public.app_role[])) THEN
    RAISE EXCEPTION 'Parcela fora da carteira do representante.';
  END IF;
  SELECT t.party_id INTO cons FROM public.financial_installments i JOIN public.financial_titles t ON t.id=i.title_id WHERE i.id=inst;
  PERFORM public.rep_reativar_interno(cons,_rep_user,'cobrança gerada pelo representante');
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (_rep_user,'representante.cobranca_solicitada','financial_installments',inst::text,_payload || jsonb_build_object('carteira',dono));
  PERFORM public.pdv_como(_actor);
  RETURN public.asaas_cobranca_preparar(_payload);
END $fn$;

CREATE OR REPLACE FUNCTION public.rep_cheque_registrar(_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE cons uuid := nullif(_payload->>'recebido_de_party_id','')::uuid; eu uuid; v_id uuid; nome text;
BEGIN
  SELECT representative_party_id INTO eu FROM public.consultant_profiles WHERE party_id=cons;
  IF cons IS NULL OR eu IS NULL OR NOT public.rep_portal_pode(eu) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.'; END IF;
  IF coalesce(trim(_payload->>'numero'),'')='' THEN RAISE EXCEPTION 'Informe o número do cheque'; END IF;
  IF coalesce(trim(_payload->>'emitente_nome'),'')='' THEN RAISE EXCEPTION 'Informe quem emitiu o cheque'; END IF;
  IF coalesce((_payload->>'valor_cents')::bigint,0)<=0 THEN RAISE EXCEPTION 'Valor do cheque deve ser maior que zero'; END IF;
  IF nullif(_payload->>'bom_para','') IS NULL THEN RAISE EXCEPTION 'Informe a data "bom para"'; END IF;
  SELECT display_name INTO nome FROM public.parties WHERE id=eu;
  INSERT INTO public.fin_cheques (numero,banco,agencia,conta,emitente_nome,emitente_doc,recebido_de_party_id,valor_cents,bom_para,recebido_em,observacao,created_by)
  VALUES (trim(_payload->>'numero'), nullif(trim(_payload->>'banco'),''), nullif(trim(_payload->>'agencia'),''), nullif(trim(_payload->>'conta'),''),
    trim(_payload->>'emitente_nome'), nullif(regexp_replace(coalesce(_payload->>'emitente_doc',''),'\D','','g'),''),
    cons, (_payload->>'valor_cents')::bigint, (_payload->>'bom_para')::date,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'Recebido pelo representante '||coalesce(nome,'')||coalesce(' · '||nullif(trim(_payload->>'observacao'),''),''), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.fin_cheque_eventos (cheque_id,de,para,motivo,created_by) VALUES (v_id,null,'em_maos','Cheque recebido pelo representante',auth.uid());
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload) VALUES (auth.uid(),'cheque.registrado_representante','fin_cheques',v_id::text,(_payload - 'emitente_doc') || jsonb_build_object('carteira',eu));
  PERFORM public.rep_reativar_interno(cons,auth.uid(),'cheque recebido pelo representante');
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Este cheque já está registrado (mesmo banco, agência, conta e número)';
END $fn$;

CREATE OR REPLACE FUNCTION public.rep_consultora_reativar(_party uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid;
BEGIN
  SELECT representative_party_id INTO eu FROM public.consultant_profiles WHERE party_id=_party;
  IF eu IS NULL OR NOT public.rep_portal_pode(eu) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.'; END IF;
  RETURN public.rep_reativar_interno(_party,auth.uid(),'reativada pelo representante');
END $fn$;

CREATE OR REPLACE FUNCTION public.rep_crm_mover(_lead uuid, _etapa uuid, _nota text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid;
BEGIN
  SELECT representante_party_id INTO eu FROM public.leads WHERE id=_lead;
  IF eu IS NULL OR NOT public.rep_portal_pode(eu) THEN RAISE EXCEPTION 'Candidatura fora da sua carteira.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rep_crm_etapas WHERE id=_etapa AND rep_party_id=eu) THEN RAISE EXCEPTION 'Etapa inválida.'; END IF;
  INSERT INTO public.rep_crm_cards(lead_id,rep_party_id,etapa_id,nota) VALUES (_lead,eu,_etapa,nullif(btrim(_nota),''))
  ON CONFLICT (lead_id) DO UPDATE SET etapa_id=EXCLUDED.etapa_id, nota=coalesce(EXCLUDED.nota,rep_crm_cards.nota), updated_at=now();
END $fn$;

CREATE OR REPLACE FUNCTION public.rep_crm_etapa_nova(_rep uuid, _nome text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v uuid;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  INSERT INTO public.rep_crm_etapas(rep_party_id,nome,ordem)
  VALUES (_rep,btrim(_nome),coalesce((SELECT max(ordem)+1 FROM public.rep_crm_etapas WHERE rep_party_id=_rep),1)) RETURNING id INTO v;
  RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_crm_etapa_nova(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_crm_etapa_nova(uuid,text) TO authenticated;

-- Candidata inserida manualmente no CRM do representante: entra para a Lardan como "novo" (decisão continua da Lardan).
CREATE OR REPLACE FUNCTION public.rep_crm_lead_criar(_rep uuid, _nome text, _whatsapp text, _cidade text, _uf text, _nota text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE w text := regexp_replace(coalesce(_whatsapp,''),'\D','','g'); v uuid; dono uuid; etapa uuid;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  IF length(btrim(coalesce(_nome,''))) < 3 THEN RAISE EXCEPTION 'Informe o nome completo.'; END IF;
  IF w LIKE '55%' AND length(w) > 11 THEN w := substr(w,3); END IF;
  IF length(w) NOT IN (10,11) THEN RAISE EXCEPTION 'WhatsApp inválido: use DDD + número.'; END IF;
  IF length(btrim(coalesce(_cidade,''))) < 2 OR length(btrim(coalesce(_uf,''))) <> 2 THEN RAISE EXCEPTION 'Informe cidade e UF.'; END IF;
  SELECT id, representante_party_id INTO v, dono FROM public.leads
   WHERE regexp_replace(whatsapp,'\D','','g') IN (w, '55'||w) AND status::text <> 'arquivado' ORDER BY created_at DESC LIMIT 1;
  IF v IS NOT NULL THEN
    IF dono IS NOT NULL AND dono <> _rep THEN RAISE EXCEPTION 'Esta candidata já está com outro representante. Fale com a Lardan.'; END IF;
    UPDATE public.leads SET representante_party_id=_rep, representante_origem=coalesce(representante_origem,'manual') WHERE id=v;
  ELSE
    INSERT INTO public.leads(full_name,whatsapp,city,uf,privacy_version,stage_id,representante_party_id,representante_origem,source_normalized)
    VALUES (btrim(_nome), w, btrim(_cidade), upper(btrim(_uf)), 'manual-representante',
      (SELECT id FROM public.candidatura_stages WHERE is_active ORDER BY is_initial DESC, sort_order LIMIT 1),
      _rep, 'manual', 'representante')
    RETURNING id INTO v;
  END IF;
  PERFORM public.rep_crm_etapas_garantir(_rep);
  SELECT id INTO etapa FROM public.rep_crm_etapas WHERE rep_party_id=_rep ORDER BY ordem LIMIT 1;
  INSERT INTO public.rep_crm_cards(lead_id,rep_party_id,etapa_id,nota) VALUES (v,_rep,etapa,nullif(btrim(_nota),''))
  ON CONFLICT (lead_id) DO UPDATE SET nota=coalesce(EXCLUDED.nota,rep_crm_cards.nota), updated_at=now();
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (auth.uid(),'candidatura.criada_representante','leads',v::text,jsonb_build_object('carteira',_rep));
  RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_crm_lead_criar(uuid,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_crm_lead_criar(uuid,text,text,text,text,text) TO authenticated;

-- Ficha da consultora vista pelo representante (CPF sempre mascarado).
CREATE OR REPLACE FUNCTION public.rep_consultora_ficha(_party uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  SELECT representative_party_id INTO eu FROM public.consultant_profiles WHERE party_id=_party;
  IF eu IS NULL OR NOT public.rep_portal_pode(eu) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.'; END IF;
  SELECT jsonb_build_object(
    'id',p.id,'code',p.code,'nome',p.display_name,'status',p.status::text,'doc_masked',p.doc_masked,'rep',eu,
    'contatos',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',cp.kind::text,'value',cp.value)) FROM public.contact_points cp WHERE cp.party_id=p.id),'[]'::jsonb),
    'endereco',(SELECT jsonb_build_object('rua',a.street,'numero',a.street_number,'complemento',a.complement,'bairro',a.district,'cidade',a.city,'uf',a.uf,'cep',a.postal_code,'referencia',a.reference)
                FROM public.party_addresses a WHERE a.party_id=p.id ORDER BY a.is_primary DESC NULLS LAST LIMIT 1),
    'parcelas',coalesce((SELECT jsonb_agg(jsonb_build_object('installment_id',ab.installment_id,'numero',ab.numero,'vencimento',ab.vencimento,'saldo_cents',ab.saldo_cents,
                 'party_id',p.id,'display_name',p.display_name,'code',p.code) ORDER BY ab.vencimento)
                FROM public.rep_portal_abertos(eu) ab WHERE ab.party_id=p.id),'[]'::jsonb),
    'aberto_cents',coalesce((SELECT sum(saldo_cents) FROM public.rep_portal_abertos(eu) WHERE party_id=p.id),0),
    'vencido_cents',coalesce((SELECT sum(saldo_cents) FROM public.rep_portal_abertos(eu) WHERE party_id=p.id AND vencimento<hoje),0),
    'cheques',coalesce((SELECT jsonb_agg(jsonb_build_object('numero',c.numero,'valor_cents',c.valor_cents,'bom_para',c.bom_para,'status',c.status) ORDER BY c.bom_para DESC)
                FROM public.fin_cheques c WHERE c.recebido_de_party_id=p.id),'[]'::jsonb)
  ) INTO r FROM public.parties p WHERE p.id=_party;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_consultora_ficha(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_consultora_ficha(uuid) TO authenticated;

-- Cobrança com valor digitado (ex.: acerto de maleta): cria um título a receber em nome da Lardan, idempotente pela chave.
CREATE OR REPLACE FUNCTION public.rep_cobranca_avulsa(_party uuid, _valor_cents bigint, _descricao text, _chave uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid; cfg consultora_cobranca_config; tid uuid; inst uuid; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; uid uuid := auth.uid(); nome_c text;
BEGIN
  SELECT representative_party_id INTO eu FROM public.consultant_profiles WHERE party_id=_party;
  IF eu IS NULL OR NOT public.rep_portal_pode(eu) THEN RAISE EXCEPTION 'Consultora fora da sua carteira.'; END IF;
  IF coalesce(_valor_cents,0) <= 0 THEN RAISE EXCEPTION 'Digite um valor maior que zero.'; END IF;
  IF _chave IS NULL THEN RAISE EXCEPTION 'Chave da cobrança ausente.'; END IF;
  SELECT i.id INTO inst FROM public.financial_titles t JOIN public.financial_installments i ON i.title_id=t.id
   WHERE t.id_externo='rep-avulsa:'||_chave ORDER BY i.numero LIMIT 1;
  IF inst IS NOT NULL THEN RETURN inst; END IF;
  SELECT * INTO cfg FROM public.consultora_cobranca_config LIMIT 1;
  IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
  SELECT display_name INTO nome_c FROM public.parties WHERE id=_party;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (uid,'representante.cobranca_avulsa','parties',_party::text,jsonb_build_object('valor_cents',_valor_cents,'descricao',_descricao,'carteira',eu,'chave',_chave));
  PERFORM public.pdv_como(cfg.ator_user_id);
  tid := public.fin_title_create(jsonb_build_object('direction','receivable','business_entity_id',cfg.business_entity_id,'party_id',_party,
     'descricao',coalesce(nullif(btrim(_descricao),''),'Acerto de maleta')||' — '||coalesce(nome_c,'consultora'),'documento','REP-'||left(_chave::text,8),
     'emissao',hoje,'competencia',hoje,'valor_cents',_valor_cents,'financial_account_id',cfg.financial_account_id,
     'origem','representante','id_externo','rep-avulsa:'||_chave,'status','ativo',
     'parcelas',jsonb_build_array(jsonb_build_object('valor_cents',_valor_cents,'vencimento',hoje))));
  SELECT id INTO inst FROM public.financial_installments WHERE title_id=tid ORDER BY numero LIMIT 1;
  RETURN inst;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_cobranca_avulsa(uuid,bigint,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_cobranca_avulsa(uuid,bigint,text,uuid) TO authenticated;

-- Cobranças com busca inteligente (nome sem acento, código, título). Assinatura única (sem sobrecarga).
DROP FUNCTION IF EXISTS public.rep_portal_cobrancas(uuid,text,int);
CREATE OR REPLACE FUNCTION public.rep_portal_cobrancas(_rep uuid, _filtro text DEFAULT 'vencidas', _pagina int DEFAULT 1, _busca text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb; termo text := nullif(btrim(coalesce(_busca,'')),'');
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  WITH base AS (
    SELECT ab.installment_id, ab.numero, ab.vencimento, ab.saldo_cents, p.id party_id, p.display_name, p.code
    FROM public.rep_portal_abertos(_rep) ab JOIN public.parties p ON p.id=ab.party_id
    WHERE (_filtro='todas' OR (_filtro='vencidas' AND ab.vencimento<hoje) OR (_filtro='hoje' AND ab.vencimento=hoje) OR (_filtro='a_vencer' AND ab.vencimento>hoje))
      AND (termo IS NULL OR (SELECT bool_and(public.fin_unaccent_lower(p.display_name||' '||coalesce(p.code,'')||' '||coalesce(ab.numero,'')) LIKE '%'||w||'%')
                             FROM unnest(string_to_array(public.fin_unaccent_lower(termo),' ')) w WHERE w<>'')))
  SELECT jsonb_build_object('total',(SELECT count(*) FROM base),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM base ORDER BY vencimento, display_name LIMIT 50 OFFSET (greatest(_pagina,1)-1)*50) x),'[]'::jsonb)) INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_portal_cobrancas(uuid,text,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_portal_cobrancas(uuid,text,int,text) TO authenticated;
NOTIFY pgrst, 'reload schema';