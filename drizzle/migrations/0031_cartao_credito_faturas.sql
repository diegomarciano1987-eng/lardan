ALTER TYPE public.fin_account_kind ADD VALUE IF NOT EXISTS 'cartao_credito';

CREATE TABLE public.fin_cartoes (
  account_id uuid PRIMARY KEY REFERENCES public.financial_accounts(id),
  final_cartao text,
  bandeira text,
  dia_fechamento int CHECK (dia_fechamento BETWEEN 1 AND 31),
  dia_vencimento int NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  limite_cents bigint CHECK (limite_cents IS NULL OR limite_cents >= 0),
  conta_pagamento_id uuid REFERENCES public.financial_accounts(id),
  emissor_party_id uuid REFERENCES public.parties(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fin_cartao_faturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.financial_accounts(id),
  referencia text NOT NULL CHECK (referencia ~ '^\d{4}-\d{2}$'),
  vencimento date NOT NULL,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','fechada')),
  title_id uuid REFERENCES public.financial_titles(id),
  fechada_em timestamptz,
  fechada_por uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, referencia)
);
CREATE TABLE public.fin_cartao_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fatura_id uuid NOT NULL REFERENCES public.fin_cartao_faturas(id),
  account_id uuid NOT NULL REFERENCES public.financial_accounts(id),
  data date NOT NULL,
  descricao text NOT NULL,
  valor_cents bigint NOT NULL CHECK (valor_cents <> 0),
  parcela text,
  chart_account_id uuid REFERENCES public.chart_of_accounts(id),
  cost_center_id uuid REFERENCES public.cost_centers(id),
  classificado_por text CHECK (classificado_por IN ('ia','manual','historico')),
  ia_confianca numeric,
  ia_motivo text,
  hash text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, hash)
);
CREATE INDEX fin_cartao_lanc_fatura_idx ON public.fin_cartao_lancamentos(fatura_id);

GRANT SELECT ON public.fin_cartoes, public.fin_cartao_faturas, public.fin_cartao_lancamentos TO authenticated;
GRANT ALL ON public.fin_cartoes, public.fin_cartao_faturas, public.fin_cartao_lancamentos TO service_role;
ALTER TABLE public.fin_cartoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_cartao_faturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_cartao_lancamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financeiro le cartoes" ON public.fin_cartoes FOR SELECT TO authenticated USING (public.has_capability(auth.uid(),'finance.bank.view'));
CREATE POLICY "financeiro le faturas" ON public.fin_cartao_faturas FOR SELECT TO authenticated USING (public.has_capability(auth.uid(),'finance.bank.view'));
CREATE POLICY "financeiro le lancamentos cartao" ON public.fin_cartao_lancamentos FOR SELECT TO authenticated USING (public.has_capability(auth.uid(),'finance.bank.view'));

