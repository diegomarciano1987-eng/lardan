-- Configuração de encargos (linha única)
CREATE TABLE IF NOT EXISTS public.cob_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  multa_pct numeric(6,3) NOT NULL DEFAULT 2 CHECK (multa_pct >= 0 AND multa_pct <= 20),
  juros_mes_pct numeric(6,3) NOT NULL DEFAULT 1 CHECK (juros_mes_pct >= 0 AND juros_mes_pct <= 20),
  carencia_dias int NOT NULL DEFAULT 0 CHECK (carencia_dias between 0 and 60),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cob_config(id) VALUES (true) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.cob_config TO authenticated;
GRANT ALL ON public.cob_config TO service_role;
ALTER TABLE public.cob_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY cob_config_r ON public.cob_config FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));

CREATE OR REPLACE FUNCTION public.cob_config_salvar(_multa numeric, _juros numeric, _carencia int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE antes jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), array['master','diretoria','financeiro']::app_role[]) THEN RAISE EXCEPTION 'Só diretoria/financeiro altera os encargos'; END IF;
  SELECT to_jsonb(c) INTO antes FROM cob_config c;
  UPDATE cob_config SET multa_pct=_multa, juros_mes_pct=_juros, carencia_dias=_carencia, updated_by=auth.uid(), updated_at=now();
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, diff)
  VALUES (auth.uid(), 'cob_config_salvar', 'cob_config', null, jsonb_build_object('antes', antes, 'multa', _multa, 'juros', _juros, 'carencia', _carencia));
END $$;

-- Simulações / acordos (não mexem no financeiro)
CREATE TABLE IF NOT EXISTS public.cob_simulacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  installment_ids uuid[] NOT NULL,
  data_base date NOT NULL,
  multa_pct numeric(6,3) NOT NULL, juros_mes_pct numeric(6,3) NOT NULL,
  principal_cents bigint NOT NULL, encargos_cents bigint NOT NULL,
  desconto_cents bigint NOT NULL DEFAULT 0, total_cents bigint NOT NULL,
  entrada_cents bigint NOT NULL DEFAULT 0, entrada_data date,
  parcelas int NOT NULL DEFAULT 1 CHECK (parcelas between 1 and 48),
  primeira_data date,
  plano jsonb NOT NULL DEFAULT '[]',
  observacao text,
  status text NOT NULL DEFAULT 'simulada' CHECK (status in ('simulada','aguardando_entrada','efetivada','cancelada')),
  promessa_id uuid,
  autor_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cob_simulacoes_party ON public.cob_simulacoes(party_id, created_at desc);
GRANT SELECT ON public.cob_simulacoes TO authenticated;
GRANT ALL ON public.cob_simulacoes TO service_role;
ALTER TABLE public.cob_simulacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY cob_sim_r ON public.cob_simulacoes FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));

