CREATE TABLE public.cob_judicial (
  party_id uuid PRIMARY KEY REFERENCES public.parties(id),
  processo text, vara text, comarca text, advogado text,
  data_ajuizamento date, observacao text,
  encaminhado_por uuid, encaminhado_em timestamptz NOT NULL DEFAULT now(),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cob_judicial_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  tipo text NOT NULL CHECK (tipo in ('termo_assinado','peticao','certidao','sentenca','comprovante','outro')),
  titulo text NOT NULL, storage_path text NOT NULL UNIQUE, file_name text NOT NULL, content_type text NOT NULL,
  autor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cob_judicial_acordos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  data_acordo date NOT NULL,
  installment_ids uuid[] NOT NULL DEFAULT '{}',
  principal_cents bigint NOT NULL DEFAULT 0 CHECK (principal_cents >= 0),
  honorarios_cents bigint NOT NULL DEFAULT 0 CHECK (honorarios_cents >= 0),
  cartorio_cents bigint NOT NULL DEFAULT 0 CHECK (cartorio_cents >= 0),
  custas_cents bigint NOT NULL DEFAULT 0 CHECK (custas_cents >= 0),
  outros_cents bigint NOT NULL DEFAULT 0 CHECK (outros_cents >= 0),
  outros_descricao text,
  desconto_cents bigint NOT NULL DEFAULT 0 CHECK (desconto_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  plano jsonb NOT NULL DEFAULT '[]',
  observacao text,
  status text NOT NULL DEFAULT 'vigente' CHECK (status in ('vigente','cumprido','descumprido','cancelado')),
  status_motivo text,
  autor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
COMMENT ON TABLE public.cob_judicial_acordos IS 'Acordos judiciais: nunca geram cobrança Asaas nem mexem no financeiro.';
CREATE INDEX ON public.cob_judicial_docs(party_id, created_at desc);
CREATE INDEX ON public.cob_judicial_acordos(party_id, created_at desc);

GRANT SELECT ON public.cob_judicial, public.cob_judicial_docs, public.cob_judicial_acordos TO authenticated;
GRANT ALL ON public.cob_judicial, public.cob_judicial_docs, public.cob_judicial_acordos TO service_role;
ALTER TABLE public.cob_judicial ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cob_judicial_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cob_judicial_acordos ENABLE ROW LEVEL SECURITY;
CREATE POLICY cob_jud_r ON public.cob_judicial FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));
CREATE POLICY cob_jud_r ON public.cob_judicial_docs FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));
CREATE POLICY cob_jud_r ON public.cob_judicial_acordos FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));

