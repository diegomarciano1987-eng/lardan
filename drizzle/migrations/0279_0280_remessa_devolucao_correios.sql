-- 0280 (Diego, 11/11/2026): (1) trocar a remessa/representante de uma maleta já pronta, sem mexer
-- na consultora nem nas peças; (2) devolver à empresa a maleta que a consultora não ficou (antes do
-- aceite) — o representante ou a equipe pede, a montagem confirma a chegada e as peças voltam ao
-- estoque; (3) Correios também para a maleta que já está com o representante (em trânsito);
-- (4) entrega pelos Correios: 30 dias da entrega só quando a maleta NÃO tem representante; com
-- representante vale a data de acerto da remessa.

CREATE OR REPLACE FUNCTION public.remessa_maleta_mudar_remessa(_cycle uuid, _remessa uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles; r_old remessas; r_new remessas; novo_num int; nova_custodia uuid; novo_due timestamptz;
BEGIN
  IF uid IS NULL OR NOT (public.can_manage_kits(uid) OR public.has_role(uid, 'master')) THEN
    RAISE EXCEPTION 'Sem permissão para mudar a remessa da maleta.' USING errcode = '42501';
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501'; END IF;
  IF c.remessa_id = _remessa THEN RAISE EXCEPTION 'A maleta já está nesta remessa.'; END IF;
  IF c.status::text NOT IN ('rascunho','montagem','conferida','expedida','transito','recebida') THEN
    RAISE EXCEPTION 'Só dá para mudar a remessa antes do aceite da consultora (situação atual: %).', c.status;
  END IF;
  IF EXISTS (SELECT 1 FROM kit_acceptances WHERE cycle_id = _cycle) THEN RAISE EXCEPTION 'A consultora já aceitou esta maleta.'; END IF;
  IF EXISTS (SELECT 1 FROM kit_transfers WHERE cycle_id = _cycle AND status IN ('pendente','transito')
              AND to_party_id IS DISTINCT FROM c.custodian_party_id AND to_party_id = c.consultora_party_id) THEN
    RAISE EXCEPTION 'Há uma entrega em mãos para a consultora em andamento. Cancele a entrega antes de mudar a remessa.';
  END IF;
  SELECT * INTO r_new FROM remessas WHERE id = _remessa FOR UPDATE;
  IF r_new.id IS NULL THEN RAISE EXCEPTION 'Remessa de destino não encontrada.'; END IF;
  IF r_new.status IN ('fechada','cancelada') THEN RAISE EXCEPTION 'A remessa % está finalizada ou cancelada.', r_new.numero; END IF;
  SELECT * INTO r_old FROM remessas WHERE id = c.remessa_id;
  IF c.consultora_party_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM kit_cycles x WHERE x.remessa_id = _remessa AND x.consultora_party_id = c.consultora_party_id
         AND x.status <> 'cancelada' AND x.id <> _cycle) THEN
    RAISE EXCEPTION 'Esta consultora já tem uma maleta na remessa %.', r_new.numero;
  END IF;
  IF c.status::text = 'transito' AND c.custodian_party_id IS NOT NULL
     AND c.custodian_party_id IS NOT DISTINCT FROM coalesce(c.representante_party_id, r_old.representante_party_id) THEN
    IF r_new.representante_party_id IS NULL THEN
      RAISE EXCEPTION 'A maleta está com o representante; a remessa de destino precisa ter representante.';
    END IF;
    nova_custodia := r_new.representante_party_id;
  ELSE
    nova_custodia := c.custodian_party_id;
  END IF;
  IF c.consultora_party_id IS NULL AND r_new.representante_party_id IS NOT NULL THEN
    SELECT coalesce(max(abertura_numero), 0) + 1 INTO novo_num FROM kit_cycles
     WHERE remessa_id = _remessa AND consultora_party_id IS NULL AND status <> 'cancelada';
  ELSE
    novo_num := c.abertura_numero;
  END IF;
  novo_due := CASE WHEN c.received_at IS NULL THEN NULL ELSE c.due_at END;
  UPDATE kit_cycles SET remessa_id = _remessa, representante_party_id = r_new.representante_party_id,
         custodian_party_id = nova_custodia, abertura_numero = novo_num, due_at = novo_due, updated_by = uid
   WHERE id = _cycle;
  IF nova_custodia IS DISTINCT FROM c.custodian_party_id THEN
    UPDATE kit_transfers SET to_party_id = nova_custodia, updated_by = uid,
           note = coalesce(note, '') || ' | Remessa trocada para ' || r_new.numero
     WHERE cycle_id = _cycle AND status IN ('pendente','transito') AND to_party_id = c.custodian_party_id;
  END IF;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
  VALUES (_cycle, 'remessa.trocada', c.status, c.status, uid,
          jsonb_build_object('de_remessa', r_old.numero, 'para_remessa', r_new.numero,
                             'de_representante', c.representante_party_id, 'para_representante', r_new.representante_party_id,
                             'custodia_de', c.custodian_party_id, 'custodia_para', nova_custodia), btrim(_motivo));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.remessa_trocada', 'kit_cycles', _cycle::text,
          jsonb_build_object('de', c.remessa_id, 'para', _remessa, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('remessa', r_new.numero, 'representante_party_id', r_new.representante_party_id,
                            'custodia_mudou', nova_custodia IS DISTINCT FROM c.custodian_party_id, 'abertura_numero', novo_num);
END $function$;
REVOKE ALL ON FUNCTION public.remessa_maleta_mudar_remessa(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_maleta_mudar_remessa(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remessas_destino_lista(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles;
BEGIN
  IF uid IS NULL OR NOT (public.can_manage_kits(uid) OR public.has_role(uid, 'master')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'numero', r.numero, 'praca', p.nome,
            'representante', rp.display_name, 'data_acerto', r.data_acerto, 'status', r.status) ORDER BY r.numero DESC)
    FROM remessas r LEFT JOIN cob_pracas p ON p.id = r.praca_id LEFT JOIN parties rp ON rp.id = r.representante_party_id
    WHERE r.status NOT IN ('fechada','cancelada') AND r.id IS DISTINCT FROM c.remessa_id), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.remessas_destino_lista(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessas_destino_lista(uuid) TO authenticated, service_role;

CREATE TABLE public.maleta_devolucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id),
  status text NOT NULL DEFAULT 'pedida' CHECK (status IN ('pedida','recebida','cancelada')),
  motivo text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('representante','equipe')),
  representante_party_id uuid,
  pedido_por uuid,
  pedido_em timestamptz NOT NULL DEFAULT now(),
  recebido_por uuid,
  recebido_em timestamptz,
  pecas integer,
  cancelado_por uuid,
  cancelado_em timestamptz,
  cancelado_motivo text
);
CREATE UNIQUE INDEX maleta_devolucoes_uma_aberta ON public.maleta_devolucoes (cycle_id) WHERE status = 'pedida';
GRANT SELECT ON public.maleta_devolucoes TO authenticated;
GRANT ALL ON public.maleta_devolucoes TO service_role;
ALTER TABLE public.maleta_devolucoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY maleta_devolucoes_ler ON public.maleta_devolucoes FOR SELECT TO authenticated
  USING ((SELECT public.can_manage_kits(auth.uid())) OR (representante_party_id IS NOT NULL AND public.rep_portal_pode(representante_party_id)));

