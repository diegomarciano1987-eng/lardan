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

  create temp table if not exists _dreg_base2 (mes text, chart_id uuid, codigo text, nome text, natureza text, asaas boolean, v bigint, linha text) on commit drop;
  truncate _dreg_base2;
  with b as (
    select to_char(date_trunc('month', b.data),'YYYY-MM') mes, b.chart_id, b.codigo, b.nome, b.natureza,
           coalesce(b.contraparte ilike '%asaas%', false) asaas,
           sum(case when b.natureza = 'receita' then b.valor_cents else -b.valor_cents end)::bigint v
    from fin_dre_base(v_ini, v_ate, v_regime, v_cc, v_ent) b
    where b.natureza in ('receita','deducao','custo','despesa') and b.chart_id is not null
    group by 1,2,3,4,5,6
  ), mapa as (
    select distinct on (anc.root) anc.root, mp.estrutura_codigo linha from (
      with recursive a as (
        select c.id root, c.id, c.parent_id, 0 d from chart_of_accounts c where c.id in (select distinct chart_id from b)
        union all select a.root, c.id, c.parent_id, a.d + 1 from chart_of_accounts c join a on c.id = a.parent_id where a.d < 10)
      select * from a) anc
    join fin_dre_mapa mp on mp.chart_id = anc.id and mp.versao = v_ver order by anc.root, anc.d
  )
  insert into _dreg_base2 select b.mes, b.chart_id, b.codigo, b.nome, b.natureza, b.asaas, b.v, coalesce(m.linha, 'fora_estrutura')
  from b left join mapa m on m.root = b.chart_id;

  with meses as (
    select to_char(g,'YYYY-MM') mes, to_char(g - v_off,'YYYY-MM') mes_comp, g::date ini
    from generate_series(v_de, date_trunc('month', v_ate), interval '1 month') g
  ),
  est as (select * from fin_dre_estrutura where versao = v_ver and ativo),
  grupo_mes as (select linha, mes, sum(v)::bigint v from _dreg_base2 group by 1,2),
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
    from (select linha, chart_id, codigo, nome, mes, sum(v)::bigint v from _dreg_base2 where mes >= to_char(v_de,'YYYY-MM') group by 1,2,3,4,5) x
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
      coalesce(sum(v) filter (where asaas and natureza in ('custo','despesa')),0)::bigint tarifas_asaas,
      coalesce(sum(v) filter (where (asaas or codigo in ('4.1.2','4.1.5')) and natureza in ('custo','despesa')),0)::bigint custo_cobranca
    from _dreg_base2 where mes >= to_char(v_de,'YYYY-MM')
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