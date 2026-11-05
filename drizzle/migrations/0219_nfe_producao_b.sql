-- 0216b — fiscal_focus_dados: servidor + IBGE pelo município e cidade pelo CEP
CREATE OR REPLACE FUNCTION public.fiscal_focus_dados(_party uuid, _itens jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p record; a record; pend text[] := '{}'; itens jsonb; email text; fone text; v_cidade text; v_uf text; v_ibge text; v_cep text;
BEGIN
  IF NOT (public.fiscal_focus_pode('emitir') OR public.fiscal_focus_eh_servidor()) THEN RAISE EXCEPTION 'Só o Master.' USING errcode = '42501'; END IF;
  _itens := coalesce(_itens, '[]'::jsonb);
  IF jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) > 60 THEN RAISE EXCEPTION 'Informe até 60 peças.'; END IF;
  SELECT * INTO p FROM parties WHERE id = _party;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não encontrada.'; END IF;
  SELECT * INTO a FROM party_addresses WHERE party_id = _party ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT value INTO email FROM contact_points WHERE party_id = _party AND kind = 'email' ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT regexp_replace(value, '[^0-9]', '', 'g') INTO fone FROM contact_points WHERE party_id = _party AND kind IN ('whatsapp', 'telefone')
   ORDER BY is_primary DESC, created_at LIMIT 1;

  v_cep := regexp_replace(coalesce(a.postal_code, ''), '[^0-9]', '', 'g');
  v_cidade := nullif(btrim(coalesce(a.city, '')), '');
  v_uf := upper(nullif(btrim(coalesce(a.uf, '')), ''));
  IF v_cidade IS NULL AND v_cep ~ '^[0-9]{8}$' THEN
    SELECT c.cidade, c.uf INTO v_cidade, v_uf FROM cep_cidades c WHERE c.cep = v_cep AND (v_uf IS NULL OR c.uf = v_uf);
  END IF;
  v_ibge := CASE WHEN a.ibge_city_code ~ '^[0-9]{7}$' THEN a.ibge_city_code END;
  IF v_ibge IS NULL AND v_cidade IS NOT NULL AND v_uf IS NOT NULL THEN
    SELECT m.codigo_ibge INTO v_ibge FROM ibge_municipios m
     WHERE m.uf = v_uf AND (m.nome_norm = lower(v_cidade) OR public.norm_name(m.nome) = public.norm_name(v_cidade)) LIMIT 1;
  END IF;

  IF p.doc_digits IS NULL OR length(p.doc_digits) <> 11 OR NOT public.doc_is_valid(public.doc_canon(p.doc_digits)) THEN pend := array_append(pend, 'CPF inválido ou ausente'::text); END IF;
  IF a.id IS NULL THEN pend := array_append(pend, 'sem endereço'::text);
  ELSE
    IF coalesce(btrim(a.street), '') = '' THEN pend := array_append(pend, 'endereço sem rua'::text); END IF;
    IF coalesce(btrim(a.district), '') = '' THEN pend := array_append(pend, 'endereço sem bairro'::text); END IF;
    IF v_ibge IS NULL THEN pend := array_append(pend, 'cidade sem código IBGE'::text); END IF;
    IF v_cep !~ '^[0-9]{8}$' THEN pend := array_append(pend, 'CEP inválido'::text); END IF;
    IF v_uf IS NULL THEN pend := array_append(pend, 'endereço sem UF'::text); END IF;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'variant_id', v.id, 'codigo', public.fiscal_peca_codigo(v.id), 'descricao', public.fiscal_peca_descricao(v.id),
            'ncm', coalesce(nullif(regexp_replace(coalesce(v.ncm, pr.ncm, ''), '[^0-9]', '', 'g'), ''), '71171900'),
           'quantidade', (i->>'quantidade')::int,
           'preco_varejo_cents', coalesce(nullif(v.price_cents, 0), pr.price_cents))
         ORDER BY ord)
    INTO itens
    FROM jsonb_array_elements(_itens) WITH ORDINALITY AS t(i, ord)
    JOIN product_variants v ON v.id = (i->>'variant_id')::uuid
    JOIN products pr ON pr.id = v.product_id;
  itens := coalesce(itens, '[]'::jsonb);
  IF jsonb_array_length(itens) <> jsonb_array_length(_itens) THEN RAISE EXCEPTION 'Peça não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(itens) x WHERE coalesce((x->>'quantidade')::int, 0) < 1) THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(itens) x WHERE coalesce((x->>'preco_varejo_cents')::bigint, 0) <= 0) THEN
    pend := array_append(pend, 'peça sem preço de varejo'::text);
  END IF;

  RETURN jsonb_build_object(
    'destinatario', jsonb_build_object(
       'party_id', p.id, 'nome', p.display_name, 'cpf', p.doc_digits,
       'logradouro', a.street, 'numero', coalesce(nullif(btrim(a.street_number), ''), 'S/N'), 'complemento', a.complement,
       'bairro', a.district, 'municipio', v_cidade, 'uf', v_uf, 'cep', v_cep,
       'codigo_municipio', v_ibge, 'email', email, 'telefone', fone),
    'itens', itens,
    'pendencias', to_jsonb(pend));
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_dados(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_dados(uuid,jsonb) TO authenticated, service_role;