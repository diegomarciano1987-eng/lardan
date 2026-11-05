-- 0211 — Compra de verdade na vitrine + Vendidos + Central de vendas (05/11/2026). Pacote do Diego.
CREATE OR REPLACE FUNCTION public.pedidos_abertos_qtd(_cycle uuid, _variant uuid, _exceto uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(sum(i.quantity), 0)::int
    FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id
   WHERE i.cycle_id = _cycle AND i.variant_id = _variant AND o.status <> 'cancelado'
     AND o.client_id IS NOT NULL AND o.channel IN ('consultora', 'vitrine') AND o.id IS DISTINCT FROM _exceto
$$;
REVOKE ALL ON FUNCTION public.pedidos_abertos_qtd(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedidos_abertos_qtd(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consultant_order_create(_client uuid, _itens jsonb, _idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  eu uuid := public.my_party_id(); cli public.consultant_clients; existente public.sales_orders;
  pedido uuid; item record; preco integer; b public.kit_balances; nome text;
  total bigint := 0; contagem integer := 0; ja integer;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501';
  END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN RAISE EXCEPTION 'Chave do pedido inválida.'; END IF;
  SELECT * INTO existente FROM public.sales_orders WHERE idempotency_key = _idempotency_key;
  IF existente.id IS NOT NULL THEN
    IF existente.consultora_party_id IS DISTINCT FROM eu THEN RAISE EXCEPTION 'Chave do pedido inválida.'; END IF;
    RETURN jsonb_build_object('order_id', existente.id, 'codigo', existente.code, 'total_cents', existente.subtotal_cents, 'repetido', true);
  END IF;
  SELECT * INTO cli FROM public.consultant_clients WHERE id = _client AND consultora_party_id = eu;
  IF cli.id IS NULL THEN RAISE EXCEPTION 'Escolha uma cliente sua.'; END IF;
  IF jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 THEN RAISE EXCEPTION 'Escolha pelo menos uma peça.'; END IF;
  IF jsonb_array_length(_itens) > 60 THEN RAISE EXCEPTION 'Pedido grande demais.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_itens) e WHERE coalesce((e->>'quantidade')::int,0) NOT BETWEEN 1 AND 99) THEN
    RAISE EXCEPTION 'Quantidade inválida.';
  END IF;

  INSERT INTO public.sales_orders (consultora_party_id, client_id, customer_name, customer_phone, customer_email, channel, status, idempotency_key)
  VALUES (eu, cli.id, cli.nome, cli.telefone, cli.email, 'consultora', 'em_atendimento', _idempotency_key)
  RETURNING id INTO pedido;

  FOR item IN SELECT (e->>'cycle_id')::uuid cyc, (e->>'variant_id')::uuid vid, sum((e->>'quantidade')::int)::int q
              FROM jsonb_array_elements(_itens) e GROUP BY 1,2 ORDER BY 1,2 LOOP
    SELECT pr.name || coalesce(' (' || v.label || ')', '') INTO nome FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id WHERE v.id = item.vid;
    nome := coalesce(nome, 'uma das peças');
    IF NOT EXISTS (SELECT 1 FROM public.kit_cycles c WHERE c.id = item.cyc AND c.consultora_party_id = eu AND c.status IN ('recebida','operacao')) THEN
      RAISE EXCEPTION 'A peça % não está numa maleta ativa sua.', nome;
    END IF;
    SELECT * INTO b FROM public.kit_balances WHERE cycle_id = item.cyc AND variant_id = item.vid FOR UPDATE;
    ja := public.pedidos_abertos_qtd(item.cyc, item.vid, pedido);
    IF b.id IS NULL OR coalesce(b.qty_available,0) - ja < item.q THEN
      RAISE EXCEPTION 'A peça % já está em outro pedido seu. Restam % unidade(s) livre(s). Tire ela da venda ou cancele o outro pedido.', nome, greatest(coalesce(b.qty_available,0) - ja, 0);
    END IF;
    preco := public.kit_preco(item.cyc, item.vid);
    INSERT INTO public.sales_order_items (order_id, cycle_id, variant_id, product_name, variant_label, quantity, unit_price_cents)
    SELECT pedido, item.cyc, item.vid, pr.name, v.label, item.q, preco FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id WHERE v.id = item.vid;
    total := total + preco::bigint * item.q; contagem := contagem + item.q;
  END LOOP;

  UPDATE public.sales_orders SET subtotal_cents = total, items_count = contagem WHERE id = pedido;
  INSERT INTO public.sales_order_events (order_id, kind, to_status, actor_user_id, payload)
  VALUES (pedido, 'pedido.criado_consultora', 'em_atendimento', auth.uid(), jsonb_build_object('itens', contagem, 'reserva', false));
  RETURN jsonb_build_object('order_id', pedido, 'codigo', (SELECT code FROM public.sales_orders WHERE id = pedido), 'total_cents', total);
END $function$;

CREATE OR REPLACE FUNCTION public.consultora_pecas_buscar(_busca text DEFAULT ''::text, _categoria text DEFAULT ''::text, _banho text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.produto,x.variante),'[]'::jsonb) FROM (
 SELECT b.cycle_id,b.variant_id,pr.name produto,v.label variante,(b.qty_available-coalesce(ped.ja,0))::int disponivel,public.kit_preco(b.cycle_id, b.variant_id) preco_cents,
 (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id=pr.id ORDER BY pm.position LIMIT 1) media_id,k.code maleta,cat.name categoria,coalesce(pt.name,pr.plating) banho,pr.collection_id,v.barcode,v.sku,pr.internal_code,pr.material,pr.warranty_text
 FROM public.kit_balances b JOIN public.kit_cycles c ON c.id=b.cycle_id JOIN public.kits k ON k.id=c.kit_id JOIN public.product_variants v ON v.id=b.variant_id JOIN public.products pr ON pr.id=v.product_id LEFT JOIN public.categories cat ON cat.id=pr.category_id LEFT JOIN public.plating_types pt ON pt.id=v.plating_type_id
 LEFT JOIN LATERAL (SELECT public.pedidos_abertos_qtd(b.cycle_id, b.variant_id) ja) ped ON true
 WHERE auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'consultora') AND c.consultora_party_id=public.my_party_id() AND c.status IN ('recebida','operacao') AND b.qty_available-coalesce(ped.ja,0)>0
 AND (coalesce(_categoria,'')='' OR cat.name=_categoria) AND (coalesce(_banho,'')='' OR coalesce(pt.name,pr.plating)=_banho)
 AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(trim(coalesce(_busca,''))), E'\\s+') term WHERE term<>'' AND lower(concat_ws(' ',pr.name,v.label,v.barcode,v.sku,pr.internal_code,pr.reference_code,cat.name,pt.name,pr.plating)) NOT LIKE '%'||term||'%') LIMIT 300
) x;
$function$;

