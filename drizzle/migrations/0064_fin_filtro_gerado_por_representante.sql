-- Títulos cuja cobrança foi gerada por um representante (valor digitado ou parcela cobrada), com a carteira.
CREATE OR REPLACE FUNCTION public.rep_titulos_gerados() RETURNS TABLE(title_id uuid, rep_party_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT t.id, (a.payload->>'carteira')::uuid FROM public.audit_logs a
    JOIN public.financial_titles t ON t.id_externo = 'rep-avulsa:'||(a.payload->>'chave')
   WHERE a.action='representante.cobranca_avulsa' AND a.payload ? 'carteira'
  UNION
  SELECT i.title_id, (a.payload->>'carteira')::uuid FROM public.audit_logs a
    JOIN public.financial_installments i ON i.id::text = a.entity_id
   WHERE a.action='representante.cobranca_solicitada' AND a.payload ? 'carteira'
$fn$;
REVOKE ALL ON FUNCTION public.rep_titulos_gerados() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fin_representantes_filtro() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'nome',p.display_name,'titulos',x.n) ORDER BY p.display_name)
    FROM (SELECT DISTINCT pr.party_id FROM public.party_roles pr WHERE pr.role='representante') r
    JOIN public.parties p ON p.id=r.party_id
    LEFT JOIN LATERAL (SELECT count(DISTINCT g.title_id) n FROM public.rep_titulos_gerados() g WHERE g.rep_party_id=p.id) x ON true),'[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.fin_representantes_filtro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_representantes_filtro() TO authenticated;

-- Novo filtro _rep ('qualquer' = gerado por qualquer representante; uuid = um representante). Sem sobrecarga.
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fin_titles_list'::regproc);
  d := replace(d, '_ate date DEFAULT NULL::date)', '_ate date DEFAULT NULL::date, _rep text DEFAULT NULL::text)');
  d := replace(d, 'and (_entidade is null or t.business_entity_id = _entidade)',
    'and (_entidade is null or t.business_entity_id = _entidade)
       and (coalesce(_rep,'''') = '''' or t.id in (select g.title_id from public.rep_titulos_gerados() g where _rep = ''qualquer'' or g.rep_party_id::text = _rep))');
  IF position('_rep text' in d) = 0 OR position('rep_titulos_gerados' in d) = 0 THEN RAISE EXCEPTION 'fin_titles_list: ponto de edição não encontrado'; END IF;
  DROP FUNCTION public.fin_titles_list(text,text,text,text,integer,integer,uuid,uuid,uuid,boolean,date,date);
  EXECUTE d;

  d := pg_get_functiondef('public.fin_installments_list'::regproc);
  d := replace(d, '_offset integer DEFAULT 0)', '_offset integer DEFAULT 0, _rep text DEFAULT NULL::text)');
  d := replace(d, 'where t.direction = v_dir and t.status <> ''cancelado''',
    'where t.direction = v_dir and t.status <> ''cancelado''
      and (coalesce(_rep,'''') = '''' or t.id in (select g.title_id from public.rep_titulos_gerados() g where _rep = ''qualquer'' or g.rep_party_id::text = _rep))');
  IF position('_rep text' in d) = 0 OR position('rep_titulos_gerados' in d) = 0 THEN RAISE EXCEPTION 'fin_installments_list: ponto de edição não encontrado'; END IF;
  DROP FUNCTION public.fin_installments_list(text,date,date,text,text,integer,integer);
  EXECUTE d;
END $do$;
REVOKE ALL ON FUNCTION public.fin_titles_list(text,text,text,text,integer,integer,uuid,uuid,uuid,boolean,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_titles_list(text,text,text,text,integer,integer,uuid,uuid,uuid,boolean,date,date,text) TO authenticated;
REVOKE ALL ON FUNCTION public.fin_installments_list(text,date,date,text,text,integer,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_installments_list(text,date,date,text,text,integer,integer,text) TO authenticated;
NOTIFY pgrst, 'reload schema';