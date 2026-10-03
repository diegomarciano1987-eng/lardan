CREATE OR REPLACE FUNCTION public.cob_carteira() RETURNS TABLE(party_id uuid, nome text, documento text, etapa text, responsavel_id uuid, responsavel_nome text,
  vencido_cents bigint, a_vencer_cents bigint, parcelas_vencidas int, maior_atraso int, proxima_acao date, proxima_acao_titulo text,
  promessa_status text, promessa_data date, cidade text, uf text, pausa_ate date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN QUERY
  with p as (select * from public.cob_parcelas_abertas() x where x.saldo_cents>0),
  agg as (select p.party_id,
     sum(case when p.vencimento<hoje then p.saldo_cents else 0 end)::bigint venc,
     sum(case when p.vencimento>=hoje then p.saldo_cents else 0 end)::bigint aven,
     count(*) filter (where p.vencimento<hoje)::int qv,
     coalesce(max(hoje-p.vencimento) filter (where p.vencimento<hoje),0)::int ma
   from p group by p.party_id having sum(case when p.vencimento<hoje then p.saldo_cents else 0 end)>0)
  select a.party_id, pa.display_name::text, pa.doc_masked::text, coalesce(c.etapa,'novo_atraso'), c.responsavel_id, pr.full_name::text,
    a.venc, a.aven, a.qv, a.ma,
    (select min(t.vence_em) from cob_tarefas t where t.party_id=a.party_id and t.status='aberta'),
    (select t.titulo from cob_tarefas t where t.party_id=a.party_id and t.status='aberta' order by t.vence_em limit 1),
    (select pm.status from cob_promessas pm where pm.party_id=a.party_id and pm.status in ('vigente','descumprida') order by pm.created_at desc limit 1),
    (select pm.data_prometida from cob_promessas pm where pm.party_id=a.party_id and pm.status in ('vigente','descumprida') order by pm.created_at desc limit 1),
    (select ad.city::text from party_addresses ad where ad.party_id=a.party_id order by ad.is_primary desc limit 1),
    (select ad.uf::text from party_addresses ad where ad.party_id=a.party_id order by ad.is_primary desc limit 1),
    c.pausa_ate
  from agg a join parties pa on pa.id=a.party_id
  left join cob_casos c on c.party_id=a.party_id
  left join profiles pr on pr.id=c.responsavel_id;
END $$;

CREATE OR REPLACE FUNCTION public.cob_devedor(_party uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  select jsonb_build_object(
    'pessoa', (select jsonb_build_object('id',pa.id,'nome',pa.display_name,'documento',pa.doc_masked) from parties pa where pa.id=_party),
    'endereco', (select jsonb_build_object('cidade',ad.city,'uf',ad.uf) from party_addresses ad where ad.party_id=_party order by ad.is_primary desc limit 1),
    'caso', (select to_jsonb(c) || jsonb_build_object('responsavel_nome',pr.full_name) from cob_casos c left join profiles pr on pr.id=c.responsavel_id where c.party_id=_party),
    'contatos', coalesce((select jsonb_agg(jsonb_build_object('tipo',cp.kind,'valor',cp.value)) from contact_points cp where cp.party_id=_party),'[]'),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('installment_id',p.installment_id,'title_id',p.title_id,'numero',p.numero,'vencimento',p.vencimento,'saldo_cents',p.saldo_cents,'valor_cents',p.valor_cents,'atraso',greatest(hoje-p.vencimento,0)) order by p.vencimento) from public.cob_parcelas_abertas() p where p.party_id=_party and p.saldo_cents>0),'[]'),
    'interacoes', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('autor',pr.full_name) order by x.created_at desc) from cob_interacoes x left join profiles pr on pr.id=x.autor_id where x.party_id=_party),'[]'),
    'promessas', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from cob_promessas x where x.party_id=_party),'[]'),
    'tarefas', coalesce((select jsonb_agg(to_jsonb(x) order by x.vence_em) from cob_tarefas x where x.party_id=_party),'[]'),
    'recebimentos', coalesce((select jsonb_agg(jsonb_build_object('data',s.data,'valor_cents',a.valor_cents,'installment_id',a.installment_id,'estorno',s.is_reversal) order by s.data desc)
        from financial_allocations a join financial_settlements s on s.id=a.settlement_id join financial_installments i on i.id=a.installment_id join financial_titles t on t.id=i.title_id
        where coalesce(t.pagador_party_id,t.party_id)=_party and t.direction='receivable'),'[]')
  ) into r;
  RETURN r;
END $$;