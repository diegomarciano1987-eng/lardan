-- 0315 (Diego 13/11): busca com cidade/responsável, contatos de recado e referência, referência da peça na maleta,
-- desfazer movimento errado de maleta (equipe e representante) e banho por categoria nas vendas.

-- 1. Busca: cidade, UF, praça e responsável de cada pessoa encontrada (só de quem quem busca já pode ver)
CREATE OR REPLACE FUNCTION public.pessoas_busca_contexto(_ids uuid[])
RETURNS TABLE(party_id uuid, cidade text, uf text, praca text, responsavel text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id,
         (SELECT a.city FROM party_addresses a WHERE a.party_id = p.id ORDER BY a.is_primary DESC, a.updated_at DESC NULLS LAST LIMIT 1),
         (SELECT a.uf FROM party_addresses a WHERE a.party_id = p.id ORDER BY a.is_primary DESC, a.updated_at DESC NULLS LAST LIMIT 1),
         pr.nome, rp.display_name
    FROM unnest(coalesce(_ids, '{}'::uuid[])) WITH ORDINALITY u(id, n)
    JOIN parties p ON p.id = u.id
    LEFT JOIN consultant_profiles cp ON cp.party_id = p.id
    LEFT JOIN parties rp ON rp.id = cp.representative_party_id
    LEFT JOIN cob_pracas pr ON pr.id = cp.praca_id
   WHERE auth.uid() IS NOT NULL
     AND cardinality(_ids) <= 2500
     AND (public.is_staff(auth.uid()) OR public.colab_party_ok(p.id))
     AND (NOT public.colab_restrita() OR public.colab_party_ok(p.id) OR public.kit_ve_rede())
   ORDER BY u.n
$$;
REVOKE ALL ON FUNCTION public.pessoas_busca_contexto(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pessoas_busca_contexto(uuid[]) TO authenticated, service_role;

-- 2. Contato de recado e referência (opcionais): nome, parentesco e telefone. Só por RPC.
CREATE TABLE public.party_referencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('recado','referencia')),
  nome text,
  parentesco text,
  telefone text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, tipo)
);
GRANT ALL ON public.party_referencias TO service_role;
ALTER TABLE public.party_referencias ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.party_referencias IS '0315: telefone de recado e contato de referência da consultora (nome, parentesco, telefone). Leitura/escrita só por party_referencias_ler/salvar.';

CREATE OR REPLACE FUNCTION public.party_referencias_pode(_party uuid, _escrever boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    (public.has_capability(auth.uid(), CASE WHEN _escrever THEN 'registry.manage' ELSE 'registry.view' END)
       AND (NOT public.colab_restrita() OR public.colab_party_ok(_party)))
    OR (NOT _escrever AND public.is_staff(auth.uid()) AND NOT public.colab_restrita())
    OR (public.has_role(auth.uid(), 'representante') AND EXISTS (
          SELECT 1 FROM consultant_profiles cp WHERE cp.party_id = _party AND cp.representative_party_id = public.my_party_id()))
    OR (public.has_role(auth.uid(), 'representante') AND EXISTS (
          SELECT 1 FROM leads l WHERE l.party_id = _party AND l.representante_party_id = public.my_party_id())))
$$;
REVOKE ALL ON FUNCTION public.party_referencias_pode(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_referencias_pode(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.party_referencias_ler(_party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.party_referencias_pode(_party, false) THEN RAISE EXCEPTION 'Sem permissão para ver os contatos deste cadastro.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'nome', nome, 'parentesco', parentesco, 'telefone', telefone,
                                                       'atualizado_em', atualizado_em) ORDER BY tipo DESC)
                     FROM party_referencias WHERE party_id = _party), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.party_referencias_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_referencias_ler(uuid) TO authenticated, service_role;

