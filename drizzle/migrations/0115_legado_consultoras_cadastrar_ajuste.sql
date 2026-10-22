CREATE OR REPLACE FUNCTION public.legado_consultoras_cadastrar(_lote text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l record; pid uuid; d text; criadas int := 0; puladas int := 0; nao_pessoa int := 0;
BEGIN
  IF NOT (coalesce(auth.role(),'') = 'service_role' AND auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Somente servidor.' USING errcode = '42501';
  END IF;
  IF length(coalesce(_lote,'')) < 4 THEN RAISE EXCEPTION 'Informe o lote.'; END IF;
  FOR l IN
    SELECT * FROM legado_consultoras lc
     WHERE lc.party_id IS NULL AND EXISTS (SELECT 1 FROM legado_maletas m WHERE m.codcli = lc.codcli)
     ORDER BY lc.codcli FOR UPDATE
  LOOP
    d := nullif(regexp_replace(coalesce(l.cpf,''), '\D', '', 'g'), '');
    -- registros internos (empresa, maleta de fotos) e CPF de dígitos repetidos não são pessoas
    IF upper(coalesce(l.nome,'')) ~ '(LARDAN|MALETA|DESIGN)' OR d ~ '^(\d)\1{10}$' THEN nao_pessoa := nao_pessoa + 1; CONTINUE; END IF;
    IF d IS NOT NULL AND EXISTS (SELECT 1 FROM parties p WHERE p.doc_digits = d) THEN puladas := puladas + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM party_codigos_legados c WHERE c.sistema = 'cliente' AND c.codigo = l.codcli::text) THEN puladas := puladas + 1; CONTINUE; END IF;
    IF d IS NOT NULL AND (length(d) <> 11 OR NOT public.doc_is_valid(public.doc_canon(d))) THEN d := NULL; END IF;
    INSERT INTO parties (kind, display_name, legal_name, doc, birth_date, status, is_active, doc_source, notes)
    VALUES ('pessoa', btrim(l.nome), btrim(l.nome), d, l.nascimento, 'ativo', true, CASE WHEN d IS NULL THEN NULL ELSE 'jflex' END,
            'Cadastrada a partir do histórico JFLEX (cód. ' || l.codcli || ', lote ' || _lote || ').')
    RETURNING id INTO pid;
    INSERT INTO party_roles (party_id, role, status, started_at, notes)
    VALUES (pid, 'consultora', 'ativo', coalesce(l.cadastro_em, current_date), 'Histórico JFLEX');
    INSERT INTO consultant_profiles (party_id) VALUES (pid) ON CONFLICT DO NOTHING;
    IF coalesce(l.rua, l.cidade) IS NOT NULL THEN
      INSERT INTO party_addresses (party_id, label, postal_code, street, street_number, no_number, complement, district, city, uf, ibge_city_code, is_primary, country, address_source)
      VALUES (pid, 'Principal', nullif(regexp_replace(coalesce(l.cep,''),'\D','','g'),''), l.rua, nullif(btrim(l.numero),''),
              nullif(btrim(l.numero),'') IS NULL, l.complemento, l.bairro, l.cidade, l.uf, l.ibge, true, 'BR', 'jflex');
    END IF;
    IF nullif(regexp_replace(coalesce(l.celular,''),'\D','','g'),'') IS NOT NULL THEN
      INSERT INTO contact_points (party_id, kind, label, value, is_primary) VALUES (pid, 'whatsapp', 'Celular', l.celular, true);
    END IF;
    IF nullif(btrim(coalesce(l.email,'')),'') IS NOT NULL THEN
      INSERT INTO contact_points (party_id, kind, label, value, is_primary) VALUES (pid, 'email', 'E-mail', btrim(l.email), false);
    END IF;
    INSERT INTO party_codigos_legados (party_id, sistema, codigo) VALUES (pid, 'cliente', l.codcli::text);
    UPDATE legado_consultoras SET party_id = pid, vinculo = 'codigo', vinculado_em = now() WHERE codcli = l.codcli;
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'legado.consultora_cadastrada', 'parties', pid::text, jsonb_build_object('codcli', l.codcli, 'lote', _lote, 'cpf_informado', d IS NOT NULL));
    criadas := criadas + 1;
  END LOOP;
  RETURN jsonb_build_object('criadas', criadas, 'puladas_ja_tem_cadastro', puladas, 'nao_pessoa', nao_pessoa);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_consultoras_cadastrar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.legado_consultoras_cadastrar(text) TO service_role;