CREATE OR REPLACE FUNCTION public.maleta_devolucao_checar(_c kit_cycles)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF _c.status::text NOT IN ('expedida','transito','recebida') THEN
    RAISE EXCEPTION 'Só volta para a empresa por aqui a maleta que saiu e ainda não teve aceite (situação: %). Depois do aceite, use o acerto.', _c.status;
  END IF;
  IF EXISTS (SELECT 1 FROM kit_acceptances WHERE cycle_id = _c.id) THEN RAISE EXCEPTION 'A consultora já aceitou esta maleta: faça o acerto.'; END IF;
  IF EXISTS (SELECT 1 FROM kit_balances WHERE cycle_id = _c.id AND (qty_sold > 0 OR qty_reserved > 0 OR qty_return_transit > 0)) THEN
    RAISE EXCEPTION 'Há peça vendida, reservada ou em retorno nesta maleta.';
  END IF;
  IF EXISTS (SELECT 1 FROM kit_pre_baixas WHERE cycle_id = _c.id) THEN RAISE EXCEPTION 'Esta maleta já tem acerto começado.'; END IF;
  IF EXISTS (SELECT 1 FROM correios_envios WHERE cycle_id = _c.id AND direcao = 'ida' AND status IN ('criando','pre_postada','postada','em_transito')) THEN
    RAISE EXCEPTION 'A maleta tem envio pelos Correios em andamento: cancele o envio antes.';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.maleta_devolucao_checar(kit_cycles) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.maleta_devolucao_pedir(_cycle uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles; equipe boolean; rep uuid; nid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  rep := coalesce(c.representante_party_id, (SELECT representante_party_id FROM remessas WHERE id = c.remessa_id));
  equipe := (public.can_manage_kits(uid) OR public.has_role(uid, 'master')) AND public.kit_cycle_in_scope(_cycle);
  IF NOT equipe AND NOT ((rep IS NOT NULL AND public.rep_portal_pode(rep))
                         OR (c.custodian_party_id IS NOT NULL AND public.rep_portal_pode(c.custodian_party_id))) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  PERFORM public.maleta_devolucao_checar(c);
  IF EXISTS (SELECT 1 FROM maleta_devolucoes WHERE cycle_id = _cycle AND status = 'pedida') THEN
    RAISE EXCEPTION 'A devolução desta maleta já foi pedida.';
  END IF;
  INSERT INTO maleta_devolucoes (cycle_id, motivo, origem, representante_party_id, pedido_por)
  VALUES (_cycle, btrim(_motivo), CASE WHEN equipe THEN 'equipe' ELSE 'representante' END, rep, uid) RETURNING id INTO nid;
  UPDATE kit_transfers SET status = 'cancelada', updated_by = uid, note = coalesce(note, '') || ' | Devolução à empresa: ' || btrim(_motivo)
   WHERE cycle_id = _cycle AND status IN ('pendente','transito') AND to_party_id = c.consultora_party_id;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
  VALUES (_cycle, 'devolucao.pedida', c.status, c.status, uid, jsonb_build_object('devolucao', nid), btrim(_motivo));
  RETURN jsonb_build_object('id', nid, 'status', 'pedida');
END $function$;
REVOKE ALL ON FUNCTION public.maleta_devolucao_pedir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_devolucao_pedir(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.maleta_devolucao_cancelar(_id uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); d maleta_devolucoes;
BEGIN
  SELECT * INTO d FROM maleta_devolucoes WHERE id = _id FOR UPDATE;
  IF d.id IS NULL OR d.status <> 'pedida' THEN RAISE EXCEPTION 'Devolução não está aberta.'; END IF;
  IF NOT (public.can_manage_kits(uid) OR public.has_role(uid, 'master') OR (d.representante_party_id IS NOT NULL AND public.rep_portal_pode(d.representante_party_id))) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  UPDATE maleta_devolucoes SET status = 'cancelada', cancelado_por = uid, cancelado_em = now(), cancelado_motivo = nullif(btrim(coalesce(_motivo,'')), '') WHERE id = _id;
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload, reason)
  VALUES (d.cycle_id, 'devolucao.cancelada', uid, jsonb_build_object('devolucao', _id), _motivo);
  RETURN jsonb_build_object('id', _id, 'status', 'cancelada');
END $function$;
REVOKE ALL ON FUNCTION public.maleta_devolucao_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_devolucao_cancelar(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.maleta_devolucao_receber(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); d maleta_devolucoes; c kit_cycles; b record; total int := 0; anterior text;
  nota record; v_maleta text; nome text; promessas int := 0;
BEGIN
  IF uid IS NULL OR NOT public.can_manage_kits(uid) THEN
    RAISE EXCEPTION 'Só a montagem confirma a chegada da maleta.' USING errcode = '42501';
  END IF;
  SELECT * INTO d FROM maleta_devolucoes WHERE id = _id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Devolução não encontrada.'; END IF;
  IF d.status = 'recebida' THEN RETURN jsonb_build_object('id', _id, 'repetida', true, 'pecas', d.pecas); END IF;
  IF d.status <> 'pedida' THEN RAISE EXCEPTION 'Devolução cancelada.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = d.cycle_id FOR UPDATE;
  IF public.kit_cycle_in_scope(c.id) IS NOT TRUE THEN RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501'; END IF;
  PERFORM public.maleta_devolucao_checar(c);
  IF c.current_location_id IS NULL OR c.origin_location_id IS NULL THEN RAISE EXCEPTION 'Maleta sem local de estoque.'; END IF;
  IF c.current_location_id <> c.origin_location_id AND NOT EXISTS (SELECT 1 FROM locations WHERE id = c.current_location_id AND kind = 'maleta') THEN
    RAISE EXCEPTION 'O local físico desta maleta não é uma maleta.';
  END IF;
  SELECT k.code INTO v_maleta FROM kits k WHERE k.id = c.kit_id;
  anterior := coalesce(current_setting('lardan.kit_stock', true), 'off');
  IF c.current_location_id <> c.origin_location_id THEN
    PERFORM 1 FROM stock_balances WHERE location_id = c.current_location_id ORDER BY variant_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM stock_balances WHERE location_id = c.current_location_id AND (quantity < 0 OR reserved > 0)) THEN
      RAISE EXCEPTION 'Saldo da maleta inválido ou reservado.';
    END IF;
    FOR b IN SELECT * FROM stock_balances WHERE location_id = c.current_location_id AND quantity > 0 ORDER BY variant_id LOOP
      PERFORM set_config('lardan.kit_stock', 'on', true);
      PERFORM public.register_stock_movement('transferencia', b.variant_id, b.quantity, c.current_location_id, c.origin_location_id,
        'transferencia', NULL, 'maleta:' || c.id, 'Maleta devolvida à empresa sem aceite', 'devolucao:' || _id || ':' || b.variant_id, NULL);
      PERFORM set_config('lardan.kit_stock', anterior, true);
      total := total + b.quantity;
    END LOOP;
  END IF;
  UPDATE kit_balances SET qty_returned = qty_returned + greatest(coalesce(qty_available, 0), 0), is_published = false, updated_at = now()
   WHERE cycle_id = c.id;
  UPDATE kit_transfers SET status = 'cancelada', updated_by = uid, note = coalesce(note, '') || ' | Maleta devolvida à empresa'
   WHERE cycle_id = c.id AND status IN ('pendente','transito');
  UPDATE assinaturas_digitais
     SET status = CASE WHEN status = 'pendente' THEN 'cancelado' ELSE status END,
         zapsign_cancelar_em = CASE WHEN status = 'pendente' AND doc_token IS NOT NULL THEN now() END,
         invalidada_em = now(), invalidada_motivo = 'Maleta ' || coalesce(v_maleta, '') || ' devolvida à empresa. ' || d.motivo
   WHERE cycle_id = c.id AND tipo = 'promissoria' AND status IN ('pendente','assinado') AND invalidada_em IS NULL;
  GET DIAGNOSTICS promessas = ROW_COUNT;
  UPDATE kit_cycles SET status = 'cancelada', cancelled_at = now(), current_location_id = c.origin_location_id,
         cancel_reason = 'Devolvida à empresa sem aceite: ' || d.motivo, updated_by = uid WHERE id = c.id;
  SELECT numero, chave_nfe INTO nota FROM fiscal_focus_envios
   WHERE cycle_id = c.id AND operacao = 'remessa' AND status = 'autorizado' ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    SELECT display_name INTO nome FROM parties WHERE id = c.consultora_party_id;
    INSERT INTO maleta_troca_pendencias (cycle_id, remessa_id, maleta, consultora_anterior_party_id, consultora_anterior_nome,
           nota_numero, nota_chave, status, criado_por, origem, motivo)
    VALUES (c.id, c.remessa_id, v_maleta, c.consultora_party_id, nome, nota.numero::text, nota.chave_nfe, 'aberta', uid, 'devolucao',
            'Maleta devolvida à empresa: fazer a nota de devolução. ' || d.motivo);
  END IF;
  UPDATE maleta_devolucoes SET status = 'recebida', recebido_por = uid, recebido_em = now(), pecas = total WHERE id = _id;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
  VALUES (c.id, 'devolucao.recebida', c.status, 'cancelada', uid,
          jsonb_build_object('devolucao', _id, 'pecas', total, 'promissorias_invalidadas', promessas, 'pendencia_fiscal', nota.numero IS NOT NULL), d.motivo);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.devolvida_empresa', 'kit_cycles', c.id::text, jsonb_build_object('devolucao', _id, 'pecas', total));
  RETURN jsonb_build_object('id', _id, 'pecas', total, 'pendencia_fiscal', nota.numero IS NOT NULL, 'promissorias_invalidadas', promessas);
END $function$;
REVOKE ALL ON FUNCTION public.maleta_devolucao_receber(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_devolucao_receber(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.maleta_devolucoes_lista(_rep uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF _rep IS NULL THEN
    IF NOT public.can_manage_kits(uid) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  ELSIF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'cycle_id', d.cycle_id, 'maleta', k.code, 'remessa', r.numero,
      'consultora', p.display_name, 'representante', rp.display_name, 'motivo', d.motivo, 'origem', d.origem,
      'pedido_em', d.pedido_em, 'pecas', (SELECT coalesce(sum(qty_allocated), 0) FROM kit_balances WHERE cycle_id = d.cycle_id)) ORDER BY d.pedido_em)
    FROM maleta_devolucoes d JOIN kit_cycles c ON c.id = d.cycle_id JOIN kits k ON k.id = c.kit_id
    LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN parties p ON p.id = c.consultora_party_id
    LEFT JOIN parties rp ON rp.id = d.representante_party_id
    WHERE d.status = 'pedida' AND (_rep IS NULL OR d.representante_party_id = _rep)), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.maleta_devolucoes_lista(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_devolucoes_lista(uuid) TO authenticated, service_role;

DO $$
DECLARE d text; novo text;
BEGIN
  d := pg_get_functiondef('public.correios_maleta_dados(uuid, text)'::regprocedure);
  novo := replace(d, $a$if kc.status::text not in ('conferida','expedida') then$a$, $a$if kc.status::text not in ('conferida','expedida','transito') then$a$);
  IF novo = d AND position($a$'expedida','transito'$a$ in d) = 0 THEN RAISE EXCEPTION '0280: trecho da situação não encontrado em correios_maleta_dados'; END IF;
  IF novo <> d THEN EXECUTE novo; END IF;

  d := pg_get_functiondef('public.correios_envio_rastro(uuid, jsonb)'::regprocedure);
  novo := replace(d, $a$if e.direcao = 'ida' and e.entregue_em is not null then$a$,
    $a$if e.direcao = 'ida' and e.entregue_em is not null
     and not exists (select 1 from kit_cycles k left join remessas r on r.id = k.remessa_id
                      where k.id = e.cycle_id and coalesce(k.representante_party_id, r.representante_party_id) is not null) then$a$);
  IF novo = d AND position('representante_party_id, r.representante_party_id) is not null' in d) = 0 THEN RAISE EXCEPTION '0280: trecho dos 30 dias não encontrado em correios_envio_rastro'; END IF;
  IF novo <> d THEN EXECUTE novo; END IF;
END $$;