-- _itens: [{tipo:'recado'|'referencia', nome, parentesco, telefone}]; linha toda vazia apaga aquele tipo.
CREATE OR REPLACE FUNCTION public.party_referencias_salvar(_party uuid, _itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE x jsonb; v_tipo text; v_nome text; v_par text; v_tel text; n int := 0; antes jsonb;
BEGIN
  IF NOT public.party_referencias_pode(_party, true) THEN RAISE EXCEPTION 'Sem permissão para alterar os contatos deste cadastro.' USING errcode = '42501'; END IF;
  IF jsonb_typeof(coalesce(_itens, 'null'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Contatos inválidos.'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) - 'party_id'), '[]'::jsonb) INTO antes FROM party_referencias r WHERE party_id = _party;
  FOR x IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_tipo := x->>'tipo';
    IF v_tipo NOT IN ('recado','referencia') THEN RAISE EXCEPTION 'Tipo de contato inválido.'; END IF;
    v_nome := nullif(left(btrim(coalesce(x->>'nome','')), 120), '');
    v_par := nullif(left(btrim(coalesce(x->>'parentesco','')), 60), '');
    v_tel := nullif(regexp_replace(coalesce(x->>'telefone',''), '\D', '', 'g'), '');
    IF v_tel IS NOT NULL AND length(v_tel) NOT IN (10, 11) THEN
      RAISE EXCEPTION 'Telefone de % precisa ter DDD + número (10 ou 11 dígitos).', CASE WHEN v_tipo = 'recado' THEN 'recado' ELSE 'referência' END;
    END IF;
    IF v_nome IS NULL AND v_par IS NULL AND v_tel IS NULL THEN
      DELETE FROM party_referencias WHERE party_id = _party AND tipo = v_tipo;
    ELSE
      INSERT INTO party_referencias (party_id, tipo, nome, parentesco, telefone, criado_por)
      VALUES (_party, v_tipo, v_nome, v_par, v_tel, auth.uid())
      ON CONFLICT (party_id, tipo) DO UPDATE SET nome = EXCLUDED.nome, parentesco = EXCLUDED.parentesco,
        telefone = EXCLUDED.telefone, atualizado_em = now();
      n := n + 1;
    END IF;
  END LOOP;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'pessoa.referencias_salvas', 'parties', _party::text, jsonb_build_object('antes', antes, 'depois', _itens));
  RETURN jsonb_build_object('salvos', n);
END $$;
REVOKE ALL ON FUNCTION public.party_referencias_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_referencias_salvar(uuid, jsonb) TO authenticated, service_role;

-- 3. Referência da peça junto do nome na maleta (mesma regra da etiqueta: variante, depois produto)
CREATE OR REPLACE FUNCTION public.kit_detail(_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.kit_cycles; comp uuid; k public.kits;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo não encontrado.'; END IF;
  PERFORM public.kit_require_cycle(_cycle);

  SELECT * INTO k FROM public.kits WHERE id = c.kit_id;
  SELECT id INTO comp FROM public.kit_compositions WHERE cycle_id = _cycle
   ORDER BY version DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ciclo', to_jsonb(c),
    'maleta', jsonb_build_object('id', k.id, 'codigo', k.code, 'etiqueta', k.label,
                                 'qr_token', k.qr_token),
    'consultora', (SELECT display_name FROM public.parties WHERE id = c.consultora_party_id),
    'representante', (SELECT display_name FROM public.parties WHERE id = c.representante_party_id),
    'custodia', (SELECT display_name FROM public.parties WHERE id = c.custodian_party_id),
    'composicao', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'variant_id', ci.variant_id,
        'produto', pr.name,
        'variante', v.label,
        'sku', v.sku,
        'referencia', public.peca_referencia_etiqueta(v.reference_code, pr.reference_code),
        'quantidade', ci.quantity,
        'valor_unitario', ci.unit_reference_cents,
        'media_id', (SELECT pm.media_id FROM public.product_media pm
                      WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1))
        ORDER BY pr.name), '[]'::jsonb)
      FROM public.kit_composition_items ci
      JOIN public.product_variants v ON v.id = ci.variant_id
      JOIN public.products pr ON pr.id = v.product_id
      WHERE ci.composition_id = comp),
    'saldos', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'variant_id', b.variant_id,
        'produto', pr.name,
        'variante', v.label,
        'referencia', public.peca_referencia_etiqueta(v.reference_code, pr.reference_code),
        'alocado', b.qty_allocated,
        'aceito', b.qty_accepted,
        'divergente', b.qty_divergent,
        'vendido', b.qty_sold,
        'reservado', b.qty_reserved,
        'disponivel', b.qty_available,
        'publicado', b.is_published,
        'media_id', (SELECT pm.media_id FROM public.product_media pm
                      WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1))
        ORDER BY pr.name), '[]'::jsonb)
      FROM public.kit_balances b
      JOIN public.product_variants v ON v.id = b.variant_id
      JOIN public.products pr ON pr.id = v.product_id
      WHERE b.cycle_id = _cycle),
    'entregas', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'seq', t.seq, 'situacao', t.status,
        'de', (SELECT display_name FROM public.parties WHERE id = t.from_party_id),
        'para', (SELECT display_name FROM public.parties WHERE id = t.to_party_id),
        'para_party_id', t.to_party_id,
        'transportadora', t.carrier, 'rastreio', t.tracking_code,
        'enviada_em', t.shipped_at, 'entregue_em', t.delivered_at,
        'recusada_em', t.refused_at, 'motivo', t.refusal_reason) ORDER BY t.seq), '[]'::jsonb)
      FROM public.kit_transfers t WHERE t.cycle_id = _cycle),
    'eventos', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'de', e.from_status, 'para', e.to_status,
        'quando', e.created_at, 'payload', e.payload, 'motivo', e.reason)
        ORDER BY e.created_at DESC), '[]'::jsonb)
      FROM public.kit_events e WHERE e.cycle_id = _cycle));
