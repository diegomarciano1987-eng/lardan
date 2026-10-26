-- 0157 — novo pedido de consignação + regra de preço nova + preço congelado na remessa.
-- Não apaga nada, não remove coluna e pode rodar duas vezes.
--
-- 1. pedido_config: dados fixos da folha (endereço, contato de pedidos, Pix, garantia, montagem) e o
--    prazo do correio — editável só pelo Master.
-- 2. remessas.tipo_envio ('pessoal' | 'correio'): "Postar a maleta até" só aparece no correio
--    (data do acerto − prazo do correio).
-- 3. kit_pedido_dados(ciclo): tudo que a folha imprime, com o preço GRAVADO de cada item.
-- 4. kit_preco(ciclo, variante): preço gravado na maleta. App, vitrine, pedido da cliente e maleta
--    perdida passam a usar ele (antes usavam o preço do catálogo do dia).
-- 5. preco_regra_lardan + preco_reajuste_previa/aplicar/desfazer: nova regra (sempre para cima;
--    até R$ 99,99 termina em ,90; de R$ 100 em diante termina em 4,90 ou 9,90). Só aplica com o
--    Master e depois da aprovação do relatório; maleta já montada/na rua não muda.
-- 6. Faixas de comissão: se a tabela estiver vazia, recebe as faixas da folha (20/25/30/35/40%).

