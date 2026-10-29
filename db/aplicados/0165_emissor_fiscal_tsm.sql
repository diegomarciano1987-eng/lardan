-- 0165 — Empresa emissora da NF-e: TSM COMERCIO DE SEMIJOIAS LTDA (LARDAN SEMIJOIAS).
-- Dados conferidos no SINTEGRA/PR em 22/10/2026 (PDF enviado pelo Diego em 29/10/2026) e no cadastro da Focus:
--   CNPJ 43.319.208/0001-80 · IE 90908301-01 · Simples Nacional · Av. dos Estudantes, 1277, Setor 1,
--   Ibiporã/PR, CEP 86200-055, IBGE 4109807 · (43) 9649-1234 · lardansemijoias@gmail.com
-- Liga a empresa à configuração fiscal (provedor Focus, homologação). A EMISSÃO REAL CONTINUA DESLIGADA.
-- Não cria pessoa nova, não apaga nada e pode rodar duas vezes.
DO $$
DECLARE v_party uuid; v_n int; v_entity uuid; v_cobr uuid; v_ibge text; v_end uuid;
BEGIN
  SELECT codigo_ibge INTO v_ibge FROM public.ibge_municipios WHERE uf = 'PR' AND nome = 'Ibiporã' LIMIT 1;
  v_ibge := coalesce(v_ibge, '4109807');

  -- pessoa da empresa (já existe, importada da planilha; nunca duplicar)
  SELECT count(*), min(id::text)::uuid INTO v_n, v_party FROM public.parties WHERE (doc_canon = '43319208000180' OR doc_digits = '43319208000180')
    AND NOT EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id = parties.id);
  IF v_n > 1 THEN RAISE EXCEPTION 'Mais de uma pessoa com o CNPJ da TSM (%). Unifique antes.', v_n; END IF;
  IF v_party IS NOT NULL THEN
    UPDATE public.parties SET legal_name = coalesce(nullif(legal_name, ''), 'TSM COMERCIO DE SEMIJOIAS LTDA'), updated_at = now() WHERE id = v_party;
    -- endereço principal = o do SINTEGRA (o que estava continua guardado, só deixa de ser o principal)
    SELECT id INTO v_end FROM public.party_addresses
     WHERE party_id = v_party AND regexp_replace(coalesce(postal_code, ''), '\D', '', 'g') = '86200055' AND street_number = '1277' LIMIT 1;
    IF v_end IS NULL THEN
      UPDATE public.party_addresses SET is_primary = false WHERE party_id = v_party AND is_primary;
      INSERT INTO public.party_addresses (party_id, label, street, street_number, district, city, uf, postal_code, ibge_city_code, country, is_primary, address_source)
      VALUES (v_party, 'Sede (SINTEGRA)', 'Avenida dos Estudantes', '1277', 'Setor 1', 'Ibiporã', 'PR', '86200055', v_ibge, 'Brasil', true, 'sintegra')
      RETURNING id INTO v_end;
    ELSE
      UPDATE public.party_addresses SET is_primary = false WHERE party_id = v_party AND is_primary AND id <> v_end;
      UPDATE public.party_addresses SET is_primary = true, street = 'Avenida dos Estudantes', district = 'Setor 1', city = 'Ibiporã', uf = 'PR',
             ibge_city_code = v_ibge, updated_at = now() WHERE id = v_end;
    END IF;
  END IF;

  -- empresa: pelo CNPJ; senão a empresa da cobrança Lardan se ainda não tiver CNPJ; senão cria
  SELECT id INTO v_entity FROM public.business_entities WHERE regexp_replace(coalesce(tax_id, ''), '\D', '', 'g') = '43319208000180' LIMIT 1;
  IF v_entity IS NULL THEN
    SELECT c.business_entity_id INTO v_cobr FROM public.consultora_cobranca_config c
      JOIN public.business_entities b ON b.id = c.business_entity_id
     WHERE c.id AND coalesce(regexp_replace(b.tax_id, '\D', '', 'g'), '') = '';
    v_entity := v_cobr;
  END IF;
  IF v_entity IS NULL THEN
    INSERT INTO public.business_entities (legal_name, trade_name, tax_id, state_registration, city, uf, is_active, party_id, notes)
    VALUES ('TSM COMERCIO DE SEMIJOIAS LTDA', 'LARDAN SEMIJOIAS', '43319208000180', '9090830101', 'Ibiporã', 'PR', true, v_party,
            'Emissora da NF-e. Dados do SINTEGRA/PR (22/10/2026). Simples Nacional.')
    RETURNING id INTO v_entity;
  ELSE
    UPDATE public.business_entities SET legal_name = 'TSM COMERCIO DE SEMIJOIAS LTDA', trade_name = 'LARDAN SEMIJOIAS', tax_id = '43319208000180',
           state_registration = '9090830101', city = 'Ibiporã', uf = 'PR', party_id = coalesce(party_id, v_party), is_active = true,
           notes = concat_ws(' ', nullif(notes, ''), 'Emissora da NF-e: dados do SINTEGRA/PR (22/10/2026), Simples Nacional.'), updated_at = now()
     WHERE id = v_entity;
  END IF;

  -- configuração fiscal: Focus em homologação, emissão real DESLIGADA
  UPDATE public.fiscal_settings SET emitter_entity_id = v_entity, provider = coalesce(provider, 'focus'),
         environment = CASE WHEN environment = 'nenhum' THEN 'homologacao' ELSE environment END, updated_at = now()
   WHERE id AND NOT emission_active;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (NULL, 'fiscal.emissor_cadastrado', 'business_entities', v_entity::text,
          jsonb_build_object('cnpj', '43319208000180', 'ie', '9090830101', 'ibge', v_ibge, 'party', v_party, 'fonte', 'SINTEGRA/PR 22/10/2026'));
END $$;
