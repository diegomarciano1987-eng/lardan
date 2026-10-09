CREATE OR REPLACE FUNCTION public.fin_classificacoes(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_busca text := nullif(_filtros->>'busca','');
        v_ent uuid := nullif(_filtros->>'entidade_id','')::uuid;
        v_dir text := nullif(_filtros->>'direction','');
        v_lim int := least(coalesce((_filtros->>'limit')::int, 20), 50);
        v_lim_planos int := least(coalesce((_filtros->>'limit')::int, 500), 500);
        v_naturezas text[];
begin
  if not has_capability(auth.uid(),'finance.view')
     and not has_capability(auth.uid(),'finance.dashboard.view') then
    raise exception 'Sem permissão';
  end if;
  v_naturezas := case v_dir
    when 'receivable' then array['receita','deducao','ativo','passivo','resultado']
    when 'payable' then array['custo','despesa','passivo','ativo','resultado']
    else array['receita','deducao','custo','despesa','ativo','passivo','resultado'] end;

  return jsonb_build_object(
    'planos', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'codigo',c.codigo,'nome',c.nome,
        'natureza',c.natureza::text,'entidade',c.business_entity_id) order by c.codigo)
      from (select * from chart_of_accounts c where c.is_active and c.aceita_lancamento
              and c.natureza::text = any(v_naturezas)
              and (c.vigencia_inicio is null or c.vigencia_inicio <= current_date)
              and (c.vigencia_fim is null or c.vigencia_fim >= current_date)
              and (v_ent is null or c.business_entity_id is null or c.business_entity_id = v_ent)
              and (v_busca is null or c.nome ilike '%'||v_busca||'%' or c.codigo ilike '%'||v_busca||'%')
            order by c.codigo limit v_lim_planos) c), '[]'::jsonb),
    'centros', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'codigo',c.codigo,'nome',c.nome,
        'entidade',c.business_entity_id) order by c.codigo)
      from (select * from cost_centers c where c.is_active
              and (c.vigencia_inicio is null or c.vigencia_inicio <= current_date)
              and (c.vigencia_fim is null or c.vigencia_fim >= current_date)
              and (v_ent is null or c.business_entity_id is null or c.business_entity_id = v_ent)
              and (v_busca is null or c.nome ilike '%'||v_busca||'%' or c.codigo ilike '%'||v_busca||'%')
            order by c.codigo limit v_lim) c), '[]'::jsonb),
    'entidades', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,
        'nome',coalesce(e.trade_name,e.legal_name)) order by coalesce(e.trade_name,e.legal_name))
      from (select * from business_entities e where e.is_active
              and (v_busca is null or coalesce(e.trade_name,'') ilike '%'||v_busca||'%'
                   or e.legal_name ilike '%'||v_busca||'%')
            order by 1 limit v_lim) e), '[]'::jsonb),
    'formas', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'codigo',f.codigo,'nome',f.nome)
        order by f.nome)
      from (select * from payment_methods f where f.is_active
              and (v_busca is null or f.nome ilike '%'||v_busca||'%')
            order by f.nome limit v_lim) f), '[]'::jsonb),
    'contas', coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'nome',a.nome,'kind',a.kind::text)
        order by a.nome)
      from (select * from financial_accounts a where a.is_active and not a.is_homologacao
              and (v_ent is null or a.business_entity_id is null or a.business_entity_id = v_ent)
              and (v_busca is null or a.nome ilike '%'||v_busca||'%')
            order by a.nome limit v_lim) a), '[]'::jsonb)
  );
end $function$;
REVOKE EXECUTE ON FUNCTION public.fin_classificacoes(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fin_classificacoes(jsonb) TO authenticated;