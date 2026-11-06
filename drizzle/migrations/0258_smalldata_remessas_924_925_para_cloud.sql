-- 0258 (pacote 0254) — Maletas das remessas 924 e 925 do SmallData (JFLEX) para o Lardan Cloud.
-- 924 antiga -> remessa 926 do Cloud; 925 antiga -> remessa 925 do Cloud. Maletas de ABERTURA com o representante.
-- Motor oficial: remessa_abrir_maleta_representante -> kit_item_upsert -> kit_conferir (kit_expedir só se pedido).
-- Aditivo e idempotente: 3 tabelas novas (só servidor), funções de prévia/aplicar/desfazer. Nenhuma coluna removida.

CREATE TABLE IF NOT EXISTS public.legado_transferencia_remessas (
  legado_remessa int PRIMARY KEY,
  representante int NOT NULL,
  praca int,
  emissao date,
  vencimento date,
  remessa_destino int NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.legado_transferencia_maletas (
  legado_remessa int NOT NULL REFERENCES public.legado_transferencia_remessas(legado_remessa),
  codcli int NOT NULL,
  kit int NOT NULL,
  valor_legado_cents bigint NOT NULL DEFAULT 0,
  pecas_legado int NOT NULL DEFAULT 0,
  cycle_id uuid REFERENCES public.kit_cycles(id),
  remessa_id uuid REFERENCES public.remessas(id),
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente','conferida','expedida','desfeita')),
  feito_em timestamptz,
  feito_por uuid,
  PRIMARY KEY (legado_remessa, codcli, kit)
);
CREATE TABLE IF NOT EXISTS public.legado_transferencia_pecas (
  legado_remessa int NOT NULL,
  codcli int NOT NULL,
  kit int NOT NULL,
  produto int NOT NULL,
  tamanho text NOT NULL DEFAULT 'U',
  quantidade int NOT NULL CHECK (quantidade > 0),
  conferida int NOT NULL DEFAULT 0,
  referencia text,
  nome text,
  PRIMARY KEY (legado_remessa, codcli, kit, produto, tamanho),
  FOREIGN KEY (legado_remessa, codcli, kit) REFERENCES public.legado_transferencia_maletas(legado_remessa, codcli, kit)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['legado_transferencia_remessas','legado_transferencia_maletas','legado_transferencia_pecas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.legado_transferencia_ator(_actor uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE prev text := current_setting('request.jwt.claims', true); papel text;
BEGIN
  papel := coalesce(nullif(prev, '')::jsonb ->> 'role', '');
  IF _actor IS NOT NULL THEN
    IF papel IN ('authenticated', 'anon') OR coalesce(current_setting('role', true), '') IN ('authenticated', 'anon') THEN RAISE EXCEPTION 'Chame sem _actor: a operação usa o seu próprio login.' USING errcode = '42501'; END IF;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  END IF;
  IF auth.uid() IS NULL OR NOT public.can_manage_kits(auth.uid()) OR NOT public.kit_scope_all() THEN
    PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);
    RAISE EXCEPTION 'Sem permissão: precisa montar maletas e ver todas as remessas.' USING errcode = '42501';
  END IF;
  RETURN coalesce(prev, '');
END $f$;
REVOKE ALL ON FUNCTION public.legado_transferencia_ator(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.legado_transferencia_resolver(_legado int, _criar boolean)
RETURNS TABLE (codcli int, kit int, produto int, tamanho text, quantidade int, nome text, codigo text,
               variant_id uuid, situacao text, preco_cents int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p record; r jsonb; v uuid; s text; cod text;
BEGIN
  FOR p IN SELECT * FROM legado_transferencia_pecas x WHERE x.legado_remessa = _legado ORDER BY x.codcli, x.kit, x.produto, x.tamanho LOOP
    v := NULL; s := NULL;
    cod := p.produto::text || CASE WHEN upper(p.tamanho) IN ('U', '') THEN '' ELSE lpad(regexp_replace(p.tamanho, '\D', '', 'g'), 2, '0') END;
    r := public.barcode_resolver(cod, _criar);
    IF coalesce((r ->> 'encontrado')::boolean, false) AND r ? 'variant_id' THEN
      v := (r ->> 'variant_id')::uuid; s := CASE WHEN r ->> 'forma' = 'anel_tamanho' AND coalesce((r ->> 'variante_criada')::boolean, false) THEN 'aro_criado' ELSE 'ok' END;
    ELSIF coalesce((r ->> 'precisa_criar')::boolean, false) THEN
      s := 'aro_a_criar';
    ELSIF upper(p.tamanho) IN ('U', '') THEN
      IF p.referencia IS NOT NULL THEN
        r := public.barcode_resolver(p.referencia, false);
        IF coalesce((r ->> 'encontrado')::boolean, false) AND r ? 'variant_id' THEN v := (r ->> 'variant_id')::uuid; s := 'ok'; END IF;
      END IF;
      IF v IS NULL THEN
        SELECT l.variant_id INTO v FROM legado_produtos l JOIN product_variants pv ON pv.id = l.variant_id AND pv.is_active
         WHERE l.codigo = p.produto;
        IF v IS NOT NULL THEN s := 'ok'; END IF;
      END IF;
    END IF;
    IF v IS NULL AND s IS NULL THEN s := 'sem_cadastro'; END IF;
    codcli := p.codcli; kit := p.kit; produto := p.produto; tamanho := p.tamanho; quantidade := p.quantidade;
    nome := p.nome; codigo := cod; variant_id := v; situacao := s;
    preco_cents := CASE WHEN v IS NULL THEN NULL ELSE public.kit_reference_price(v) END;
    RETURN NEXT;
  END LOOP;
END $f$;
REVOKE ALL ON FUNCTION public.legado_transferencia_resolver(int, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.legado_transferencia_previa(_legado int, _actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE prev text; cfg legado_transferencia_remessas; rem remessas; rep_party uuid; rep_nome text; problemas text[] := '{}';
        res jsonb; maletas jsonb; pend jsonb; faltas jsonb; existentes jsonb; tot jsonb;
BEGIN
  prev := public.legado_transferencia_ator(_actor);
  SELECT * INTO cfg FROM legado_transferencia_remessas WHERE legado_remessa = _legado;
  IF cfg.legado_remessa IS NULL THEN RAISE EXCEPTION 'Remessa % do SmallData não está preparada para transferência.', _legado; END IF;
  SELECT * INTO rem FROM remessas WHERE numero = cfg.remessa_destino;
  SELECT lr.party_id, coalesce(pa.display_name, lr.nome) INTO rep_party, rep_nome
    FROM legado_representantes lr LEFT JOIN parties pa ON pa.id = lr.party_id WHERE lr.codigo = cfg.representante;

  IF rem.id IS NULL THEN problemas := problemas || format('A remessa %s ainda não existe no Lardan Cloud: crie a remessa antes.', cfg.remessa_destino);
  ELSE
    IF rem.status IN ('fechada', 'cancelada') THEN problemas := problemas || format('A remessa %s está %s.', rem.numero, rem.status); END IF;
    IF rem.representante_party_id IS NULL THEN problemas := problemas || format('A remessa %s não tem representante.', rem.numero);
    ELSIF rep_party IS NULL THEN problemas := problemas || format('O representante %s do SmallData não está ligado a um cadastro do Cloud.', cfg.representante);
    ELSIF rem.representante_party_id <> rep_party THEN
      problemas := problemas || format('A remessa %s é de outro representante (%s); no SmallData estas maletas são de %s.', rem.numero,
        (SELECT display_name FROM parties WHERE id = rem.representante_party_id), rep_nome);
    END IF;
    IF rem.origin_location_id IS NULL THEN problemas := problemas || format('A remessa %s não tem depósito de saída.', rem.numero); END IF;
  END IF;

  DROP TABLE IF EXISTS _ltr_res;
  CREATE TEMP TABLE _ltr_res ON COMMIT DROP AS SELECT * FROM public.legado_transferencia_resolver(_legado, false);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kit', m.kit, 'pecas_smalldata', m.pecas_legado, 'valor_smalldata_cents', m.valor_legado_cents,
           'pecas', (SELECT coalesce(sum(r.quantidade), 0) FROM _ltr_res r WHERE r.kit = m.kit AND r.codcli = m.codcli),
           'valor_cloud_cents', (SELECT coalesce(sum(r.quantidade * r.preco_cents), 0) FROM _ltr_res r WHERE r.kit = m.kit AND r.codcli = m.codcli),
           'situacao', m.situacao, 'cycle_id', m.cycle_id,
           'maleta', (SELECT k.label FROM kit_cycles c JOIN kits k ON k.id = c.kit_id WHERE c.id = m.cycle_id)) ORDER BY m.kit), '[]')
    INTO maletas FROM legado_transferencia_maletas m WHERE m.legado_remessa = _legado;

  SELECT coalesce(jsonb_agg(jsonb_build_object('kit', r.kit, 'produto', r.produto, 'tamanho', r.tamanho, 'nome', r.nome,
           'codigo', r.codigo, 'quantidade', r.quantidade, 'situacao', r.situacao) ORDER BY r.kit, r.produto), '[]')
    INTO pend FROM _ltr_res r WHERE r.situacao <> 'ok';

  IF rem.origin_location_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'nome'), '[]') INTO faltas FROM (
      SELECT jsonb_build_object('variant_id', r.variant_id, 'nome', min(r.nome), 'codigo', min(r.codigo), 'precisa', sum(r.quantidade),
               'disponivel', public.stock_available(r.variant_id, rem.origin_location_id)) x
        FROM _ltr_res r JOIN legado_transferencia_maletas m ON m.legado_remessa = _legado AND m.codcli = r.codcli AND m.kit = r.kit AND m.cycle_id IS NULL
       WHERE r.variant_id IS NOT NULL
       GROUP BY r.variant_id
      HAVING public.stock_available(r.variant_id, rem.origin_location_id) < sum(r.quantidade)
      UNION ALL
      SELECT jsonb_build_object('variant_id', NULL, 'nome', r.nome, 'codigo', r.codigo, 'precisa', r.quantidade, 'disponivel', 0)
        FROM _ltr_res r JOIN legado_transferencia_maletas m ON m.legado_remessa = _legado AND m.codcli = r.codcli AND m.kit = r.kit AND m.cycle_id IS NULL
       WHERE r.situacao = 'aro_a_criar') s;
  ELSE faltas := '[]'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('maleta', k.label, 'status', c.status, 'consultora', pa.display_name,
           'trazida_do_smalldata', EXISTS (SELECT 1 FROM legado_transferencia_maletas m WHERE m.cycle_id = c.id)) ORDER BY c.created_at), '[]')
    INTO existentes FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN parties pa ON pa.id = c.consultora_party_id
   WHERE c.remessa_id = rem.id AND c.status <> 'cancelada';

  SELECT jsonb_build_object('maletas', count(DISTINCT (codcli, kit)), 'linhas', count(*), 'pecas', coalesce(sum(quantidade), 0),
           'valor_cloud_cents', coalesce(sum(quantidade * preco_cents), 0),
           'sem_cadastro', count(*) FILTER (WHERE situacao = 'sem_cadastro'), 'aro_a_criar', count(*) FILTER (WHERE situacao = 'aro_a_criar'))
    INTO tot FROM _ltr_res;

  res := jsonb_build_object(
    'smalldata', jsonb_build_object('remessa', cfg.legado_remessa, 'representante', cfg.representante, 'representante_nome', rep_nome,
      'praca', cfg.praca, 'emissao', cfg.emissao, 'vencimento', cfg.vencimento,
      'valor_cents', (SELECT sum(valor_legado_cents) FROM legado_transferencia_maletas WHERE legado_remessa = _legado)),
    'destino', jsonb_build_object('remessa', cfg.remessa_destino, 'existe', rem.id IS NOT NULL, 'status', rem.status,
      'representante', (SELECT display_name FROM parties WHERE id = rem.representante_party_id),
      'praca', (SELECT nome FROM cob_pracas WHERE id = rem.praca_id), 'data_acerto', rem.data_acerto,
      'maletas_ja_na_remessa', existentes),
    'totais', tot, 'maletas', maletas, 'pecas_pendentes', pend, 'falta_no_deposito', faltas,
    'ja_feitas', (SELECT count(*) FROM legado_transferencia_maletas WHERE legado_remessa = _legado AND cycle_id IS NOT NULL),
    'problemas', to_jsonb(problemas),
    'pode_aplicar', cardinality(problemas) = 0 AND (tot ->> 'sem_cadastro')::int = 0);
  PERFORM set_config('request.jwt.claims', prev, true);
  RETURN res;
