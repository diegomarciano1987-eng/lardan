create table public.fin_dre_estrutura (
  id uuid primary key default gen_random_uuid(),
  versao integer not null default 1,
  codigo text not null,
  rotulo text not null,
  ordem integer not null,
  tipo text not null check (tipo in ('grupo','subtotal','indicador')),
  sinal smallint not null default -1 check (sinal in (-1, 1)),
  formula text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (versao, codigo)
);
comment on column public.fin_dre_estrutura.formula is 'Subtotal: "acumulado" = soma de todos os grupos anteriores na ordem.';
grant select on public.fin_dre_estrutura to authenticated;
grant all on public.fin_dre_estrutura to service_role;
alter table public.fin_dre_estrutura enable row level security;
create policy "dre estrutura leitura" on public.fin_dre_estrutura for select to authenticated
  using (public.has_capability(auth.uid(), 'finance.dre.view'));

insert into public.fin_dre_estrutura (versao, codigo, rotulo, ordem, tipo, sinal, formula) values
 (1,'receita_bruta','Receita bruta',10,'grupo',1,null),
 (1,'deducoes','(−) Deduções',20,'grupo',-1,null),
 (1,'receita_liquida','= Receita líquida',30,'subtotal',1,'acumulado'),
 (1,'cmv','(−) CMV',40,'grupo',-1,null),
 (1,'lucro_bruto','= Lucro bruto',50,'subtotal',1,'acumulado'),
 (1,'comerciais','(−) Despesas comerciais',60,'grupo',-1,null),
 (1,'perdas','(−) Perdas da rede',70,'grupo',-1,null),
 (1,'administrativas','(−) Despesas administrativas e de pessoal',80,'grupo',-1,null),
 (1,'ebitda','= EBITDA',90,'subtotal',1,'acumulado'),
 (1,'financeiro','(+/−) Resultado financeiro',100,'grupo',-1,null),
 (1,'depreciacao_ir','(−) Depreciação e impostos sobre o lucro',110,'grupo',-1,null),
 (1,'fora_estrutura','Contas fora da estrutura',115,'grupo',-1,null),
 (1,'lucro_liquido','= Lucro líquido',120,'subtotal',1,'acumulado');

create table public.fin_dre_mapa (
  id uuid primary key default gen_random_uuid(),
  versao integer not null default 1,
  chart_id uuid not null references public.chart_of_accounts(id) on delete cascade,
  estrutura_codigo text not null,
  proposta boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (versao, chart_id)
);
grant select on public.fin_dre_mapa to authenticated;
grant all on public.fin_dre_mapa to service_role;
alter table public.fin_dre_mapa enable row level security;
create policy "dre mapa leitura" on public.fin_dre_mapa for select to authenticated
  using (public.has_capability(auth.uid(), 'finance.dre.view'));

insert into public.fin_dre_mapa (versao, chart_id, estrutura_codigo)
select 1, c.id, case
    when c.codigo like '3.1.%' then 'receita_bruta'
    when c.codigo = '4.1.1' then 'deducoes'
    when c.codigo like '4.2.%' then 'cmv'
    when c.codigo like '4.3.%' or c.codigo like '5.6.%' then 'comerciais'
    when c.codigo like '5.2.%' or c.codigo like '5.3.%' or c.codigo like '5.4.%' or c.codigo like '5.5.%' then 'administrativas'
    else 'financeiro'
  end
from public.chart_of_accounts c
where c.natureza in ('receita','deducao','custo','despesa')
  and (c.codigo like '3.1.%' or c.codigo like '4.%' or c.codigo like '5.%' or c.codigo in ('7.1.6','7.2.3'));

create table public.fin_periodos (
  id uuid primary key default gen_random_uuid(),
  mes date not null check (mes = date_trunc('month', mes)::date),
  business_entity_id uuid references public.business_entities(id),
  situacao text not null default 'aberto' check (situacao in ('aberto','fechado')),
  fechado_por uuid,
  fechado_em timestamptz,
  motivo text,
  updated_at timestamptz not null default now()
);
create unique index fin_periodos_mes_ent on public.fin_periodos (mes, coalesce(business_entity_id, '00000000-0000-0000-0000-000000000000'::uuid));
grant select on public.fin_periodos to authenticated;
grant all on public.fin_periodos to service_role;
alter table public.fin_periodos enable row level security;
create policy "periodos leitura" on public.fin_periodos for select to authenticated
  using (public.has_capability(auth.uid(), 'finance.dre.view') or public.has_capability(auth.uid(), 'finance.payable.view')
      or public.has_capability(auth.uid(), 'finance.receivable.view'));

