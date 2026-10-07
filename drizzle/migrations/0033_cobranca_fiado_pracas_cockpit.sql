CREATE TABLE public.cob_pracas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo int NOT NULL UNIQUE,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cob_pracas TO authenticated;
GRANT ALL ON public.cob_pracas TO service_role;
ALTER TABLE public.cob_pracas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe interna vê praças" ON public.cob_pracas FOR SELECT TO authenticated
  USING (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'registry.view') OR public.has_capability(auth.uid(), 'registry.finance.view'));

ALTER TABLE public.consultant_profiles ADD COLUMN IF NOT EXISTS praca_id uuid REFERENCES public.cob_pracas(id);

CREATE TABLE public.party_codigos_legados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  sistema text NOT NULL,
  codigo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sistema, codigo)
);
CREATE INDEX ON public.party_codigos_legados(party_id);
GRANT SELECT ON public.party_codigos_legados TO authenticated;
GRANT ALL ON public.party_codigos_legados TO service_role;
ALTER TABLE public.party_codigos_legados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe interna vê códigos legados" ON public.party_codigos_legados FOR SELECT TO authenticated
  USING (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'registry.view') OR public.has_capability(auth.uid(), 'registry.finance.view'));

-- Lastro: cada linha original da planilha de fiado, imutável, ligada ao título gerado
CREATE TABLE public.cob_fiado_linhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote text NOT NULL,
  linha int NOT NULL,
  payload jsonb NOT NULL,
  party_id uuid REFERENCES public.parties(id),
  title_id uuid REFERENCES public.financial_titles(id),
  representante_party_id uuid REFERENCES public.parties(id),
  praca_id uuid REFERENCES public.cob_pracas(id),
  data_cobranca date,
  vencimento date NOT NULL,
  parcela int,
  valor_cents bigint NOT NULL,
  situacao text NOT NULL CHECK (situacao IN ('importada','pendente')),
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lote, linha)
);
CREATE INDEX ON public.cob_fiado_linhas(party_id);
CREATE INDEX ON public.cob_fiado_linhas(title_id);
GRANT SELECT ON public.cob_fiado_linhas TO authenticated;
GRANT ALL ON public.cob_fiado_linhas TO service_role;
ALTER TABLE public.cob_fiado_linhas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cobrança e financeiro veem o lastro do fiado" ON public.cob_fiado_linhas FOR SELECT TO authenticated
  USING (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'registry.finance.view'));
CREATE OR REPLACE FUNCTION public.cob_fiado_linhas_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Lastro do fiado é imutável'; END $$;
CREATE TRIGGER cob_fiado_linhas_imutavel BEFORE UPDATE OR DELETE ON public.cob_fiado_linhas
  FOR EACH ROW WHEN (current_setting('lardan.fiado_rollback', true) IS DISTINCT FROM 'on') EXECUTE FUNCTION public.cob_fiado_linhas_imutavel();