END $f$;

CREATE OR REPLACE FUNCTION public.legado_transferencia_aplicar(_legado int, _aceitar_falta boolean DEFAULT false,
                                                               _expedir boolean DEFAULT false, _actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE prev text; pv jsonb; cfg legado_transferencia_remessas; rem remessas; m record; it record; v jsonb; cyc uuid;
        feitas int := 0; pecas int := 0; aros int := 0; lista jsonb := '[]';
BEGIN
  prev := public.legado_transferencia_ator(_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('legado_transferencia:' || _legado, 0));
  pv := public.legado_transferencia_previa(_legado, NULL);
  IF NOT (pv ->> 'pode_aplicar')::boolean THEN
    RAISE EXCEPTION 'Não dá para aplicar: %', coalesce((SELECT string_agg(x, ' ') FROM jsonb_array_elements_text(pv -> 'problemas') x), '')
      || CASE WHEN (pv -> 'totais' ->> 'sem_cadastro')::int > 0 THEN format(' %s peça(s) sem cadastro no Cloud.', pv -> 'totais' ->> 'sem_cadastro') ELSE '' END;
  END IF;
  IF jsonb_array_length(pv -> 'falta_no_deposito') > 0 AND NOT _aceitar_falta THEN
    RAISE EXCEPTION '% peça(s) sem saldo suficiente no depósito da remessa. Confira a prévia e, se as peças já saíram pelo SmallData, aplique com _aceitar_falta = true.',
      jsonb_array_length(pv -> 'falta_no_deposito');
  END IF;
  SELECT * INTO cfg FROM legado_transferencia_remessas WHERE legado_remessa = _legado;
  SELECT * INTO rem FROM remessas WHERE numero = cfg.remessa_destino FOR UPDATE;

  DROP TABLE IF EXISTS _ltr_apl;
  CREATE TEMP TABLE _ltr_apl ON COMMIT DROP AS SELECT * FROM public.legado_transferencia_resolver(_legado, true);
  IF EXISTS (SELECT 1 FROM _ltr_apl WHERE variant_id IS NULL) THEN RAISE EXCEPTION 'Peça sem cadastro apareceu durante a aplicação; nada foi gravado.'; END IF;
  aros := (SELECT count(*) FROM _ltr_apl WHERE situacao = 'aro_criado');

  FOR m IN SELECT * FROM legado_transferencia_maletas WHERE legado_remessa = _legado AND cycle_id IS NULL ORDER BY kit FOR UPDATE LOOP
    v := public.remessa_abrir_maleta_representante(rem.id);
    cyc := (v ->> 'cycle_id')::uuid;
    FOR it IN SELECT variant_id, sum(quantidade)::int q FROM _ltr_apl WHERE codcli = m.codcli AND kit = m.kit GROUP BY variant_id LOOP
      PERFORM public.kit_item_upsert(cyc, it.variant_id, it.q);
      pecas := pecas + it.q;
    END LOOP;
    PERFORM public.kit_conferir(cyc, format('Trazida do SmallData: remessa %s, maleta %s.', _legado, m.kit));
    IF _expedir THEN
      PERFORM public.kit_expedir(cyc, jsonb_build_object('rota', 'representante', 'note', format('SmallData remessa %s, maleta %s', _legado, m.kit)));
    END IF;
    UPDATE legado_transferencia_maletas SET cycle_id = cyc, remessa_id = rem.id, situacao = CASE WHEN _expedir THEN 'expedida' ELSE 'conferida' END,
           feito_em = now(), feito_por = auth.uid()
     WHERE legado_remessa = m.legado_remessa AND codcli = m.codcli AND kit = m.kit;
    lista := lista || jsonb_build_object('kit_smalldata', m.kit, 'abertura', (v ->> 'abertura_numero')::int, 'cycle_id', cyc);
    feitas := feitas + 1;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'legado_transferencia_aplicar', 'remessas', rem.id::text,
          jsonb_build_object('smalldata', _legado, 'remessa', rem.numero, 'maletas', feitas, 'pecas', pecas, 'aros_criados', aros,
                             'expedidas', _expedir, 'aceitou_falta', _aceitar_falta, 'faltas', pv -> 'falta_no_deposito', 'lista', lista));
  PERFORM set_config('request.jwt.claims', prev, true);
  RETURN jsonb_build_object('remessa', rem.numero, 'maletas', feitas, 'pecas', pecas, 'aros_criados', aros, 'expedidas', _expedir,
                            'repetida', feitas = 0, 'lista', lista);
