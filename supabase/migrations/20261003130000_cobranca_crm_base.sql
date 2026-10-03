CREATE OR REPLACE FUNCTION public.cob_pode(_u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  select public.has_any_role(_u, array['master','diretoria','cobranca','financeiro']::app_role[]) $$;

CREATE TABLE public.cob_casos (
  party_id uuid PRIMARY KEY REFERENCES public.parties(id),
  etapa text NOT NULL DEFAULT 'novo_atraso' CHECK (etapa in ('novo_atraso','em_contato','em_negociacao','promessa','acompanhamento')),
  responsavel_id uuid,
  pausa_ate date, pausa_motivo text,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cob_interacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  tipo text NOT NULL CHECK (tipo in ('ligacao','whatsapp_aberto','negociacao','anotacao','desconto_solicitado','etapa','negativacao_encaminhada','correcao')),
  resultado text CHECK (resultado in ('sucesso','sem_sucesso','nao_atendeu','recado','outro')),
  observacao text, installment_ids uuid[] NOT NULL DEFAULT '{}',
  corrige_id uuid REFERENCES public.cob_interacoes(id),
  autor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cob_promessas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  valor_cents bigint NOT NULL CHECK (valor_cents>0), data_prometida date NOT NULL,
  installment_ids uuid[] NOT NULL CHECK (cardinality(installment_ids)>0),
  saldo_inicial_cents bigint NOT NULL,
  status text NOT NULL DEFAULT 'vigente' CHECK (status in ('vigente','cumprida','parcial','descumprida','cancelada')),
  cancel_motivo text, observacao text, responsavel_id uuid,
  autor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), avaliada_em timestamptz);
CREATE TABLE public.cob_regua_etapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dias integer NOT NULL UNIQUE CHECK (dias>0),
  acao text NOT NULL, prazo_dias integer NOT NULL DEFAULT 1, mensagem text NOT NULL DEFAULT '',
  responsavel_id uuid, ativo boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cob_tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  origem text NOT NULL DEFAULT 'manual' CHECK (origem in ('regua','manual','promessa')),
  regua_dias integer, chave text UNIQUE,
  titulo text NOT NULL, installment_ids uuid[] NOT NULL DEFAULT '{}',
  vence_em date NOT NULL, responsavel_id uuid,
  status text NOT NULL DEFAULT 'aberta' CHECK (status in ('aberta','concluida','cancelada')),
  motivo_fim text, autor_id uuid, concluida_por uuid, concluida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.cob_interacoes(party_id, created_at desc);
CREATE INDEX ON public.cob_tarefas(status, vence_em);
CREATE INDEX ON public.cob_promessas(party_id, status);

GRANT SELECT ON public.cob_casos, public.cob_interacoes, public.cob_promessas, public.cob_regua_etapas, public.cob_tarefas TO authenticated;
GRANT ALL ON public.cob_casos, public.cob_interacoes, public.cob_promessas, public.cob_regua_etapas, public.cob_tarefas TO service_role;
ALTER TABLE public.cob_casos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cob_interacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cob_promessas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cob_regua_etapas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cob_tarefas ENABLE ROW LEVEL SECURITY;
CREATE POLICY cob_r ON public.cob_casos FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));
CREATE POLICY cob_r ON public.cob_interacoes FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));
CREATE POLICY cob_r ON public.cob_promessas FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));
CREATE POLICY cob_r ON public.cob_regua_etapas FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));
CREATE POLICY cob_r ON public.cob_tarefas FOR SELECT TO authenticated USING (public.cob_pode(auth.uid()));

INSERT INTO public.cob_regua_etapas(dias,acao,prazo_dias,mensagem) VALUES
 (1,'Lembrete amigável',1,'Olá {nome}, notamos uma parcela vencida de {valor}. Podemos ajudar?'),
 (3,'Contato por telefone',1,'Olá {nome}, sua parcela de {valor} segue em aberto. Vamos combinar o pagamento?'),
 (7,'Negociação',2,'Olá {nome}, gostaríamos de negociar o saldo vencido de {valor}.'),
 (15,'Avaliar encaminhamento',3,'Olá {nome}, o saldo de {valor} está em atraso há 15 dias.')
ON CONFLICT DO NOTHING;