CREATE OR REPLACE FUNCTION public.cob_simulacao_salvar(_party uuid, _dados jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid; ids uuid[]; s bigint; st text;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  ids := ARRAY(SELECT jsonb_array_elements_text(_dados->'installment_ids')::uuid);
  SELECT sum(saldo_cents) INTO s FROM public.cob_parcelas_abertas() WHERE installment_id = any(ids) AND party_id=_party;
  IF s IS NULL OR s <> (_dados->>'principal_cents')::bigint THEN RAISE EXCEPTION 'Parcelas mudaram desde a simulação; refaça o cálculo'; END IF;
  IF (_dados->>'desconto_cents')::bigint > (_dados->>'principal_cents')::bigint + (_dados->>'encargos_cents')::bigint THEN RAISE EXCEPTION 'Desconto maior que a dívida'; END IF;
  st := CASE WHEN coalesce((_dados->>'entrada_cents')::bigint,0) > 0 THEN 'aguardando_entrada' ELSE 'simulada' END;
  INSERT INTO cob_simulacoes(party_id, installment_ids, data_base, multa_pct, juros_mes_pct, principal_cents, encargos_cents, desconto_cents, total_cents,
    entrada_cents, entrada_data, parcelas, primeira_data, plano, observacao, status, autor_id)
  VALUES (_party, ids, (_dados->>'data_base')::date, (_dados->>'multa_pct')::numeric, (_dados->>'juros_mes_pct')::numeric,
    s, (_dados->>'encargos_cents')::bigint, coalesce((_dados->>'desconto_cents')::bigint,0), (_dados->>'total_cents')::bigint,
    coalesce((_dados->>'entrada_cents')::bigint,0), nullif(_dados->>'entrada_data','')::date, coalesce((_dados->>'parcelas')::int,1),
    nullif(_dados->>'primeira_data','')::date, coalesce(_dados->'plano','[]'), nullif(_dados->>'observacao',''), st, auth.uid())
  RETURNING id INTO v;
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(_party,'negociacao','simulacao','Simulação de acordo: total '||to_char(((_dados->>'total_cents')::bigint)/100.0,'FM999G999G990D00')||coalesce(' · entrada em '||to_char(nullif(_dados->>'entrada_data','')::date,'DD/MM/YYYY'),''),ids,auth.uid());
  IF st = 'aguardando_entrada' AND nullif(_dados->>'entrada_data','') IS NOT NULL THEN
    INSERT INTO cob_tarefas(party_id,titulo,vence_em,autor_id,responsavel_id,installment_ids)
    VALUES(_party,'Conferir entrada do acordo · '||to_char(((_dados->>'entrada_cents')::bigint)/100.0,'FM999G999G990D00'),(_dados->>'entrada_data')::date,auth.uid(),auth.uid(),ids);
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.cob_simulacao_status(_id uuid, _status text, _motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r cob_simulacoes;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF _status NOT IN ('efetivada','cancelada') THEN RAISE EXCEPTION 'Status inválido'; END IF;
  SELECT * INTO r FROM cob_simulacoes WHERE id=_id FOR UPDATE;
  IF r.id IS NULL OR r.status IN ('efetivada','cancelada') THEN RAISE EXCEPTION 'Simulação já encerrada'; END IF;
  UPDATE cob_simulacoes SET status=_status, updated_at=now() WHERE id=_id;
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(r.party_id,'negociacao',_status,'Acordo '||CASE WHEN _status='efetivada' THEN 'efetivado (entrada confirmada)' ELSE 'cancelado' END||coalesce(' — '||_motivo,''),r.installment_ids,auth.uid());
END $$;

-- Promessa passa a gerar lembrete na data prometida
CREATE OR REPLACE FUNCTION public.cob_promessa_criar(_party uuid, _valor bigint, _data date, _parcelas uuid[], _obs text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v uuid; s bigint;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF EXISTS (select 1 from cob_promessas where status='vigente' and installment_ids && _parcelas) THEN RAISE EXCEPTION 'Já existe promessa vigente para estas parcelas'; END IF;
  select sum(saldo_cents) into s from public.cob_parcelas_abertas() where installment_id = any(_parcelas) and party_id=_party;
  IF s is null THEN RAISE EXCEPTION 'Parcelas inválidas'; END IF;
  INSERT INTO cob_promessas(party_id,valor_cents,data_prometida,installment_ids,saldo_inicial_cents,observacao,responsavel_id,autor_id)
  VALUES(_party,_valor,_data,_parcelas,s,_obs,auth.uid(),auth.uid()) RETURNING id INTO v;
  INSERT INTO cob_casos(party_id,etapa,pausa_ate,pausa_motivo,updated_by) VALUES(_party,'promessa',_data,'Promessa de pagamento',auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET etapa='promessa', pausa_ate=_data, pausa_motivo='Promessa de pagamento', updated_at=now();
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id) VALUES(_party,'negociacao','sucesso','Promessa de '||(_valor/100.0)::text||' para '||_data::text||coalesce(' — '||_obs,''),_parcelas,auth.uid());
  INSERT INTO cob_tarefas(party_id,titulo,vence_em,autor_id,responsavel_id,installment_ids)
  VALUES(_party,'Conferir promessa · '||to_char(_valor/100.0,'FM999G999G990D00'),_data,auth.uid(),auth.uid(),_parcelas);
  RETURN v;
END $function$;

-- Lembretes do dia (gaveta lateral)
CREATE OR REPLACE FUNCTION public.cob_lembretes()
RETURNS TABLE(id uuid, party_id uuid, nome text, titulo text, vence_em date, origem text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT t.id, t.party_id, p.display_name, t.titulo, t.vence_em, t.origem
  FROM cob_tarefas t JOIN parties p ON p.id=t.party_id
  WHERE public.cob_pode(auth.uid()) AND t.status='aberta'
    AND t.vence_em <= (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1
    AND (t.origem <> 'regua' OR t.responsavel_id = auth.uid())
  ORDER BY t.vence_em, p.display_name LIMIT 200
$$;

-- Suspensão de novas maletas/pedidos
ALTER TABLE public.cob_casos ADD COLUMN IF NOT EXISTS suspensa boolean NOT NULL DEFAULT false;
ALTER TABLE public.cob_casos ADD COLUMN IF NOT EXISTS suspensa_motivo text;
ALTER TABLE public.cob_casos ADD COLUMN IF NOT EXISTS suspensa_em timestamptz;

CREATE OR REPLACE FUNCTION public.cob_suspender(_party uuid, _suspensa boolean, _motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF coalesce(trim(_motivo),'') = '' THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  INSERT INTO cob_casos(party_id,etapa,suspensa,suspensa_motivo,suspensa_em,updated_by)
  VALUES(_party,'novo_atraso',_suspensa,_motivo,now(),auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET suspensa=_suspensa, suspensa_motivo=_motivo, suspensa_em=now(), updated_by=auth.uid(), updated_at=now();
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(_party,'anotacao',CASE WHEN _suspensa THEN 'suspensa' ELSE 'liberada' END,
    CASE WHEN _suspensa THEN 'Suspensa para novas maletas/pedidos: ' ELSE 'Liberada para novas maletas/pedidos: ' END||_motivo,'{}',auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.cob_bloqueio_suspensa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m text;
BEGIN
  IF NEW.consultora_party_id IS NULL THEN RETURN NEW; END IF;
  SELECT suspensa_motivo INTO m FROM cob_casos WHERE party_id=NEW.consultora_party_id AND suspensa;
  IF FOUND THEN RAISE EXCEPTION 'Consultora suspensa pela cobrança (%). Libere na Central de Cobrança antes.', coalesce(m,'sem motivo'); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cob_bloqueio_kit ON public.kit_cycles;
CREATE TRIGGER cob_bloqueio_kit BEFORE INSERT ON public.kit_cycles FOR EACH ROW EXECUTE FUNCTION public.cob_bloqueio_suspensa();
DROP TRIGGER IF EXISTS cob_bloqueio_pedido ON public.sales_orders;
CREATE TRIGGER cob_bloqueio_pedido BEFORE INSERT ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION public.cob_bloqueio_suspensa();

REVOKE EXECUTE ON FUNCTION public.cob_config_salvar(numeric,numeric,int), public.cob_simulacao_salvar(uuid,jsonb), public.cob_simulacao_status(uuid,text,text), public.cob_lembretes(), public.cob_suspender(uuid,boolean,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cob_config_salvar(numeric,numeric,int), public.cob_simulacao_salvar(uuid,jsonb), public.cob_simulacao_status(uuid,text,text), public.cob_lembretes(), public.cob_suspender(uuid,boolean,text) TO authenticated;
NOTIFY pgrst, 'reload schema';