CREATE OR REPLACE FUNCTION public.cob_judicial_encaminhar(_party uuid, _d jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE novo boolean;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  novo := NOT EXISTS (SELECT 1 FROM cob_judicial WHERE party_id=_party);
  INSERT INTO cob_judicial(party_id, processo, vara, comarca, advogado, data_ajuizamento, observacao, encaminhado_por, updated_by)
  VALUES (_party, nullif(_d->>'processo',''), nullif(_d->>'vara',''), nullif(_d->>'comarca',''), nullif(_d->>'advogado',''),
    nullif(_d->>'data_ajuizamento','')::date, left(nullif(_d->>'observacao',''),2000), auth.uid(), auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET processo=excluded.processo, vara=excluded.vara, comarca=excluded.comarca, advogado=excluded.advogado,
    data_ajuizamento=excluded.data_ajuizamento, observacao=excluded.observacao, updated_by=auth.uid(), updated_at=now();
  INSERT INTO cob_casos(party_id,etapa,updated_by) VALUES(_party,'acompanhamento',auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET etapa='acompanhamento', updated_at=now(), updated_by=auth.uid();
  INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id)
  VALUES(_party,'etapa', CASE WHEN novo THEN 'Encaminhada para judicial' ELSE 'Dados do processo judicial atualizados' END || coalesce(' · processo '||nullif(_d->>'processo',''),''), auth.uid());
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, diff) VALUES (auth.uid(), 'cob_judicial_encaminhar', 'cob_judicial', _party, _d);
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_encaminhar(uuid,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_encaminhar(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_judicial_acordo_salvar(_party uuid, _d jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid; ids uuid[]; s bigint; h bigint; ca bigint; cu bigint; o bigint; de bigint; tot bigint; soma bigint;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cob_judicial WHERE party_id=_party) THEN RAISE EXCEPTION 'Encaminhe para judicial antes de lançar o acordo'; END IF;
  IF nullif(_d->>'data_acordo','') IS NULL THEN RAISE EXCEPTION 'Informe a data do acordo'; END IF;
  ids := ARRAY(SELECT jsonb_array_elements_text(coalesce(_d->'installment_ids','[]'))::uuid);
  SELECT coalesce(sum(saldo_cents),0) INTO s FROM public.cob_parcelas_abertas() WHERE installment_id = any(ids) AND party_id=_party;
  h := coalesce((_d->>'honorarios_cents')::bigint,0); ca := coalesce((_d->>'cartorio_cents')::bigint,0);
  cu := coalesce((_d->>'custas_cents')::bigint,0); o := coalesce((_d->>'outros_cents')::bigint,0);
  de := coalesce((_d->>'desconto_cents')::bigint,0); tot := (_d->>'total_cents')::bigint;
  IF tot IS NULL OR tot <= 0 THEN RAISE EXCEPTION 'Informe o valor total do acordo'; END IF;
  SELECT coalesce(sum((x->>'valor_cents')::bigint),0) INTO soma FROM jsonb_array_elements(coalesce(_d->'plano','[]')) x;
  IF jsonb_array_length(coalesce(_d->'plano','[]')) = 0 THEN RAISE EXCEPTION 'Informe as parcelas do acordo'; END IF;
  IF soma <> tot THEN RAISE EXCEPTION 'As parcelas precisam somar o total do acordo'; END IF;
  INSERT INTO cob_judicial_acordos(party_id,data_acordo,installment_ids,principal_cents,honorarios_cents,cartorio_cents,custas_cents,outros_cents,outros_descricao,desconto_cents,total_cents,plano,observacao,autor_id)
  VALUES(_party,(_d->>'data_acordo')::date,ids,s,h,ca,cu,o,nullif(_d->>'outros_descricao',''),de,tot,_d->'plano',left(nullif(_d->>'observacao',''),2000),auth.uid())
  RETURNING id INTO v;
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(_party,'negociacao','sucesso','Acordo judicial de '||to_char((_d->>'data_acordo')::date,'DD/MM/YYYY')||': total '||to_char(tot/100.0,'FM999G999G990D00')||' em '||jsonb_array_length(_d->'plano')||'x (sem cobrança Asaas)',ids,auth.uid());
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, diff) VALUES (auth.uid(), 'cob_judicial_acordo_salvar', 'cob_judicial_acordos', v, _d);
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_acordo_salvar(uuid,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_acordo_salvar(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_judicial_acordo_status(_id uuid, _status text, _motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r cob_judicial_acordos;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF _status NOT IN ('cumprido','descumprido','cancelado') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  IF nullif(trim(_motivo),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  SELECT * INTO r FROM cob_judicial_acordos WHERE id=_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Acordo não encontrado'; END IF;
  IF r.status <> 'vigente' THEN RAISE EXCEPTION 'Acordo já encerrado'; END IF;
  UPDATE cob_judicial_acordos SET status=_status, status_motivo=left(_motivo,500), updated_at=now() WHERE id=_id;
  INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id) VALUES(r.party_id,'anotacao','Acordo judicial '||_status||': '||left(_motivo,500),auth.uid());
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, diff) VALUES (auth.uid(), 'cob_judicial_acordo_status', 'cob_judicial_acordos', _id, jsonb_build_object('status',_status,'motivo',_motivo));
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_acordo_status(uuid,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_acordo_status(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_judicial_doc_registrar(_d jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid; p uuid := (_d->>'party_id')::uuid;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF (_d->>'storage_path') NOT LIKE 'judicial/'||p::text||'/%' THEN RAISE EXCEPTION 'Caminho inválido'; END IF;
  INSERT INTO cob_judicial_docs(party_id,tipo,titulo,storage_path,file_name,content_type,autor_id)
  VALUES(p,_d->>'tipo',left(coalesce(nullif(_d->>'titulo',''),_d->>'file_name'),200),_d->>'storage_path',left(_d->>'file_name',200),_d->>'content_type',auth.uid())
  RETURNING id INTO v;
  INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id) VALUES(p,'anotacao','Documento judicial anexado: '||left(coalesce(nullif(_d->>'titulo',''),_d->>'file_name'),200),auth.uid());
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_doc_registrar(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_doc_registrar(jsonb) TO authenticated;