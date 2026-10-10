-- Busca em TODAS as consultoras do sistema (representante não sabe de antemão quem é dele).
CREATE OR REPLACE FUNCTION public.rep_pode_assumir(_party uuid, _rep uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT public.rep_portal_pode(_rep) AND (
    public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro','cobranca']::public.app_role[])
    OR NOT EXISTS (SELECT 1 FROM public.consultant_profiles c JOIN public.parties p ON p.id=c.party_id
                   WHERE c.party_id=_party AND c.representative_party_id IS NOT NULL AND c.representative_party_id<>_rep AND p.status='ativo'))
$fn$;
REVOKE ALL ON FUNCTION public.rep_pode_assumir(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_pode_assumir(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rep_portal_busca_todas(_rep uuid, _busca text, _pagina int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE termo text := public.fin_unaccent_lower(btrim(coalesce(_busca,''))); r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  IF length(termo) < 2 THEN RETURN jsonb_build_object('total',0,'itens','[]'::jsonb); END IF;
  WITH cand AS (
    SELECT p.id FROM public.parties p
    WHERE (EXISTS (SELECT 1 FROM public.consultant_profiles c WHERE c.party_id=p.id)
        OR EXISTS (SELECT 1 FROM public.party_roles pr WHERE pr.party_id=p.id AND pr.role IN ('consultora','revendedora','candidata')))
      AND (SELECT bool_and(public.fin_unaccent_lower(p.display_name||' '||coalesce(p.code,'')) LIKE '%'||w||'%')
           FROM unnest(string_to_array(termo,' ')) w WHERE w<>'')
  ), base AS (
    SELECT p.id, p.code, p.display_name, p.status::text status,
      (SELECT a.city||'/'||a.uf FROM public.party_addresses a WHERE a.party_id=p.id ORDER BY a.is_primary DESC NULLS LAST LIMIT 1) cidade,
      c.representative_party_id rep_id,
      (SELECT rp.display_name FROM public.parties rp WHERE rp.id=c.representative_party_id) rep_nome,
      coalesce(c.representative_party_id=_rep,false) na_carteira,
      public.rep_pode_assumir(p.id,_rep) pode_assumir,
      (SELECT count(*) FROM public.kit_cycles k WHERE k.consultora_party_id=p.id AND k.status::text NOT IN ('encerrada','cancelada')) maletas,
      coalesce((SELECT sum(i.valor_cents - coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a WHERE a.installment_id=i.id),0))
        FROM public.financial_titles t JOIN public.financial_installments i ON i.title_id=t.id
        WHERE t.party_id=p.id AND t.direction='receivable' AND t.status='ativo'),0) aberto_cents
    FROM cand JOIN public.parties p ON p.id=cand.id LEFT JOIN public.consultant_profiles c ON c.party_id=p.id
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM base),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM base ORDER BY na_carteira DESC, maletas DESC, display_name LIMIT 50 OFFSET (greatest(_pagina,1)-1)*50) x),'[]'::jsonb)) INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_portal_busca_todas(uuid,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_portal_busca_todas(uuid,text,int) TO authenticated;

-- Traz a consultora para a carteira (sem representante, inativa, ou back-office). Auditado.
CREATE OR REPLACE FUNCTION public.rep_consultora_assumir(_party uuid, _rep uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE antes uuid; nome_rep text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  SELECT representative_party_id INTO antes FROM public.consultant_profiles WHERE party_id=_party;
  IF antes = _rep THEN RETURN false; END IF;
  IF NOT public.rep_pode_assumir(_party,_rep) THEN
    SELECT display_name INTO nome_rep FROM public.parties WHERE id=antes;
    RAISE EXCEPTION 'Consultora ativa na carteira de %. Fale com a Lardan.', coalesce(nome_rep,'outro representante');
  END IF;
  INSERT INTO public.consultant_profiles(party_id, representative_party_id) VALUES (_party,_rep)
  ON CONFLICT (party_id) DO UPDATE SET representative_party_id=EXCLUDED.representative_party_id, updated_at=now();
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (auth.uid(),'representante.consultora_assumida','parties',_party::text,jsonb_build_object('de',antes,'para',_rep));
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_consultora_assumir(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_consultora_assumir(uuid,uuid) TO authenticated;

-- Ficha com acesso pela carteira OU por consultora que pode ser assumida.
CREATE OR REPLACE FUNCTION public.rep_consultora_ficha_rep(_party uuid, _rep uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE dono uuid; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  SELECT representative_party_id INTO dono FROM public.consultant_profiles WHERE party_id=_party;
  IF coalesce(dono<>_rep,true) AND NOT public.rep_pode_assumir(_party,_rep) THEN RAISE EXCEPTION 'Consultora ativa na carteira de outro representante.'; END IF;
  WITH ab AS (
    SELECT i.id installment_id, t.numero, i.vencimento,
      i.valor_cents - coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a WHERE a.installment_id=i.id),0) saldo_cents
    FROM public.financial_titles t JOIN public.financial_installments i ON i.title_id=t.id
    WHERE t.party_id=_party AND t.direction='receivable' AND t.status='ativo')
  SELECT jsonb_build_object(
    'id',p.id,'code',p.code,'nome',p.display_name,'status',p.status::text,'doc_masked',p.doc_masked,'rep',dono,
    'na_carteira',coalesce(dono=_rep,false),'rep_nome',(SELECT display_name FROM public.parties WHERE id=dono),
    'contatos',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',cp.kind::text,'value',cp.value)) FROM public.contact_points cp WHERE cp.party_id=p.id),'[]'::jsonb),
    'endereco',(SELECT jsonb_build_object('rua',a.street,'numero',a.street_number,'complemento',a.complement,'bairro',a.district,'cidade',a.city,'uf',a.uf,'cep',a.postal_code,'referencia',a.reference)
                FROM public.party_addresses a WHERE a.party_id=p.id ORDER BY a.is_primary DESC NULLS LAST LIMIT 1),
    'parcelas',coalesce((SELECT jsonb_agg(jsonb_build_object('installment_id',ab.installment_id,'numero',ab.numero,'vencimento',ab.vencimento,'saldo_cents',ab.saldo_cents,
                 'party_id',p.id,'display_name',p.display_name,'code',p.code) ORDER BY ab.vencimento) FROM ab WHERE ab.saldo_cents>0),'[]'::jsonb),
    'aberto_cents',coalesce((SELECT sum(saldo_cents) FROM ab WHERE saldo_cents>0),0),
    'vencido_cents',coalesce((SELECT sum(saldo_cents) FROM ab WHERE saldo_cents>0 AND vencimento<hoje),0),
    'maletas',coalesce((SELECT jsonb_agg(jsonb_build_object('status',k.status::text,'desde',k.created_at) ORDER BY k.created_at DESC)
                FROM public.kit_cycles k WHERE k.consultora_party_id=p.id AND k.status::text NOT IN ('encerrada','cancelada')),'[]'::jsonb),
    'cheques',coalesce((SELECT jsonb_agg(jsonb_build_object('numero',c.numero,'valor_cents',c.valor_cents,'bom_para',c.bom_para,'status',c.status) ORDER BY c.bom_para DESC)
                FROM public.fin_cheques c WHERE c.recebido_de_party_id=p.id),'[]'::jsonb)
  ) INTO r FROM public.parties p WHERE p.id=_party;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.rep_consultora_ficha_rep(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_consultora_ficha_rep(uuid,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';