-- Carteira com praça, representante, código legado e quem só tem parcelas a vencer
CREATE OR REPLACE FUNCTION public.cob_carteira2()
 RETURNS TABLE(party_id uuid, nome text, documento text, etapa text, responsavel_id uuid, responsavel_nome text, vencido_cents bigint, a_vencer_cents bigint, parcelas_vencidas integer, parcelas_abertas integer, maior_atraso integer, proxima_acao date, proxima_acao_titulo text, promessa_status text, promessa_data date, cidade text, uf text, pausa_ate date, praca_id uuid, praca_codigo int, praca_nome text, representante_id uuid, representante_nome text, codigo_legado text, tem_fiado boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN QUERY
  with p as (select * from public.cob_parcelas_abertas() x where x.saldo_cents>0),
  agg as (select p.party_id,
     sum(case when p.vencimento<hoje then p.saldo_cents else 0 end)::bigint venc,
     sum(case when p.vencimento>=hoje then p.saldo_cents else 0 end)::bigint aven,
     count(*) filter (where p.vencimento<hoje)::int qv, count(*)::int qa,
     coalesce(max(hoje-p.vencimento) filter (where p.vencimento<hoje),0)::int ma
   from p group by p.party_id)
  select a.party_id, pa.display_name::text, pa.doc_masked::text, coalesce(c.etapa,'novo_atraso'), c.responsavel_id, pr.full_name::text,
    a.venc, a.aven, a.qv, a.qa, a.ma,
    (select min(t.vence_em) from cob_tarefas t where t.party_id=a.party_id and t.status='aberta'),
    (select t.titulo from cob_tarefas t where t.party_id=a.party_id and t.status='aberta' order by t.vence_em limit 1),
    (select pm.status from cob_promessas pm where pm.party_id=a.party_id and pm.status in ('vigente','descumprida') order by pm.created_at desc limit 1),
    (select pm.data_prometida from cob_promessas pm where pm.party_id=a.party_id and pm.status in ('vigente','descumprida') order by pm.created_at desc limit 1),
    (select ad.city::text from party_addresses ad where ad.party_id=a.party_id order by ad.is_primary desc limit 1),
    (select ad.uf::text from party_addresses ad where ad.party_id=a.party_id order by ad.is_primary desc limit 1),
    c.pausa_ate,
    pc.id, pc.codigo, pc.nome::text, rp.id, rp.display_name::text,
    (select l.codigo from party_codigos_legados l where l.party_id=a.party_id and l.sistema='cliente' limit 1),
    exists(select 1 from cob_fiado_linhas f where f.party_id=a.party_id)
  from agg a join parties pa on pa.id=a.party_id
  left join cob_casos c on c.party_id=a.party_id
  left join profiles pr on pr.id=c.responsavel_id
  left join consultant_profiles cp on cp.party_id=a.party_id
  left join cob_pracas pc on pc.id=cp.praca_id
  left join parties rp on rp.id=cp.representative_party_id;
END $function$;
REVOKE ALL ON FUNCTION public.cob_carteira2() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_carteira2() TO authenticated;

-- Cockpit financeiro da consultora: débitos, fiado (lastro), recebimentos, comissões e maletas
CREATE OR REPLACE FUNCTION public.consultora_cockpit_financeiro(_party uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'registry.finance.view')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o financeiro desta pessoa';
  END IF;
  with ab as (select * from public.cob_parcelas_abertas() p where p.party_id=_party and p.saldo_cents>0)
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'vencido_cents', (select coalesce(sum(saldo_cents),0) from ab where vencimento<hoje),
      'a_vencer_cents', (select coalesce(sum(saldo_cents),0) from ab where vencimento>=hoje),
      'parcelas_abertas', (select count(*) from ab),
      'maior_atraso', (select coalesce(max(hoje-vencimento),0) from ab where vencimento<hoje),
      'recebido_cents', (select coalesce(sum(case when s.is_reversal then -a.valor_cents else a.valor_cents end),0)
         from financial_allocations a join financial_settlements s on s.id=a.settlement_id join financial_installments i on i.id=a.installment_id join financial_titles t on t.id=i.title_id
         where coalesce(t.pagador_party_id,t.party_id)=_party and t.direction='receivable'),
      'comissao_cents', (select coalesce(sum(comissao_cents),0) from referral_commissions where sponsor_party_id=_party),
      'praca', (select jsonb_build_object('codigo',pc.codigo,'nome',pc.nome) from consultant_profiles cp join cob_pracas pc on pc.id=cp.praca_id where cp.party_id=_party),
      'representante', (select rp.display_name from consultant_profiles cp join parties rp on rp.id=cp.representative_party_id where cp.party_id=_party),
      'codigo_legado', (select codigo from party_codigos_legados where party_id=_party and sistema='cliente' limit 1),
      'etapa_cobranca', (select etapa from cob_casos where party_id=_party)
    ),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('installment_id',ab.installment_id,'title_id',ab.title_id,'numero',ab.numero,'vencimento',ab.vencimento,'saldo_cents',ab.saldo_cents,'valor_cents',ab.valor_cents,'atraso',greatest(hoje-ab.vencimento,0),
        'origem',t.sistema_origem,'descricao',t.descricao) order by ab.vencimento) from ab join financial_titles t on t.id=ab.title_id),'[]'),
    'fiado', coalesce((select jsonb_agg(jsonb_build_object('linha',f.linha,'lote',f.lote,'data_cobranca',f.data_cobranca,'vencimento',f.vencimento,'parcela',f.parcela,'valor_cents',f.valor_cents,
        'situacao_titulo',(select i.settlement_status from financial_installments i where i.title_id=f.title_id limit 1),'title_id',f.title_id,'importado_em',f.created_at) order by f.vencimento) from cob_fiado_linhas f where f.party_id=_party),'[]'),
    'recebimentos', coalesce((select jsonb_agg(jsonb_build_object('data',s.data,'valor_cents',a.valor_cents,'estorno',s.is_reversal,'referencia',s.referencia,'titulo',t.numero) order by s.data desc)
        from financial_allocations a join financial_settlements s on s.id=a.settlement_id join financial_installments i on i.id=a.installment_id join financial_titles t on t.id=i.title_id
        where coalesce(t.pagador_party_id,t.party_id)=_party and t.direction='receivable'),'[]'),
    'comissoes', coalesce((select jsonb_agg(jsonb_build_object('id',rc.id,'data',rc.created_at,'indicada',ip.display_name,'venda_cents',rc.venda_cents,'percentual',rc.percentual,'comissao_cents',rc.comissao_cents,'status',rc.status) order by rc.created_at desc)
        from referral_commissions rc left join parties ip on ip.id=rc.indicada_party_id where rc.sponsor_party_id=_party),'[]'),
    'maletas', coalesce((select jsonb_agg(jsonb_build_object('id',kc.id,'ciclo',kc.cycle_no,'status',kc.status,'valor_cents',kc.reference_total_cents,'pecas',kc.quantity_total,'recebida',kc.received_at,'fechada',kc.closed_at) order by kc.created_at desc)
        from kit_cycles kc where kc.consultora_party_id=_party),'[]'),
    'promessas', coalesce((select jsonb_agg(jsonb_build_object('valor_cents',x.valor_cents,'data',x.data_prometida,'status',x.status) order by x.created_at desc) from cob_promessas x where x.party_id=_party),'[]')
  ) into r;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.consultora_cockpit_financeiro(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultora_cockpit_financeiro(uuid) TO authenticated;