create table public.fin_orcamento (
  id uuid primary key default gen_random_uuid(),
  mes date not null check (mes = date_trunc('month', mes)::date),
  estrutura_codigo text not null,
  chart_id uuid references public.chart_of_accounts(id),
  cost_center_id uuid references public.cost_centers(id),
  valor_cents bigint not null check (valor_cents >= 0),
  origem text not null default 'tela',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
comment on column public.fin_orcamento.valor_cents is 'Valor positivo; o sinal vem de fin_dre_estrutura.sinal.';
create unique index fin_orcamento_chave on public.fin_orcamento (mes, estrutura_codigo,
  coalesce(chart_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid));
grant select on public.fin_orcamento to authenticated;
grant all on public.fin_orcamento to service_role;
alter table public.fin_orcamento enable row level security;
create policy "orcamento leitura" on public.fin_orcamento for select to authenticated
  using (public.has_capability(auth.uid(), 'finance.dre.view'));

insert into public.role_capabilities (role, capability) values
  ('master','finance.period.close'), ('master','finance.period.reopen'), ('master','finance.budget.manage'),
  ('diretoria','finance.period.close'), ('diretoria','finance.period.reopen'), ('diretoria','finance.budget.manage'),
  ('financeiro','finance.period.close'), ('financeiro','finance.budget.manage')
on conflict do nothing;

create or replace function public.fin_periodo_fechado(_data date, _ent uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _data is not null and exists (
    select 1 from public.fin_periodos p
    where p.situacao = 'fechado' and p.mes = date_trunc('month', _data)::date
      and (p.business_entity_id is null or p.business_entity_id is not distinct from _ent));
$$;

create or replace function public.fin_periodo_guard_title()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if public.fin_periodo_fechado(coalesce(new.competencia, new.emissao), new.business_entity_id) then
      raise exception 'Período fechado: % não aceita novos lançamentos', to_char(coalesce(new.competencia, new.emissao),'MM/YYYY');
    end if;
  elsif (new.valor_cents, new.competencia, new.emissao, new.chart_account_id, new.cost_center_id, new.status, new.business_entity_id)
        is distinct from (old.valor_cents, old.competencia, old.emissao, old.chart_account_id, old.cost_center_id, old.status, old.business_entity_id) then
    if public.fin_periodo_fechado(coalesce(old.competencia, old.emissao), old.business_entity_id)
       or public.fin_periodo_fechado(coalesce(new.competencia, new.emissao), new.business_entity_id) then
      raise exception 'Período fechado: alteração ou reclassificação bloqueada em %', to_char(coalesce(old.competencia, old.emissao),'MM/YYYY');
    end if;
  end if;
  return new;
end $$;
create trigger fin_periodo_guard_title before insert or update on public.financial_titles
  for each row execute function public.fin_periodo_guard_title();

create or replace function public.fin_periodo_guard_installment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ent uuid; v_emi date; v_comp date;
begin
  select business_entity_id, emissao, competencia into v_ent, v_emi, v_comp from public.financial_titles where id = new.title_id;
  if tg_op = 'INSERT' then
    if public.fin_periodo_fechado(coalesce(new.competencia, v_comp, v_emi), v_ent) then
      raise exception 'Período fechado: % não aceita novas parcelas', to_char(coalesce(new.competencia, v_comp, v_emi),'MM/YYYY');
    end if;
  elsif (new.valor_cents, new.competencia) is distinct from (old.valor_cents, old.competencia) then
    if public.fin_periodo_fechado(coalesce(old.competencia, v_comp, v_emi), v_ent)
       or public.fin_periodo_fechado(coalesce(new.competencia, v_comp, v_emi), v_ent) then
      raise exception 'Período fechado: alteração de parcela bloqueada';
    end if;
  end if;
  return new;
end $$;
create trigger fin_periodo_guard_installment before insert or update on public.financial_installments
  for each row execute function public.fin_periodo_guard_installment();

create or replace function public.fin_periodo_guard_settlement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.fin_periodo_fechado(new.data, null) then
    raise exception 'Período fechado: baixa com data em % bloqueada', to_char(new.data,'MM/YYYY');
  end if;
  return new;
end $$;
create trigger fin_periodo_guard_settlement before insert on public.financial_settlements
  for each row execute function public.fin_periodo_guard_settlement();

create or replace function public.fin_periodo_fechar(_mes date, _ent uuid, _motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', _mes)::date;
begin
  if not has_capability(auth.uid(), 'finance.period.close') then raise exception 'Sem permissão para fechar período'; end if;
  insert into fin_periodos (mes, business_entity_id, situacao, fechado_por, fechado_em, motivo)
  values (v_mes, _ent, 'fechado', auth.uid(), now(), nullif(trim(_motivo),''))
  on conflict (mes, coalesce(business_entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set situacao='fechado', fechado_por=auth.uid(), fechado_em=now(), motivo=excluded.motivo, updated_at=now();
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'fin.periodo.fechar', 'fin_periodos', to_char(v_mes,'YYYY-MM'), jsonb_build_object('empresa', _ent, 'motivo', _motivo));
  return jsonb_build_object('mes', v_mes, 'situacao', 'fechado');
end $$;

create or replace function public.fin_periodo_reabrir(_mes date, _ent uuid, _motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', _mes)::date; v_n int;
begin
  if not has_capability(auth.uid(), 'finance.period.reopen') then raise exception 'Sem permissão para reabrir período'; end if;
  if coalesce(length(trim(_motivo)),0) < 5 then raise exception 'Informe o motivo da reabertura'; end if;
  update fin_periodos set situacao='aberto', motivo=trim(_motivo), updated_at=now()
   where mes = v_mes and business_entity_id is not distinct from _ent and situacao='fechado';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Período não está fechado'; end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'fin.periodo.reabrir', 'fin_periodos', to_char(v_mes,'YYYY-MM'), jsonb_build_object('empresa', _ent, 'motivo', trim(_motivo)));
  return jsonb_build_object('mes', v_mes, 'situacao', 'aberto');
end $$;

create or replace function public.fin_dre_mapa_set(_chart uuid, _linha text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ver int := (select max(versao) from fin_dre_estrutura where ativo);
begin
  if not has_capability(auth.uid(), 'finance.settings.manage') then raise exception 'Sem permissão'; end if;
  if _linha is null or _linha = '' then
    delete from fin_dre_mapa where versao = v_ver and chart_id = _chart;
  else
    if not exists (select 1 from fin_dre_estrutura where versao=v_ver and codigo=_linha and tipo='grupo' and codigo <> 'fora_estrutura') then
      raise exception 'Linha da DRE inválida';
    end if;
    insert into fin_dre_mapa (versao, chart_id, estrutura_codigo, proposta, updated_by)
    values (v_ver, _chart, _linha, false, auth.uid())
    on conflict (versao, chart_id) do update set estrutura_codigo=excluded.estrutura_codigo, proposta=false, updated_by=auth.uid(), updated_at=now();
  end if;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'fin.dre.mapa', 'fin_dre_mapa', _chart::text, jsonb_build_object('linha', _linha, 'versao', v_ver));
end $$;

create or replace function public.fin_orcamento_salvar(_linhas jsonb, _origem text default 'tela')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_n int := 0; v_ver int := (select max(versao) from fin_dre_estrutura where ativo);
begin
  if not has_capability(auth.uid(), 'finance.budget.manage') then raise exception 'Sem permissão'; end if;
  if jsonb_typeof(_linhas) <> 'array' or jsonb_array_length(_linhas) > 5000 then raise exception 'Lote inválido (máx. 5000 linhas)'; end if;
  for r in select * from jsonb_array_elements(_linhas) loop
    if not exists (select 1 from fin_dre_estrutura where versao=v_ver and codigo = r->>'linha' and tipo='grupo') then
      raise exception 'Linha da DRE desconhecida: %', r->>'linha';
    end if;
    if (r->>'valor_cents')::bigint < 0 then raise exception 'Valor negativo não é aceito (o sinal vem da linha)'; end if;
    insert into fin_orcamento (mes, estrutura_codigo, chart_id, cost_center_id, valor_cents, origem, updated_by)
    values (date_trunc('month', (r->>'mes')::date)::date, r->>'linha', nullif(r->>'chart_id','')::uuid,
            nullif(r->>'cost_center_id','')::uuid, (r->>'valor_cents')::bigint, coalesce(_origem,'tela'), auth.uid())
    on conflict (mes, estrutura_codigo, coalesce(chart_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set valor_cents=excluded.valor_cents, origem=excluded.origem, updated_by=auth.uid(), updated_at=now();
    v_n := v_n + 1;
  end loop;
  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'fin.orcamento.salvar', 'fin_orcamento', null, jsonb_build_object('linhas', v_n, 'origem', _origem));
  return jsonb_build_object('gravadas', v_n);
end $$;

create or replace function public.fin_dre_gerencial(_filtros jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_de date := date_trunc('month', coalesce(nullif(_filtros->>'de','')::date, (now() at time zone 'America/Sao_Paulo')::date))::date;
  v_ate date := coalesce(nullif(_filtros->>'ate','')::date, (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + interval '1 month - 1 day')::date);
  v_regime text := coalesce(_filtros->>'regime','competencia');
  v_cc uuid := nullif(_filtros->>'centro_custo_id','')::uuid;
  v_ent uuid := nullif(_filtros->>'entidade_id','')::uuid;
  v_comp text := coalesce(nullif(_filtros->>'comparativo',''),'mes_anterior');
  v_ver int := (select max(versao) from fin_dre_estrutura where ativo);
  v_ini date; v_off interval; v_res jsonb;
begin
  if not has_capability(auth.uid(),'finance.dre.view') then raise exception 'Sem permissão'; end if;
  if v_ate < v_de then raise exception 'Período inválido'; end if;
  if v_regime not in ('competencia','caixa') then raise exception 'Regime inválido'; end if;
  if v_comp not in ('mes_anterior','ano_anterior','orcado') then raise exception 'Comparativo inválido'; end if;
  if (extract(year from v_ate) * 12 + extract(month from v_ate)) - (extract(year from v_de) * 12 + extract(month from v_de)) >= 24 then
    raise exception 'Período máximo de 24 meses';
  end if;
  v_off := case v_comp when 'ano_anterior' then interval '12 months' else interval '1 month' end;
  v_ini := (v_de - greatest(v_off, interval '3 months'))::date;

  create temp table if not exists _dreg_base (mes text, chart_id uuid, codigo text, nome text, natureza text, origem text, contraparte text, v bigint, linha text) on commit drop;
  truncate _dreg_base;
  insert into _dreg_base
  select to_char(date_trunc('month', b.data),'YYYY-MM'), b.chart_id, b.codigo, b.nome, b.natureza, b.origem, b.contraparte,
         case when b.natureza = 'receita' then b.valor_cents else -b.valor_cents end, 'fora_estrutura'
  from fin_dre_base(v_ini, v_ate, v_regime, v_cc, v_ent) b
  where b.natureza in ('receita','deducao','custo','despesa') and b.chart_id is not null;

  update _dreg_base d set linha = m.linha from (
    with recursive anc as (
      select c.id root, c.id, c.parent_id, 0 d from chart_of_accounts c where c.id in (select distinct chart_id from _dreg_base)
      union all select anc.root, c.id, c.parent_id, anc.d + 1 from chart_of_accounts c join anc on c.id = anc.parent_id where anc.d < 10)
    select distinct on (anc.root) anc.root, mp.estrutura_codigo linha
    from anc join fin_dre_mapa mp on mp.chart_id = anc.id and mp.versao = v_ver order by anc.root, anc.d
  ) m where m.root = d.chart_id;

  with meses as (
    select to_char(g,'YYYY-MM') mes, to_char(g - v_off,'YYYY-MM') mes_comp, g::date ini
    from generate_series(v_de, date_trunc('month', v_ate), interval '1 month') g
  ),
  est as (select * from fin_dre_estrutura where versao = v_ver and ativo),
  grupo_mes as (select linha, mes, sum(v)::bigint v from _dreg_base group by 1,2),
  orc as (
    select o.estrutura_codigo linha, to_char(o.mes,'YYYY-MM') mes, sum(o.valor_cents * e.sinal)::bigint v
    from fin_orcamento o join est e on e.codigo = o.estrutura_codigo
    where o.mes between v_de and v_ate and (v_cc is null or o.cost_center_id = v_cc or o.cost_center_id is null)
    group by 1,2
  ),
  celula as (
    select e.codigo, e.ordem, mm.mes,
      (case when e.tipo = 'grupo' then coalesce((select v from grupo_mes g where g.linha=e.codigo and g.mes=mm.mes),0)
           else coalesce((select sum(g.v) from grupo_mes g join est e2 on e2.codigo=g.linha and e2.tipo='grupo' and e2.ordem < e.ordem where g.mes=mm.mes),0) end)::bigint atual,
      (case when v_comp='orcado' then
             case when e.tipo='grupo' then coalesce((select v from orc o where o.linha=e.codigo and o.mes=mm.mes),0)
                  else coalesce((select sum(o.v) from orc o join est e2 on e2.codigo=o.linha and e2.ordem < e.ordem where o.mes=mm.mes),0) end
           else
             case when e.tipo='grupo' then coalesce((select v from grupo_mes g where g.linha=e.codigo and g.mes=mm.mes_comp),0)
                  else coalesce((select sum(g.v) from grupo_mes g join est e2 on e2.codigo=g.linha and e2.tipo='grupo' and e2.ordem < e.ordem where g.mes=mm.mes_comp),0) end
      end)::bigint comp,
      (select coalesce(sum(g.v),0)/3.0 from grupo_mes g where e.tipo='grupo' and g.linha=e.codigo
         and g.mes in (to_char(mm.ini - interval '1 month','YYYY-MM'), to_char(mm.ini - interval '2 months','YYYY-MM'), to_char(mm.ini - interval '3 months','YYYY-MM'))) media3
    from est e cross join meses mm
  ),
  rl as (select mes, atual from celula where codigo='receita_liquida'),
  rl_total as (select coalesce(sum(atual),0) t from rl),
  contas as (
    select linha, chart_id, codigo, nome, jsonb_object_agg(mes, v) valores, sum(v)::bigint total
    from (select linha, chart_id, codigo, nome, mes, sum(v)::bigint v from _dreg_base where mes >= to_char(v_de,'YYYY-MM') group by 1,2,3,4,5) x
    group by 1,2,3,4
  ),
  linhas as (
    select e.ordem, jsonb_build_object(
      'codigo', e.codigo, 'rotulo', e.rotulo, 'tipo', e.tipo, 'sinal', e.sinal, 'ordem', e.ordem,
      'valores', (select jsonb_object_agg(c.mes, c.atual) from celula c where c.codigo=e.codigo),
      'comparativo', (select jsonb_object_agg(c.mes, c.comp) from celula c where c.codigo=e.codigo),
      'pct_receita', (select jsonb_object_agg(c.mes, case when r.atual = 0 then null else round(c.atual * 100.0 / r.atual, 2) end)
                      from celula c join rl r on r.mes=c.mes where c.codigo=e.codigo),
      'total', (select sum(atual) from celula c where c.codigo=e.codigo),
      'total_comparativo', (select sum(comp) from celula c where c.codigo=e.codigo),
      'pct_receita_total', (select case when t = 0 then null else round((select sum(atual) from celula c where c.codigo=e.codigo) * 100.0 / t, 2) end from rl_total),
      'contas', coalesce((select jsonb_agg(jsonb_build_object('chart_id', k.chart_id, 'codigo', k.codigo, 'nome', k.nome,
                    'valores', k.valores, 'total', k.total) order by k.codigo) from contas k where k.linha=e.codigo and e.tipo='grupo'), '[]'::jsonb)
    ) j from est e
  ),
  alertas as (
    select jsonb_agg(a) j from (
      select jsonb_build_object('codigo', c.codigo, 'rotulo', e.rotulo, 'mes', c.mes, 'valor_cents', c.atual,
        'media3_cents', round(c.media3)::bigint, 'desvio_cents', c.atual - round(c.media3)::bigint,
        'variacao_pct', round((c.atual - c.media3) * 100.0 / abs(c.media3), 1),
        'pior', c.atual < c.media3) a
      from celula c join est e on e.codigo=c.codigo
      where e.tipo='grupo' and c.media3 <> 0 and abs(c.atual) > 100000
        and abs(c.atual - c.media3) > abs(c.media3) * 0.25
      order by abs(c.atual - c.media3) desc limit 5) z
  ),
  ind as (
    select
      coalesce(sum(v) filter (where codigo in ('4.3.1','4.3.2')),0)::bigint comissoes,
      coalesce(sum(v) filter (where contraparte ilike '%asaas%' and natureza in ('custo','despesa')),0)::bigint tarifas_asaas,
      coalesce(sum(v) filter (where (contraparte ilike '%asaas%' or codigo in ('4.1.2','4.1.5')) and natureza in ('custo','despesa')),0)::bigint custo_cobranca
    from _dreg_base where mes >= to_char(v_de,'YYYY-MM')
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate, 'regime', v_regime, 'comparativo', v_comp,
        'data_corte', case when v_regime='caixa' then least(v_ate, v_hoje) else v_ate end),
    'versao_estrutura', v_ver,
    'meses', (select jsonb_agg(mes order by mes) from meses),
    'meses_fechados', coalesce((select jsonb_agg(to_char(p.mes,'YYYY-MM') order by p.mes) from fin_periodos p
        where p.situacao='fechado' and p.mes between v_de and v_ate and (p.business_entity_id is null or p.business_entity_id is not distinct from v_ent)), '[]'::jsonb),
    'linhas', (select jsonb_agg(j order by ordem) from linhas),
    'alertas', coalesce((select j from alertas), '[]'::jsonb),
    'indicadores_lardan', (select jsonb_build_object(
        'receita_liquida_cents', (select t from rl_total),
        'comissoes_cents', -i.comissoes, 'tarifas_asaas_cents', -i.tarifas_asaas,
        'custo_cobranca_cents', -i.custo_cobranca,
        'recebido_cents', (select coalesce(sum(b.valor_cents),0)::bigint from fin_dre_base(v_de, v_ate, 'caixa', v_cc, v_ent) b where b.natureza='receita' and b.origem <> 'encargo'),
        'inadimplencia_representante', null,
        'inadimplencia_nota', 'Sem vínculo título × representante no cadastro; o indicador aparece quando o vínculo existir.')
      from ind i)
  ) into v_res;
  return v_res;
end $$;

revoke all on function public.fin_periodo_fechado(date, uuid) from public, anon;
revoke all on function public.fin_dre_gerencial(jsonb) from public, anon;
revoke all on function public.fin_periodo_fechar(date, uuid, text) from public, anon;
revoke all on function public.fin_periodo_reabrir(date, uuid, text) from public, anon;
revoke all on function public.fin_dre_mapa_set(uuid, text) from public, anon;
revoke all on function public.fin_orcamento_salvar(jsonb, text) from public, anon;
revoke all on function public.fin_periodo_guard_title() from public, anon, authenticated;
revoke all on function public.fin_periodo_guard_installment() from public, anon, authenticated;
revoke all on function public.fin_periodo_guard_settlement() from public, anon, authenticated;
grant execute on function public.fin_periodo_fechado(date, uuid) to authenticated, service_role;
grant execute on function public.fin_dre_gerencial(jsonb) to authenticated;
grant execute on function public.fin_periodo_fechar(date, uuid, text) to authenticated;
grant execute on function public.fin_periodo_reabrir(date, uuid, text) to authenticated;
grant execute on function public.fin_dre_mapa_set(uuid, text) to authenticated;
grant execute on function public.fin_orcamento_salvar(jsonb, text) to authenticated;