END $function$;

-- 4. Desfazer movimento errado de maleta (troca de consultora, troca para abertura, repasse do representante).
-- Nunca apaga o movimento: cria o movimento de volta, guarda quem, quando e por quê, e só desfaz o ÚLTIMO movimento.
CREATE TABLE public.maleta_movimentos_desfeitos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL UNIQUE,
  cycle_id uuid NOT NULL,
  maleta text,
  de_party_id uuid,
  para_party_id uuid,
  motivo text NOT NULL,
  desfeito_por uuid NOT NULL,
  representante_party_id uuid,
  aceite_desfeito boolean NOT NULL DEFAULT false,
  copia jsonb NOT NULL DEFAULT '{}'::jsonb,
  resultado jsonb NOT NULL DEFAULT '{}'::jsonb,
  desfeito_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.maleta_movimentos_desfeitos TO service_role;
ALTER TABLE public.maleta_movimentos_desfeitos ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.maleta_movimentos_desfeitos IS '0315: cada movimento de maleta desfeito (um por evento), com motivo, autor e cópia do aceite/pré-baixa vazia removidos.';

CREATE OR REPLACE FUNCTION public.maleta_movimento_kinds()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['maleta.transferida','maleta.trocada_para_abertura','maleta.repassada'] $$;

-- Núcleo: _aplicar=false só devolve o plano (prévia); _aplicar=true executa.
CREATE OR REPLACE FUNCTION public.maleta_movimento_desfazer_nucleo(_evento uuid, _motivo text, _rep uuid, _aplicar boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); e kit_events; c kit_cycles; v_maleta text; v_nova uuid; v_destino uuid; v_atual uuid;
        v_aceita boolean; v_master boolean; v_bloq text; pb kit_pre_baixas; s jsonb; st party_status;
        n_atual text; n_destino text; v_passos text[] := '{}'; v_motivo text := btrim(coalesce(_motivo, ''));
        v_copia jsonb := '{}'::jsonb; r jsonb; cart record; v_cart jsonb; v_pend int := 0; v_rem_rep uuid; d record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  SELECT * INTO e FROM kit_events WHERE id = _evento AND kind = ANY (public.maleta_movimento_kinds());
  IF e.id IS NULL THEN RAISE EXCEPTION 'Movimento não encontrado.'; END IF;
  -- repasse que fez parte de uma troca para abertura: quem manda é a troca
  IF e.kind = 'maleta.repassada' THEN
    SELECT * INTO e FROM kit_events x WHERE x.cycle_id = e.cycle_id AND x.created_at = e.created_at
       AND x.kind = 'maleta.trocada_para_abertura' LIMIT 1;
    IF e.id IS NULL THEN SELECT * INTO e FROM kit_events WHERE id = _evento; END IF;
  END IF;
  IF _aplicar THEN SELECT * INTO c FROM kit_cycles WHERE id = e.cycle_id FOR UPDATE;
  ELSE SELECT * INTO c FROM kit_cycles WHERE id = e.cycle_id; END IF;
  SELECT code INTO v_maleta FROM kits WHERE id = c.kit_id;
  SELECT representante_party_id INTO v_rem_rep FROM remessas WHERE id = c.remessa_id;

  -- quem pode
  IF _rep IS NOT NULL THEN
    IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
    IF c.representante_party_id IS DISTINCT FROM _rep AND v_rem_rep IS DISTINCT FROM _rep THEN
      RAISE EXCEPTION 'Esta maleta não é da sua remessa.' USING errcode = '42501';
    END IF;
  ELSE
    IF NOT (public.can_manage_kits(uid) OR public.has_role(uid, 'master')) THEN
      RAISE EXCEPTION 'Sem permissão para desfazer movimentos de maleta.' USING errcode = '42501';
    END IF;
    IF public.kit_cycle_in_scope(c.id) IS NOT TRUE THEN RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501'; END IF;
  END IF;
  v_master := public.has_role(uid, 'master');

  v_nova := coalesce((e.payload->>'consultora_nova')::uuid, (e.payload->>'consultora')::uuid);
  v_destino := CASE WHEN e.kind = 'maleta.repassada' THEN NULL ELSE (e.payload->>'consultora_anterior')::uuid END;
  v_atual := c.consultora_party_id;
  SELECT display_name || coalesce(' (' || code || ')', '') INTO n_atual FROM parties WHERE id = v_atual;
  SELECT display_name || coalesce(' (' || code || ')', ''), status INTO n_destino, st FROM parties WHERE id = v_destino;
  v_aceita := EXISTS (SELECT 1 FROM kit_acceptances a WHERE a.cycle_id = c.id);

  IF EXISTS (SELECT 1 FROM maleta_movimentos_desfeitos WHERE evento_id = e.id) THEN
    v_bloq := 'Este movimento já foi desfeito.';
  ELSIF EXISTS (SELECT 1 FROM kit_events x WHERE x.cycle_id = c.id AND x.kind = ANY (public.maleta_movimento_kinds())
                 AND x.created_at > e.created_at) THEN
    v_bloq := 'Depois deste movimento a maleta foi movida de novo. Desfaça primeiro o movimento mais recente dela.';
  ELSIF v_atual IS DISTINCT FROM v_nova THEN
    v_bloq := format('A maleta não está mais com %s.', coalesce((SELECT display_name FROM parties WHERE id = v_nova), 'a consultora deste movimento'));
  ELSIF c.status::text NOT IN ('transito','recebida','operacao') THEN
    v_bloq := 'A maleta já está em acerto ou encerrada: o caminho agora é o acerto (devolução das peças).';
  ELSIF v_aceita AND (_rep IS NOT NULL OR NOT v_master) THEN
    v_bloq := format('%s já aceitou a maleta no app. Depois do aceite, só o Master desfaz, pela tela da equipe.', coalesce(n_atual, 'A consultora'));
  ELSIF v_aceita THEN
    SELECT * INTO pb FROM kit_pre_baixas WHERE cycle_id = c.id;
    IF EXISTS (SELECT 1 FROM sales_order_items i WHERE i.cycle_id = c.id) THEN
      v_bloq := 'Já existe pedido de cliente com peças desta maleta. Não dá para desfazer.';
    ELSIF EXISTS (SELECT 1 FROM kit_balances b WHERE b.cycle_id = c.id AND (b.qty_sold > 0 OR b.qty_reserved > 0 OR b.qty_return_transit > 0 OR b.qty_returned > 0 OR b.qty_lost > 0)) THEN
      v_bloq := 'Esta maleta já tem peça vendida, reservada ou devolvida. Não dá para desfazer.';
    ELSIF pb.id IS NOT NULL AND (pb.status <> 'aberta' OR pb.title_id IS NOT NULL OR coalesce(pb.adiantado_cents, 0) > 0
          OR EXISTS (SELECT 1 FROM kit_pre_baixa_itens i WHERE i.pre_baixa_id = pb.id AND (i.qtd_vendida > 0 OR i.qtd_app > 0 OR coalesce(i.qtd_lida, 0) > 0))
          OR EXISTS (SELECT 1 FROM asaas_adiantamento_usos u WHERE u.pre_baixa_id = pb.id)
          OR EXISTS (SELECT 1 FROM consultora_acerto_ajustes j WHERE j.pre_baixa_id = pb.id)) THEN
      v_bloq := 'O acerto desta maleta já começou (peça marcada como vendida ou valor lançado). Não dá para desfazer.';
    ELSIF EXISTS (SELECT 1 FROM kit_signature_requests sr WHERE sr.cycle_id = c.id AND sr.estado IN ('assinado','finalizado')) THEN
      v_bloq := 'A consultora já assinou o termo de aceite desta maleta. Não dá para desfazer.';
    ELSIF EXISTS (SELECT 1 FROM kit_movements m WHERE m.cycle_id = c.id AND m.status = 'pendente') THEN
      v_bloq := 'Esta maleta tem acréscimo ou retorno de peças pendente. Resolva antes de desfazer.';
    ELSIF EXISTS (SELECT 1 FROM correios_envios ce WHERE ce.cycle_id = c.id AND ce.status NOT IN ('cancelada','expirada','erro')) THEN
      v_bloq := 'Esta maleta tem envio pelos Correios. Cancele o envio antes de desfazer.';
    ELSIF c.representante_party_id IS NULL THEN
      v_bloq := 'A maleta não tem representante para voltar a ficar com ela.';
    END IF;
  ELSE
    s := public.maleta_transferir_situacao(c.id);
    v_bloq := s->>'bloqueio';
  END IF;
  IF v_bloq IS NULL THEN
    IF v_destino IS NOT NULL AND st IN ('bloqueado','desligado') THEN
      v_bloq := format('%s está bloqueada ou desligada e não pode receber maleta.', n_destino);
    ELSIF v_destino IS NOT NULL AND c.remessa_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM kit_cycles k WHERE k.remessa_id = c.remessa_id AND k.consultora_party_id = v_destino
           AND k.status <> 'cancelada' AND k.id <> c.id) THEN
      v_bloq := format('%s já recebeu outra maleta nesta remessa. Resolva aquela antes de devolver esta.', n_destino);
    ELSIF v_destino IS NULL AND coalesce(v_rem_rep, c.representante_party_id) IS NULL THEN
      v_bloq := 'A remessa não tem representante para ficar com a maleta de abertura.';
    END IF;
  END IF;

  v_passos := v_passos || format('A maleta %s sai de %s e volta para %s.', coalesce(v_maleta, ''), coalesce(n_atual, 'quem está com ela'),
                                 coalesce(n_destino, 'ABERTURA (sem consultora), com o representante'));
  IF v_aceita THEN v_passos := v_passos || 'O aceite feito no app é desfeito (fica guardada uma cópia) e a maleta volta para a mão do representante.'::text; END IF;
  IF c.status = 'recebida' THEN v_passos := v_passos || 'O recebimento confirmado volta para a mão do representante.'::text; END IF;
  IF v_destino IS NOT NULL THEN v_passos := v_passos || 'O representante entrega para ela de novo e ela confirma e aceita no app.'::text; END IF;
  v_passos := v_passos || 'Nada é apagado: o movimento errado e o desfazer ficam no histórico da maleta, com o seu nome e o motivo.'::text;

  IF NOT _aplicar THEN
    RETURN jsonb_build_object('evento_id', e.id, 'cycle_id', c.id, 'maleta', v_maleta, 'de', n_atual,
      'para', coalesce(n_destino, 'ABERTURA'), 'para_party_id', v_destino, 'aceita', v_aceita,
      'pode', v_bloq IS NULL, 'bloqueio', v_bloq, 'passos', to_jsonb(v_passos));
  END IF;
  IF v_bloq IS NOT NULL THEN RAISE EXCEPTION '%', v_bloq; END IF;
  IF length(v_motivo) < 10 THEN RAISE EXCEPTION 'Escreva o motivo de desfazer (mínimo 10 letras).'; END IF;

  -- a. aceite sem nenhuma venda: guarda a cópia e volta a maleta ao estado "recebida"
  IF v_aceita THEN
    v_copia := jsonb_build_object(
      'aceites', (SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('itens',
                    (SELECT jsonb_agg(to_jsonb(ai)) FROM kit_acceptance_items ai WHERE ai.acceptance_id = a.id)))
                    FROM kit_acceptances a WHERE a.cycle_id = c.id),
      'saldos', (SELECT jsonb_agg(to_jsonb(b)) FROM kit_balances b WHERE b.cycle_id = c.id),
      'pre_baixa', CASE WHEN pb.id IS NOT NULL THEN to_jsonb(pb) || jsonb_build_object('itens',
                    (SELECT jsonb_agg(to_jsonb(i)) FROM kit_pre_baixa_itens i WHERE i.pre_baixa_id = pb.id)) END,
      'status', c.status, 'custodia', c.custodian_party_id, 'received_at', c.received_at);
    IF pb.id IS NOT NULL THEN
      DELETE FROM kit_pre_baixa_itens WHERE pre_baixa_id = pb.id;
      DELETE FROM kit_pre_baixas WHERE id = pb.id;
    END IF;
    DELETE FROM kit_acceptances WHERE cycle_id = c.id;
    UPDATE kit_balances SET qty_accepted = 0, qty_divergent = 0, is_published = false, updated_at = now() WHERE cycle_id = c.id;
    UPDATE kit_cycles SET status = 'recebida', updated_by = uid, updated_at = now() WHERE id = c.id;
    INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, reason, payload)
    VALUES (c.id, 'maleta.aceite_desfeito', 'operacao', 'recebida', uid, v_motivo,
            jsonb_build_object('evento_desfeito', e.id, 'consultora', v_atual, 'pre_baixa_vazia_removida', pb.id));
  END IF;

  -- b. o movimento de volta usa o mesmo núcleo oficial da transferência (entregas, termo, promissória, nota)
  r := public.maleta_transferir_exec(c.id, v_destino, NULL, v_destino IS NULL, 'Desfazer movimento: ' || v_motivo, NULL, 'desfazer');

  -- c. carteira: se este movimento levou a consultora errada para outra carteira, ela volta (só se ninguém mexeu depois)
  FOR cart IN SELECT a.entity_id, a.payload FROM audit_logs a
               WHERE a.action = 'consultora.carteira_seguiu_maleta' AND a.payload->>'cycle_id' = c.id::text
                 AND a.created_at = e.created_at LOOP
    UPDATE consultant_profiles cp
       SET representative_party_id = (cart.payload->>'representante_antes')::uuid,
           praca_id = (cart.payload->>'praca_antes')::uuid
     WHERE cp.party_id = cart.entity_id::uuid
       AND cp.representative_party_id IS NOT DISTINCT FROM (cart.payload->>'representante_depois')::uuid
       AND cp.praca_id IS NOT DISTINCT FROM (cart.payload->>'praca_depois')::uuid;
    IF FOUND THEN
      v_cart := coalesce(v_cart, '[]'::jsonb) || jsonb_build_array(cart.payload || jsonb_build_object('party_id', cart.entity_id));
      INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
      VALUES (uid, 'consultora.carteira_desfeita', 'consultant_profiles', cart.entity_id, cart.payload || jsonb_build_object('motivo', v_motivo, 'evento', e.id));
    END IF;
  END LOOP;

  -- d. nota fiscal: se a maleta voltou para quem está na nota, a pendência de troca deixa de existir
  UPDATE maleta_troca_pendencias SET status = 'resolvida', resolvido_por = uid, resolvido_em = now(),
         observacao = concat_ws(' · ', observacao, 'Movimento desfeito: a maleta voltou para quem está na nota.')
   WHERE cycle_id = c.id AND status = 'aberta' AND consultora_nova_party_id IS NOT DISTINCT FROM consultora_anterior_party_id
     AND consultora_anterior_party_id IS NOT NULL;
  GET DIAGNOSTICS v_pend = ROW_COUNT;

  INSERT INTO maleta_movimentos_desfeitos (evento_id, cycle_id, maleta, de_party_id, para_party_id, motivo, desfeito_por,
                                           representante_party_id, aceite_desfeito, copia, resultado)
  VALUES (e.id, c.id, v_maleta, v_atual, v_destino, v_motivo, uid, _rep, v_aceita, v_copia,
          coalesce(r, '{}'::jsonb) || jsonb_build_object('carteira_voltou', v_cart, 'pendencias_fiscais_resolvidas', v_pend));
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, reason, payload)
  VALUES (c.id, 'maleta.movimento_desfeito', uid, v_motivo,
          jsonb_build_object('evento_desfeito', e.id, 'kind_desfeito', e.kind, 'de', v_atual, 'para', v_destino,
                             'representante', _rep, 'aceite_desfeito', v_aceita, 'carteira_voltou', v_cart));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.movimento_desfeito', 'kit_cycles', c.id::text,
          jsonb_build_object('evento', e.id, 'kind', e.kind, 'maleta', v_maleta, 'de', v_atual, 'de_nome', n_atual,
                             'para', v_destino, 'para_nome', n_destino, 'motivo', v_motivo, 'representante', _rep,
                             'aceite_desfeito', v_aceita, 'carteira_voltou', v_cart, 'pendencias_fiscais_resolvidas', v_pend));
  RETURN coalesce(r, '{}'::jsonb) || jsonb_build_object('maleta', v_maleta, 'de', n_atual, 'para', coalesce(n_destino, 'ABERTURA'),
    'aceite_desfeito', v_aceita, 'carteira_voltou', v_cart IS NOT NULL, 'pendencias_fiscais_resolvidas', v_pend);