END $f$;

CREATE OR REPLACE FUNCTION public.legado_transferencia_desfazer(_legado int, _motivo text, _actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE prev text; m record; it record; st text; desfeitas int := 0; ja_sairam jsonb := '[]';
BEGIN
  prev := public.legado_transferencia_ator(_actor);
  IF length(trim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('legado_transferencia:' || _legado, 0));
  FOR m IN SELECT * FROM legado_transferencia_maletas WHERE legado_remessa = _legado AND cycle_id IS NOT NULL ORDER BY kit FOR UPDATE LOOP
    SELECT status INTO st FROM kit_cycles WHERE id = m.cycle_id;
    IF st IN ('rascunho', 'montagem', 'conferida', 'cancelada') THEN
      IF st <> 'cancelada' THEN
        FOR it IN SELECT i.id, i.reservation_id FROM kit_composition_items i JOIN kit_compositions kc ON kc.id = i.composition_id
                   JOIN stock_reservations sr ON sr.id = i.reservation_id AND sr.status = 'ativa'
                  WHERE kc.cycle_id = m.cycle_id LOOP
          PERFORM public.colab_kit_reserva_liberar_interna(it.reservation_id, false, 'Desfazer transferência do SmallData', 'lt-desfazer:' || it.id::text);
        END LOOP;
        PERFORM public.remessa_maleta_excluir(m.cycle_id, 'SmallData ' || _legado || ': ' || _motivo);
      END IF;
      UPDATE legado_transferencia_maletas SET cycle_id = NULL, remessa_id = NULL, situacao = 'desfeita', feito_em = now(), feito_por = auth.uid()
       WHERE legado_remessa = m.legado_remessa AND codcli = m.codcli AND kit = m.kit;
      desfeitas := desfeitas + 1;
    ELSE
      ja_sairam := ja_sairam || jsonb_build_object('kit_smalldata', m.kit, 'cycle_id', m.cycle_id, 'status', st);
    END IF;
  END LOOP;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'legado_transferencia_desfazer', 'legado_transferencia_remessas', _legado::text,
          jsonb_build_object('desfeitas', desfeitas, 'ja_sairam', ja_sairam, 'motivo', _motivo));
  PERFORM set_config('request.jwt.claims', prev, true);
  RETURN jsonb_build_object('desfeitas', desfeitas, 'ja_sairam', ja_sairam);
