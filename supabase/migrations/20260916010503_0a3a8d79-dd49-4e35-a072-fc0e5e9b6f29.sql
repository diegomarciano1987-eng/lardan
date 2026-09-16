-- ============ apoio: dinheiro, código de barras, banho, fornecedor ============

CREATE OR REPLACE FUNCTION public.import_money(_v text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s text := btrim(coalesce(_v,'')); c int;
BEGIN
  IF s = '' THEN RETURN jsonb_build_object('vazio', true); END IF;
  IF s ~* '[0-9]\s*e\s*\+?\-?[0-9]' THEN
    RETURN jsonb_build_object('erro','O Excel entregou este valor em notação científica. Formate a coluna como texto ou número comum e reenvie.');
  END IF;
  -- 1.234 sem centavos é ambíguo: pode ser mil duzentos e trinta e quatro ou 1,234
  IF regexp_replace(s,'[^0-9,\.]','','g') ~ '^[0-9]{1,3}\.[0-9]{3}$' THEN
    RETURN jsonb_build_object('erro','Valor ambíguo ("'||s||'"): não dá para saber se é milhar ou decimal. Escreva com centavos, por exemplo 1.234,00.');
  END IF;
  c := public.parse_cents_any(s);
  IF c IS NULL THEN RETURN jsonb_build_object('erro','Valor inválido ("'||s||'").'); END IF;
  IF c < 0 THEN RETURN jsonb_build_object('erro','Valor negativo não é aceito ("'||s||'").'); END IF;
  RETURN jsonb_build_object('cents', c);
END $$;

CREATE OR REPLACE FUNCTION public.import_barcode(_v text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s text := regexp_replace(coalesce(_v,''), '\s+', '', 'g');
BEGIN
  IF s = '' THEN RETURN jsonb_build_object('vazio', true); END IF;
  IF s ~* '^[0-9]+([\.,][0-9]+)?e\+?[0-9]+$' THEN
    RETURN jsonb_build_object('erro','O código de barras veio em notação científica ("'||s||'") e perdeu dígitos. Formate a coluna como texto e reenvie.');
  END IF;
  IF s ~ '[\.,]' THEN
    RETURN jsonb_build_object('erro','O código de barras veio como número ("'||s||'") e pode ter perdido dígitos. Formate a coluna como texto e reenvie.');
  END IF;
  IF s !~ '^[A-Za-z0-9\-]+$' THEN
    RETURN jsonb_build_object('erro','Código de barras com caracteres inválidos ("'||s||'").');
  END IF;
  RETURN jsonb_build_object('code', s);
END $$;

CREATE OR REPLACE FUNCTION public.import_plating(_v text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT pt.id FROM public.plating_types pt
   WHERE pt.is_active
     AND ( public.norm_name(pt.name) = public.norm_name(_v)
        OR pt.code = lower(regexp_replace(public.norm_name(_v), '[^a-z0-9]+', '_', 'g'))
        OR upper(pt.sku_token) = upper(regexp_replace(coalesce(_v,''), '\s+', '', 'g')) )
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.import_supplier(_v text)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE s text := btrim(coalesce(_v,'')); doc text; r uuid;
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  doc := regexp_replace(s, '[^0-9]', '', 'g');
  IF length(doc) IN (11,14) THEN
    SELECT id INTO r FROM public.suppliers WHERE regexp_replace(coalesce(tax_id,''),'[^0-9]','','g') = doc LIMIT 1;
    IF r IS NOT NULL THEN RETURN r; END IF;
  END IF;
  SELECT id INTO r FROM public.suppliers WHERE public.norm_name(name) = public.norm_name(s) LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;
  SELECT id INTO r FROM public.suppliers WHERE public.norm_name(trade_name) = public.norm_name(s) LIMIT 1;
  RETURN r;
END $$;

-- ============ conferência (validação) com os campos novos ============

CREATE OR REPLACE FUNCTION public.import_job_validate(_job uuid, _limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE j public.import_jobs; r record; m jsonb; d jsonb; p jsonb; msgs jsonb; st text;
        c_sku text; c_leg text; c_ean text; c_nome text; q_raw text; q_num numeric;
        v_sku uuid; v_leg uuid; v_ean uuid; alvos uuid[];
        pode_custo boolean; custo int; preco int; feitas int := 0; vazia boolean;
        novo_formato boolean; txt text; mny jsonb; bar jsonb;
        cat_id uuid; sub_id uuid; sub_pai uuid; plat_id uuid;
        v_bruto int; v_banho int; v_verniz int; v_final int; soma int; just text;
        forn_bruto uuid; forn_banho uuid;
        nomes_novos text[] := ARRAY['codigo_interno','subcategoria','material_bruto','peso_bruto',
          'fornecedor_bruto','valor_bruto','cuidados','garantia','seo_titulo','seo_descricao',
          'nome_variante','fornecedor_banho','valor_banho','verniz','valor_verniz','valor_final',
          'peso_final','preco_variante','variante_padrao','variante_ativa','codigo_legado_produto'];
        k text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id = _job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF j.responsible_user_id IS DISTINCT FROM auth.uid()
     AND NOT (public.has_role(auth.uid(),'master') OR public.has_role(auth.uid(),'diretoria')) THEN
    RAISE EXCEPTION 'Lote fora do seu escopo.' USING ERRCODE='42501';
  END IF;
  IF j.status IN ('cancelado','concluido','concluido_com_erros') THEN
    RAISE EXCEPTION 'Lote encerrado (%).', j.status;
  END IF;
  IF j.status IN ('recebendo','recebido') THEN
    UPDATE public.import_jobs SET status = CASE WHEN status='recebendo' THEN 'recebido' ELSE status END WHERE id=_job;
    UPDATE public.import_jobs SET status='validando' WHERE id=_job;
  END IF;
  m := j.mapping; d := j.defaults;
  pode_custo := public.has_capability(auth.uid(),'catalog.cost.view');

  novo_formato := false;
  FOREACH k IN ARRAY nomes_novos LOOP
    IF nullif(trim(coalesce(m->>k,'')),'') IS NOT NULL THEN novo_formato := true; END IF;
  END LOOP;

  FOR r IN SELECT * FROM public.import_rows
            WHERE job_id = _job AND status = 'pendente'
            ORDER BY line_no LIMIT greatest(coalesce(_limit,500),1)
            FOR UPDATE SKIP LOCKED
  LOOP
    msgs := '[]'::jsonb; st := 'valido';

    SELECT NOT EXISTS (SELECT 1 FROM jsonb_each_text(coalesce(r.raw,'{}'::jsonb)) kv
                        WHERE nullif(trim(coalesce(kv.value,'')),'') IS NOT NULL)
      INTO vazia;
    IF vazia THEN
      UPDATE public.import_rows
         SET status='ignorado', error_code='linha_vazia', parsed=NULL,
             messages = jsonb_build_array(jsonb_build_object('aviso','Linha vazia ignorada.'))
       WHERE id = r.id;
      feitas := feitas + 1;
      CONTINUE;
    END IF;

    q_raw := nullif(trim(coalesce(r.raw->>(m->>'quantidade'), d->>'quantidade','')),'');
    q_num := public.parse_decimal_any(q_raw);

    -- dinheiro: cada valor passa pela leitura segura
    v_bruto := NULL; v_banho := NULL; v_verniz := NULL; v_final := NULL; custo := NULL; preco := NULL;

    mny := public.import_money(coalesce(r.raw->>(m->>'valor_bruto'), ''));
    IF mny ? 'erro' THEN st := 'erro';
      msgs := msgs || jsonb_build_object('campo','valor_bruto','erro',mny->>'erro','correcao','Use o formato 1.234,56.');
    ELSE v_bruto := (mny->>'cents')::int; END IF;

    mny := public.import_money(coalesce(r.raw->>(m->>'valor_banho'), ''));
    IF mny ? 'erro' THEN st := 'erro';
      msgs := msgs || jsonb_build_object('campo','valor_banho','erro',mny->>'erro','correcao','Use o formato 1.234,56.');
    ELSE v_banho := (mny->>'cents')::int; END IF;

    mny := public.import_money(coalesce(r.raw->>(m->>'valor_verniz'), ''));
    IF mny ? 'erro' THEN st := 'erro';
      msgs := msgs || jsonb_build_object('campo','valor_verniz','erro',mny->>'erro','correcao','Use o formato 1.234,56.');
    ELSE v_verniz := (mny->>'cents')::int; END IF;

    mny := public.import_money(coalesce(nullif(r.raw->>(m->>'valor_final'),''), r.raw->>(m->>'custo'), ''));
    IF mny ? 'erro' THEN st := 'erro';
      msgs := msgs || jsonb_build_object('campo','valor_final','erro',mny->>'erro','correcao','Use o formato 1.234,56.');
    ELSE v_final := (mny->>'cents')::int; END IF;
    custo := v_final;

    mny := public.import_money(coalesce(nullif(r.raw->>(m->>'preco_variante'),''),
                                        nullif(r.raw->>(m->>'preco'),''), d->>'preco', ''));
    IF mny ? 'erro' THEN st := 'erro';
      msgs := msgs || jsonb_build_object('campo','preco','erro',mny->>'erro','correcao','Use o formato 1.234,56.');
    ELSE preco := (mny->>'cents')::int; END IF;

    -- código de barras lido como texto
    bar := public.import_barcode(coalesce(r.raw->>(m->>'ean'),''));
    IF bar ? 'erro' THEN st := 'erro';
      msgs := msgs || jsonb_build_object('campo','ean','erro',bar->>'erro',
        'correcao','Formate a coluna do código de barras como texto no Excel e reenvie.');
      c_ean := NULL;
    ELSE c_ean := bar->>'code'; END IF;

    -- banho pela lista controlada
    txt := nullif(trim(coalesce(r.raw->>(m->>'tipo_banho'), r.raw->>(m->>'banho'), d->>'banho','')),'');
    plat_id := NULL;
    IF txt IS NOT NULL THEN
      plat_id := public.import_plating(txt);
      IF plat_id IS NULL THEN
        st := 'erro';
        msgs := msgs || jsonb_build_object('campo','banho','valor',txt,
          'erro','Banho "'||txt||'" não está na lista controlada de tipos de banho.',
          'correcao','Cadastre este tipo de banho ou corrija a planilha para um banho já existente (Ouro, Prata, Ródio Branco).');
      END IF;
    END IF;

    -- categoria e subcategoria
    cat_id := NULL; sub_id := NULL;
    txt := coalesce(nullif(trim(coalesce(r.raw->>(m->>'categoria'),'')),''), d->>'categoria');
    IF txt IS NOT NULL THEN
      SELECT id INTO cat_id FROM public.categories
        WHERE parent_id IS NULL AND public.norm_name(name)=public.norm_name(txt) LIMIT 1;
    END IF;
    txt := coalesce(nullif(trim(coalesce(r.raw->>(m->>'subcategoria'),'')),''), d->>'subcategoria');
    IF txt IS NOT NULL THEN
      SELECT id, parent_id INTO sub_id, sub_pai FROM public.categories
        WHERE public.norm_name(name)=public.norm_name(txt) AND parent_id IS NOT NULL LIMIT 1;
      IF sub_id IS NULL THEN
        st := 'erro';
        msgs := msgs || jsonb_build_object('campo','subcategoria','valor',txt,
          'erro','Subcategoria "'||txt||'" não existe.',
          'correcao','Cadastre a subcategoria antes de importar ou corrija a planilha.');
      ELSIF cat_id IS NULL THEN
        st := 'erro';
        msgs := msgs || jsonb_build_object('campo','categoria',
          'erro','Para usar subcategoria, a categoria informada precisa existir.',
          'correcao','Corrija o nome da categoria ou cadastre-a antes de importar.');
      ELSIF sub_pai IS DISTINCT FROM cat_id THEN
        st := 'erro';
        msgs := msgs || jsonb_build_object('campo','subcategoria','valor',txt,
          'erro','Esta subcategoria pertence a outra categoria.',
          'correcao','Informe a categoria correta ou escolha outra subcategoria.');
        sub_id := NULL;
      ELSIF EXISTS (SELECT 1 FROM public.categories c WHERE c.id = sub_pai AND c.parent_id IS NOT NULL) THEN
        st := 'erro';
        msgs := msgs || jsonb_build_object('campo','subcategoria',
          'erro','Terceiro nível de categoria não é aceito.','correcao','Use categoria e subcategoria apenas.');
        sub_id := NULL;
      END IF;
    END IF;

    -- fornecedores
    forn_bruto := public.import_supplier(coalesce(nullif(trim(coalesce(r.raw->>(m->>'fornecedor_bruto'),'')),''),
                                                  nullif(trim(coalesce(r.raw->>(m->>'fornecedor'),'')),''),
                                                  d->>'fornecedor'));
    forn_banho := public.import_supplier(nullif(trim(coalesce(r.raw->>(m->>'fornecedor_banho'),'')),''));

    p := jsonb_build_object(
      'formato',     CASE WHEN novo_formato THEN 'novo' ELSE 'legado' END,
      'nome',        coalesce(nullif(trim(coalesce(r.raw->>(m->>'nome'),'')),''), d->>'nome'),
      'codigo_interno', public.norm_code(r.raw->>(m->>'codigo_interno')),
      'codigo_legado_produto', public.norm_code(coalesce(nullif(r.raw->>(m->>'codigo_legado_produto'),''),
                                                         r.raw->>(m->>'codigo_legado'))),
      'descricao_curta', coalesce(nullif(trim(coalesce(r.raw->>(m->>'resumo'),'')),''),
                                  nullif(trim(coalesce(r.raw->>(m->>'descricao_curta'),'')),'')),
      'descricao',   nullif(trim(coalesce(r.raw->>(m->>'descricao'),'')),''),
      'cuidados',    nullif(trim(coalesce(r.raw->>(m->>'cuidados'),'')),''),
      'garantia',    nullif(trim(coalesce(r.raw->>(m->>'garantia'),'')),''),
      'seo_titulo',  nullif(trim(coalesce(r.raw->>(m->>'seo_titulo'),'')),''),
      'seo_descricao', nullif(trim(coalesce(r.raw->>(m->>'seo_descricao'),'')),''),
      'categoria',   coalesce(nullif(trim(coalesce(r.raw->>(m->>'categoria'),'')),''), d->>'categoria'),
      'category_id', cat_id,
      'subcategoria', nullif(trim(coalesce(r.raw->>(m->>'subcategoria'),'')),''),
      'subcategory_id', sub_id,
      'colecao',     coalesce(nullif(trim(coalesce(r.raw->>(m->>'colecao'),'')),''), d->>'colecao'),
      'fornecedor',  coalesce(nullif(trim(coalesce(r.raw->>(m->>'fornecedor_bruto'),'')),''),
                              nullif(trim(coalesce(r.raw->>(m->>'fornecedor'),'')),''), d->>'fornecedor'),
      'fornecedor_bruto_id', forn_bruto,
      'fornecedor_banho',    nullif(trim(coalesce(r.raw->>(m->>'fornecedor_banho'),'')),''),
      'fornecedor_banho_id', forn_banho,
      'material',    coalesce(nullif(trim(coalesce(r.raw->>(m->>'material_bruto'),'')),''),
                              nullif(trim(coalesce(r.raw->>(m->>'material'),'')),''), d->>'material'),
      'banho',       coalesce(nullif(trim(coalesce(r.raw->>(m->>'tipo_banho'),'')),''),
                              nullif(trim(coalesce(r.raw->>(m->>'banho'),'')),''), d->>'banho'),
      'plating_type_id', plat_id,
      'verniz',      nullif(trim(coalesce(r.raw->>(m->>'verniz'),'')),''),
      'cor',         nullif(trim(coalesce(r.raw->>(m->>'cor'),'')),''),
      'tamanho',     nullif(trim(coalesce(r.raw->>(m->>'tamanho'),'')),''),
      'nome_variante', nullif(trim(coalesce(r.raw->>(m->>'nome_variante'),'')),''),
      'peso',        coalesce(public.parse_decimal_any(r.raw->>(m->>'peso_bruto')),
                              public.parse_decimal_any(r.raw->>(m->>'peso'))),
      'peso_final',  public.parse_decimal_any(r.raw->>(m->>'peso_final')),
      'medidas',     nullif(trim(coalesce(r.raw->>(m->>'medidas'),'')),''),
      'sku',         public.norm_code(r.raw->>(m->>'sku')),
      'codigo_legado', public.norm_code(r.raw->>(m->>'codigo_legado')),
      'ean',         c_ean,
      'valor_bruto_cents',  CASE WHEN pode_custo THEN v_bruto END,
      'valor_banho_cents',  CASE WHEN pode_custo THEN v_banho END,
      'valor_verniz_cents', CASE WHEN pode_custo THEN v_verniz END,
      'custo_cents',        CASE WHEN pode_custo THEN v_final END,
      'justificativa_custo', nullif(trim(coalesce(r.raw->>(m->>'justificativa_custo'),'')),''),
      'observacao_custo',   nullif(trim(coalesce(r.raw->>(m->>'observacao_custo'),'')),''),
      'preco_cents', preco,
      'quantidade',  coalesce(q_num,0)::int,
      'variante_padrao', CASE WHEN nullif(trim(coalesce(r.raw->>(m->>'variante_padrao'),'')),'') IS NULL THEN NULL
                              ELSE lower(r.raw->>(m->>'variante_padrao')) IN ('1','sim','true','x','s') END,
      'variante_ativa',  CASE WHEN nullif(trim(coalesce(r.raw->>(m->>'variante_ativa'),'')),'') IS NULL THEN NULL
                              ELSE lower(r.raw->>(m->>'variante_ativa')) IN ('1','sim','true','x','s') END,
      'destaque',    lower(coalesce(r.raw->>(m->>'destaque'), d->>'destaque','')) IN ('1','sim','true','x','s'),
      'publicar',    lower(coalesce(r.raw->>(m->>'publicar'), d->>'publicar','')) IN ('1','sim','true','x','s'),
      'mostrar_preco', lower(coalesce(r.raw->>(m->>'publicar_preco'), r.raw->>(m->>'mostrar_preco'),
                                      d->>'mostrar_preco','sim')) IN ('1','sim','true','x','s'),
      'imagem_url',  nullif(trim(coalesce(r.raw->>(m->>'imagem_url'),'')),'')
    );

    c_nome := p->>'nome'; c_sku := p->>'sku'; c_leg := p->>'codigo_legado';

    IF c_nome IS NULL THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','nome','erro','Nome do produto é obrigatório.',
        'correcao','Preencha a coluna do nome.');
    END IF;
    IF c_sku IS NULL AND c_leg IS NULL AND c_ean IS NULL AND (p->>'codigo_interno') IS NULL THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','identificador',
        'erro','Informe ao menos SKU, código interno, código legado ou código de barras.',
        'correcao','Preencha um código que identifique a peça.');
    END IF;

    -- custo: soma dos componentes x valor final
    IF pode_custo AND (v_bruto IS NOT NULL OR v_banho IS NOT NULL OR v_verniz IS NOT NULL) THEN
      soma := coalesce(v_bruto,0) + coalesce(v_banho,0) + coalesce(v_verniz,0);
      just := p->>'justificativa_custo';
      IF v_final IS NOT NULL AND v_final <> soma AND just IS NULL THEN
        st := 'erro';
        msgs := msgs || jsonb_build_object('campo','valor_final',
          'erro','O valor final da peça banhada é diferente da soma de bruto + banho + verniz.',
          'correcao','Corrija os valores ou preencha a coluna de justificativa do custo.');
      END IF;
    END IF;

    IF custo IS NOT NULL AND NOT pode_custo THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','custo','aviso','Custo ignorado: seu perfil não tem acesso a custo.');
    END IF;
    IF preco IS NOT NULL AND preco < 0 THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','preco',
        'erro','Preço negativo não é aceito.','correcao','Informe um preço igual ou maior que zero.');
    END IF;
    IF q_raw IS NOT NULL AND (q_num IS NULL OR q_num < 0 OR q_num <> trunc(q_num)) THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','quantidade','valor',left(q_raw,40),
        'erro','Quantidade precisa ser um número inteiro igual ou maior que zero.',
        'correcao','Use apenas números inteiros, sem sinal negativo.');
    END IF;
    IF j.mode = 'catalogo' AND coalesce(q_num,0) > 0 THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','quantidade',
        'aviso','Somente cadastro: a quantidade desta linha não movimenta estoque.');
    END IF;
    IF j.mode = 'entrada' AND coalesce(q_num,0) = 0 THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','quantidade',
        'aviso','Quantidade zero: a peça é cadastrada sem entrada de estoque.');
    END IF;
    IF (p->>'fornecedor') IS NOT NULL AND forn_bruto IS NULL THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','fornecedor','valor',p->>'fornecedor',
        'aviso','Fornecedor do bruto não encontrado no cadastro: será criado com este nome.',
        'correcao','Se ele já existe com outro nome, corrija a planilha antes de gravar.');
    END IF;
    IF (p->>'fornecedor_banho') IS NOT NULL AND forn_banho IS NULL THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','fornecedor_banho','valor',p->>'fornecedor_banho',
        'aviso','Fornecedor do banho não encontrado no cadastro: será criado com este nome.');
    END IF;
    IF (p->>'imagem_url') IS NOT NULL THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','imagem_url',
        'aviso','Endereço de imagem recebido, mas a importação de imagens ainda não está liberada: o endereço NÃO foi acessado e nenhuma imagem foi baixada.',
        'correcao','Suba a imagem pela Central da Vitrine depois da importação.');
    END IF;

    IF st <> 'erro' THEN
      v_sku := NULL; v_leg := NULL; v_ean := NULL;
      IF c_ean IS NOT NULL THEN
        SELECT pv.id INTO v_ean FROM public.product_variants pv WHERE pv.barcode = c_ean LIMIT 1;
      END IF;
      IF c_sku IS NOT NULL THEN
        SELECT pv.id INTO v_sku FROM public.product_variants pv WHERE upper(pv.sku) = upper(c_sku) LIMIT 1;
      END IF;
      IF c_leg IS NOT NULL THEN
        SELECT pv.id INTO v_leg FROM public.product_variants pv WHERE upper(pv.legacy_code) = upper(c_leg) LIMIT 1;
      END IF;
      alvos := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[v_ean, v_sku, v_leg]) x WHERE x IS NOT NULL);
      IF array_length(alvos,1) > 1 THEN
        st := 'conflito';
        msgs := msgs || jsonb_build_object('campo','identificador',
          'erro','Os códigos desta linha apontam para peças diferentes. Linha bloqueada para revisão manual.',
          'correcao','Corrija os códigos para que apontem para a mesma peça.',
          'registros', to_jsonb(alvos));
      ELSE
        p := p || jsonb_build_object('variant_id', coalesce(v_ean, v_sku, v_leg));
      END IF;
    END IF;

    UPDATE public.import_rows
       SET parsed = p, status = st, messages = msgs,
           error_code = CASE WHEN st IN ('erro','conflito') THEN msgs->0->>'campo' END
     WHERE id = r.id;
    feitas := feitas + 1;
  END LOOP;

  UPDATE public.import_jobs j2 SET
      ok_rows    = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('valido','aviso','processado')),
      warn_rows  = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='aviso'),
      error_rows = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('erro','conflito')),
      status = CASE WHEN EXISTS (SELECT 1 FROM public.import_rows WHERE job_id=_job AND status='pendente')
                    THEN 'validando' ELSE 'pronto' END
    WHERE j2.id = _job AND j2.status = 'validando';

  RETURN jsonb_build_object('validadas', feitas,
    'formato', CASE WHEN novo_formato THEN 'novo' ELSE 'legado' END,
    'restantes', (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='pendente'),
    'indicadores', public.import_job_counters(_job));
END $function$;

REVOKE ALL ON FUNCTION public.import_money(text) FROM anon;
REVOKE ALL ON FUNCTION public.import_barcode(text) FROM anon;
REVOKE ALL ON FUNCTION public.import_plating(text) FROM anon;
REVOKE ALL ON FUNCTION public.import_supplier(text) FROM anon;
