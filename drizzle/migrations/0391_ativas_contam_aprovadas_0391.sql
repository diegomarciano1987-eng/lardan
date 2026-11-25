DO $$
DECLARE f text; d text; n text;
BEGIN
  FOREACH f IN ARRAY ARRAY['painel_visao_geral','network_geo_territorio','rep_portal_resumo','rep_portal_consultoras'] LOOP
    FOR d IN SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = f AND p.pronamespace = 'public'::regnamespace LOOP
      n := d;
      n := replace(n, 'filter (where status=''ativo'')', 'filter (where status in (''ativo'',''aprovado''))');
      n := replace(n, 'from base where status=''ativo''', 'from base where status in (''ativo'',''aprovado'')');
      n := replace(n, 'p.status=''ativo''', 'p.status in (''ativo'',''aprovado'')');
      n := replace(n, 'p.status<>''ativo''', 'p.status not in (''ativo'',''aprovado'')');
      IF n = d THEN RAISE EXCEPTION 'Nada para ajustar em %', f; END IF;
      EXECUTE n;
    END LOOP;
  END LOOP;
END $$;