-- parcelas a receber em aberto por devedor
CREATE OR REPLACE FUNCTION public.cob_parcelas_abertas() RETURNS TABLE(installment_id uuid, title_id uuid, party_id uuid, numero text, vencimento date, saldo_cents bigint, valor_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  select i.id, t.id, coalesce(t.pagador_party_id,t.party_id), t.numero, i.vencimento, public.fin_installment_saldo(i.id)::bigint, i.valor_cents
  from financial_installments i join financial_titles t on t.id=i.title_id
  where t.direction='receivable' and t.status not in ('cancelado','rascunho')
    and i.settlement_status in ('nao_liquidado','parcial') and coalesce(t.pagador_party_id,t.party_id) is not null $$;
REVOKE ALL ON FUNCTION public.cob_parcelas_abertas() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cob_carteira() RETURNS TABLE(party_id uuid, nome text, documento text, etapa text, responsavel_id uuid, responsavel_nome text,
  vencido_cents bigint, a_vencer_cents bigint, parcelas_vencidas int, maior_atraso int, proxima_acao date, proxima_acao_titulo text,
  promessa_status text, promessa_data date, cidade text, uf text, pausa_ate date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN QUERY
  with p as (select * from public.cob_parcelas_abertas() where saldo_cents>0),
  agg as (select p.party_id,
     sum(case when p.vencimento<hoje then p.saldo_cents else 0 end)::bigint venc,
     sum(case when p.vencimento>=hoje then p.saldo_cents else 0 end)::bigint aven,
     count(*) filter (where p.vencimento<hoje)::int qv,
     coalesce(max(hoje-p.vencimento) filter (where p.vencimento<hoje),0)::int ma
   from p group by p.party_id having sum(case when p.vencimento<hoje then p.saldo_cents else 0 end)>0)
  select a.party_id, pa.display_name::text, null::text, coalesce(c.etapa,'novo_atraso'), c.responsavel_id, pr.full_name::text,
    a.venc, a.aven, a.qv, a.ma,
    (select min(t.vence_em) from cob_tarefas t where t.party_id=a.party_id and t.status='aberta'),
    (select t.titulo from cob_tarefas t where t.party_id=a.party_id and t.status='aberta' order by t.vence_em limit 1),
    (select pm.status from cob_promessas pm where pm.party_id=a.party_id and pm.status in ('vigente','descumprida') order by pm.created_at desc limit 1),
    (select pm.data_prometida from cob_promessas pm where pm.party_id=a.party_id and pm.status in ('vigente','descumprida') order by pm.created_at desc limit 1),
    (select ad.cidade::text from party_addresses ad where ad.party_id=a.party_id limit 1),
    (select ad.uf::text from party_addresses ad where ad.party_id=a.party_id limit 1),
    c.pausa_ate
  from agg a join parties pa on pa.id=a.party_id
  left join cob_casos c on c.party_id=a.party_id
  left join profiles pr on pr.id=c.responsavel_id;
END $$;
GRANT EXECUTE ON FUNCTION public.cob_carteira() TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_devedor(_party uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  select jsonb_build_object(
    'pessoa', (select jsonb_build_object('id',pa.id,'nome',pa.display_name) from parties pa where pa.id=_party),
    'caso', (select to_jsonb(c) from cob_casos c where c.party_id=_party),
    'contatos', coalesce((select jsonb_agg(jsonb_build_object('tipo',cp.kind,'valor',cp.value)) from contact_points cp where cp.party_id=_party),'[]'),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('installment_id',p.installment_id,'title_id',p.title_id,'numero',p.numero,'vencimento',p.vencimento,'saldo_cents',p.saldo_cents,'valor_cents',p.valor_cents,'atraso',greatest(hoje-p.vencimento,0)) order by p.vencimento) from public.cob_parcelas_abertas() p where p.party_id=_party and p.saldo_cents>0),'[]'),
    'interacoes', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('autor',pr.full_name) order by x.created_at desc) from cob_interacoes x left join profiles pr on pr.id=x.autor_id where x.party_id=_party),'[]'),
    'promessas', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from cob_promessas x where x.party_id=_party),'[]'),
    'tarefas', coalesce((select jsonb_agg(to_jsonb(x) order by x.vence_em) from cob_tarefas x where x.party_id=_party),'[]'),
    'recebimentos', coalesce((select jsonb_agg(jsonb_build_object('data',s.data_pagamento,'valor_cents',s.valor_cents,'installment_id',s.installment_id) order by s.data_pagamento desc)
        from financial_settlements s join financial_installments i on i.id=s.installment_id join financial_titles t on t.id=i.title_id
        where coalesce(t.pagador_party_id,t.party_id)=_party and t.direction='receivable'),'[]')
  ) into r;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.cob_devedor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_registrar(_party uuid, _tipo text, _resultado text, _obs text, _parcelas uuid[] DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF _tipo in ('etapa','correcao') THEN RAISE EXCEPTION 'Tipo reservado'; END IF;
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id) VALUES(_party,_tipo,_resultado,left(_obs,2000),coalesce(_parcelas,'{}'),auth.uid()) RETURNING id INTO v;
  INSERT INTO cob_casos(party_id,updated_by) VALUES(_party,auth.uid()) ON CONFLICT (party_id) DO UPDATE SET updated_at=now(), updated_by=auth.uid();
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.cob_registrar(uuid,text,text,text,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_mover_etapa(_party uuid, _etapa text, _responsavel uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  INSERT INTO cob_casos(party_id,etapa,responsavel_id,updated_by) VALUES(_party,_etapa,_responsavel,auth.uid())
  ON CONFLICT (party_id) DO UPDATE SET etapa=_etapa, responsavel_id=coalesce(_responsavel,cob_casos.responsavel_id), updated_at=now(), updated_by=auth.uid();
  INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id) VALUES(_party,'etapa','Etapa: '||_etapa,auth.uid());
END $$;
GRANT EXECUTE ON FUNCTION public.cob_mover_etapa(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_promessa_criar(_party uuid, _valor bigint, _data date, _parcelas uuid[], _obs text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.cob_promessa_criar(uuid,bigint,date,uuid[],text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_promessa_cancelar(_id uuid, _motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF coalesce(trim(_motivo),'')='' THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  UPDATE cob_promessas SET status='cancelada', cancel_motivo=_motivo, avaliada_em=now() WHERE id=_id AND status='vigente';
END $$;
GRANT EXECUTE ON FUNCTION public.cob_promessa_cancelar(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_tarefa_criar(_party uuid, _titulo text, _vence date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  INSERT INTO cob_tarefas(party_id,titulo,vence_em,autor_id,responsavel_id) VALUES(_party,_titulo,_vence,auth.uid(),auth.uid()) RETURNING id INTO v; RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.cob_tarefa_criar(uuid,text,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_tarefa_concluir(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  UPDATE cob_tarefas SET status='concluida', concluida_por=auth.uid(), concluida_em=now() WHERE id=_id AND status='aberta';
END $$;
GRANT EXECUTE ON FUNCTION public.cob_tarefa_concluir(uuid) TO authenticated;

-- régua: idempotente, agrupada por devedor, respeita pausa, avalia promessas
CREATE OR REPLACE FUNCTION public.cob_regua_executar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; criadas int:=0; canceladas int:=0; pm record; saldo bigint; n int;
BEGIN
  -- promessas vencidas: avalia por saldo atual vs saldo inicial
  FOR pm IN select * from cob_promessas where status='vigente' and data_prometida < hoje LOOP
    select coalesce(sum(saldo_cents),0) into saldo from public.cob_parcelas_abertas() where installment_id = any(pm.installment_ids);
    UPDATE cob_promessas SET avaliada_em=now(), status = case when pm.saldo_inicial_cents - saldo >= pm.valor_cents or saldo=0 then 'cumprida'
       when pm.saldo_inicial_cents - saldo > 0 then 'parcial' else 'descumprida' end WHERE id=pm.id;
    UPDATE cob_casos SET pausa_ate=null, pausa_motivo=null WHERE party_id=pm.party_id;
  END LOOP;
  -- cancela tarefas da régua cujas parcelas já não têm saldo
  UPDATE cob_tarefas t SET status='cancelada', motivo_fim='Parcelas quitadas ou canceladas'
   WHERE t.status='aberta' and t.origem='regua'
     and not exists (select 1 from public.cob_parcelas_abertas() p where p.installment_id = any(t.installment_ids) and p.saldo_cents>0);
  GET DIAGNOSTICS canceladas = ROW_COUNT;
  -- cria tarefas por devedor e etapa
  INSERT INTO cob_tarefas(party_id,origem,regua_dias,chave,titulo,installment_ids,vence_em,responsavel_id)
  select p.party_id,'regua',e.dias,'regua:'||p.party_id||':'||e.dias||':'||min(p.vencimento),
         'D+'||e.dias||' · '||e.acao, array_agg(p.installment_id), hoje+e.prazo_dias, coalesce(c.responsavel_id,e.responsavel_id)
  from public.cob_parcelas_abertas() p
  join cob_regua_etapas e on e.ativo and hoje - p.vencimento >= e.dias
  left join cob_casos c on c.party_id=p.party_id
  where p.saldo_cents>0 and (c.pausa_ate is null or c.pausa_ate < hoje)
    and not exists (select 1 from cob_regua_etapas e2 where e2.ativo and e2.dias>e.dias and hoje-p.vencimento>=e2.dias)
  group by p.party_id,e.dias,e.acao,e.prazo_dias,c.responsavel_id,e.responsavel_id
  ON CONFLICT (chave) DO NOTHING;
  GET DIAGNOSTICS criadas = ROW_COUNT;
  RETURN jsonb_build_object('criadas',criadas,'canceladas',canceladas,'data',hoje);
END $$;
REVOKE ALL ON FUNCTION public.cob_regua_executar() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cob_regua_executar() TO service_role;