-- ===== Etapa 2: ações do representante (somente na própria carteira) =====
CREATE OR REPLACE FUNCTION public.rep_eu() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'representante') THEN public.my_party_id() END
$fn$;

CREATE OR REPLACE FUNCTION public.rep_parcela_dono(_inst uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT c.representative_party_id FROM public.financial_installments i
  JOIN public.financial_titles t ON t.id=i.title_id AND t.direction='receivable' AND t.status='ativo'
  JOIN public.consultant_profiles c ON c.party_id=t.party_id WHERE i.id=_inst
$fn$;
REVOKE ALL ON FUNCTION public.rep_parcela_dono(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_reativar_interno(_party uuid, _actor uuid, _motivo text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  UPDATE public.parties SET status='ativo', is_active=true, updated_at=now() WHERE id=_party AND status<>'ativo';
  IF FOUND THEN
    INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
    VALUES (_actor,'consultora.reativada_representante','parties',_party::text,jsonb_build_object('motivo',_motivo));
    RETURN true;
  END IF;
  RETURN false;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_reativar_interno(uuid,uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_parcela_cobravel(_inst uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid := public.rep_eu(); saldo bigint;
BEGIN
  IF eu IS NULL OR public.rep_parcela_dono(_inst) IS DISTINCT FROM eu THEN RAISE EXCEPTION 'Parcela fora da sua carteira.'; END IF;
  saldo := public.fin_installment_saldo(_inst);
  IF coalesce(saldo,0) <= 0 THEN RAISE EXCEPTION 'Parcela já quitada.'; END IF;
  RETURN jsonb_build_object('rep',eu,'saldo_cents',saldo,'user',auth.uid());
END $fn$;
REVOKE ALL ON FUNCTION public.rep_parcela_cobravel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_parcela_cobravel(uuid) TO authenticated;

-- Chamado só pelo servidor depois de rep_parcela_cobravel; assina com o ator técnico oficial.
CREATE OR REPLACE FUNCTION public.rep_asaas_preparar(_actor uuid, _rep_user uuid, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE inst uuid := (_payload->>'installment_id')::uuid; rep uuid; cons uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.consultora_cobranca_config WHERE ator_user_id=_actor) THEN RAISE EXCEPTION 'Assinatura técnica inválida.'; END IF;
  SELECT party_id INTO rep FROM public.profiles WHERE id=_rep_user;
  IF rep IS NULL OR NOT public.has_role(_rep_user,'representante') OR public.rep_parcela_dono(inst) IS DISTINCT FROM rep THEN
    RAISE EXCEPTION 'Parcela fora da carteira do representante.';
  END IF;
  SELECT t.party_id INTO cons FROM public.financial_installments i JOIN public.financial_titles t ON t.id=i.title_id WHERE i.id=inst;
  PERFORM public.rep_reativar_interno(cons,_rep_user,'cobrança gerada pelo representante');
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (_rep_user,'representante.cobranca_solicitada','financial_installments',inst::text,_payload);
  PERFORM public.pdv_como(_actor);
  RETURN public.asaas_cobranca_preparar(_payload);
END $fn$;
REVOKE ALL ON FUNCTION public.rep_asaas_preparar(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rep_asaas_preparar(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rep_cheque_registrar(_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid := public.rep_eu(); cons uuid := nullif(_payload->>'recebido_de_party_id','')::uuid; v_id uuid; nome text;
BEGIN
  IF eu IS NULL THEN RAISE EXCEPTION 'Somente o representante registra cheque aqui.'; END IF;
  IF cons IS NULL OR NOT EXISTS(SELECT 1 FROM public.consultant_profiles WHERE party_id=cons AND representative_party_id=eu) THEN
    RAISE EXCEPTION 'Consultora fora da sua carteira.'; END IF;
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
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload) VALUES (auth.uid(),'cheque.registrado_representante','fin_cheques',v_id::text,_payload - 'emitente_doc');
  PERFORM public.rep_reativar_interno(cons,auth.uid(),'cheque recebido pelo representante');
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Este cheque já está registrado (mesmo banco, agência, conta e número)';
END $fn$;
REVOKE ALL ON FUNCTION public.rep_cheque_registrar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_cheque_registrar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rep_consultora_reativar(_party uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid := public.rep_eu();
BEGIN
  IF eu IS NULL OR NOT EXISTS(SELECT 1 FROM public.consultant_profiles WHERE party_id=_party AND representative_party_id=eu) THEN
    RAISE EXCEPTION 'Consultora fora da sua carteira.'; END IF;
  RETURN public.rep_reativar_interno(_party,auth.uid(),'reativada pelo representante');
END $fn$;
REVOKE ALL ON FUNCTION public.rep_consultora_reativar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_consultora_reativar(uuid) TO authenticated;

-- ===== Etapa 3: CRM de captação do representante =====
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS representante_party_id uuid REFERENCES public.parties(id);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS representante_origem text;
CREATE INDEX IF NOT EXISTS leads_representante_idx ON public.leads(representante_party_id);

CREATE TABLE IF NOT EXISTS public.rep_crm_etapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_party_id uuid NOT NULL REFERENCES public.parties(id),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 40),
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rep_crm_etapas TO authenticated;
GRANT ALL ON public.rep_crm_etapas TO service_role;
ALTER TABLE public.rep_crm_etapas ENABLE ROW LEVEL SECURITY;
CREATE POLICY rep_crm_etapas_ler ON public.rep_crm_etapas FOR SELECT TO authenticated USING (public.rep_portal_pode(rep_party_id));

CREATE TABLE IF NOT EXISTS public.rep_crm_cards (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id),
  rep_party_id uuid NOT NULL REFERENCES public.parties(id),
  etapa_id uuid REFERENCES public.rep_crm_etapas(id),
  nota text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rep_crm_cards TO authenticated;
GRANT ALL ON public.rep_crm_cards TO service_role;
ALTER TABLE public.rep_crm_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY rep_crm_cards_ler ON public.rep_crm_cards FOR SELECT TO authenticated USING (public.rep_portal_pode(rep_party_id));

CREATE OR REPLACE FUNCTION public.rep_crm_etapas_garantir(_rep uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.rep_crm_etapas WHERE rep_party_id=_rep) THEN
    INSERT INTO public.rep_crm_etapas(rep_party_id,nome,ordem) VALUES
      (_rep,'Novo contato',1),(_rep,'Conversando',2),(_rep,'Visita agendada',3),(_rep,'Aguardando Lardan',4),(_rep,'Primeira maleta',5);
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_crm_etapas_garantir(uuid) FROM PUBLIC, anon, authenticated;

-- Link Seja Lardan do representante: código = parties.code (ex.: lc-000123) gravado no tracking.
CREATE OR REPLACE FUNCTION public.rep_publico(_code text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT jsonb_build_object('nome', split_part(p.display_name,' ',1))
  FROM public.parties p JOIN public.party_roles r ON r.party_id=p.id AND r.role='representante'
  WHERE lower(p.code)=lower(btrim(_code)) AND p.status='ativo' LIMIT 1
$fn$;
GRANT EXECUTE ON FUNCTION public.rep_publico(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_vincular_submissao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE cod text := lower(btrim(coalesce(NEW.tracking->>'representante',''))); quem uuid;
BEGIN
  IF cod='' OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  SELECT p.id INTO quem FROM public.parties p JOIN public.party_roles r ON r.party_id=p.id AND r.role='representante'
   WHERE lower(p.code)=cod AND p.status='ativo' LIMIT 1;
  IF quem IS NULL THEN RETURN NEW; END IF;
  UPDATE public.leads SET representante_party_id=quem, representante_origem='link'
   WHERE id=NEW.lead_id AND representante_party_id IS NULL;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_rep_submissao ON public.candidatura_submissions;
CREATE TRIGGER trg_rep_submissao AFTER INSERT ON public.candidatura_submissions
FOR EACH ROW EXECUTE FUNCTION public.rep_vincular_submissao();

-- Daniel encaminha (ou retira) uma candidatura para um representante.
CREATE OR REPLACE FUNCTION public.rep_lead_encaminhar(_lead uuid, _rep uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.has_capability(auth.uid(),'candidaturas.assign') THEN RAISE EXCEPTION 'Sem permissão para encaminhar candidaturas.'; END IF;
  IF _rep IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.party_roles WHERE party_id=_rep AND role='representante') THEN
    RAISE EXCEPTION 'Pessoa escolhida não é representante.'; END IF;
  UPDATE public.leads SET representante_party_id=_rep, representante_origem=CASE WHEN _rep IS NULL THEN NULL ELSE 'encaminhada' END WHERE id=_lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidatura não encontrada.'; END IF;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (auth.uid(),'candidatura.encaminhada_representante','leads',_lead::text,jsonb_build_object('representante',_rep));
END $fn$;
REVOKE ALL ON FUNCTION public.rep_lead_encaminhar(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_lead_encaminhar(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rep_representantes_lista() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT CASE WHEN public.has_capability(auth.uid(),'candidaturas.assign') THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'nome',p.display_name,'code',p.code) ORDER BY p.display_name)
      FROM public.parties p JOIN public.party_roles r ON r.party_id=p.id AND r.role='representante' WHERE p.status='ativo'),'[]'::jsonb)
  ELSE '[]'::jsonb END
$fn$;
REVOKE ALL ON FUNCTION public.rep_representantes_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_representantes_lista() TO authenticated;

CREATE OR REPLACE FUNCTION public.rep_crm(_rep uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  PERFORM public.rep_crm_etapas_garantir(_rep);
  SELECT jsonb_build_object(
    'codigo', (SELECT lower(code) FROM public.parties WHERE id=_rep),
    'etapas', (SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY ordem) FROM public.rep_crm_etapas WHERE rep_party_id=_rep),
    'cards', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'lead_id',l.id,'protocolo',l.protocol,'nome',l.full_name,'whatsapp',l.whatsapp,'cidade',l.city||'/'||l.uf,
        'status_lardan',l.status::text,'origem',l.representante_origem,'criado',l.created_at,
        'etapa_id',coalesce(c.etapa_id,(SELECT id FROM public.rep_crm_etapas WHERE rep_party_id=_rep ORDER BY ordem LIMIT 1)),'nota',c.nota)
        ORDER BY l.created_at DESC)
      FROM public.leads l LEFT JOIN public.rep_crm_cards c ON c.lead_id=l.id
      WHERE l.representante_party_id=_rep AND l.status::text NOT IN ('arquivado')),'[]'::jsonb)
  ) INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_crm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_crm(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rep_crm_mover(_lead uuid, _etapa uuid, _nota text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid := public.rep_eu();
BEGIN
  IF eu IS NULL OR NOT EXISTS(SELECT 1 FROM public.leads WHERE id=_lead AND representante_party_id=eu) THEN RAISE EXCEPTION 'Candidatura fora da sua carteira.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rep_crm_etapas WHERE id=_etapa AND rep_party_id=eu) THEN RAISE EXCEPTION 'Etapa inválida.'; END IF;
  INSERT INTO public.rep_crm_cards(lead_id,rep_party_id,etapa_id,nota) VALUES (_lead,eu,_etapa,nullif(btrim(_nota),''))
  ON CONFLICT (lead_id) DO UPDATE SET etapa_id=EXCLUDED.etapa_id, nota=coalesce(EXCLUDED.nota,rep_crm_cards.nota), updated_at=now();
END $fn$;
REVOKE ALL ON FUNCTION public.rep_crm_mover(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_crm_mover(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rep_crm_etapa_salvar(_id uuid, _nome text, _ordem int) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid := public.rep_eu(); v uuid;
BEGIN
  IF eu IS NULL THEN RAISE EXCEPTION 'Somente o representante configura o funil.'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.rep_crm_etapas(rep_party_id,nome,ordem) VALUES (eu,btrim(_nome),coalesce(_ordem,99)) RETURNING id INTO v;
  ELSE
    UPDATE public.rep_crm_etapas SET nome=btrim(_nome), ordem=coalesce(_ordem,ordem) WHERE id=_id AND rep_party_id=eu RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'Etapa não encontrada.'; END IF;
  END IF;
  RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_crm_etapa_salvar(uuid,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_crm_etapa_salvar(uuid,text,int) TO authenticated;