CREATE OR REPLACE FUNCTION public.showcase_items_for(_party uuid, _design jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY ord, x->>'produto'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'cycle_id', min(b.cycle_id::text)::uuid,
      'variant_id', v.id, 'produto', pr.name, 'slug', pr.slug, 'variante', v.label,
      'tamanho', v.size, 'cor', v.color, 'categoria', cat.name,
      'referencia', public.peca_referencia_etiqueta(v.reference_code, pr.reference_code),
      'disponivel', sum(b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id))::int,
      'preco_cents', public.kit_preco_da_consultora(_party, v.id),
      'media_id', coalesce(
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id
             AND pm.media_id::text = _design#>>ARRAY['organizacao','fotos',v.id::text]),
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1)),
      'midias', (SELECT coalesce(jsonb_agg(pm.media_id ORDER BY pm.position), '[]') FROM public.product_media pm WHERE pm.product_id = pr.id),
      'ilustracao', (SELECT '/api/public/vitrine-ilus/' || si.party_id || '/' || si.variant_id
          FROM public.showcase_illustrations si
         WHERE si.party_id = _party AND si.variant_id = v.id
           AND NOT EXISTS (SELECT 1 FROM public.product_media pm2 WHERE pm2.product_id = pr.id))
    ) AS x,
    coalesce((SELECT o FROM jsonb_array_elements_text(coalesce(_design#>'{organizacao,ordem}','[]')) WITH ORDINALITY q(e,o) WHERE e = v.id::text), 100000) AS ord
    FROM public.kit_balances b
    JOIN public.kit_cycles c ON c.id = b.cycle_id
    JOIN public.product_variants v ON v.id = b.variant_id
    JOIN public.products pr ON pr.id = v.product_id
    LEFT JOIN public.categories cat ON cat.id = pr.category_id
    WHERE c.consultora_party_id = _party AND c.status IN ('recebida','operacao')
      AND b.is_published AND b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id) > 0 AND v.is_active
      AND pr.status <> 'arquivado'
      AND coalesce(public.kit_preco_da_consultora(_party, v.id), 0) > 0
    GROUP BY v.id, pr.id, cat.name
  ) s
$function$;

CREATE OR REPLACE FUNCTION public.vitrine_comprar(_slug text, _cliente jsonb, _itens jsonb, _forma text, _chave text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sh consultant_showcases; eu uuid; cfg consultora_cobranca_config; ex sales_orders;
  v_nome text := left(btrim(regexp_replace(coalesce(_cliente->>'nome', ''), '\s+', ' ', 'g')), 80);
  v_fone text := regexp_replace(coalesce(_cliente->>'telefone', ''), '\D', '', 'g');
  d text := regexp_replace(coalesce(_cliente->>'cpf', ''), '\D', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(_cliente->>'email', ''))), '');
  cli uuid; pedido uuid; codigo text; item record; cyc uuid; disp int; preco int; pnome text;
  total bigint := 0; contagem int := 0; party uuid; nome_cad text; nome_c text; tid uuid; inst uuid; prev text;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _forma NOT IN ('pix', 'cartao') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
  IF _chave IS NULL OR length(_chave) < 16 OR length(_chave) > 80 THEN RAISE EXCEPTION 'Chave da compra inválida.'; END IF;
  SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
  SELECT * INTO ex FROM sales_orders WHERE idempotency_key = 'vitrine:' || _chave;
  IF ex.id IS NOT NULL THEN
    RETURN jsonb_build_object('order_id', ex.id, 'codigo', ex.code, 'token', ex.public_token, 'total_cents', ex.subtotal_cents,
      'installment_id', ex.pay_installment_id, 'actor', cfg.ator_user_id, 'forma', ex.pay_method, 'vencimento', ex.pay_due_date,
      'expira_em', ex.reserve_expires_at, 'repetido', true);
  END IF;

  SELECT * INTO sh FROM consultant_showcases WHERE slug = lower(btrim(coalesce(_slug, ''))) AND is_public AND design_published IS NOT NULL;
  IF sh.party_id IS NULL THEN RAISE EXCEPTION 'Vitrine não encontrada.'; END IF;
  eu := sh.party_id;
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id = eu AND status IN ('ativo', 'aprovado'))
     OR NOT EXISTS (SELECT 1 FROM party_roles WHERE party_id = eu AND role = 'consultora' AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'Esta vitrine não está vendendo agora. Fale com a consultora pelo WhatsApp.';
  END IF;
  IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Pagamento pela vitrine indisponível no momento. Fale com a consultora pelo WhatsApp.'; END IF;

  IF length(v_nome) < 5 OR position(' ' IN v_nome) = 0 THEN RAISE EXCEPTION 'Informe seu nome e sobrenome.'; END IF;
  IF length(v_fone) NOT IN (10, 11) THEN RAISE EXCEPTION 'Informe seu WhatsApp com DDD.'; END IF;
  IF length(d) <> 11 OR NOT public.cpf_is_valid(d) THEN RAISE EXCEPTION 'CPF inválido. Confira os 11 números.'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.'; END IF;
  IF jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 THEN RAISE EXCEPTION 'Escolha pelo menos uma peça.'; END IF;
  IF jsonb_array_length(_itens) > 30 THEN RAISE EXCEPTION 'Compra grande demais para a vitrine. Fale com a consultora.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_itens) e
              WHERE coalesce(e->>'variant_id', '') !~ '^[0-9a-f-]{36}$' OR coalesce((e->>'quantidade')::int, 0) NOT BETWEEN 1 AND 10) THEN
    RAISE EXCEPTION 'Peça ou quantidade inválida.';
  END IF;

  IF (SELECT count(*) FROM sales_orders WHERE channel = 'vitrine' AND status <> 'cancelado' AND payment_status = 'pendente'
        AND regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g') = v_fone) >= 2 THEN
    RAISE EXCEPTION 'Você já tem compras aguardando pagamento nesta vitrine. Pague ou aguarde 1 hora para elas expirarem.';
  END IF;
  IF (SELECT count(*) FROM sales_orders WHERE channel = 'vitrine' AND consultora_party_id = eu AND status <> 'cancelado'
        AND payment_status = 'pendente') >= 15 THEN
    RAISE EXCEPTION 'Muitas compras aguardando pagamento nesta vitrine agora. Tente de novo em alguns minutos ou fale com a consultora.';
  END IF;

  IF d = (SELECT doc_digits FROM parties WHERE id = eu) THEN RAISE EXCEPTION 'Este CPF é da própria consultora. Use o CPF de quem está comprando.'; END IF;
  SELECT id, display_name INTO party, nome_cad FROM parties WHERE doc_digits = d AND is_active ORDER BY created_at LIMIT 1;
  IF party IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM party_roles pr WHERE pr.party_id = party AND pr.ended_at IS NULL AND pr.role::text IN ('consultora','revendedora','colaborador','representante','vendedora_interna','fornecedor','transportadora','prestador','custodiante','entidade_grupo','loja')) THEN
      RAISE EXCEPTION 'Este CPF não pode ser usado em compra pela vitrine. Fale com a consultora pelo WhatsApp.';
    END IF;
    IF public.fin_unaccent_lower(split_part(btrim(coalesce(nome_cad, '')), ' ', 1)) <> public.fin_unaccent_lower(split_part(v_nome, ' ', 1)) THEN
      RAISE EXCEPTION 'Este CPF está cadastrado em outro nome. Confira o CPF ou escreva seu nome como no documento.';
    END IF;
  END IF;

  SELECT id INTO cli FROM consultant_clients
   WHERE consultora_party_id = eu AND regexp_replace(coalesce(telefone, ''), '\D', '', 'g') = v_fone AND NOT coalesce(encerrada, false)
   ORDER BY created_at LIMIT 1;
  IF cli IS NULL THEN
    INSERT INTO consultant_clients (consultora_party_id, nome, telefone, email, origem, ultima_interacao)
    VALUES (eu, v_nome, v_fone, v_email, 'vitrine', now()) RETURNING id INTO cli;
  ELSE
    UPDATE consultant_clients SET ultima_interacao = now(), email = coalesce(consultant_clients.email, v_email) WHERE id = cli;
  END IF;

  INSERT INTO sales_orders (consultora_party_id, client_id, customer_name, customer_phone, customer_email, channel, status,
                            payment_status, idempotency_key, reserve_expires_at)
  VALUES (eu, cli, v_nome, v_fone, v_email, 'vitrine', 'aguardando_pagamento', 'pendente', 'vitrine:' || _chave, now() + interval '60 minutes')
  RETURNING id, code INTO pedido, codigo;

  FOR item IN SELECT (e->>'variant_id')::uuid vid, sum((e->>'quantidade')::int)::int q
                FROM jsonb_array_elements(_itens) e GROUP BY 1 ORDER BY 1 LOOP
    SELECT pr.name || coalesce(' (' || v.label || ')', '') INTO pnome FROM product_variants v JOIN products pr ON pr.id = v.product_id WHERE v.id = item.vid;
    pnome := coalesce(pnome, 'uma das peças');
    cyc := NULL; disp := 0;
    PERFORM 1 FROM kit_balances b JOIN kit_cycles c ON c.id = b.cycle_id
      WHERE c.consultora_party_id = eu AND c.status IN ('recebida', 'operacao') AND b.variant_id = item.vid AND b.is_published
      ORDER BY b.cycle_id FOR UPDATE OF b;
    SELECT b.cycle_id, b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id, pedido)
      INTO cyc, disp
      FROM kit_balances b JOIN kit_cycles c ON c.id = b.cycle_id
     WHERE c.consultora_party_id = eu AND c.status IN ('recebida', 'operacao') AND b.variant_id = item.vid AND b.is_published
     ORDER BY (b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id, pedido) >= item.q) DESC, c.created_at
     LIMIT 1;
    IF cyc IS NULL OR coalesce(disp, 0) <= 0 THEN RAISE EXCEPTION 'A peça % acabou de ser vendida. Atualize a vitrine.', pnome; END IF;
    IF disp < item.q THEN RAISE EXCEPTION 'Só resta % unidade(s) de %.', disp, pnome; END IF;
    preco := public.kit_preco_da_consultora(eu, item.vid);
    IF coalesce(preco, 0) <= 0 THEN RAISE EXCEPTION 'A peça % está sem preço. Fale com a consultora.', pnome; END IF;
    INSERT INTO sales_order_items (order_id, cycle_id, variant_id, product_name, variant_label, quantity, unit_price_cents)
    SELECT pedido, cyc, item.vid, pr.name, v.label, item.q, preco FROM product_variants v JOIN products pr ON pr.id = v.product_id WHERE v.id = item.vid;
    total := total + preco::bigint * item.q; contagem := contagem + item.q;
  END LOOP;

  IF party IS NULL THEN
    INSERT INTO parties (kind, display_name, legal_name, doc, doc_digits, status, created_by)
    VALUES ('pessoa', v_nome, v_nome, d, d, 'ativo', cfg.ator_user_id) RETURNING id INTO party;
    INSERT INTO party_roles (party_id, role, created_by) VALUES (party, 'cliente', cfg.ator_user_id);
  END IF;
  UPDATE sales_orders SET subtotal_cents = total, items_count = contagem, pay_method = _forma,
         pay_doc_masked = '***.' || substr(d, 4, 3) || '.' || substr(d, 7, 3) || '-**', pay_due_date = hoje, pay_party_id = party
   WHERE id = pedido;
  INSERT INTO sales_order_events (order_id, kind, to_status, actor_user_id, payload)
  VALUES (pedido, 'pedido.criado_vitrine', 'aguardando_pagamento', NULL,
          jsonb_build_object('itens', contagem, 'valor_cents', total, 'forma', _forma, 'expira_em', now() + interval '60 minutes'));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (NULL, 'vitrine.compra', 'sales_orders', pedido::text, jsonb_build_object('consultora', eu, 'forma', _forma, 'valor_cents', total, 'cliente', party));

  SELECT display_name INTO nome_c FROM parties WHERE id = eu;
  prev := current_setting('request.jwt.claims', true);
  PERFORM public.pdv_como(cfg.ator_user_id);
  tid := public.fin_title_create(jsonb_build_object('direction', 'receivable', 'business_entity_id', cfg.business_entity_id, 'party_id', party,
     'descricao', 'Pedido vitrine ' || codigo || ' — ' || coalesce(nome_c, 'consultora'), 'documento', 'PED-' || codigo, 'emissao', hoje, 'competencia', hoje,
     'valor_cents', total, 'financial_account_id', cfg.financial_account_id, 'origem', 'consultora', 'id_externo', 'pedido:' || pedido, 'status', 'ativo',
     'parcelas', jsonb_build_array(jsonb_build_object('valor_cents', total, 'vencimento', hoje))));
  PERFORM set_config('request.jwt.claims', coalesce(prev, ''), true);
  SELECT id INTO inst FROM financial_installments WHERE title_id = tid ORDER BY numero LIMIT 1;
  UPDATE sales_orders SET pay_title_id = tid, pay_installment_id = inst WHERE id = pedido;

  RETURN jsonb_build_object('order_id', pedido, 'codigo', codigo, 'token', (SELECT public_token FROM sales_orders WHERE id = pedido),
    'total_cents', total, 'installment_id', inst, 'actor', cfg.ator_user_id, 'forma', _forma, 'vencimento', hoje,
    'expira_em', now() + interval '60 minutes',
    'consultora_user', (SELECT id FROM profiles WHERE party_id = eu ORDER BY created_at LIMIT 1),
    'consultora_nome', split_part(btrim(coalesce(nome_c, '')), ' ', 1));