-- Criar cartão (conta + configuração) de forma atômica
CREATE OR REPLACE FUNCTION public.fin_cartao_criar(_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_id uuid;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão para cadastrar contas'; end if;
  if coalesce(trim(_payload->>'nome'),'') = '' then raise exception 'Informe o nome do cartão'; end if;
  if nullif(_payload->>'dia_vencimento','') is null then raise exception 'Informe o dia de vencimento da fatura'; end if;
  insert into financial_accounts (nome, kind, banco, saldo_inicial_cents, data_corte, created_by)
  values (trim(_payload->>'nome'), 'cartao_credito', nullif(trim(_payload->>'banco'),''), 0,
          (now() at time zone 'America/Sao_Paulo')::date, auth.uid())
  returning id into v_id;
  insert into fin_cartoes (account_id, final_cartao, bandeira, dia_fechamento, dia_vencimento, limite_cents, conta_pagamento_id, emissor_party_id)
  values (v_id, nullif(regexp_replace(coalesce(_payload->>'final_cartao',''),'\D','','g'),''), nullif(_payload->>'bandeira',''),
          nullif(_payload->>'dia_fechamento','')::int, (_payload->>'dia_vencimento')::int,
          nullif(_payload->>'limite_cents','')::bigint, nullif(_payload->>'conta_pagamento_id','')::uuid,
          nullif(_payload->>'emissor_party_id','')::uuid);
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.cartao.criar','financial_accounts',v_id, _payload);
  return v_id;
end $$;

CREATE OR REPLACE FUNCTION public.fin_cartao_config_set(_account uuid, _payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_antes jsonb;
begin
  if not has_capability(auth.uid(),'finance.bank.manage') then raise exception 'Sem permissão'; end if;
  select to_jsonb(c) into v_antes from fin_cartoes c where account_id = _account;
  if v_antes is null then raise exception 'Cartão não encontrado'; end if;
  update fin_cartoes set
    final_cartao = nullif(regexp_replace(coalesce(_payload->>'final_cartao',''),'\D','','g'),''),
    bandeira = nullif(_payload->>'bandeira',''),
    dia_fechamento = nullif(_payload->>'dia_fechamento','')::int,
    dia_vencimento = coalesce(nullif(_payload->>'dia_vencimento','')::int, dia_vencimento),
    limite_cents = nullif(_payload->>'limite_cents','')::bigint,
    conta_pagamento_id = nullif(_payload->>'conta_pagamento_id','')::uuid,
    emissor_party_id = nullif(_payload->>'emissor_party_id','')::uuid,
    updated_at = now()
  where account_id = _account;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.cartao.config','financial_accounts',_account, jsonb_build_object('antes',v_antes,'depois',_payload));
end $$;

CREATE OR REPLACE FUNCTION public.fin_cartao_painel(_account uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare r jsonb;
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'config', (select to_jsonb(c) || jsonb_build_object(
                 'conta_pagamento', (select nome from financial_accounts where id = c.conta_pagamento_id),
                 'emissor', (select coalesce(display_name, legal_name) from parties where id = c.emissor_party_id))
               from fin_cartoes c where c.account_id = _account),
    'faturas', coalesce((select jsonb_agg(x order by x->>'referencia' desc) from (
        select jsonb_build_object('id', f.id, 'referencia', f.referencia, 'vencimento', f.vencimento, 'status', f.status,
          'title_id', f.title_id,
          'total_cents', coalesce((select sum(valor_cents) from fin_cartao_lancamentos l where l.fatura_id = f.id),0),
          'qtd', (select count(*) from fin_cartao_lancamentos l where l.fatura_id = f.id),
          'sem_classificacao', (select count(*) from fin_cartao_lancamentos l where l.fatura_id = f.id and l.chart_account_id is null),
          'pago_cents', coalesce((select sum(a.valor_cents) from financial_installments i join financial_allocations a on a.installment_id = i.id where i.title_id = f.title_id),0),
          'titulo_numero', (select numero from financial_titles where id = f.title_id)) x
        from fin_cartao_faturas f where f.account_id = _account) s), '[]'::jsonb)
  ) into r;
  return r;
end $$;

CREATE OR REPLACE FUNCTION public.fin_cartao_fatura_abrir(_account uuid, _referencia text, _vencimento date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_id uuid;
begin
  if not has_capability(auth.uid(),'finance.payable.manage') then raise exception 'Sem permissão para lançar faturas'; end if;
  if not exists (select 1 from fin_cartoes where account_id = _account) then raise exception 'Conta não é um cartão de crédito'; end if;
  if _vencimento is null then raise exception 'Informe o vencimento da fatura'; end if;
  select id into v_id from fin_cartao_faturas where account_id = _account and referencia = _referencia;
  if v_id is not null then return v_id; end if;
  insert into fin_cartao_faturas (account_id, referencia, vencimento, created_by)
  values (_account, _referencia, _vencimento, auth.uid()) returning id into v_id;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.cartao.fatura_aberta','fin_cartao_faturas',v_id, jsonb_build_object('referencia',_referencia,'vencimento',_vencimento));
  return v_id;
end $$;

-- Importa linhas; cada linha traz data, descricao, valor_cents (gasto positivo, estorno negativo) e ocorrencia (repetições legítimas no mesmo arquivo)
CREATE OR REPLACE FUNCTION public.fin_cartao_importar(_fatura uuid, _linhas jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare f record; e jsonb; v_hash text; v_ins int := 0; v_rep int := 0; v_id uuid;
begin
  if not has_capability(auth.uid(),'finance.payable.manage') then raise exception 'Sem permissão para lançar faturas'; end if;
  select * into f from fin_cartao_faturas where id = _fatura for update;
  if f.id is null then raise exception 'Fatura não encontrada'; end if;
  if f.status <> 'aberta' then raise exception 'Fatura fechada: reabra para incluir gastos'; end if;
  if jsonb_typeof(_linhas) <> 'array' or jsonb_array_length(_linhas) = 0 then raise exception 'Nenhum gasto para importar'; end if;
  for e in select * from jsonb_array_elements(_linhas) loop
    if nullif(e->>'data','') is null or coalesce(trim(e->>'descricao'),'') = '' or coalesce((e->>'valor_cents')::bigint,0) = 0 then
      raise exception 'Linha inválida: data, descrição e valor são obrigatórios (%).', e->>'descricao';
    end if;
    v_hash := md5(f.account_id::text||'|'||(e->>'data')||'|'||lower(trim(e->>'descricao'))||'|'||(e->>'valor_cents')||'|'||coalesce(e->>'ocorrencia','1'));
    insert into fin_cartao_lancamentos (fatura_id, account_id, data, descricao, valor_cents, parcela, hash, created_by)
    values (_fatura, f.account_id, (e->>'data')::date, trim(e->>'descricao'), (e->>'valor_cents')::bigint,
            nullif(e->>'parcela',''), v_hash, auth.uid())
    on conflict (account_id, hash) do nothing returning id into v_id;
    if v_id is null then v_rep := v_rep + 1; else v_ins := v_ins + 1; end if;
    v_id := null;
  end loop;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.cartao.importar','fin_cartao_faturas',_fatura, jsonb_build_object('inseridos',v_ins,'repetidos',v_rep));
  return jsonb_build_object('inseridos', v_ins, 'repetidos', v_rep);
end $$;

CREATE OR REPLACE FUNCTION public.fin_cartao_fatura_detalhe(_fatura uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  return (select jsonb_build_object(
    'fatura', to_jsonb(f) || jsonb_build_object('cartao', fa.nome, 'titulo_numero', (select numero from financial_titles where id = f.title_id)),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'data', l.data, 'descricao', l.descricao, 'valor_cents', l.valor_cents,
        'parcela', l.parcela, 'chart_account_id', l.chart_account_id, 'chart', ca.codigo||' '||ca.nome,
        'cost_center_id', l.cost_center_id, 'centro', cc.nome,
        'classificado_por', l.classificado_por, 'ia_confianca', l.ia_confianca, 'ia_motivo', l.ia_motivo) order by l.data, l.created_at)
      from fin_cartao_lancamentos l left join chart_of_accounts ca on ca.id = l.chart_account_id
      left join cost_centers cc on cc.id = l.cost_center_id where l.fatura_id = f.id), '[]'::jsonb))
    from fin_cartao_faturas f join financial_accounts fa on fa.id = f.account_id where f.id = _fatura);
end $$;

-- Classifica gastos (manual, IA ou histórico). _itens: [{id, chart_account_id, cost_center_id, origem, confianca, motivo}]
CREATE OR REPLACE FUNCTION public.fin_cartao_classificar(_itens jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare e jsonb; n int := 0; v_ant record;
begin
  if not has_capability(auth.uid(),'finance.payable.manage') then raise exception 'Sem permissão'; end if;
  for e in select * from jsonb_array_elements(_itens) loop
    select l.* into v_ant from fin_cartao_lancamentos l where l.id = (e->>'id')::uuid;
    if v_ant.id is null then raise exception 'Gasto não encontrado'; end if;
    perform fin_validar_classificacao('payable', null, nullif(e->>'chart_account_id','')::uuid, nullif(e->>'cost_center_id','')::uuid, null, null);
    update fin_cartao_lancamentos set chart_account_id = nullif(e->>'chart_account_id','')::uuid,
      cost_center_id = nullif(e->>'cost_center_id','')::uuid,
      classificado_por = case when nullif(e->>'chart_account_id','') is null then null else coalesce(nullif(e->>'origem',''),'manual') end,
      ia_confianca = nullif(e->>'confianca','')::numeric, ia_motivo = nullif(e->>'motivo',''), updated_at = now()
    where id = v_ant.id;
    insert into audit_logs (actor_id, action, entity, entity_id, payload)
    values (auth.uid(),'financeiro.cartao.classificar','fin_cartao_lancamentos',v_ant.id,
      jsonb_build_object('antes', jsonb_build_object('chart', v_ant.chart_account_id, 'cc', v_ant.cost_center_id), 'depois', e));
    n := n + 1;
  end loop;
  return n;
end $$;

CREATE OR REPLACE FUNCTION public.fin_cartao_lancamento_excluir(_id uuid, _motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v record;
begin
  if not has_capability(auth.uid(),'finance.payable.manage') then raise exception 'Sem permissão'; end if;
  select l.*, f.status fstatus into v from fin_cartao_lancamentos l join fin_cartao_faturas f on f.id = l.fatura_id where l.id = _id;
  if v.id is null then raise exception 'Gasto não encontrado'; end if;
  if v.fstatus <> 'aberta' then raise exception 'Fatura fechada: reabra para excluir gastos'; end if;
  if coalesce(trim(_motivo),'') = '' then raise exception 'Informe o motivo'; end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.cartao.excluir','fin_cartao_lancamentos',_id, jsonb_build_object('linha', to_jsonb(v), 'motivo', _motivo));
  delete from fin_cartao_lancamentos where id = _id;
end $$;

-- Fecha a fatura: gera um único título a pagar no vencimento escolhido
CREATE OR REPLACE FUNCTION public.fin_cartao_fechar(_fatura uuid, _payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare f record; c record; v_total bigint; v_sem int; v_venc date; v_party uuid; v_conta uuid; v_tid uuid; v_nome text;
begin
  if not has_capability(auth.uid(),'finance.payable.manage') then raise exception 'Sem permissão para gerar contas a pagar'; end if;
  select * into f from fin_cartao_faturas where id = _fatura for update;
  if f.id is null then raise exception 'Fatura não encontrada'; end if;
  if f.status <> 'aberta' then raise exception 'Fatura já está fechada'; end if;
  select * into c from fin_cartoes where account_id = f.account_id;
  select nome into v_nome from financial_accounts where id = f.account_id;
  select coalesce(sum(valor_cents),0), count(*) filter (where chart_account_id is null) into v_total, v_sem
  from fin_cartao_lancamentos where fatura_id = _fatura;
  if v_sem > 0 then raise exception 'Ainda há % gasto(s) sem categoria. Classifique todos antes de fechar.', v_sem; end if;
  if v_total <= 0 then raise exception 'Total da fatura precisa ser maior que zero'; end if;
  v_venc := coalesce(nullif(_payload->>'vencimento','')::date, f.vencimento);
  v_party := coalesce(nullif(_payload->>'party_id','')::uuid, c.emissor_party_id);
  v_conta := coalesce(nullif(_payload->>'conta_pagamento_id','')::uuid, c.conta_pagamento_id);
  if v_party is null then raise exception 'Informe quem recebe o pagamento (banco emissor do cartão)'; end if;
  v_tid := fin_title_create(jsonb_build_object(
    'direction','payable','party_id',v_party,
    'descricao','Fatura cartão '||v_nome||' — '||to_char(to_date(f.referencia,'YYYY-MM'),'MM/YYYY'),
    'documento','FATURA-'||f.referencia, 'emissao', (now() at time zone 'America/Sao_Paulo')::date,
    'competencia', v_venc, 'valor_cents', v_total, 'financial_account_id', v_conta,
    'origem','cartao_fatura','id_externo','cartao:'||f.id, 'status','ativo',
    'observacao','Gerado pelo fechamento da fatura. Os gastos entram na DRE pela data de cada compra.',
    'parcelas', jsonb_build_array(jsonb_build_object('vencimento', v_venc, 'valor_cents', v_total))));
  update financial_titles set origem_id = f.id where id = v_tid;
  update fin_cartao_faturas set status = 'fechada', title_id = v_tid, vencimento = v_venc, fechada_em = now(), fechada_por = auth.uid()
  where id = _fatura;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.cartao.fechar','fin_cartao_faturas',_fatura, jsonb_build_object('title_id',v_tid,'total_cents',v_total,'vencimento',v_venc));
  return v_tid;
end $$;

CREATE OR REPLACE FUNCTION public.fin_cartao_reabrir(_fatura uuid, _motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare f record;
begin
  if not has_capability(auth.uid(),'finance.payable.manage') then raise exception 'Sem permissão'; end if;
  if coalesce(trim(_motivo),'') = '' then raise exception 'Informe o motivo da reabertura'; end if;
  select * into f from fin_cartao_faturas where id = _fatura for update;
  if f.id is null or f.status <> 'fechada' then raise exception 'Fatura não está fechada'; end if;
  if exists (select 1 from financial_installments i join financial_allocations a on a.installment_id = i.id where i.title_id = f.title_id) then
    raise exception 'Fatura já tem pagamento registrado: estorne o pagamento antes de reabrir';
  end if;
  perform fin_title_cancel(f.title_id, 'Fatura de cartão reaberta: '||_motivo);
  update fin_cartao_faturas set status = 'aberta', title_id = null, fechada_em = null, fechada_por = null where id = _fatura;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(),'financeiro.cartao.reabrir','fin_cartao_faturas',_fatura, jsonb_build_object('title_cancelado',f.title_id,'motivo',_motivo));
end $$;

REVOKE ALL ON FUNCTION public.fin_cartao_criar(jsonb), public.fin_cartao_config_set(uuid,jsonb), public.fin_cartao_painel(uuid),
  public.fin_cartao_fatura_abrir(uuid,text,date), public.fin_cartao_importar(uuid,jsonb), public.fin_cartao_fatura_detalhe(uuid),
  public.fin_cartao_classificar(jsonb), public.fin_cartao_lancamento_excluir(uuid,text), public.fin_cartao_fechar(uuid,jsonb),
  public.fin_cartao_reabrir(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_cartao_criar(jsonb), public.fin_cartao_config_set(uuid,jsonb), public.fin_cartao_painel(uuid),
  public.fin_cartao_fatura_abrir(uuid,text,date), public.fin_cartao_importar(uuid,jsonb), public.fin_cartao_fatura_detalhe(uuid),
  public.fin_cartao_classificar(jsonb), public.fin_cartao_lancamento_excluir(uuid,text), public.fin_cartao_fechar(uuid,jsonb),
  public.fin_cartao_reabrir(uuid,text) TO authenticated;

-- DRE: gastos de cartão entram pela data da compra (competência) e pela proporção paga da fatura (caixa); o título da fatura não conta duas vezes
CREATE OR REPLACE FUNCTION public.fin_dre_base(_de date, _ate date, _regime text, _cc uuid, _ent uuid)
 RETURNS TABLE(origem text, natureza text, chart_id uuid, codigo text, nome text, valor_cents bigint, title_id uuid, cc uuid, ref_id uuid, data date, descricao text, contraparte text, direction text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; cfg jsonb := fin_encargos_contas();
  v_lim date := case when _regime = 'caixa' then least(_ate, (now() at time zone 'America/Sao_Paulo')::date) else _ate end;
begin
  if _regime = 'competencia' then
    return query
    select 'titulo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome, i.valor_cents, t.id, t.cost_center_id, i.id,
           coalesce(i.competencia, t.competencia, t.emissao),
           t.descricao || case when i.total_parcelas > 1 then ' — parcela '||i.numero||'/'||i.total_parcelas else '' end,
           coalesce(p.display_name,p.legal_name,p.code), t.direction::text
    from financial_installments i join financial_titles t on t.id = i.title_id
    left join parties p on p.id = t.party_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    where t.status in ('ativo','aprovado') and t.origem is distinct from 'cartao_fatura'
      and coalesce(i.competencia, t.competencia, t.emissao) between _de and _ate
      and (_cc is null or t.cost_center_id = _cc) and (_ent is null or t.business_entity_id = _ent);

    return query
    select 'cartao'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome, l.valor_cents, f.title_id, l.cost_center_id, l.id,
           l.data, 'Cartão '||fa.nome||' — '||l.descricao, coalesce(p.display_name,p.legal_name,fa.nome), 'payable'::text
    from fin_cartao_lancamentos l
    join fin_cartao_faturas f on f.id = l.fatura_id
    join financial_accounts fa on fa.id = l.account_id
    left join fin_cartoes c on c.account_id = l.account_id
    left join parties p on p.id = c.emissor_party_id
    left join chart_of_accounts ca on ca.id = l.chart_account_id
    where not fa.is_homologacao and l.data between _de and _ate
      and (_cc is null or l.cost_center_id = _cc) and (_ent is null or fa.business_entity_id = _ent);
  else
    return query
    select 'titulo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome,
           case when s.is_reversal then -abs(al.valor_cents) else abs(al.valor_cents) end, t.id, t.cost_center_id, s.id,
           s.data, coalesce(s.referencia, t.descricao), coalesce(p.display_name,p.legal_name,p.code), t.direction::text
    from financial_settlements s
    join financial_accounts fa on fa.id = s.financial_account_id
    join financial_allocations al on al.settlement_id = s.id
    join financial_installments i on i.id = al.installment_id
    join financial_titles t on t.id = i.title_id
    left join parties p on p.id = t.party_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    where not fa.is_homologacao and s.data between _de and v_lim and t.status <> 'cancelado'
      and t.origem is distinct from 'cartao_fatura'
      and (_cc is null or t.cost_center_id = _cc) and (_ent is null or t.business_entity_id = _ent);

    return query
    with pg as (
      select s.id sid, s.data sdata, (case when s.is_reversal then -abs(al.valor_cents) else abs(al.valor_cents) end)::numeric aval,
             f.id fid, t.id tid, coalesce(p.display_name,p.legal_name,p.code) contra,
             (select sum(x.valor_cents) from fin_cartao_lancamentos x where x.fatura_id = f.id)::numeric tot
      from financial_settlements s
      join financial_accounts fa on fa.id = s.financial_account_id
      join financial_allocations al on al.settlement_id = s.id
      join financial_installments i on i.id = al.installment_id
      join financial_titles t on t.id = i.title_id
      join fin_cartao_faturas f on f.title_id = t.id
      left join parties p on p.id = t.party_id
      where t.origem = 'cartao_fatura' and not fa.is_homologacao and s.data between _de and v_lim and t.status <> 'cancelado'
        and (_ent is null or t.business_entity_id = _ent)
    ), ln as (
      select pg.*, l.id lid, l.descricao ldesc, l.chart_account_id lchart, l.cost_center_id lcc, l.valor_cents lval,
             sum(l.valor_cents) over (partition by pg.sid, pg.fid order by l.data, l.id)::numeric cum
      from pg join fin_cartao_lancamentos l on l.fatura_id = pg.fid
      where pg.tot is not null and pg.tot <> 0
    )
    select 'cartao'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome,
           (floor(ln.cum * ln.aval / ln.tot) - floor((ln.cum - ln.lval) * ln.aval / ln.tot))::bigint,
           ln.tid, ln.lcc, ln.lid, ln.sdata, 'Cartão (pago) — '||ln.ldesc, ln.contra, 'payable'::text
    from ln left join chart_of_accounts ca on ca.id = ln.lchart
    where (_cc is null or ln.lcc = _cc);

    return query
    select 'titulo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome,
           (case when j.kind in ('juros','multa') then -j.valor_cents else j.valor_cents end)::bigint,
           t.id, t.cost_center_id, j.id, s.data, 'Encargo separado da baixa: '||j.kind,
           coalesce(p.display_name,p.legal_name,p.code), t.direction::text
    from financial_adjustments j
    join financial_settlements s on s.id = j.settlement_id
    join financial_accounts fa on fa.id = s.financial_account_id
    join financial_installments i on i.id = j.installment_id
    join financial_titles t on t.id = i.title_id
    left join parties p on p.id = t.party_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    where j.kind in ('juros','multa','desconto','abatimento') and not s.is_reversal
      and not fa.is_homologacao and s.data between _de and v_lim and t.status <> 'cancelado'
      and (_cc is null or t.cost_center_id = _cc) and (_ent is null or t.business_entity_id = _ent);
  end if;

  return query
  select 'encargo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome, j.valor_cents::bigint,
         t.id, t.cost_center_id, j.id, coalesce(s.data, (j.created_at at time zone 'America/Sao_Paulo')::date),
         initcap(j.kind::text) || ' — ' || t.descricao, coalesce(p.display_name,p.legal_name,p.code), t.direction::text
  from financial_adjustments j
  join financial_installments i on i.id = j.installment_id
  join financial_titles t on t.id = i.title_id
  left join financial_settlements s on s.id = j.settlement_id
  left join financial_accounts fa on fa.id = s.financial_account_id
  left join parties p on p.id = t.party_id
  left join chart_of_accounts ca on ca.id = nullif(cfg->>(case
        when j.kind in ('juros','multa') and t.direction = 'receivable' then 'juros_recebidos'
        when j.kind in ('juros','multa') and t.direction = 'payable' then 'juros_pagos'
        when j.kind in ('desconto','abatimento') and t.direction = 'receivable' then 'descontos_concedidos'
        else 'nenhuma' end),'')::uuid
  where j.kind in ('juros','multa','desconto','abatimento') and t.status <> 'cancelado'
    and coalesce(s.is_reversal,false) = false and coalesce(fa.is_homologacao,false) = false
    and coalesce(s.data, (j.created_at at time zone 'America/Sao_Paulo')::date) between _de and v_lim
    and (_cc is null or t.cost_center_id = _cc) and (_ent is null or t.business_entity_id = _ent);

  return query
  select 'encargo'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome, abs(m.valor_cents)::bigint,
         tt.id, tt.cost_center_id, m.id, m.data, coalesce(m.descricao,'Tarifa') || ' — ' || fa.nome,
         tt.contraparte, 'payable'::text
  from financial_account_movements m
  join financial_accounts fa on fa.id = m.financial_account_id
  left join lateral (select t.id, t.cost_center_id, t.business_entity_id,
                            coalesce(p.display_name,p.legal_name,p.code) contraparte
                       from financial_allocations a join financial_installments i on i.id = a.installment_id
                       join financial_titles t on t.id = i.title_id left join parties p on p.id = t.party_id
                      where a.settlement_id = m.settlement_id order by a.created_at, a.id limit 1) tt on true
  left join chart_of_accounts ca on ca.id = nullif(cfg->>'tarifas','')::uuid
  where m.kind = 'ajuste' and m.settlement_id is not null and m.valor_cents < 0 and m.descricao ilike 'tarifa%'
    and not fa.is_homologacao and m.data between _de and v_lim
    and (_cc is null or tt.cost_center_id = _cc) and (_ent is null or tt.business_entity_id = _ent);
end $function$;