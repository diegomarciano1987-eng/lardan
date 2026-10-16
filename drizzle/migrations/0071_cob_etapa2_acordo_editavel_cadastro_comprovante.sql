
-- status 'excluida' para acordo digitado errado (fica no histórico, não some)
ALTER TABLE public.cob_simulacoes DROP CONSTRAINT IF EXISTS cob_simulacoes_status_check;
ALTER TABLE public.cob_simulacoes ADD CONSTRAINT cob_simulacoes_status_check
  CHECK (status = ANY (ARRAY['simulada','aguardando_entrada','efetivada','cancelada','excluida']));
ALTER TABLE public.cob_simulacoes ADD COLUMN IF NOT EXISTS excluida_motivo text, ADD COLUMN IF NOT EXISTS excluida_por uuid, ADD COLUMN IF NOT EXISTS excluida_em timestamptz;
ALTER TABLE public.cob_interacoes DROP CONSTRAINT IF EXISTS cob_interacoes_resultado_check;
ALTER TABLE public.cob_interacoes ADD CONSTRAINT cob_interacoes_resultado_check CHECK (resultado IS NULL OR resultado = ANY (ARRAY['sucesso','sem_sucesso','nao_atendeu','recado','outro','simulacao','efetivada','cancelada','suspensa','liberada','excluida','comprovante','cadastro']));