END $$;
REVOKE ALL ON FUNCTION public.vitrine_comprar(text, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vitrine_comprar(text, jsonb, jsonb, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.vitrine_pagamento_situacao(_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('codigo', o.code, 'pago', o.payment_status = 'pago', 'cancelado', o.status = 'cancelado',
           'expira_em', o.reserve_expires_at, 'total_cents', o.subtotal_cents, 'forma', o.pay_method, 'url', o.pay_url,
           'consultora', split_part(btrim((SELECT display_name FROM parties WHERE id = o.consultora_party_id)), ' ', 1))
    FROM sales_orders o WHERE o.public_token = _token AND o.channel = 'vitrine'
$$;
REVOKE ALL ON FUNCTION public.vitrine_pagamento_situacao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vitrine_pagamento_situacao(uuid) TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.pedido_cobranca_cancelamentos (
  order_id uuid PRIMARY KEY REFERENCES public.sales_orders(id),
  situacao text NOT NULL CHECK (situacao IN ('cancelado', 'falhou', 'sem_cobranca')),
  erro text,
  tentativas int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pedido_cobranca_cancelamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pedido_cobranca_cancelamentos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pedido_cobranca_cancelamentos TO service_role;
COMMENT ON TABLE public.pedido_cobranca_cancelamentos IS
  '0211: cancelamento no Asaas da cobrança de pedido expirado (vitrine) ou cancelado. Só o laço /api/public/vitrine/expirar escreve.';

CREATE OR REPLACE FUNCTION public.pedidos_cobranca_para_cancelar()
RETURNS TABLE (order_id uuid, codigo text, acao text, charge_id uuid, external_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT o.id, o.code, CASE WHEN o.status = 'cancelado' THEN 'cancelar' ELSE 'expirar' END, ac.id, ac.external_id
    FROM sales_orders o
    LEFT JOIN asaas_charges ac ON ac.id = o.pay_charge_id
    LEFT JOIN pedido_cobranca_cancelamentos x ON x.order_id = o.id
   WHERE o.payment_status = 'pendente'
     AND ((o.channel = 'vitrine' AND o.status <> 'cancelado' AND o.reserve_expires_at < now())
          OR (o.status = 'cancelado' AND ac.id IS NOT NULL AND coalesce(ac.external_status, 'PENDING') IN ('PENDING', 'OVERDUE')))
     AND coalesce(x.situacao, '') NOT IN ('cancelado', 'sem_cobranca')
     AND coalesce(x.tentativas, 0) < 6
   ORDER BY o.created_at
   LIMIT 50
$$;
REVOKE ALL ON FUNCTION public.pedidos_cobranca_para_cancelar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedidos_cobranca_para_cancelar() TO service_role;

CREATE OR REPLACE FUNCTION public.pedido_cobranca_cancelada(_order uuid, _ok boolean, _erro text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o sales_orders; sit text;
BEGIN
  SELECT * INTO o FROM sales_orders WHERE id = _order FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  sit := CASE WHEN _ok AND o.pay_charge_id IS NULL THEN 'sem_cobranca' WHEN _ok THEN 'cancelado' ELSE 'falhou' END;
  INSERT INTO pedido_cobranca_cancelamentos (order_id, situacao, erro) VALUES (o.id, sit, left(_erro, 500))
  ON CONFLICT (order_id) DO UPDATE SET situacao = excluded.situacao, erro = excluded.erro,
    tentativas = pedido_cobranca_cancelamentos.tentativas + 1, updated_at = now();
  IF _ok AND o.channel = 'vitrine' AND o.status <> 'cancelado' AND o.payment_status = 'pendente' THEN
    UPDATE sales_orders SET status = 'cancelado', cancelled_at = now(), cancel_reason = 'Pagamento não concluído em 60 minutos (vitrine).' WHERE id = o.id;
    INSERT INTO sales_order_events (order_id, kind, from_status, to_status, actor_user_id, payload)
    VALUES (o.id, 'pedido.expirado_vitrine', o.status::text, 'cancelado', NULL, jsonb_build_object('cobranca_cancelada', o.pay_charge_id IS NOT NULL));
  END IF;
  RETURN jsonb_build_object('situacao', sit);
END $$;
REVOKE ALL ON FUNCTION public.pedido_cobranca_cancelada(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedido_cobranca_cancelada(uuid, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.order_set_status(_order uuid, _status text, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o public.sales_orders; uid uuid := auth.uid(); eu uuid; novo public.sales_order_status;
        it record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  eu := public.my_party_id();
  SELECT * INTO o FROM public.sales_orders WHERE id = _order FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR o.consultora_party_id IS DISTINCT FROM eu) THEN
    RAISE EXCEPTION 'Sem permissão para atender este pedido.' USING errcode='42501';
  END IF;
  novo := _status::public.sales_order_status;
  IF o.status = novo THEN
    RETURN jsonb_build_object('situacao', o.status, 'repetido', true);
  END IF;
  IF o.status IN ('concluido','cancelado') THEN
    RAISE EXCEPTION 'Este pedido já foi encerrado.';
  END IF;
  IF novo = 'cancelado' AND o.payment_status = 'pago' AND public.has_capability(uid,'kit.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'Este pedido já foi pago e não pode ser cancelado pelo app. Para devolução, fale com a Lardan.';
  END IF;

  IF novo = 'cancelado' THEN
    FOR it IN SELECT * FROM public.sales_order_items WHERE order_id = o.id LOOP
      UPDATE public.kit_balances
         SET qty_reserved = greatest(qty_reserved - it.quantity, 0), updated_at = now()
       WHERE cycle_id = it.cycle_id AND variant_id = it.variant_id;
    END LOOP;
    UPDATE public.sales_orders SET status = novo, cancelled_at = now(), cancel_reason = _note
     WHERE id = o.id;
  ELSIF novo = 'concluido' THEN
    RAISE EXCEPTION 'Conclusão exige o registro da venda, ainda não disponível.';
  ELSE
    UPDATE public.sales_orders SET status = novo WHERE id = o.id;
  END IF;

  INSERT INTO public.sales_order_events (order_id, kind, from_status, to_status, actor_user_id, note)
  VALUES (o.id, 'pedido.situacao', o.status::text, novo::text, uid, _note);

  RETURN jsonb_build_object('situacao', novo);
END $function$;

CREATE OR REPLACE FUNCTION public.consultora_pedido_entregue(_order uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id(); o sales_orders; novo sales_order_status;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id = _order AND consultora_party_id = eu FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status = 'cancelado' THEN RAISE EXCEPTION 'Este pedido foi cancelado.'; END IF;
  IF o.delivery_status = 'entregue' THEN RETURN jsonb_build_object('entregue', true, 'repetido', true); END IF;
  novo := CASE WHEN o.payment_status = 'pago' THEN 'concluido'::sales_order_status ELSE o.status END;
  UPDATE sales_orders SET delivery_status = 'entregue', status = novo, closed_at = CASE WHEN novo = 'concluido' THEN now() ELSE closed_at END WHERE id = o.id;
  INSERT INTO sales_order_events (order_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (o.id, 'pedido.entregue', o.status::text, novo::text, auth.uid(), jsonb_build_object('pago', o.payment_status = 'pago'));
  RETURN jsonb_build_object('entregue', true, 'situacao', novo);
END $$;
REVOKE ALL ON FUNCTION public.consultora_pedido_entregue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_pedido_entregue(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.venda_forma(_o public.sales_orders)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _o.pay_method = 'pix' AND _o.pay_installment_id IS NOT NULL THEN 'pix'
    WHEN _o.pay_method = 'cartao' AND _o.pay_installment_id IS NOT NULL THEN 'cartao'
    WHEN _o.pay_method = 'depois' AND _o.pay_installment_id IS NOT NULL THEN 'boleto'
    WHEN _o.pay_method = 'dinheiro' THEN 'dinheiro'
    WHEN _o.pay_method = 'depois' THEN 'receber_depois'
    WHEN _o.status = 'concluido' THEN 'marcada_feita'
    ELSE 'sem_forma' END
$$;
GRANT EXECUTE ON FUNCTION public.venda_forma(public.sales_orders) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_vendidos(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id(); hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  de date := coalesce(_de, date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date); ate date := coalesce(_ate, hoje);
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501'; END IF;
  IF ate < de OR ate - de > 400 THEN RAISE EXCEPTION 'Período inválido.'; END IF;
  RETURN (
    WITH v AS (
      SELECT o.*, public.venda_forma(o) AS forma, (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia
        FROM sales_orders o
       WHERE o.consultora_party_id = eu AND o.status <> 'cancelado' AND o.client_id IS NOT NULL
         AND o.channel IN ('consultora', 'vitrine')
         AND (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN de AND ate),
    maleta AS (
      SELECT coalesce(sum(greatest(it.qtd_vendida - it.qtd_app, 0) * it.preco_cents), 0)::bigint AS valor,
             coalesce(sum(greatest(it.qtd_vendida - it.qtd_app, 0)), 0)::int AS pecas
        FROM kit_pre_baixas p JOIN kit_pre_baixa_itens it ON it.pre_baixa_id = p.id
        JOIN kit_cycles c ON c.id = p.cycle_id
       WHERE p.consultora_party_id = eu AND p.status IN ('aberta', 'fechada') AND c.status IN ('recebida', 'operacao', 'acerto'))
    SELECT jsonb_build_object(
      'de', de, 'ate', ate,
      'resumo', jsonb_build_object(
         'vendas', (SELECT count(*) FROM v), 'valor_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM v),
         'pecas', (SELECT coalesce(sum(items_count), 0) FROM v),
         'pago_lardan_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM v WHERE payment_status = 'pago' AND forma IN ('pix', 'cartao', 'boleto')),
         'dinheiro_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM v WHERE forma = 'dinheiro'),
         'a_receber_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM v WHERE payment_status <> 'pago' AND forma NOT IN ('dinheiro', 'marcada_feita')),
         'vitrine_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM v WHERE channel = 'vitrine')),
      'formas', (SELECT coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'vendas', n, 'valor_cents', valor) ORDER BY valor DESC), '[]'::jsonb)
                   FROM (SELECT forma, count(*) n, sum(subtotal_cents) valor FROM v GROUP BY forma) f),
      'vendas', (SELECT coalesce(jsonb_agg(jsonb_build_object('order_id', id, 'codigo', code, 'data', created_at, 'cliente', customer_name,
                   'valor_cents', subtotal_cents, 'pecas', items_count, 'forma', forma, 'canal', channel,
                   'pago', payment_status = 'pago', 'entregue', delivery_status = 'entregue', 'situacao', status) ORDER BY created_at DESC), '[]'::jsonb)
                   FROM (SELECT * FROM v ORDER BY created_at DESC LIMIT 200) x),
      'maleta_sem_pedido', (SELECT jsonb_build_object('valor_cents', valor, 'pecas', pecas) FROM maleta))
  );
END $$;
REVOKE ALL ON FUNCTION public.consultora_vendidos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_vendidos(date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.central_vendas(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  de date := coalesce(_de, date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date); ate date := coalesce(_ate, hoje);
  dias int; de_ant date; ate_ant date;
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.has_capability(auth.uid(), 'finance.view'), false) OR coalesce(public.kit_scope_all(), false)) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF ate < de OR ate - de > 400 THEN RAISE EXCEPTION 'Período inválido.'; END IF;
  dias := ate - de + 1; ate_ant := de - 1; de_ant := de - dias;
  RETURN (
    WITH base AS (
      SELECT o.*, public.venda_forma(o) AS forma, (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia
        FROM sales_orders o
       WHERE o.status <> 'cancelado' AND o.client_id IS NOT NULL AND o.channel IN ('consultora', 'vitrine')
         AND (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN de_ant AND ate),
    v AS (SELECT * FROM base WHERE dia BETWEEN de AND ate),
    ant AS (SELECT * FROM base WHERE dia BETWEEN de_ant AND ate_ant),
    vc AS (SELECT v.*, p.display_name AS consultora, p.code AS consultora_codigo, cp.praca_id, cp.representative_party_id AS rep_id
             FROM v JOIN parties p ON p.id = v.consultora_party_id LEFT JOIN consultant_profiles cp ON cp.party_id = v.consultora_party_id)
    SELECT jsonb_build_object(
      'de', de, 'ate', ate,
      'resumo', jsonb_build_object(
         'vendas', (SELECT count(*) FROM v), 'valor_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM v),
         'pecas', (SELECT coalesce(sum(items_count), 0) FROM v),
         'consultoras', (SELECT count(DISTINCT consultora_party_id) FROM v),
         'pago_lardan_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM v WHERE payment_status = 'pago' AND forma IN ('pix', 'cartao', 'boleto')),
         'a_receber_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM v WHERE payment_status <> 'pago' AND forma NOT IN ('dinheiro', 'marcada_feita')),
         'vitrine_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM v WHERE channel = 'vitrine'),
         'vitrine_vendas', (SELECT count(*) FROM v WHERE channel = 'vitrine'),
         'anterior_valor_cents', (SELECT coalesce(sum(subtotal_cents), 0) FROM ant),
         'anterior_vendas', (SELECT count(*) FROM ant)),
      'formas', (SELECT coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'vendas', n, 'valor_cents', valor) ORDER BY valor DESC), '[]'::jsonb)
                   FROM (SELECT forma, count(*) n, sum(subtotal_cents) valor FROM v GROUP BY forma) f),
      'dias', (SELECT coalesce(jsonb_agg(jsonb_build_object('dia', g::date, 'vendas', coalesce(x.n, 0), 'valor_cents', coalesce(x.valor, 0),
                 'vitrine_cents', coalesce(x.vit, 0)) ORDER BY g), '[]'::jsonb)
                 FROM generate_series(de, ate, interval '1 day') g
                 LEFT JOIN (SELECT dia, count(*) n, sum(subtotal_cents) valor, sum(subtotal_cents) FILTER (WHERE channel = 'vitrine') vit FROM v GROUP BY dia) x ON x.dia = g::date),
      'ranking', (SELECT coalesce(jsonb_agg(r ORDER BY (r->>'valor_cents')::bigint DESC), '[]'::jsonb) FROM (
                   SELECT jsonb_build_object('party_id', consultora_party_id, 'nome', max(consultora), 'codigo', max(consultora_codigo),
                     'praca', (SELECT nome FROM cob_pracas WHERE id = max(praca_id::text)::uuid),
                     'representante', (SELECT display_name FROM parties WHERE id = max(rep_id::text)::uuid),
                     'vendas', count(*), 'valor_cents', sum(subtotal_cents), 'pecas', sum(items_count),
                     'vitrine_cents', coalesce(sum(subtotal_cents) FILTER (WHERE channel = 'vitrine'), 0)) r
                     FROM vc GROUP BY consultora_party_id ORDER BY sum(subtotal_cents) DESC LIMIT 50) t),
      'pracas', (SELECT coalesce(jsonb_agg(jsonb_build_object('praca', coalesce(pc.nome, 'Sem praça'), 'codigo', pc.codigo, 'vendas', n, 'valor_cents', valor,
                   'consultoras', cons) ORDER BY valor DESC), '[]'::jsonb)
                   FROM (SELECT praca_id, count(*) n, sum(subtotal_cents) valor, count(DISTINCT consultora_party_id) cons FROM vc GROUP BY praca_id) x
                   LEFT JOIN cob_pracas pc ON pc.id = x.praca_id),
      'representantes', (SELECT coalesce(jsonb_agg(jsonb_build_object('representante', coalesce(r.display_name, 'Sem representante'), 'vendas', n,
                   'valor_cents', valor, 'consultoras', cons) ORDER BY valor DESC), '[]'::jsonb)
                   FROM (SELECT rep_id, count(*) n, sum(subtotal_cents) valor, count(DISTINCT consultora_party_id) cons FROM vc GROUP BY rep_id) x
                   LEFT JOIN parties r ON r.id = x.rep_id),
      'ultimas', (SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', code, 'data', created_at, 'consultora', consultora,
                   'cliente', split_part(btrim(customer_name), ' ', 1), 'valor_cents', subtotal_cents, 'pecas', items_count,
                   'forma', forma, 'canal', channel, 'pago', payment_status = 'pago') ORDER BY created_at DESC), '[]'::jsonb)
                   FROM (SELECT * FROM vc ORDER BY created_at DESC LIMIT 30) x))
  );
END $$;
REVOKE ALL ON FUNCTION public.central_vendas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.central_vendas(date, date) TO authenticated, service_role;