-- ───────────────────────── 1. configuração da folha ─────────────────────────
CREATE TABLE IF NOT EXISTS public.pedido_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  endereco_linha text NOT NULL DEFAULT 'Av. dos Estudantes, 1277 · Ibiporã-PR · lardan.com.br · (43) 9 9159-0321',
  pedidos_telefone text NOT NULL DEFAULT '(43) 99160-0321',
  pedidos_email text NOT NULL DEFAULT 'lardansemijoias@gmail.com',
  pagamento_texto text NOT NULL DEFAULT 'dinheiro, cartão de crédito e débito. Cheque só mediante consulta.',
  pix_tipo text NOT NULL DEFAULT 'CNPJ',
  pix_chave text NOT NULL DEFAULT '43.319.208/0001-80',
  pix_favorecido text NOT NULL DEFAULT 'TSM Comércio de Semijoias Ltda',
  garantia_titulo text NOT NULL DEFAULT 'Garantia Lardan · 24 meses',
  garantia_texto text NOT NULL DEFAULT 'Cobre defeito de fabricação e **só vale com registro no app Lardan**: a consultora envia foto e referência da peça, ligada à venda feita para a cliente. A Qualidade analisa em até 10 dias após receber a peça e, se aprovada, a troca ou o conserto chega em até 30 dias, sem custo.',
  garantia_exclusoes text NOT NULL DEFAULT '**Não cobre:** peça quebrada (fecho, solda, elo), riscos por atrito, contato com cosméticos ou produtos químicos, peças e correntes arrebentadas ou amassadas. Não há troca na hora nem devolução por arrependimento.',
  montagem_texto text NOT NULL DEFAULT 'Faremos duas tentativas de contato na semana anterior ao acerto. Sem resposta, montamos o kit pelo seu histórico de vendas (tipos de peça e faturamento).',
  rodape_texto text NOT NULL DEFAULT 'Confira o kit e confirme o recebimento no app Lardan.',
  prazo_correio_dias integer NOT NULL DEFAULT 7 CHECK (prazo_correio_dias BETWEEN 0 AND 60),
  preco_virada_em timestamptz,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.pedido_config (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.pedido_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pedido_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pedido_config TO service_role;

CREATE OR REPLACE FUNCTION public.pedido_config_ler() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(c) - 'id' FROM pedido_config c WHERE auth.uid() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.pedido_config_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_config_ler() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pedido_config_salvar(_dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE antes jsonb; k text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'Só o Master altera os dados do pedido.' USING errcode = '42501';
  END IF;
  FOR k IN SELECT jsonb_object_keys(coalesce(_dados, '{}')) LOOP
    IF k NOT IN ('endereco_linha','pedidos_telefone','pedidos_email','pagamento_texto','pix_tipo','pix_chave','pix_favorecido',
                 'garantia_titulo','garantia_texto','garantia_exclusoes','montagem_texto','rodape_texto','prazo_correio_dias') THEN
      RAISE EXCEPTION 'Campo não editável: %', k;
    END IF;
  END LOOP;
  SELECT to_jsonb(c) INTO antes FROM pedido_config c;
  UPDATE pedido_config c SET
    endereco_linha = coalesce(_dados->>'endereco_linha', c.endereco_linha),
    pedidos_telefone = coalesce(_dados->>'pedidos_telefone', c.pedidos_telefone),
    pedidos_email = coalesce(_dados->>'pedidos_email', c.pedidos_email),
    pagamento_texto = coalesce(_dados->>'pagamento_texto', c.pagamento_texto),
    pix_tipo = coalesce(_dados->>'pix_tipo', c.pix_tipo),
    pix_chave = coalesce(_dados->>'pix_chave', c.pix_chave),
    pix_favorecido = coalesce(_dados->>'pix_favorecido', c.pix_favorecido),
    garantia_titulo = coalesce(_dados->>'garantia_titulo', c.garantia_titulo),
    garantia_texto = coalesce(_dados->>'garantia_texto', c.garantia_texto),
    garantia_exclusoes = coalesce(_dados->>'garantia_exclusoes', c.garantia_exclusoes),
    montagem_texto = coalesce(_dados->>'montagem_texto', c.montagem_texto),
    rodape_texto = coalesce(_dados->>'rodape_texto', c.rodape_texto),
    prazo_correio_dias = coalesce((_dados->>'prazo_correio_dias')::int, c.prazo_correio_dias),
    atualizado_por = auth.uid(), atualizado_em = now();
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'pedido.config_alterada', 'pedido_config', 'pedido', jsonb_build_object('antes', antes, 'mudou', _dados));
  RETURN public.pedido_config_ler();
END $$;
REVOKE ALL ON FUNCTION public.pedido_config_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_config_salvar(jsonb) TO authenticated, service_role;

-- ───────────────────────── 2. tipo de envio da remessa ─────────────────────────
ALTER TABLE public.remessas ADD COLUMN IF NOT EXISTS tipo_envio text NOT NULL DEFAULT 'pessoal';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remessas_tipo_envio_chk') THEN
    ALTER TABLE public.remessas ADD CONSTRAINT remessas_tipo_envio_chk CHECK (tipo_envio IN ('pessoal', 'correio'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.remessa_tipo_envio_definir(_remessa uuid, _tipo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r remessas;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para alterar a remessa.' USING errcode = '42501'; END IF;
  IF _tipo NOT IN ('pessoal', 'correio') THEN RAISE EXCEPTION 'Tipo de envio inválido: use pessoal ou correio.'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.status IN ('fechada', 'cancelada') THEN RAISE EXCEPTION 'Esta remessa está %.', r.status; END IF;
  IF r.tipo_envio = _tipo THEN RETURN jsonb_build_object('tipo_envio', _tipo, 'repetido', true); END IF;
  UPDATE remessas SET tipo_envio = _tipo, updated_at = now() WHERE id = _remessa;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa.tipo_envio', 'remessas', _remessa::text, jsonb_build_object('antes', r.tipo_envio, 'depois', _tipo));
  RETURN jsonb_build_object('tipo_envio', _tipo, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.remessa_tipo_envio_definir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_tipo_envio_definir(uuid, text) TO authenticated, service_role;

-- ───────────────────────── 4. preço gravado na maleta ─────────────────────────
CREATE OR REPLACE FUNCTION public.kit_preco(_cycle uuid, _variant uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT i.unit_reference_cents FROM kit_composition_items i JOIN kit_compositions c ON c.id = i.composition_id
      WHERE c.cycle_id = _cycle AND i.variant_id = _variant AND i.unit_reference_cents > 0
      ORDER BY c.version DESC LIMIT 1),
    public.kit_reference_price(_variant))
$$;
REVOKE ALL ON FUNCTION public.kit_preco(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_preco(uuid, uuid) TO authenticated, service_role;

-- preço da peça na vitrine da consultora: o da maleta ativa mais recente que tem a peça
CREATE OR REPLACE FUNCTION public.kit_preco_da_consultora(_party uuid, _variant uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT public.kit_preco(c.id, _variant) FROM kit_cycles c JOIN kit_balances b ON b.cycle_id = c.id AND b.variant_id = _variant
      WHERE c.consultora_party_id = _party AND c.status IN ('recebida', 'operacao') AND b.qty_available > 0
      ORDER BY c.created_at DESC LIMIT 1),
    public.kit_reference_price(_variant))
$$;
REVOKE ALL ON FUNCTION public.kit_preco_da_consultora(uuid, uuid) FROM PUBLIC, anon;

DO $patch$
DECLARE f record; def text; novo text;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('consultant_order_create', 'public.kit_reference_price(vid)', 'public.kit_preco(cyc, vid)'),
      ('showcase_order_create', 'public.kit_reference_price(vid)', 'public.kit_preco(cyc, vid)'),
      ('consultant_pieces', 'public.kit_reference_price(b.variant_id)', 'public.kit_preco(b.cycle_id, b.variant_id)'),
      ('consultora_pecas_buscar', 'public.kit_reference_price(b.variant_id)', 'public.kit_preco(b.cycle_id, b.variant_id)'),
      ('kit_maleta_perdida', 'public.kit_reference_price(it.variant_id)', 'public.kit_preco(c.id, it.variant_id)'),
      ('showcase_items_for', 'public.kit_reference_price(v.id)', 'public.kit_preco_da_consultora(_party, v.id)')
    ) AS x(fn, de, para) LOOP
    SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f.fn;
    IF def IS NULL THEN RAISE EXCEPTION 'Função % não encontrada.', f.fn; END IF;
    IF position(f.para IN def) > 0 THEN CONTINUE; END IF;
    novo := replace(def, f.de, f.para);
    IF novo = def THEN RAISE EXCEPTION '% não tem o formato esperado (preço).', f.fn; END IF;
    EXECUTE novo;
  END LOOP;
END $patch$;

-- ───────────────────────── 3. dados da folha do pedido ─────────────────────────
CREATE OR REPLACE FUNCTION public.pedido_grupo_peca(_categoria text, _sku text, _nome text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH n AS (SELECT upper(translate(coalesce(_categoria, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                                         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) cat,
                upper(coalesce(_nome, '')) nome, upper(regexp_replace(coalesce(_sku, ''), '[^A-Za-z]', '', 'g')) sku)
  SELECT CASE
    WHEN cat ~ '^ANE(L|IS)' THEN 'aneis'
    WHEN cat ~ '^BRINCO' THEN 'brincos'
    WHEN cat ~ '^(COLAR|COLARES|GARGANTILHA|CONJUNTO|PINGENTE|CHOKER)' THEN 'colares'
    WHEN cat ~ '^(PULSEIRA|BRACELETE)' THEN 'pulseiras'
    WHEN cat ~ '^TORNOZELEIRA' THEN 'tornozeleiras'
    WHEN cat ~ '^PIERCING' THEN 'piercing'
    WHEN nome ~ '^PIERCING' OR sku ~ '^PC' THEN 'piercing'
    WHEN nome ~ '^(AN|ANEL)\M' OR sku ~ '^L?AN' THEN 'aneis'
    WHEN nome ~ '^(CONJ|GR|COLAR|GARGANTILHA|CHOKER|PING)' OR sku ~ '^(L?GR|CJ|CH0|KGR|COL)' THEN 'colares'
    WHEN nome ~ '^(PUL|BRACELETE|BC)\M' OR sku ~ '^(L?PU|L?PC|PUL)' THEN 'pulseiras'
    WHEN nome ~ '^(TN|TORNOZELEIRA)' OR sku ~ '^(L?TN|TORN)' THEN 'tornozeleiras'
    WHEN nome ~ '^(BR|BRINCO)\M' OR sku ~ '^(L?BR|L?BI|AQ|AC|AG|BTR|TAQ)' THEN 'brincos'
    ELSE 'outros' END
  FROM n
$$;

CREATE OR REPLACE FUNCTION public.kit_pedido_dados(_cycle uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE kc kit_cycles; r remessas; cfg pedido_config; pa parties; v jsonb; kit_no int; montador text; codigo text;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para imprimir o pedido.' USING errcode = '42501'; END IF;
  SELECT * INTO kc FROM kit_cycles WHERE id = _cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF kc.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora definida.'; END IF;
  SELECT * INTO r FROM remessas WHERE id = kc.remessa_id;
  SELECT * INTO cfg FROM pedido_config;
  SELECT * INTO pa FROM parties WHERE id = kc.consultora_party_id;

  SELECT count(*) INTO kit_no FROM kit_cycles x
   WHERE x.remessa_id IS NOT DISTINCT FROM kc.remessa_id AND kc.remessa_id IS NOT NULL
     AND x.consultora_party_id = kc.consultora_party_id AND x.status <> 'cancelada' AND x.created_at <= kc.created_at;
  codigo := CASE WHEN pa.code ~ '^[0-9]{1,5}$' THEN lpad(pa.code, 5, '0') ELSE pa.code END;

  -- quem montou: quem mais bipou nesta maleta; senão quem criou a composição
  SELECT p.full_name INTO montador FROM montagem_operacoes o JOIN profiles p ON p.id = o.actor_user_id
   WHERE o.cycle_id = _cycle GROUP BY p.full_name ORDER BY sum(abs(o.delta)) DESC, max(o.created_at) DESC LIMIT 1;
  IF montador IS NULL THEN
    SELECT p.full_name INTO montador FROM kit_compositions c JOIN profiles p ON p.id = c.created_by
     WHERE c.cycle_id = _cycle ORDER BY c.version DESC LIMIT 1;
  END IF;

  SELECT jsonb_build_object(
    'empresa', to_jsonb(cfg) - 'id' - 'atualizado_por' - 'atualizado_em' - 'preco_virada_em',
    'remessa', jsonb_build_object(
      'numero', r.numero, 'kit', greatest(kit_no, 1), 'tipo_envio', coalesce(r.tipo_envio, 'pessoal'),
      'data_acerto', coalesce(r.data_acerto, (kc.due_at AT TIME ZONE 'America/Sao_Paulo')::date),
      'postar_ate', CASE WHEN r.tipo_envio = 'correio' AND coalesce(r.data_acerto, (kc.due_at AT TIME ZONE 'America/Sao_Paulo')::date) IS NOT NULL
                         THEN coalesce(r.data_acerto, (kc.due_at AT TIME ZONE 'America/Sao_Paulo')::date) - cfg.prazo_correio_dias END),
    'maleta', (SELECT k.code FROM kits k WHERE k.id = kc.kit_id),
    'cliente_codigo', codigo,
    'consultora', jsonb_build_object(
      'nome', pa.display_name,
      'endereco', (SELECT btrim(concat_ws(' · ', nullif(btrim(concat_ws(', ', ad.street, ad.street_number)), ''), ad.district))
                     FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
      'cidade', (SELECT ad.city || '/' || ad.uf FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
      'whatsapp', (SELECT ct.value FROM contact_points ct WHERE ct.party_id = pa.id AND ct.kind = 'whatsapp' ORDER BY ct.is_primary DESC, ct.created_at LIMIT 1)),
    'representante', (SELECT jsonb_build_object(
        'nome', rp.display_name,
        'praca', coalesce((SELECT cp2.nome FROM cob_pracas cp2 WHERE cp2.id = r.praca_id),
                          (SELECT cp3.nome FROM consultant_profiles c3 JOIN cob_pracas cp3 ON cp3.id = c3.praca_id WHERE c3.party_id = pa.id)),
        'telefone', (SELECT ct.value FROM contact_points ct WHERE ct.party_id = rp.id AND ct.kind::text IN ('whatsapp', 'phone', 'telefone', 'celular', 'mobile')
                      ORDER BY (ct.kind = 'whatsapp') DESC, ct.is_primary DESC, ct.created_at LIMIT 1))
      FROM parties rp WHERE rp.id = coalesce(r.representante_party_id, kc.representante_party_id)),
    'montado_por', montador,
    'faixas', coalesce((SELECT jsonb_agg(jsonb_build_object('min_cents', f.min_vendido_cents, 'percentual', f.percentual) ORDER BY f.min_vendido_cents)
                         FROM consultora_comissao_faixas f), '[]'::jsonb),
    'itens', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'variant_id', i.variant_id, 'sku', coalesce(nullif(v.sku, ''), pr.internal_code),
          'descricao', btrim(pr.name || CASE WHEN nullif(btrim(v.label), '') IS NULL OR upper(btrim(v.label)) IN ('U', 'UN', 'UNICO', 'ÚNICO', 'PADRAO', 'PADRÃO')
                                             THEN '' ELSE ' ' || btrim(v.label) END),
          'preco_cents', i.unit_reference_cents, 'quantidade', i.quantity,
          'grupo', public.pedido_grupo_peca(cat.name, coalesce(v.sku, pr.internal_code), pr.name))
        ORDER BY pr.name, v.label)
      FROM kit_composition_items i
      JOIN kit_compositions c ON c.id = i.composition_id
      JOIN product_variants v ON v.id = i.variant_id
      JOIN products pr ON pr.id = v.product_id
      LEFT JOIN categories cat ON cat.id = pr.category_id
     WHERE c.id = (SELECT c2.id FROM kit_compositions c2 WHERE c2.cycle_id = _cycle ORDER BY c2.version DESC LIMIT 1)
       AND i.quantity > 0), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.kit_pedido_dados(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_pedido_dados(uuid) TO authenticated, service_role;

-- ───────────────────────── 5. regra de preço nova ─────────────────────────
-- Até R$ 99,99: ARRED.PARA.CIMA(P + 0,10; 0) − 0,10  → termina em ,90
-- R$ 100 ou mais: ARRED.PARA.CIMA((P + 0,10)/5; 0) × 5 − 0,10 → termina em 4,90 ou 9,90
CREATE OR REPLACE FUNCTION public.preco_regra_lardan(_cents integer) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _cents IS NULL OR _cents <= 0 THEN _cents
    WHEN _cents < 10000 THEN ((_cents + 10 + 99) / 100) * 100 - 10
    ELSE ((_cents + 10 + 499) / 500) * 500 - 10 END
$$;

CREATE TABLE IF NOT EXISTS public.preco_reajustes (
  id bigserial PRIMARY KEY,
  lote text NOT NULL,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  onde text NOT NULL CHECK (onde IN ('lista', 'variante')),
  antes_cents integer NOT NULL,
  depois_cents integer NOT NULL,
  ator uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz
);
CREATE INDEX IF NOT EXISTS preco_reajustes_lote ON public.preco_reajustes (lote);
ALTER TABLE public.preco_reajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preco_reajustes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.preco_reajustes TO service_role;

-- relatório antigo × novo (só leitura): uma linha por variante ativa com preço
CREATE OR REPLACE FUNCTION public.preco_reajuste_previa() RETURNS TABLE (
  variant_id uuid, sku text, produto text, variante text, categoria text,
  antes_cents integer, depois_cents integer, diferenca_cents integer, pecas_na_rua integer, pecas_estoque integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'master') OR public.has_role(auth.uid(), 'diretoria')
                                OR public.has_capability(auth.uid(), 'catalog.manage')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o reajuste de preço.' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT v.id, coalesce(nullif(v.sku, ''), pr.internal_code), pr.name, v.label, cat.name,
         public.kit_reference_price(v.id), public.preco_regra_lardan(public.kit_reference_price(v.id)),
         public.preco_regra_lardan(public.kit_reference_price(v.id)) - public.kit_reference_price(v.id),
         coalesce((SELECT sum(greatest(b.qty_allocated - b.qty_sold - b.qty_returned - b.qty_lost, 0))::int FROM kit_balances b JOIN kit_cycles c ON c.id = b.cycle_id
                    WHERE b.variant_id = v.id AND c.status IN ('expedida', 'transito', 'recebida', 'operacao', 'acerto')), 0),
         coalesce((SELECT sum(s.quantity)::int FROM stock_balances s WHERE s.variant_id = v.id), 0)
    FROM product_variants v JOIN products pr ON pr.id = v.product_id
    LEFT JOIN categories cat ON cat.id = pr.category_id
   WHERE v.is_active AND pr.status <> 'arquivado' AND public.kit_reference_price(v.id) > 0
   ORDER BY (public.preco_regra_lardan(public.kit_reference_price(v.id)) - public.kit_reference_price(v.id)) DESC, pr.name;
END $$;
REVOKE ALL ON FUNCTION public.preco_reajuste_previa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preco_reajuste_previa() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preco_reajuste_resumo() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'variantes', count(*), 'mudam', count(*) FILTER (WHERE diferenca_cents <> 0),
    'antes_cents', coalesce(sum(antes_cents), 0), 'depois_cents', coalesce(sum(depois_cents), 0),
    'maior_aumento_cents', coalesce(max(diferenca_cents), 0),
    'media_aumento_pct', round(avg(CASE WHEN antes_cents > 0 THEN diferenca_cents * 100.0 / antes_cents END), 2),
    'virada_em', (SELECT preco_virada_em FROM pedido_config),
    'ultimo_lote', (SELECT lote FROM preco_reajustes WHERE desfeito_em IS NULL ORDER BY criado_em DESC LIMIT 1))
  FROM public.preco_reajuste_previa()
$$;
REVOKE ALL ON FUNCTION public.preco_reajuste_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preco_reajuste_resumo() TO authenticated, service_role;

-- aplicar: só o Master, digitando a confirmação. Maleta já expedida (na rua) não muda — acerta pelo preço gravado.
-- Maleta ainda em montagem (composição não congelada) passa a usar o preço novo.
CREATE OR REPLACE FUNCTION public.preco_reajuste_aplicar(_confirmacao text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_lote text; n_lista int; n_var int; n_kit int := 0; c record;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN
    RAISE EXCEPTION 'Só o Master aplica o reajuste de preço.' USING errcode = '42501';
  END IF;
  IF coalesce(_confirmacao, '') <> 'APLICAR NOVO PRECO' THEN
    RAISE EXCEPTION 'Para aplicar, digite exatamente: APLICAR NOVO PRECO';
  END IF;
  v_lote := 'preco-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 4);

  INSERT INTO preco_reajustes (lote, variant_id, onde, antes_cents, depois_cents, ator)
  SELECT v_lote, p.variant_id, 'lista', p.price_cents, public.preco_regra_lardan(p.price_cents), uid
    FROM public_price_list p
   WHERE p.variant_id IS NOT NULL AND p.price_cents > 0 AND public.preco_regra_lardan(p.price_cents) <> p.price_cents;
  GET DIAGNOSTICS n_lista = ROW_COUNT;
  UPDATE public_price_list p SET price_cents = r.depois_cents
    FROM preco_reajustes r WHERE r.lote = v_lote AND r.onde = 'lista' AND r.variant_id = p.variant_id;

  INSERT INTO preco_reajustes (lote, variant_id, onde, antes_cents, depois_cents, ator)
  SELECT v_lote, v.id, 'variante', v.price_cents, public.preco_regra_lardan(v.price_cents), uid
    FROM product_variants v
   WHERE v.price_cents > 0 AND public.preco_regra_lardan(v.price_cents) <> v.price_cents;
  GET DIAGNOSTICS n_var = ROW_COUNT;
  UPDATE product_variants v SET price_cents = r.depois_cents
    FROM preco_reajustes r WHERE r.lote = v_lote AND r.onde = 'variante' AND r.variant_id = v.id;

  -- maletas ainda em montagem (composição aberta): passam ao preço novo
  FOR c IN SELECT DISTINCT kc.id FROM kit_cycles kc JOIN kit_compositions co ON co.cycle_id = kc.id
            WHERE kc.status IN ('rascunho', 'montagem') AND co.frozen_at IS NULL LOOP
    UPDATE kit_composition_items i SET unit_reference_cents = public.kit_reference_price(i.variant_id)
      FROM kit_compositions co
     WHERE co.id = i.composition_id AND co.cycle_id = c.id AND co.frozen_at IS NULL
       AND i.unit_reference_cents IS DISTINCT FROM public.kit_reference_price(i.variant_id);
    PERFORM public.kit_totals_refresh(c.id);
    n_kit := n_kit + 1;
  END LOOP;

  UPDATE pedido_config SET preco_virada_em = now(), atualizado_por = uid, atualizado_em = now();
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'preco.reajuste_aplicado', 'product_variants', v_lote,
          jsonb_build_object('lista', n_lista, 'variantes', n_var, 'maletas_em_montagem', n_kit));
  RETURN jsonb_build_object('lote', v_lote, 'lista', n_lista, 'variantes', n_var, 'maletas_em_montagem', n_kit);
END $$;
REVOKE ALL ON FUNCTION public.preco_reajuste_aplicar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preco_reajuste_aplicar(text) TO authenticated, service_role;

-- desfazer: volta só onde o preço ainda é o que o lote gravou
CREATE OR REPLACE FUNCTION public.preco_reajuste_desfazer(_lote text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); n_lista int; n_var int;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN
    RAISE EXCEPTION 'Só o Master desfaz o reajuste.' USING errcode = '42501';
  END IF;
  UPDATE public_price_list p SET price_cents = r.antes_cents
    FROM preco_reajustes r WHERE r.lote = _lote AND r.onde = 'lista' AND r.desfeito_em IS NULL
     AND r.variant_id = p.variant_id AND p.price_cents = r.depois_cents;
  GET DIAGNOSTICS n_lista = ROW_COUNT;
  UPDATE product_variants v SET price_cents = r.antes_cents
    FROM preco_reajustes r WHERE r.lote = _lote AND r.onde = 'variante' AND r.desfeito_em IS NULL
     AND r.variant_id = v.id AND v.price_cents = r.depois_cents;
  GET DIAGNOSTICS n_var = ROW_COUNT;
  UPDATE preco_reajustes SET desfeito_em = now() WHERE lote = _lote AND desfeito_em IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'preco.reajuste_desfeito', 'product_variants', _lote, jsonb_build_object('lista', n_lista, 'variantes', n_var));
  RETURN jsonb_build_object('lote', _lote, 'lista', n_lista, 'variantes', n_var);
END $$;
REVOKE ALL ON FUNCTION public.preco_reajuste_desfazer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preco_reajuste_desfazer(text) TO authenticated, service_role;

-- ───────────────────────── 6. faixas de comissão da folha ─────────────────────────
INSERT INTO public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo)
SELECT x.min, x.pct, x.titulo FROM (VALUES (0, 20.00, '20%'), (20000, 25.00, '25%'), (50000, 30.00, '30%'),
                                          (65000, 35.00, '35%'), (120000, 40.00, '40%')) x(min, pct, titulo)
 WHERE NOT EXISTS (SELECT 1 FROM public.consultora_comissao_faixas);

-- leitura do tipo de envio (tela da remessa)
CREATE OR REPLACE FUNCTION public.remessa_envio_ler(_remessa uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('tipo_envio', r.tipo_envio, 'prazo_correio_dias', c.prazo_correio_dias,
         'postar_ate', CASE WHEN r.tipo_envio = 'correio' AND r.data_acerto IS NOT NULL THEN r.data_acerto - c.prazo_correio_dias END)
    FROM remessas r CROSS JOIN pedido_config c
   WHERE r.id = _remessa AND (public.can_manage_kits(auth.uid()) OR public.has_capability(auth.uid(), 'kit.view.all'))
$$;
REVOKE ALL ON FUNCTION public.remessa_envio_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_envio_ler(uuid) TO authenticated, service_role;