-- salvar acordo: plano editável validado no servidor
CREATE OR REPLACE FUNCTION public.cob_simulacao_salvar(_party uuid, _dados jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v uuid; ids uuid[]; s bigint; st text; soma bigint; ent bigint; tot bigint; ent_d date; x jsonb; ant date;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  ids := ARRAY(SELECT jsonb_array_elements_text(_dados->'installment_ids')::uuid);
  SELECT sum(saldo_cents) INTO s FROM public.cob_parcelas_abertas() WHERE installment_id = any(ids) AND party_id=_party;
  IF s IS NULL OR s <> (_dados->>'principal_cents')::bigint THEN RAISE EXCEPTION 'Parcelas mudaram desde a simulação; refaça o cálculo'; END IF;
  IF (_dados->>'desconto_cents')::bigint > (_dados->>'principal_cents')::bigint + (_dados->>'encargos_cents')::bigint THEN RAISE EXCEPTION 'Desconto maior que a dívida'; END IF;
  ent := coalesce((_dados->>'entrada_cents')::bigint,0); tot := (_dados->>'total_cents')::bigint;
  ent_d := nullif(_dados->>'entrada_data','')::date;
  IF ent < 0 OR ent > tot THEN RAISE EXCEPTION 'Entrada inválida'; END IF;
  IF ent > 0 AND ent_d IS NULL THEN RAISE EXCEPTION 'Informe a data da entrada'; END IF;
  soma := 0; ant := ent_d;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(_dados->'plano','[]')) LOOP
    IF coalesce((x->>'valor_cents')::bigint,0) <= 0 THEN RAISE EXCEPTION 'Toda parcela do acordo precisa de valor maior que zero'; END IF;
    IF nullif(x->>'data','') IS NULL THEN RAISE EXCEPTION 'Toda parcela do acordo precisa de data'; END IF;
    IF ant IS NOT NULL AND (x->>'data')::date < ant THEN RAISE EXCEPTION 'As datas das parcelas precisam estar em ordem (parcela % antes da anterior)', x->>'numero'; END IF;
    ant := (x->>'data')::date; soma := soma + (x->>'valor_cents')::bigint;
  END LOOP;
  IF ent + soma <> tot THEN RAISE EXCEPTION 'Entrada + parcelas (%) precisa ser igual ao total do acordo (%)', to_char((ent+soma)/100.0,'FM999G999G990D00'), to_char(tot/100.0,'FM999G999G990D00'); END IF;
  st := CASE WHEN ent > 0 THEN 'aguardando_entrada' ELSE 'simulada' END;
  INSERT INTO cob_simulacoes(party_id, installment_ids, data_base, multa_pct, juros_mes_pct, principal_cents, encargos_cents, desconto_cents, total_cents,
    entrada_cents, entrada_data, parcelas, primeira_data, plano, observacao, status, autor_id)
  VALUES (_party, ids, (_dados->>'data_base')::date, (_dados->>'multa_pct')::numeric, (_dados->>'juros_mes_pct')::numeric,
    s, (_dados->>'encargos_cents')::bigint, coalesce((_dados->>'desconto_cents')::bigint,0), tot, ent, ent_d,
    greatest(jsonb_array_length(coalesce(_dados->'plano','[]')),1),
    (SELECT min((y->>'data')::date) FROM jsonb_array_elements(coalesce(_dados->'plano','[]')) y), coalesce(_dados->'plano','[]'), nullif(_dados->>'observacao',''), st, auth.uid())
  RETURNING id INTO v;
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(_party,'negociacao','simulacao','Simulação de acordo: total '||to_char(tot/100.0,'FM999G999G990D00')||coalesce(' · entrada em '||to_char(ent_d,'DD/MM/YYYY'),''),ids,auth.uid());
  IF st = 'aguardando_entrada' THEN
    INSERT INTO cob_tarefas(party_id,titulo,vence_em,autor_id,responsavel_id,installment_ids)
    VALUES(_party,'Conferir entrada do acordo · '||to_char(ent/100.0,'FM999G999G990D00'),ent_d,auth.uid(),auth.uid(),ids);
  END IF;
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.cob_simulacao_excluir(_id uuid, _motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r cob_simulacoes;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF coalesce(btrim(_motivo),'') = '' THEN RAISE EXCEPTION 'Informe o motivo da exclusão'; END IF;
  SELECT * INTO r FROM cob_simulacoes WHERE id=_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Acordo não encontrado'; END IF;
  IF r.status IN ('efetivada','excluida') THEN RAISE EXCEPTION 'Acordo efetivado ou já excluído não pode ser excluído'; END IF;
  UPDATE cob_simulacoes SET status='excluida', excluida_motivo=_motivo, excluida_por=auth.uid(), excluida_em=now(), updated_at=now() WHERE id=_id;
  UPDATE cob_tarefas SET status='cancelada', motivo_fim='Acordo excluído: '||left(_motivo,80)
   WHERE party_id=r.party_id AND status='aberta' AND titulo LIKE 'Conferir entrada do acordo%' AND installment_ids = r.installment_ids;
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(r.party_id,'negociacao','excluida','Acordo excluído (digitado errado) — '||_motivo,r.installment_ids,auth.uid());
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES(auth.uid(),'cob.acordo_excluido','cob_simulacoes',_id::text,to_jsonb(r)||jsonb_build_object('motivo',_motivo));
END $$;
REVOKE ALL ON FUNCTION public.cob_simulacao_excluir(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_simulacao_excluir(uuid,text) TO authenticated;

-- editar dados do cliente a partir da cobrança
CREATE OR REPLACE FUNCTION public.cob_cadastro_ler(_party uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN jsonb_build_object(
    'nome',(SELECT display_name FROM parties WHERE id=_party),
    'cpf',(SELECT doc_masked FROM parties WHERE id=_party),
    'tem_cpf',(SELECT doc_digits IS NOT NULL FROM parties WHERE id=_party),
    'whatsapp',(SELECT value FROM contact_points WHERE party_id=_party AND kind='whatsapp' ORDER BY is_primary DESC, created_at LIMIT 1),
    'telefone',(SELECT value FROM contact_points WHERE party_id=_party AND kind='telefone' ORDER BY is_primary DESC, created_at LIMIT 1),
    'email',(SELECT value FROM contact_points WHERE party_id=_party AND kind='email' ORDER BY is_primary DESC, created_at LIMIT 1),
    'endereco',(SELECT jsonb_build_object('cep',postal_code,'rua',street,'numero',street_number,'complemento',complement,'bairro',district,'cidade',city,'uf',uf)
                FROM party_addresses WHERE party_id=_party ORDER BY is_primary DESC, created_at LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION public.cob_cadastro_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_cadastro_ler(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_cadastro_salvar(_party uuid, _d jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE antes jsonb; cpf text; outro text; k text; val text; e jsonb; aid uuid;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id=_party) THEN RAISE EXCEPTION 'Pessoa não encontrada'; END IF;
  antes := public.cob_cadastro_ler(_party);
  IF coalesce(btrim(_d->>'nome'),'') <> '' THEN UPDATE parties SET display_name=btrim(_d->>'nome'), updated_by=auth.uid(), updated_at=now() WHERE id=_party; END IF;
  cpf := regexp_replace(coalesce(_d->>'cpf',''),'\D','','g');
  IF cpf <> '' THEN
    IF length(cpf) <> 11 THEN RAISE EXCEPTION 'CPF precisa ter 11 dígitos'; END IF;
    SELECT display_name||' ('||coalesce(code,'')||')' INTO outro FROM parties WHERE doc_digits=cpf AND id<>_party LIMIT 1;
    IF outro IS NOT NULL THEN RAISE EXCEPTION 'Este CPF já está no cadastro de %. Unifique os cadastros em vez de repetir o CPF.', outro; END IF;
    UPDATE parties SET doc=cpf, updated_by=auth.uid(), updated_at=now() WHERE id=_party AND coalesce(doc_digits,'')<>cpf;
  END IF;
  FOREACH k IN ARRAY ARRAY['whatsapp','telefone','email'] LOOP
    val := btrim(coalesce(_d->>k,''));
    IF val <> '' THEN
      IF EXISTS (SELECT 1 FROM contact_points WHERE party_id=_party AND kind=k::contact_kind) THEN
        UPDATE contact_points SET value=val, updated_at=now() WHERE id=(SELECT id FROM contact_points WHERE party_id=_party AND kind=k::contact_kind ORDER BY is_primary DESC, created_at LIMIT 1);
      ELSE INSERT INTO contact_points(party_id,kind,label,value,is_primary) VALUES(_party,k::contact_kind,'Cobrança',val,true); END IF;
    END IF;
  END LOOP;
  e := _d->'endereco';
  IF e IS NOT NULL AND coalesce(btrim(e->>'cidade'),'') <> '' THEN
    SELECT id INTO aid FROM party_addresses WHERE party_id=_party ORDER BY is_primary DESC, created_at LIMIT 1;
    IF aid IS NULL THEN
      INSERT INTO party_addresses(party_id,label,postal_code,street,street_number,complement,district,city,uf,is_primary,address_source)
      VALUES(_party,'Principal',nullif(e->>'cep',''),nullif(e->>'rua',''),nullif(e->>'numero',''),nullif(e->>'complemento',''),nullif(e->>'bairro',''),e->>'cidade',upper(nullif(e->>'uf','')),true,'cobranca');
    ELSE
      UPDATE party_addresses SET postal_code=nullif(e->>'cep',''), street=nullif(e->>'rua',''), street_number=nullif(e->>'numero',''), complement=nullif(e->>'complemento',''),
        district=nullif(e->>'bairro',''), city=e->>'cidade', uf=upper(nullif(e->>'uf','')) WHERE id=aid;
    END IF;
  END IF;
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(_party,'correcao','cadastro','Dados cadastrais atualizados pela cobrança','{}',auth.uid());
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES(auth.uid(),'cob.cadastro_editado','parties',_party::text,jsonb_build_object('antes',antes - 'cpf','depois',public.cob_cadastro_ler(_party) - 'cpf','cpf_alterado',cpf<>''));
END $$;
REVOKE ALL ON FUNCTION public.cob_cadastro_salvar(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_cadastro_salvar(uuid,jsonb) TO authenticated;

-- comprovantes de entrada/parcela pagos fora do Asaas (baixa continua manual no financeiro)
CREATE TABLE IF NOT EXISTS public.cob_comprovantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  simulacao_id uuid REFERENCES public.cob_simulacoes(id),
  installment_id uuid REFERENCES public.financial_installments(id),
  referente text NOT NULL DEFAULT 'entrada',
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  data_pagamento date NOT NULL,
  banco text,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  status text NOT NULL DEFAULT 'aguardando_baixa' CHECK (status IN ('aguardando_baixa','baixado','recusado')),
  observacao text,
  autor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cob_comprovantes TO authenticated;
GRANT ALL ON public.cob_comprovantes TO service_role;
ALTER TABLE public.cob_comprovantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY cob_comprovantes_ler ON public.cob_comprovantes FOR SELECT TO authenticated
  USING (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(),'finance.dashboard.view'));

CREATE OR REPLACE FUNCTION public.cob_comprovante_registrar(_d jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid; p uuid := (_d->>'party_id')::uuid;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF coalesce((_d->>'valor_cents')::bigint,0) <= 0 THEN RAISE EXCEPTION 'Informe o valor pago'; END IF;
  IF coalesce(_d->>'storage_path','') NOT LIKE 'comprovantes/'||p||'/%' THEN RAISE EXCEPTION 'Arquivo inválido'; END IF;
  INSERT INTO cob_comprovantes(party_id,simulacao_id,installment_id,referente,valor_cents,data_pagamento,banco,storage_path,file_name,content_type,observacao,autor_id)
  VALUES(p,nullif(_d->>'simulacao_id','')::uuid,nullif(_d->>'installment_id','')::uuid,coalesce(nullif(_d->>'referente',''),'entrada'),(_d->>'valor_cents')::bigint,
         (_d->>'data_pagamento')::date,nullif(_d->>'banco',''),_d->>'storage_path',_d->>'file_name',nullif(_d->>'content_type',''),nullif(_d->>'observacao',''),auth.uid())
  RETURNING id INTO v;
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(p,'anotacao','comprovante','Comprovante de '||to_char(((_d->>'valor_cents')::bigint)/100.0,'FM999G999G990D00')||' em '||to_char((_d->>'data_pagamento')::date,'DD/MM/YYYY')||coalesce(' ('||nullif(_d->>'banco','')||')','')||' anexado — aguarda baixa no financeiro',
         CASE WHEN nullif(_d->>'installment_id','') IS NULL THEN '{}'::uuid[] ELSE ARRAY[(_d->>'installment_id')::uuid] END, auth.uid());
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'cob.comprovante_anexado','cob_comprovantes',v::text,_d);
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.cob_comprovante_registrar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_comprovante_registrar(jsonb) TO authenticated;