END $$;
REVOKE ALL ON FUNCTION public.maleta_movimento_desfazer_nucleo(uuid, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maleta_movimento_desfazer_nucleo(uuid, text, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.maleta_movimento_previa(_evento uuid, _rep uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.maleta_movimento_desfazer_nucleo(_evento, NULL, _rep, false)
$$;
CREATE OR REPLACE FUNCTION public.maleta_movimento_desfazer(_evento uuid, _motivo text, _rep uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.maleta_movimento_desfazer_nucleo(_evento, _motivo, _rep, true)
$$;
REVOKE ALL ON FUNCTION public.maleta_movimento_previa(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.maleta_movimento_desfazer(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_movimento_previa(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.maleta_movimento_desfazer(uuid, text, uuid) TO authenticated, service_role;

-- Lista dos movimentos (últimos 120 dias), com quem fez e se já foi desfeito.
CREATE OR REPLACE FUNCTION public.maleta_movimentos_lista(_busca text DEFAULT NULL, _rep uuid DEFAULT NULL, _limite int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); t text := nullif(btrim(coalesce(_busca, '')), '');
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  IF _rep IS NOT NULL THEN
    IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  ELSIF NOT (public.can_manage_kits(uid) OR public.has_role(uid, 'master')) THEN
    RAISE EXCEPTION 'Sem permissão para ver os movimentos de maleta.' USING errcode = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY (x->>'quando') DESC) FROM (
      SELECT jsonb_build_object(
        'evento_id', e.id, 'cycle_id', c.id, 'maleta', k.code, 'remessa', rm.numero, 'kind', e.kind, 'quando', e.created_at,
        'origem', coalesce(e.payload->>'origem', 'representante'),
        'de', CASE WHEN e.kind = 'maleta.repassada' THEN 'ABERTURA' ELSE pa.display_name END, 'de_codigo', pa.code,
        'para', pn.display_name, 'para_codigo', pn.code,
        'quem', coalesce(pf.full_name, pf.display_name, pf.email), 'motivo', e.reason,
        'situacao', c.status, 'com_quem_esta', pc.display_name,
        'aceita', EXISTS (SELECT 1 FROM kit_acceptances a WHERE a.cycle_id = c.id),
        'ultimo', NOT EXISTS (SELECT 1 FROM kit_events z WHERE z.cycle_id = c.id AND z.kind = ANY (public.maleta_movimento_kinds()) AND z.created_at > e.created_at),
        'desfeito_em', d.desfeito_em, 'desfeito_motivo', d.motivo,
        'desfeito_por', (SELECT coalesce(full_name, display_name, email) FROM profiles WHERE id = d.desfeito_por)) x
      FROM kit_events e
      JOIN kit_cycles c ON c.id = e.cycle_id
      JOIN kits k ON k.id = c.kit_id
      LEFT JOIN remessas rm ON rm.id = c.remessa_id
      LEFT JOIN parties pa ON pa.id = (e.payload->>'consultora_anterior')::uuid
      LEFT JOIN parties pn ON pn.id = coalesce((e.payload->>'consultora_nova')::uuid, (e.payload->>'consultora')::uuid)
      LEFT JOIN parties pc ON pc.id = c.consultora_party_id
      LEFT JOIN profiles pf ON pf.id = e.actor_user_id
      LEFT JOIN maleta_movimentos_desfeitos d ON d.evento_id = e.id
      WHERE e.kind = ANY (public.maleta_movimento_kinds())
        AND e.created_at > now() - interval '120 days'
        AND NOT (e.kind = 'maleta.repassada' AND EXISTS (SELECT 1 FROM kit_events y WHERE y.cycle_id = e.cycle_id
                   AND y.created_at = e.created_at AND y.kind = 'maleta.trocada_para_abertura'))
        AND (CASE WHEN _rep IS NOT NULL THEN (c.representante_party_id = _rep OR rm.representante_party_id = _rep)
                  ELSE public.kit_cycle_in_scope(c.id) IS TRUE END)
        AND (t IS NULL OR k.code ILIKE '%' || t || '%' OR rm.numero::text = t
             OR pa.display_name ILIKE '%' || t || '%' OR pn.display_name ILIKE '%' || t || '%'
             OR pa.code = t OR pn.code = t OR pc.display_name ILIKE '%' || t || '%')
      ORDER BY e.created_at DESC
      LIMIT least(greatest(coalesce(_limite, 100), 1), 300)) q), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.maleta_movimentos_lista(text, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_movimentos_lista(text, uuid, int) TO authenticated, service_role;

-- 5. Banho por categoria nas vendas da consultora (SmallData + acertos do Lardan), em % dentro de cada categoria.
-- Banho do cadastro do produto; sem cadastro, pelo nome da peça do SmallData; sem nenhum dos dois = "sem banho informado".
CREATE OR REPLACE FUNCTION public.banho_da_peca(_tipo text, _nome text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT coalesce(nullif(btrim(_tipo), ''),
    CASE WHEN upper(coalesce(_nome,'')) ~ '\m(DOU|DOUR|DOURADO|DOURADA|OURO)\M' THEN 'dourado'
         WHEN upper(coalesce(_nome,'')) ~ 'R[OÓ]DIO' THEN 'rodio_branco'
         WHEN upper(coalesce(_nome,'')) ~ '\m(A[CÇ]O|INOX)\M' THEN 'aco_inox'
         WHEN upper(coalesce(_nome,'')) ~ '925' THEN 'prata_925'
         WHEN upper(coalesce(_nome,'')) ~ '\m(PRATA|PRATEADO|PRATEADA)\M' THEN 'prata_banhada'
    END, 'sem_banho')
$$;
GRANT EXECUTE ON FUNCTION public.banho_da_peca(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_banhos_dados(_party uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cods AS (SELECT coalesce(public.legado_codigos_da_pessoa(_party), '{}'::int[]) c),
  lardan_rem AS (SELECT DISTINCT rm.numero FROM kit_pre_baixas pb JOIN remessas rm ON rm.id = pb.remessa_id
                  WHERE pb.consultora_party_id = _party AND pb.status IN ('fechada','encerrada','pendencia')),
  v AS (
    SELECT upper(coalesce(nullif(btrim(lp.categoria), ''), 'SEM CATEGORIA')) cat,
           public.banho_da_peca(pr.banho_tipo, lp.nome) banho, v.quantidade q
      FROM legado_maleta_vendidos v
      LEFT JOIN legado_produtos lp ON lp.codigo = v.produto
      LEFT JOIN products pr ON pr.id = lp.product_id
     WHERE v.codcli = ANY ((SELECT c FROM cods)::int[]) AND v.quantidade > 0
       AND v.remessa NOT IN (SELECT numero FROM lardan_rem)
    UNION ALL
    SELECT upper(coalesce(nullif(btrim(ct.name), ''), 'SEM CATEGORIA')), public.banho_da_peca(pr.banho_tipo, pr.name), i.qtd_vendida
      FROM kit_pre_baixas pb
      JOIN kit_pre_baixa_itens i ON i.pre_baixa_id = pb.id
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN products pr ON pr.id = pv.product_id
      LEFT JOIN categories ct ON ct.id = pr.category_id
     WHERE pb.consultora_party_id = _party AND pb.status IN ('fechada','encerrada','pendencia') AND i.qtd_vendida > 0),
  g AS (SELECT cat, banho, sum(q)::int q FROM v GROUP BY 1, 2),
  t AS (SELECT cat, sum(q)::int total FROM g GROUP BY 1)
  SELECT jsonb_build_object(
    'total', coalesce((SELECT sum(total) FROM t), 0),
    'categorias', coalesce((SELECT jsonb_agg(jsonb_build_object('categoria', t.cat, 'total', t.total,
        'banhos', (SELECT jsonb_agg(jsonb_build_object('banho', g.banho, 'qtd', g.q, 'pct', round(100.0 * g.q / t.total))
                                    ORDER BY (g.banho = 'sem_banho'), g.q DESC) FROM g WHERE g.cat = t.cat))
        ORDER BY t.total DESC) FROM t), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.consultora_banhos_dados(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_banhos_dados(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consultora_banhos_categoria(_party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  IF _party IS DISTINCT FROM public.my_party_id() THEN
    IF NOT (((public.is_staff(uid) OR public.colab_restrita())
              AND (public.legado_pode_ver(uid) OR public.can_view_kits(uid) OR public.has_capability(uid, 'registry.view')))
            OR (public.has_role(uid, 'representante') AND EXISTS (SELECT 1 FROM consultant_profiles cp
                  WHERE cp.party_id = _party AND cp.representative_party_id = public.my_party_id()))) THEN
      RAISE EXCEPTION 'Sem permissão para ver as vendas desta consultora.' USING errcode = '42501';
    END IF;
    IF public.colab_restrita() AND NOT (public.has_capability(uid, 'kit.manage') OR public.colab_party_ok(_party)) THEN
      RAISE EXCEPTION 'Cadastro fora da carteira.' USING errcode = '42501';
    END IF;
  END IF;
  RETURN public.consultora_banhos_dados(_party);
END $$;
REVOKE ALL ON FUNCTION public.consultora_banhos_categoria(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_banhos_categoria(uuid) TO authenticated, service_role;