END $f$;

REVOKE ALL ON FUNCTION public.legado_transferencia_previa(int, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.legado_transferencia_aplicar(int, boolean, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.legado_transferencia_desfazer(int, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_transferencia_previa(int, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.legado_transferencia_aplicar(int, boolean, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.legado_transferencia_desfazer(int, text, uuid) TO authenticated, service_role;

INSERT INTO public.legado_transferencia_remessas (legado_remessa, representante, praca, emissao, vencimento, remessa_destino) VALUES
  (924, 3009, 14, '2026-10-30', '2026-12-21', 926),
  (925, 3010, 42, '2026-10-30', '2026-12-21', 925)
ON CONFLICT (legado_remessa) DO NOTHING;

INSERT INTO public.legado_transferencia_maletas (legado_remessa, codcli, kit, valor_legado_cents, pecas_legado) VALUES
  (924, 20, 1, 293223, 35), (924, 20, 2, 323508, 35), (924, 20, 3, 329501, 35), (924, 20, 4, 302336, 35), (924, 20, 5, 342323, 35),
  (924, 20, 6, 318309, 35), (924, 20, 7, 278528, 35), (924, 20, 8, 292004, 35), (924, 20, 9, 343073, 35), (924, 20, 10, 324983, 35),
  (925, 74, 1, 284555, 35), (925, 74, 2, 275468, 35), (925, 74, 3, 346037, 35), (925, 74, 4, 330182, 35), (925, 74, 5, 329965, 35),
  (925, 74, 6, 282071, 35), (925, 74, 7, 356789, 35), (925, 74, 8, 338789, 35), (925, 74, 9, 288514, 35), (925, 74, 10, 321746, 35)
ON CONFLICT (legado_remessa, codcli, kit) DO NOTHING;

-- Peças (697 linhas, 700 peças): produto, aro e quantidade da extração JFLEX; referência e nome vêm de legado_produtos (mesma fonte).
INSERT INTO public.legado_transferencia_pecas (legado_remessa, codcli, kit, produto, tamanho, quantidade, conferida, referencia, nome)
SELECT CASE WHEN m.rk[1]='4' THEN 924 ELSE 925 END, CASE WHEN m.rk[1]='4' THEN 20 ELSE 74 END, m.rk[2]::int,
       x.produto, x.tamanho, x.q, x.q, lp.referencia, lp.nome
  FROM (SELECT string_to_array(split_part(b,':',1),'.') rk, split_part(b,':',2) itens FROM unnest(string_to_array($z$4.1:41,4081,5538,5609,9698,10066,10740,11427,11460,12520,12743,13426,13745/15,14122,14464,14653,14659,14662,14848/15,15066,15068,15189,15450,15836,15929,15945,15984,16814,17230,17595,18037/12,18061,18215/25,18402/14,18470/17;4.2:4451,5691/19,5874,8109,9640,11448,11460,11461,11463,11586,11738,11841,12088,12524,13935,14149/14,14447,14469,14659,15042/18,15066,15068,15431,15942,15947,16496,16862,17161,17230,17254,17299,17710,17960,17988,18471/15;4.3:4654,6234,8559,9125,9136,10057,10160/17,11385,11447,11460,11828,12087,12088,13785/19,13787/20,14006,14448,14469,14541/23,14659,15068,15082,15559/12,15942,15947,15980,16169,16924,17230,17260,17350,17812,17952,18155/17,18237;4.4:2516,5621,7532,8523,8623/16,9560/13,10041,10062,10457,11461,12019,12087,12088,13135,13803/12,14119,14148/15,14329,14462,14469,14541/25,14659,14906,15066,15068,15936,15945,16186,17010,17230,17602,17813,17982,18080/12,18248;4.5:9719/23,9821,10238/23,11461,11658,11738,12161,12946,13464,14139/12,14462,14656,14662,14664/24,14825,14832,15066,15389,15942,16150,16231,16636,16804,16890,16977/20,17230,17294,17309,17353,17382,17702,17715,17946,18061,18080/15;4.6:2680,4020,4482,6306,6515,7956,8563,9591,10121/19,11460,11461,11970,12088,12226,12692,14006,14083,14165,14469,14659,15066,15068,15130/20,15947,16150,16225,16905,17230,17716,17982,18014/12,18046,18118/20,18402/14,18456/20;4.7:6454,6750,9996,10049,11405,11461,12088,12232,12285,12435,12670,13803/27,14001,14064,14256,14468,14659,14824,15066,15068,15070,15567,15797,16304/20,16493,17028,17230,17268,17345,17399/15,17710,17815,18031/13,18403/13,18470/14;4.8:48,9542,9896,10431,10646,11451,11461,11462,11463,12088,12626/20,13120,13706,13832,14080,14083,14131/17,14467,14602,14659,14662,15066,15068,15374/21,15391,15450,15947,16899,17230,17372,17585,17882,18151/12,18173/20,18377/14;4.9:3901,5462,8137,8875,9554/24,10156/19,11398,11738,12088,13464,14073,14156/13,14659,14662,14881,14965,15066,15068,15898,15947,16166,16494,16785,16974,17041,17059/13,17142,17230,17295,17350,17807,17910,17982,18086/14,18402/14;4.10:3425,3957/16,8024,8210,8855,9559,10349,10585,11405,11918,12088,12285,12367,14077,14541/20,14659,15066,15068,15389,15945,16084,16476,16493,16824,16979/14,17170,17230,17298,17303,17581,18047,18090/10,18146/15,18208/12,18332/15;5.1:230,6761,6961,7513,8217,9634,10493,10761,11423,11461,11833,12088,12743,12808,13785/23,14460,14466,14524/21,14659,14824,14946,15066,15068*2,15687,15929,16994/18,17148,17228,17265,17372,17982,18002/13,18456/18,18474/22;5.2:2796,3423,3621,4497,5204,5412,6462,8002,8528,9703/16,11460,11492,11995,12087,14060,14153/13,14256,14462,14654,14659,14908,15068,15566,15638,15687,15947,16151,16829,16845,17230,18007/12,18017/21,18205/20,18282,18403/23;5.3:5470,6909,8155,9347,10933,11235,11437,11659,11662,11828,12087,12088,13794/15,13805,14451,14462,14659,15066,15068,15080,15503,15701,15947,16166,17230,17723,17912,17993,18002/12,18038/17,18197,18255,18332/14,18394/13,18403/28;5.4:5544,5937,8617/10,9679,10983,11783,11984,12088,12160,12233,12948,13256,13804/23,13816,13867,14083,14135/18,14835,14857/14,15066,15068,15071,15082,15341,15384,15450,15802,16066,16221,16824,17230,17235,17807,18155/12,18471/13;5.5:3656,5831,8565,9731,9834,10560,11460,11461,11753/15,12088,12169,12365,13393,14073,14460,14462,14653,14659,14842/16,14908,15066,15068,15243,15764,16920,17150,17227,17230,17603,17912,18081/20,18146/20,18247,18398/14,18473/17;5.6:8621/10,9210,11310,11460*2,12524,13656,13816,13862,14006,14152/27,14462,14469,14656,14659,14662,15067,15278,15387,15446,15936,15945,16815,16823,16924,17294,17355,17913,17952,18028/12,18305,18343,18392/15,18398/14,18471/21;5.7:1567,7819,10346,10508,10933,11460,11551,12161,13348,14083,14130/16,14218,14358,14460,14466,14654,14845/14,15067,15068,15257,15661,15942,15947,16301,16461,16496,16653,16804,16812,16817,17913,17996/12,18118/20,18393/14,18473/19;5.8:1649,4058,8664/10,9107,11427,12393,12965,13784/14,13833,14006,14083,14119,14495,14654,14659,15067,15068*2,15327,15701,15942,15974/24,16860,16920,17113,17140,17230,17246,17382,17721,17911,18013/12,18253,18400/14,18473/16;5.9:3010,7585,7943,8469,10759,10980,11460,11462,11709,12087,12088,12392,12498,12548,14079,14226,14352,14468,14469,14659,14824,14909,15066,15942,15947,16830,17230,17294,17994,18027/12,18080/12,18146/15,18173/20,18470/21,18474/11;5.10:4088,4780,6035,8083,8691/12,10466,11372,11427,11460,11793,11955,12088,12748,13120,13278,13617,13620,14256,14462,14469,14659,14660,15068,15568,15599,15947,16166,16836,17229,17299,17910,18112/13,18219/17,18394/13,18471/18$z$, ';')) b) m
  CROSS JOIN LATERAL (
    SELECT split_part(split_part(i,'*',1),'/',1)::int produto,
           coalesce(nullif(split_part(split_part(i,'*',1),'/',2),''),'U') tamanho,
           coalesce(nullif(split_part(i,'*',2),''),'1')::int q
      FROM unnest(string_to_array(m.itens, ',')) i) x
  LEFT JOIN public.legado_produtos lp ON lp.codigo = x.produto
ON CONFLICT (legado_remessa, codcli, kit, produto, tamanho) DO NOTHING;