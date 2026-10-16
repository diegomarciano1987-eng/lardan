
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.party_unificar(uuid,uuid,text,boolean)'::regprocedure);
  d := replace(d, $x$EXECUTE format('SELECT coalesce(jsonb_agg(id),''[]'') FROM %s WHERE %I=$1', fk.t, fk.col) INTO ids USING _duplicada;$x$,
                  $x$EXECUTE format('SELECT coalesce(jsonb_agg(coalesce(to_jsonb(z)->''id'', to_jsonb(%L::text))),''[]'') FROM %s z WHERE %I=$1', fk.col, fk.t, fk.col) INTO ids USING _duplicada;$x$);
  EXECUTE d;
END $$;

CREATE OR REPLACE FUNCTION public.party_duplicados()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability(auth.uid(),'registry.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(g ORDER BY g->>'tipo', g->>'nome') FROM (
    SELECT jsonb_build_object('tipo',tipo,'nome',min(x.display_name),'qtd',count(*),'cpfs_distintos',count(DISTINCT x.doc_digits),
      'cadastros',jsonb_agg(jsonb_build_object('id',x.id,'code',x.code,'nome',x.display_name,'cpf',x.doc_masked,'ativo',x.is_active,
        'papeis',(SELECT jsonb_agg(r.role) FROM party_roles r WHERE r.party_id=x.id)) ORDER BY (x.doc_digits IS NULL), x.created_at)) g
    FROM (SELECT p.id, 'mesmo CPF' tipo, 'cpf:'||p.doc_digits k FROM parties p WHERE p.doc_digits IS NOT NULL AND p.kind='pessoa'
          UNION ALL
          SELECT p.id, 'mesmo nome', 'nome:'||public.fin_unaccent_lower(regexp_replace(btrim(p.display_name),'\s+',' ','g')) FROM parties p WHERE p.kind='pessoa') c
    JOIN parties x ON x.id=c.id
    WHERE NOT (x.notes ILIKE '%Unificado em %')
    GROUP BY tipo, k HAVING count(*)>1 AND (tipo='mesmo CPF' OR count(DISTINCT x.doc_digits) <= 1)) q),'[]');
END $$;
REVOKE ALL ON FUNCTION public.party_duplicados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_duplicados() TO authenticated, service_role;
