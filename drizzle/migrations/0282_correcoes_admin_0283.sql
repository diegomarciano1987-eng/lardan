-- 0283 (Diego/Daniel, 11/11/2026): correções do administrador.
-- (1) desfazer devolução feita por engano; (2) segunda maleta na mesma remessa com motivo;
-- (3) vincular histórico de vendas de um cadastro a outro (ex.: nome do marido); (4) excluir venda de teste
-- e cancelar remessa vazia. Nada emite nota fiscal sozinho.

ALTER TABLE public.kit_cycles ADD COLUMN IF NOT EXISTS segunda_maleta_motivo text;
DROP INDEX IF EXISTS public.kit_cycles_remessa_consultora_uq;
CREATE UNIQUE INDEX kit_cycles_remessa_consultora_uq ON public.kit_cycles (remessa_id, consultora_party_id)
  WHERE remessa_id IS NOT NULL AND consultora_party_id IS NOT NULL AND status <> 'cancelada' AND segunda_maleta_motivo IS NULL;

DO $$ DECLARE d text; n text; BEGIN
  d := pg_get_functiondef('public.maleta_transferir_exec(uuid,uuid,uuid,boolean,text,uuid,text)'::regprocedure);
  n := replace(d, 'AND k.status <> ''cancelada'' AND k.id <> c.id) THEN',
                  'AND k.status <> ''cancelada'' AND k.id <> c.id AND k.segunda_maleta_motivo IS NULL) AND c.segunda_maleta_motivo IS NULL THEN');
  IF n = d THEN
    IF position('k.segunda_maleta_motivo IS NULL' in d) = 0 THEN RAISE EXCEPTION 'ponto da segunda maleta não encontrado'; END IF;
  ELSE EXECUTE n; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.maleta_segunda_marcar(_cycle uuid, _motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo da segunda maleta (mínimo 5 letras).'; END IF;
  UPDATE kit_cycles SET segunda_maleta_motivo = left(btrim(_motivo), 500), updated_at = now() WHERE id = _cycle;
END $$;
REVOKE ALL ON FUNCTION public.maleta_segunda_marcar(uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rep_maleta_segunda(_rep uuid, _cycle uuid, _consultora uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF _consultora IS NULL THEN RAISE EXCEPTION 'A segunda maleta é para uma consultora que já tem maleta.'; END IF;
  PERFORM public.maleta_segunda_marcar(_cycle, _motivo);
  r := public.rep_maleta_trocar_destino(_rep, _cycle, _consultora, NULL);
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, reason, payload)
  VALUES (_cycle, 'maleta.segunda', auth.uid(), btrim(_motivo), jsonb_build_object('consultora', _consultora, 'representante', _rep, 'origem', 'representante'));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'maleta.segunda', 'kit_cycles', _cycle::text, jsonb_build_object('consultora', _consultora, 'representante', _rep, 'motivo', btrim(_motivo)));
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.rep_maleta_segunda(uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_maleta_segunda(uuid,uuid,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remessa_maleta_segunda(_cycle uuid, _consultora uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  IF _consultora IS NULL THEN RAISE EXCEPTION 'A segunda maleta é para uma consultora que já tem maleta.'; END IF;
  PERFORM public.maleta_segunda_marcar(_cycle, _motivo);
  r := public.remessa_maleta_transferir(_cycle, _consultora, _motivo);
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, reason, payload)
  VALUES (_cycle, 'maleta.segunda', auth.uid(), btrim(_motivo), jsonb_build_object('consultora', _consultora, 'origem', 'equipe'));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'maleta.segunda', 'kit_cycles', _cycle::text, jsonb_build_object('consultora', _consultora, 'motivo', btrim(_motivo)));
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.remessa_maleta_segunda(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_maleta_segunda(uuid,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.maleta_devolucao_desfazer(_cycle uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); c kit_cycles; d maleta_devolucoes; ev kit_events; m record; total int := 0;
  anterior text; anterior_ub text; v_maleta_loc uuid; v_status kit_status;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN RAISE EXCEPTION 'Só o Master desfaz uma devolução.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.status <> 'cancelada' THEN RAISE EXCEPTION 'Esta maleta não está devolvida.'; END IF;
  SELECT * INTO d FROM maleta_devolucoes WHERE cycle_id = c.id AND status = 'recebida' ORDER BY recebido_em DESC LIMIT 1 FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Esta maleta não foi cancelada por devolução à empresa.'; END IF;
  IF d.recebido_em < now() - interval '15 days' THEN RAISE EXCEPTION 'A devolução tem mais de 15 dias: monte uma maleta nova.'; END IF;
  IF EXISTS (SELECT 1 FROM kit_cycles k WHERE k.kit_id = c.kit_id AND k.id <> c.id AND k.status <> 'cancelada' AND k.created_at > c.created_at) THEN
    RAISE EXCEPTION 'A caixa desta maleta já foi usada em outra montagem.';
  END IF;
  SELECT * INTO ev FROM kit_events WHERE cycle_id = c.id AND kind = 'devolucao.recebida' ORDER BY created_at DESC LIMIT 1;
  v_status := coalesce(ev.from_status, 'transito');
  SELECT from_location_id INTO v_maleta_loc FROM stock_movements WHERE idempotency_key LIKE 'devolucao:' || d.id || ':%' LIMIT 1;

  anterior := coalesce(current_setting('lardan.kit_stock', true), 'off');
  anterior_ub := coalesce(current_setting('lardan.stock_unblock', true), 'off');
  FOR m IN SELECT variant_id, quantity, from_location_id, to_location_id FROM stock_movements
            WHERE idempotency_key LIKE 'devolucao:' || d.id || ':%' ORDER BY variant_id LOOP
    -- inverso exato da entrada: o depósito ainda não contado pode estar negativo, por isso o desbloqueio só aqui
    PERFORM set_config('lardan.kit_stock', 'on', true);
    PERFORM set_config('lardan.stock_unblock', 'on', true);
    PERFORM public.register_stock_movement('transferencia', m.variant_id, m.quantity, m.to_location_id, m.from_location_id,
      'transferencia', NULL, 'maleta:' || c.id, 'Devolução desfeita: ' || btrim(_motivo), 'devolucao_desfeita:' || d.id || ':' || m.variant_id, NULL);
    PERFORM set_config('lardan.stock_unblock', anterior_ub, true);
    PERFORM set_config('lardan.kit_stock', anterior, true);
    -- kit_balances não muda: a devolução é sempre antes do aceite (nada foi somado em devolvido)
    total := total + m.quantity;
  END LOOP;

  UPDATE kit_cycles SET status = v_status, cancelled_at = NULL, cancel_reason = NULL,
         current_location_id = coalesce(v_maleta_loc, c.current_location_id), updated_by = uid WHERE id = c.id;
  UPDATE maleta_devolucoes SET status = 'cancelada', cancelado_por = uid, cancelado_em = now(),
         cancelado_motivo = 'Devolução desfeita pelo Master: ' || btrim(_motivo) WHERE id = d.id;
  UPDATE maleta_troca_pendencias SET motivo = concat_ws(' · ', motivo, 'Devolução desfeita: ' || btrim(_motivo))
   WHERE cycle_id = c.id AND status = 'aberta';
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
  VALUES (c.id, 'devolucao.desfeita', 'cancelada', v_status, uid, jsonb_build_object('devolucao', d.id, 'pecas', total), btrim(_motivo));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.devolucao_desfeita', 'kit_cycles', c.id::text, jsonb_build_object('devolucao', d.id, 'pecas', total, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('cycle_id', c.id, 'pecas', total, 'status', v_status);
END $$;
REVOKE ALL ON FUNCTION public.maleta_devolucao_desfazer(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_devolucao_desfazer(uuid,text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.consultora_historico_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destino_party_id uuid NOT NULL REFERENCES public.parties(id),
  origem_party_id uuid NOT NULL REFERENCES public.parties(id),
  motivo text NOT NULL,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_por uuid,
  desfeito_em timestamptz,
  CHECK (destino_party_id <> origem_party_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS consultora_historico_vinculos_origem_uq ON public.consultora_historico_vinculos (origem_party_id) WHERE desfeito_em IS NULL;
GRANT SELECT ON public.consultora_historico_vinculos TO authenticated;
GRANT ALL ON public.consultora_historico_vinculos TO service_role;
ALTER TABLE public.consultora_historico_vinculos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Cadastro vê vínculos de histórico" ON public.consultora_historico_vinculos;
CREATE POLICY "Cadastro vê vínculos de histórico" ON public.consultora_historico_vinculos FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'registry.view')));

CREATE OR REPLACE FUNCTION public.consultora_historico_partes(_party uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT array_agg(DISTINCT x) FROM (
    SELECT _party x
    UNION SELECT origem_party_id FROM consultora_historico_vinculos WHERE destino_party_id = _party AND desfeito_em IS NULL
  ) s
$$;

CREATE OR REPLACE FUNCTION public.legado_codigos_da_pessoa(_party uuid)
RETURNS integer[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(DISTINCT c), '{}') FROM (
    SELECT codcli c FROM legado_consultoras WHERE party_id = ANY (public.consultora_historico_partes(_party))
    UNION SELECT codigo::int FROM party_codigos_legados WHERE party_id = ANY (public.consultora_historico_partes(_party))
       AND sistema = 'cliente' AND codigo ~ '^[0-9]{1,9}$'
  ) s
$$;

DO $$ DECLARE d text; n text; BEGIN
  d := pg_get_functiondef('public.consultora_acertos_vendas(uuid)'::regprocedure);
  n := replace(d, 'WHERE p.consultora_party_id = _party AND', 'WHERE p.consultora_party_id = ANY (public.consultora_historico_partes(_party)) AND');
  IF n = d THEN
    IF position('consultora_historico_partes' in d) = 0 THEN RAISE EXCEPTION 'ponto de consultora_acertos_vendas não encontrado'; END IF;
  ELSE EXECUTE n; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.consultora_historico_vincular(_destino uuid, _origem uuid, _motivo text, _executar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); dst parties; org parties; v uuid; cods int[]; n_lardan int; n_antigo int;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN RAISE EXCEPTION 'Só o Master vincula históricos.' USING errcode = '42501'; END IF;
  IF _destino = _origem THEN RAISE EXCEPTION 'Escolha dois cadastros diferentes.'; END IF;
  SELECT * INTO dst FROM parties WHERE id = _destino; SELECT * INTO org FROM parties WHERE id = _origem;
  IF dst.id IS NULL OR org.id IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;
  IF EXISTS (SELECT 1 FROM consultora_historico_vinculos WHERE origem_party_id = _destino AND desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'O cadastro de destino já está ligado a outro. Use o cadastro principal.';
  END IF;
  IF EXISTS (SELECT 1 FROM consultora_historico_vinculos WHERE destino_party_id = _origem AND desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'O cadastro de origem já recebe histórico de outro. Desfaça antes.';
  END IF;
  SELECT coalesce(array_agg(DISTINCT codcli), '{}') INTO cods FROM legado_consultoras WHERE party_id = _origem;
  SELECT count(*) INTO n_lardan FROM kit_pre_baixas WHERE consultora_party_id = _origem AND fechada_em IS NOT NULL;
  SELECT count(*) INTO n_antigo FROM legado_acertos_consultora WHERE codcli = ANY (cods);
  IF NOT _executar THEN
    RETURN jsonb_build_object('previa', true, 'destino', dst.display_name, 'destino_codigo', dst.code, 'origem', org.display_name,
      'origem_codigo', org.code, 'codigos_antigos', cods, 'acertos_antigos', n_antigo, 'acertos_lardan', n_lardan);
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  INSERT INTO consultora_historico_vinculos (destino_party_id, origem_party_id, motivo, criado_por)
  VALUES (_destino, _origem, btrim(_motivo), uid) RETURNING id INTO v;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'consultora.historico_vinculado', 'parties', _destino::text,
          jsonb_build_object('vinculo', v, 'origem', _origem, 'origem_nome', org.display_name, 'codigos', cods, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('id', v, 'acertos_antigos', n_antigo, 'acertos_lardan', n_lardan);
END $$;
REVOKE ALL ON FUNCTION public.consultora_historico_vincular(uuid,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_historico_vincular(uuid,uuid,text,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_historico_desvincular(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); v consultora_historico_vinculos;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN RAISE EXCEPTION 'Só o Master desfaz.' USING errcode = '42501'; END IF;
  UPDATE consultora_historico_vinculos SET desfeito_em = now(), desfeito_por = uid WHERE id = _id AND desfeito_em IS NULL RETURNING * INTO v;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vínculo não encontrado.'; END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'consultora.historico_desvinculado', 'parties', v.destino_party_id::text, jsonb_build_object('vinculo', v.id, 'origem', v.origem_party_id));
END $$;
REVOKE ALL ON FUNCTION public.consultora_historico_desvincular(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_historico_desvincular(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_historico_vinculos_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'destino', d.display_name, 'destino_codigo', d.code,
      'origem', o.display_name, 'origem_codigo', o.code, 'motivo', v.motivo, 'criado_em', v.criado_em) ORDER BY v.criado_em DESC)
    FROM consultora_historico_vinculos v JOIN parties d ON d.id = v.destino_party_id JOIN parties o ON o.id = v.origem_party_id
   WHERE v.desfeito_em IS NULL), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.consultora_historico_vinculos_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_historico_vinculos_lista() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.venda_teste_buscar(_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'codigo', o.code, 'cliente', o.customer_name, 'consultora', p.display_name,
      'status', o.status, 'pagamento', o.payment_status, 'total_cents', o.subtotal_cents, 'itens', o.items_count, 'criado_em', o.created_at,
      'canal', o.channel) ORDER BY o.created_at DESC)
    FROM (SELECT * FROM sales_orders s
           WHERE btrim(coalesce(_codigo, '')) <> '' AND (s.code ILIKE '%' || btrim(_codigo) || '%' OR s.customer_name ILIKE '%' || btrim(_codigo) || '%')
           ORDER BY s.created_at DESC LIMIT 30) o
    LEFT JOIN parties p ON p.id = o.consultora_party_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.venda_teste_buscar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venda_teste_buscar(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.venda_teste_excluir(_order uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); o sales_orders;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN RAISE EXCEPTION 'Só o Master exclui venda de teste.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id = _order FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF o.status = 'cancelado' THEN RETURN jsonb_build_object('id', o.id, 'repetida', true); END IF;
  IF o.payment_status = 'pago' AND o.pay_installment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta venda foi paga para a Lardan (Pix/cartão). Estorne o pagamento antes.';
  END IF;
  IF EXISTS (SELECT 1 FROM kit_pre_baixas pb JOIN kit_balances b ON b.cycle_id = pb.cycle_id
              JOIN sales_order_items i ON i.order_id = o.id AND i.variant_id = b.variant_id
             WHERE pb.consultora_party_id = o.consultora_party_id AND pb.fechada_em > o.created_at) THEN
    RAISE EXCEPTION 'O acerto da maleta desta venda já foi fechado. Corrija pelo acerto.';
  END IF;
  UPDATE sales_orders SET status = 'cancelado', cancelled_at = now(), updated_at = now(),
         cancel_reason = 'Venda de teste excluída pelo Master: ' || btrim(_motivo) WHERE id = o.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'venda.teste_excluida', 'sales_orders', o.id::text, jsonb_build_object('codigo', o.code, 'status_antes', o.status,
          'pagamento', o.payment_status, 'total_cents', o.subtotal_cents, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('id', o.id, 'codigo', o.code);
END $$;
REVOKE ALL ON FUNCTION public.venda_teste_excluir(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venda_teste_excluir(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remessa_cancelar_vazia(_remessa uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); r remessas;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN RAISE EXCEPTION 'Só o Master cancela remessa.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.status = 'cancelada' THEN RETURN jsonb_build_object('id', r.id, 'repetida', true); END IF;
  IF EXISTS (SELECT 1 FROM kit_cycles WHERE remessa_id = r.id AND status <> 'cancelada') THEN
    RAISE EXCEPTION 'A remessa % ainda tem maletas. Cancele ou mude as maletas de remessa antes.', r.numero;
  END IF;
  IF EXISTS (SELECT 1 FROM kit_pre_baixas WHERE remessa_id = r.id) THEN RAISE EXCEPTION 'A remessa tem acertos registrados.'; END IF;
  UPDATE remessas SET status = 'cancelada' WHERE id = r.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'remessa.cancelada_vazia', 'remessas', r.id::text, jsonb_build_object('numero', r.numero, 'status_antes', r.status, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('id', r.id, 'numero', r.numero);
END $$;
REVOKE ALL ON FUNCTION public.remessa_cancelar_vazia(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_cancelar_vazia(uuid,text) TO authenticated, service_role;