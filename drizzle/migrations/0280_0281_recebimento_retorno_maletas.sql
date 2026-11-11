-- 0281 (Diego, 11/11/2026) — Recebimento de maletas na Qualidade + expedição de retorno do representante.
-- Volta faz o mesmo caminho da ida: consultora -> representante (acerto) -> empresa (expedição de retorno)
-- -> Qualidade confirma a chegada (bipando a maleta). Maleta que não ficou com a consultora volta pela
-- devolução 0280 (peças voltam ao estoque na chegada). Maleta do acerto: chegada registrada e as peças
-- seguem para a conferência oficial do acerto (pre_baixa_conferir). Nada aqui emite nota nem mexe em dinheiro.

CREATE SEQUENCE IF NOT EXISTS public.retorno_expedicoes_numero_seq;

CREATE TABLE public.retorno_expedicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero integer NOT NULL UNIQUE DEFAULT nextval('public.retorno_expedicoes_numero_seq'),
  representante_party_id uuid REFERENCES public.parties(id),
  status text NOT NULL DEFAULT 'enviada' CHECK (status IN ('enviada','recebida','com_falta','cancelada')),
  origem text NOT NULL DEFAULT 'representante' CHECK (origem IN ('representante','equipe','balcao')),
  observacao text,
  enviada_por uuid,
  enviada_em timestamptz NOT NULL DEFAULT now(),
  recebida_em timestamptz,
  recebida_por uuid
);
ALTER SEQUENCE public.retorno_expedicoes_numero_seq OWNED BY public.retorno_expedicoes.numero;

CREATE TABLE public.retorno_expedicao_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expedicao_id uuid NOT NULL REFERENCES public.retorno_expedicoes(id),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id),
  motivo text NOT NULL CHECK (motivo IN ('acerto','nao_ficou')),
  devolucao_id uuid REFERENCES public.maleta_devolucoes(id),
  pecas integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'a_caminho' CHECK (status IN ('a_caminho','recebida','nao_veio','retirado')),
  recebida_em timestamptz,
  recebida_por uuid,
  pecas_recebidas integer,
  ocorrencia text,
  ocorrencia_por uuid,
  ocorrencia_em timestamptz
);
-- uma maleta só pode estar "a caminho" ou "recebida" uma vez; "não veio"/"retirado" liberam para nova expedição
CREATE UNIQUE INDEX retorno_itens_um_vivo ON public.retorno_expedicao_itens (cycle_id) WHERE status IN ('a_caminho','recebida');
CREATE INDEX retorno_itens_expedicao ON public.retorno_expedicao_itens (expedicao_id);
CREATE INDEX retorno_expedicoes_rep ON public.retorno_expedicoes (representante_party_id, enviada_em DESC);

-- quem confirma a chegada: montagem (kit.manage) ou Qualidade (quality.manage)
CREATE OR REPLACE FUNCTION public.retorno_pode_receber(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND (coalesce(public.can_manage_kits(_uid), false) OR coalesce(public.has_capability(_uid, 'quality.manage'), false))
$$;
CREATE OR REPLACE FUNCTION public.retorno_pode_ver(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND (public.retorno_pode_receber(_uid) OR coalesce(public.has_capability(_uid, 'quality.view'), false)
                               OR coalesce(public.has_capability(_uid, 'kit.view.all'), false))
$$;
-- alcance: o mesmo das maletas; Qualidade (fora do acesso de colaboradora) vê todas
CREATE OR REPLACE FUNCTION public.retorno_ciclo_alcance(_cycle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.kit_cycle_in_scope(_cycle), false)
      OR (NOT public.colab_restrita() AND coalesce(public.has_capability(auth.uid(), 'quality.view'), false))
$$;
REVOKE ALL ON FUNCTION public.retorno_pode_receber(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retorno_pode_ver(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retorno_ciclo_alcance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retorno_pode_receber(uuid), public.retorno_pode_ver(uuid), public.retorno_ciclo_alcance(uuid) TO authenticated, service_role;

GRANT SELECT ON public.retorno_expedicoes TO authenticated;
GRANT SELECT ON public.retorno_expedicao_itens TO authenticated;
GRANT ALL ON public.retorno_expedicoes TO service_role;
GRANT ALL ON public.retorno_expedicao_itens TO service_role;
ALTER TABLE public.retorno_expedicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retorno_expedicao_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY retorno_expedicoes_ler ON public.retorno_expedicoes FOR SELECT TO authenticated
  USING ((SELECT public.retorno_pode_ver(auth.uid())) OR (representante_party_id IS NOT NULL AND public.rep_portal_pode(representante_party_id)));
CREATE POLICY retorno_itens_ler ON public.retorno_expedicao_itens FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.retorno_expedicoes e WHERE e.id = expedicao_id
                 AND ((SELECT public.retorno_pode_ver(auth.uid())) OR (e.representante_party_id IS NOT NULL AND public.rep_portal_pode(e.representante_party_id)))));

-- Tudo que precisa voltar para a empresa e ainda não está numa expedição viva
CREATE OR REPLACE FUNCTION public.retorno_a_devolver(_cycle uuid DEFAULT NULL)
RETURNS TABLE (cycle_id uuid, representante_party_id uuid, motivo text, devolucao_id uuid, pecas integer, desde timestamptz, nao_veio boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id,
         coalesce(x.rep, c.representante_party_id, r.representante_party_id, cp.representative_party_id),
         x.motivo, x.devolucao_id, coalesce(x.pecas, c.quantity_total, 0)::int, x.desde,
         EXISTS (SELECT 1 FROM retorno_expedicao_itens i WHERE i.cycle_id = c.id AND i.status = 'nao_veio')
    FROM (
      SELECT pb.cycle_id, 'acerto'::text motivo, NULL::uuid devolucao_id, NULL::uuid rep,
             (SELECT coalesce(sum(greatest(i.qtd_enviada - i.qtd_vendida, 0)), 0)::int FROM kit_pre_baixa_itens i WHERE i.pre_baixa_id = pb.id) pecas,
             pb.fechada_em desde
        FROM kit_pre_baixas pb WHERE pb.status = 'fechada' AND (_cycle IS NULL OR pb.cycle_id = _cycle)
      UNION ALL
      SELECT d.cycle_id, 'nao_ficou', d.id, d.representante_party_id, NULL::int, d.pedido_em
        FROM maleta_devolucoes d WHERE d.status = 'pedida' AND (_cycle IS NULL OR d.cycle_id = _cycle)
    ) x
    JOIN kit_cycles c ON c.id = x.cycle_id
    LEFT JOIN remessas r ON r.id = c.remessa_id
    LEFT JOIN consultant_profiles cp ON cp.party_id = c.consultora_party_id
   WHERE c.status::text NOT IN ('encerrada','cancelada')
     AND NOT EXISTS (SELECT 1 FROM retorno_expedicao_itens i WHERE i.cycle_id = c.id AND i.status IN ('a_caminho','recebida'))
$$;
REVOKE ALL ON FUNCTION public.retorno_a_devolver(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.retorno_ciclo_info(_cycle uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'abertura_numero', c.abertura_numero,
           'consultora', p.display_name, 'consultora_codigo', p.code, 'praca', pr.nome, 'status', c.status)
    FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id
    LEFT JOIN parties p ON p.id = c.consultora_party_id LEFT JOIN cob_pracas pr ON pr.id = r.praca_id
   WHERE c.id = _cycle
$$;
REVOKE ALL ON FUNCTION public.retorno_ciclo_info(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.retorno_expedicao_json(_exp uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('id', e.id, 'numero', e.numero, 'status', e.status, 'origem', e.origem, 'observacao', e.observacao,
           'representante_party_id', e.representante_party_id, 'representante', rp.display_name,
           'enviada_em', e.enviada_em, 'recebida_em', e.recebida_em,
           'itens', coalesce((SELECT jsonb_agg(public.retorno_ciclo_info(i.cycle_id) || jsonb_build_object('item_id', i.id, 'motivo', i.motivo,
                       'pecas', i.pecas, 'pecas_recebidas', i.pecas_recebidas, 'status', i.status, 'recebida_em', i.recebida_em, 'ocorrencia', i.ocorrencia,
                       'conferencia', (SELECT public.pre_baixa_situacao(pb) FROM kit_pre_baixas pb WHERE pb.cycle_id = i.cycle_id))
                     ORDER BY i.status = 'a_caminho' DESC, (SELECT k.code FROM kit_cycles c JOIN kits k ON k.id = c.kit_id WHERE c.id = i.cycle_id))
                FROM retorno_expedicao_itens i WHERE i.expedicao_id = e.id), '[]'::jsonb))
    FROM retorno_expedicoes e LEFT JOIN parties rp ON rp.id = e.representante_party_id WHERE e.id = _exp
$$;
REVOKE ALL ON FUNCTION public.retorno_expedicao_json(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.retorno_expedicao_recalcular(_exp uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ac int; rec int; nv int; st text;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'a_caminho'), count(*) FILTER (WHERE status = 'recebida'), count(*) FILTER (WHERE status = 'nao_veio')
    INTO ac, rec, nv FROM retorno_expedicao_itens WHERE expedicao_id = _exp;
  st := CASE WHEN ac > 0 THEN 'enviada' WHEN nv > 0 THEN 'com_falta' WHEN rec > 0 THEN 'recebida' ELSE 'cancelada' END;
  UPDATE retorno_expedicoes SET status = st,
         recebida_em = CASE WHEN st IN ('recebida','com_falta') THEN coalesce(recebida_em, now()) ELSE NULL END,
         recebida_por = CASE WHEN st IN ('recebida','com_falta') THEN coalesce(recebida_por, auth.uid()) ELSE NULL END
   WHERE id = _exp;
  RETURN st;
END $$;
REVOKE ALL ON FUNCTION public.retorno_expedicao_recalcular(uuid) FROM PUBLIC, anon, authenticated;

-- App do representante: tudo que está com ele e o que precisa voltar
CREATE OR REPLACE FUNCTION public.retorno_rep_pendentes(_rep uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'a_devolver', coalesce((SELECT jsonb_agg(public.retorno_ciclo_info(a.cycle_id) || jsonb_build_object('motivo', a.motivo, 'pecas', a.pecas,
          'desde', a.desde, 'nao_veio', a.nao_veio, 'devolucao_id', a.devolucao_id) ORDER BY a.desde)
        FROM public.retorno_a_devolver() a WHERE a.representante_party_id = _rep), '[]'::jsonb),
    'com_voce', coalesce((SELECT jsonb_agg(public.retorno_ciclo_info(c.id) || jsonb_build_object('pecas', c.quantity_total)
          ORDER BY c.consultora_party_id IS NULL, c.abertura_numero NULLS LAST)
        FROM kit_cycles c WHERE c.custodian_party_id = _rep AND c.status = 'transito'
         AND NOT EXISTS (SELECT 1 FROM maleta_devolucoes d WHERE d.cycle_id = c.id AND d.status = 'pedida')
         AND NOT EXISTS (SELECT 1 FROM retorno_expedicao_itens i WHERE i.cycle_id = c.id AND i.status IN ('a_caminho','recebida'))), '[]'::jsonb),
    'com_consultoras', (SELECT count(*) FROM kit_cycles c LEFT JOIN remessas r ON r.id = c.remessa_id
          LEFT JOIN consultant_profiles cp ON cp.party_id = c.consultora_party_id
         WHERE coalesce(c.representante_party_id, r.representante_party_id, cp.representative_party_id) = _rep
           AND c.status::text IN ('recebida','operacao','acerto')
           AND NOT EXISTS (SELECT 1 FROM kit_pre_baixas pb WHERE pb.cycle_id = c.id AND pb.status <> 'aberta')),
    'expedicoes', coalesce((SELECT jsonb_agg(public.retorno_expedicao_json(e.id) ORDER BY e.enviada_em DESC)
        FROM (SELECT id, enviada_em FROM retorno_expedicoes WHERE representante_party_id = _rep AND status <> 'cancelada'
               ORDER BY enviada_em DESC LIMIT 15) e), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.retorno_rep_pendentes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retorno_rep_pendentes(uuid) TO authenticated, service_role;

-- Representante (ou a equipe) despacha as maletas de volta para a empresa
CREATE OR REPLACE FUNCTION public.retorno_expedir(_rep uuid, _cycles uuid[], _obs text DEFAULT NULL, _motivo_nao_ficou text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); equipe boolean; cy uuid; c kit_cycles; a record; exp uuid; num int; viva record; n int := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  equipe := public.can_manage_kits(uid) OR public.has_role(uid, 'master');
  IF NOT (public.rep_portal_pode(_rep) OR equipe) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF _cycles IS NULL OR cardinality(_cycles) = 0 THEN RAISE EXCEPTION 'Escolha pelo menos uma maleta.'; END IF;
  IF cardinality(_cycles) <> (SELECT count(DISTINCT x) FROM unnest(_cycles) x) THEN RAISE EXCEPTION 'Maleta repetida na lista.'; END IF;

  INSERT INTO retorno_expedicoes (representante_party_id, origem, observacao, enviada_por)
  VALUES (_rep, CASE WHEN public.has_role(uid, 'representante') AND _rep = public.my_party_id() THEN 'representante' ELSE 'equipe' END,
          nullif(btrim(coalesce(_obs, '')), ''), uid)
  RETURNING id, numero INTO exp, num;

  FOREACH cy IN ARRAY _cycles LOOP
    SELECT * INTO c FROM kit_cycles WHERE id = cy FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
    SELECT e.numero, i.status INTO viva FROM retorno_expedicao_itens i JOIN retorno_expedicoes e ON e.id = i.expedicao_id
     WHERE i.cycle_id = cy AND i.status IN ('a_caminho','recebida') LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'A maleta % já está na expedição de retorno nº %.', (SELECT code FROM kits WHERE id = c.kit_id), viva.numero;
    END IF;
    SELECT * INTO a FROM public.retorno_a_devolver(cy) LIMIT 1;
    IF NOT FOUND THEN
      -- ainda com ele, sem entrega: vira devolução (0280) — exige o motivo
      IF c.custodian_party_id = _rep AND c.status = 'transito' THEN
        IF length(btrim(coalesce(_motivo_nao_ficou, ''))) < 5 THEN
          RAISE EXCEPTION 'A maleta % ainda não foi entregue: diga por que ela vai voltar (mínimo 5 letras).', (SELECT code FROM kits WHERE id = c.kit_id);
        END IF;
        PERFORM public.maleta_devolucao_pedir(cy, _motivo_nao_ficou);
        SELECT * INTO a FROM public.retorno_a_devolver(cy) LIMIT 1;
      ELSE
        RAISE EXCEPTION 'A maleta % não está para voltar: o acerto ainda não foi fechado ou ela já voltou.', (SELECT code FROM kits WHERE id = c.kit_id);
      END IF;
    END IF;
    IF a.representante_party_id IS DISTINCT FROM _rep THEN
      RAISE EXCEPTION 'A maleta % não é da carteira deste representante.', (SELECT code FROM kits WHERE id = c.kit_id) USING errcode = '42501';
    END IF;
    INSERT INTO retorno_expedicao_itens (expedicao_id, cycle_id, motivo, devolucao_id, pecas)
    VALUES (exp, cy, a.motivo, a.devolucao_id, a.pecas);
    INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
    VALUES (cy, 'retorno.expedido', c.status, c.status, uid, jsonb_build_object('expedicao', exp, 'numero', num, 'motivo', a.motivo, 'pecas', a.pecas), _obs);
    n := n + 1;
  END LOOP;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'retorno.expedido', 'retorno_expedicoes', exp::text, jsonb_build_object('numero', num, 'representante', _rep, 'maletas', n));
  RETURN public.retorno_expedicao_json(exp);
END $$;
REVOKE ALL ON FUNCTION public.retorno_expedir(uuid, uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retorno_expedir(uuid, uuid[], text, text) TO authenticated, service_role;

-- Representante tira uma maleta da expedição antes de chegar (ex.: mandou por engano)
CREATE OR REPLACE FUNCTION public.retorno_item_retirar(_item uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); it retorno_expedicao_itens; e retorno_expedicoes;
BEGIN
  SELECT * INTO it FROM retorno_expedicao_itens WHERE id = _item FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;
  SELECT * INTO e FROM retorno_expedicoes WHERE id = it.expedicao_id FOR UPDATE;
  IF NOT ((e.representante_party_id IS NOT NULL AND public.rep_portal_pode(e.representante_party_id)) OR public.retorno_pode_receber(uid)) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF it.status <> 'a_caminho' THEN RAISE EXCEPTION 'Esta maleta já foi recebida ou tirada da expedição.'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 5 letras).'; END IF;
  UPDATE retorno_expedicao_itens SET status = 'retirado', ocorrencia = btrim(_motivo), ocorrencia_por = uid, ocorrencia_em = now() WHERE id = _item;
  PERFORM public.retorno_expedicao_recalcular(e.id);
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload, reason)
  VALUES (it.cycle_id, 'retorno.retirado', uid, jsonb_build_object('expedicao', e.id, 'numero', e.numero), btrim(_motivo));
  RETURN jsonb_build_object('item_id', _item, 'status', 'retirado');
END $$;
REVOKE ALL ON FUNCTION public.retorno_item_retirar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retorno_item_retirar(uuid, text) TO authenticated, service_role;

-- Qualidade/montagem: bipou a maleta (ou clicou) → chegada confirmada
CREATE OR REPLACE FUNCTION public.retorno_receber(_codigo text DEFAULT NULL, _item uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); it retorno_expedicao_itens; e retorno_expedicoes; ciclos uuid[]; a record; c kit_cycles;
  exp uuid; r jsonb; v_pecas int; st text; ultimo uuid;
BEGIN
  IF NOT public.retorno_pode_receber(uid) THEN
    RAISE EXCEPTION 'Só a montagem ou a Qualidade confirma a chegada da maleta.' USING errcode = '42501';
  END IF;
  IF _item IS NOT NULL THEN
    SELECT * INTO it FROM retorno_expedicao_itens WHERE id = _item FOR UPDATE;
    IF it.id IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;
  ELSE
    IF length(btrim(coalesce(_codigo, ''))) = 0 THEN RAISE EXCEPTION 'Bipe ou digite o código da maleta.'; END IF;
    SELECT array_agg(c2.id ORDER BY c2.created_at DESC) INTO ciclos FROM kits k JOIN kit_cycles c2 ON c2.kit_id = k.id
     WHERE upper(k.code) = upper(btrim(_codigo)) OR k.qr_token = btrim(_codigo);
    IF ciclos IS NULL THEN RAISE EXCEPTION 'Maleta % não encontrada.', upper(btrim(_codigo)); END IF;
    SELECT * INTO it FROM retorno_expedicao_itens WHERE cycle_id = ANY (ciclos) AND status = 'a_caminho' LIMIT 1 FOR UPDATE;
    IF it.id IS NULL THEN
      ultimo := ciclos[1];
      SELECT * INTO it FROM retorno_expedicao_itens WHERE cycle_id = ultimo AND status = 'recebida' LIMIT 1;
      IF it.id IS NULL THEN
        SELECT * INTO a FROM public.retorno_a_devolver(ultimo) LIMIT 1;
        IF NOT FOUND THEN
          SELECT * INTO c FROM kit_cycles WHERE id = ultimo;
          RAISE EXCEPTION 'A maleta % não está voltando para a empresa (situação: %). Ela volta depois do acerto fechado ou do pedido de devolução.',
            upper(btrim(_codigo)), c.status;
        END IF;
        -- chegou sem expedição registrada (no balcão / Correios): registra e recebe
        INSERT INTO retorno_expedicoes (representante_party_id, origem, observacao, enviada_por)
        VALUES (a.representante_party_id, 'balcao', 'Chegou sem expedição registrada', uid) RETURNING id INTO exp;
        INSERT INTO retorno_expedicao_itens (expedicao_id, cycle_id, motivo, devolucao_id, pecas)
        VALUES (exp, ultimo, a.motivo, a.devolucao_id, a.pecas) RETURNING * INTO it;
      END IF;
    END IF;
  END IF;
  IF public.retorno_ciclo_alcance(it.cycle_id) IS NOT TRUE THEN RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501'; END IF;
  SELECT * INTO e FROM retorno_expedicoes WHERE id = it.expedicao_id FOR UPDATE;
  IF it.status = 'recebida' THEN
    RETURN public.retorno_ciclo_info(it.cycle_id) || jsonb_build_object('item_id', it.id, 'numero', e.numero, 'motivo', it.motivo,
      'pecas', coalesce(it.pecas_recebidas, it.pecas), 'repetida', true, 'precisa_conferir', it.motivo = 'acerto'
        AND EXISTS (SELECT 1 FROM kit_pre_baixas pb WHERE pb.cycle_id = it.cycle_id AND pb.status = 'fechada'));
  END IF;
  IF it.status <> 'a_caminho' THEN RAISE EXCEPTION 'Esta maleta foi marcada como "%" nesta expedição.', it.status; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = it.cycle_id FOR UPDATE;

  IF it.motivo = 'nao_ficou' THEN
    -- 0280: peças voltam ao estoque, promissória deixa de valer, pendência fiscal se havia NF
    r := public.maleta_devolucao_receber(it.devolucao_id);
    v_pecas := coalesce((r->>'pecas')::int, it.pecas);
  ELSE
    v_pecas := it.pecas;
  END IF;
  UPDATE retorno_expedicao_itens SET status = 'recebida', recebida_em = now(), recebida_por = uid, pecas_recebidas = v_pecas WHERE id = it.id;
  st := public.retorno_expedicao_recalcular(e.id);
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (it.cycle_id, 'retorno.recebido', c.status, (SELECT status FROM kit_cycles WHERE id = it.cycle_id), uid,
          jsonb_build_object('expedicao', e.id, 'numero', e.numero, 'motivo', it.motivo, 'pecas', v_pecas));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'retorno.recebido', 'retorno_expedicao_itens', it.id::text, jsonb_build_object('numero', e.numero, 'cycle', it.cycle_id, 'motivo', it.motivo, 'pecas', v_pecas));
  RETURN public.retorno_ciclo_info(it.cycle_id) || jsonb_build_object('item_id', it.id, 'numero', e.numero, 'motivo', it.motivo,
    'pecas', v_pecas, 'repetida', false, 'expedicao_status', st, 'precisa_conferir', it.motivo = 'acerto');
END $$;
REVOKE ALL ON FUNCTION public.retorno_receber(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retorno_receber(text, uuid) TO authenticated, service_role;

-- Qualidade: a maleta estava na expedição mas não chegou → volta a ser pendência do representante
CREATE OR REPLACE FUNCTION public.retorno_nao_veio(_item uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); it retorno_expedicao_itens; e retorno_expedicoes; st text;
BEGIN
  IF NOT public.retorno_pode_receber(uid) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  SELECT * INTO it FROM retorno_expedicao_itens WHERE id = _item FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;
  IF public.retorno_ciclo_alcance(it.cycle_id) IS NOT TRUE THEN RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode = '42501'; END IF;
  IF it.status <> 'a_caminho' THEN RAISE EXCEPTION 'Só marca "não veio" a maleta que ainda está a caminho.'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o que aconteceu (mínimo 5 letras).'; END IF;
  SELECT * INTO e FROM retorno_expedicoes WHERE id = it.expedicao_id FOR UPDATE;
  UPDATE retorno_expedicao_itens SET status = 'nao_veio', ocorrencia = btrim(_motivo), ocorrencia_por = uid, ocorrencia_em = now() WHERE id = _item;
  st := public.retorno_expedicao_recalcular(e.id);
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload, reason)
  VALUES (it.cycle_id, 'retorno.nao_veio', uid, jsonb_build_object('expedicao', e.id, 'numero', e.numero), btrim(_motivo));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'retorno.nao_veio', 'retorno_expedicao_itens', _item::text, jsonb_build_object('numero', e.numero, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('item_id', _item, 'status', 'nao_veio', 'expedicao_status', st);
END $$;
REVOKE ALL ON FUNCTION public.retorno_nao_veio(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retorno_nao_veio(uuid, text) TO authenticated, service_role;

-- Painel da Qualidade: chegando, conferir peças, pendente com cada representante, recebidas
CREATE OR REPLACE FUNCTION public.retorno_painel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.retorno_pode_ver(uid) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'pode_receber', public.retorno_pode_receber(uid),
    'pode_conferir', coalesce(public.has_capability(uid, 'kit.manage'), false),
    'chegando', coalesce((SELECT jsonb_agg(public.retorno_expedicao_json(e.id) ORDER BY e.enviada_em)
        FROM retorno_expedicoes e WHERE e.status = 'enviada'
         AND EXISTS (SELECT 1 FROM retorno_expedicao_itens i WHERE i.expedicao_id = e.id AND public.retorno_ciclo_alcance(i.cycle_id))), '[]'::jsonb),
    'conferir', coalesce((SELECT jsonb_agg(public.retorno_ciclo_info(i.cycle_id) || jsonb_build_object('item_id', i.id, 'numero', e.numero,
          'representante', rp.display_name, 'pecas', i.pecas, 'recebida_em', i.recebida_em, 'conferencia', public.pre_baixa_situacao(pb)) ORDER BY i.recebida_em)
        FROM retorno_expedicao_itens i JOIN retorno_expedicoes e ON e.id = i.expedicao_id LEFT JOIN parties rp ON rp.id = e.representante_party_id
        JOIN kit_pre_baixas pb ON pb.cycle_id = i.cycle_id AND pb.status = 'fechada'
       WHERE i.status = 'recebida' AND i.motivo = 'acerto' AND public.retorno_ciclo_alcance(i.cycle_id)), '[]'::jsonb),
    'pendentes', coalesce((SELECT jsonb_agg(x ORDER BY x->>'representante' NULLS LAST) FROM (
        SELECT jsonb_build_object('representante_party_id', a.representante_party_id, 'representante', coalesce(rp.display_name, 'Sem representante'),
                 'quantidade', count(*), 'nao_veio', count(*) FILTER (WHERE a.nao_veio),
                 'maletas', jsonb_agg(public.retorno_ciclo_info(a.cycle_id) || jsonb_build_object('motivo', a.motivo, 'pecas', a.pecas, 'desde', a.desde, 'nao_veio', a.nao_veio) ORDER BY a.desde)) x
          FROM public.retorno_a_devolver() a LEFT JOIN parties rp ON rp.id = a.representante_party_id
         WHERE public.retorno_ciclo_alcance(a.cycle_id)
         GROUP BY a.representante_party_id, rp.display_name) s), '[]'::jsonb),
    'com_representantes', coalesce((SELECT jsonb_agg(jsonb_build_object('representante_party_id', s.rep, 'representante', p.display_name, 'quantidade', s.n) ORDER BY p.display_name)
        FROM (SELECT c.custodian_party_id rep, count(*) n FROM kit_cycles c
               WHERE c.status = 'transito' AND c.custodian_party_id IS NOT NULL AND public.retorno_ciclo_alcance(c.id)
                 AND NOT EXISTS (SELECT 1 FROM maleta_devolucoes d WHERE d.cycle_id = c.id AND d.status = 'pedida')
               GROUP BY 1) s JOIN parties p ON p.id = s.rep), '[]'::jsonb),
    'recebidas', coalesce((SELECT jsonb_agg(x ORDER BY x->>'recebida_em' DESC) FROM (
        SELECT public.retorno_ciclo_info(i.cycle_id) || jsonb_build_object('item_id', i.id, 'numero', e.numero, 'motivo', i.motivo,
                 'representante', rp.display_name, 'pecas', coalesce(i.pecas_recebidas, i.pecas), 'recebida_em', i.recebida_em,
                 'conferencia', (SELECT public.pre_baixa_situacao(pb) FROM kit_pre_baixas pb WHERE pb.cycle_id = i.cycle_id)) x
          FROM retorno_expedicao_itens i JOIN retorno_expedicoes e ON e.id = i.expedicao_id LEFT JOIN parties rp ON rp.id = e.representante_party_id
         WHERE i.status = 'recebida' AND public.retorno_ciclo_alcance(i.cycle_id)
         ORDER BY i.recebida_em DESC LIMIT 40) s), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.retorno_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retorno_painel() TO authenticated, service_role;

-- 0280 ajustes: a Qualidade também confirma a chegada da maleta devolvida; devolução numa expedição viva não é desfeita
DO $do$
DECLARE src text; novo text;
BEGIN
  src := pg_get_functiondef('public.maleta_devolucao_receber(uuid)'::regprocedure);
  novo := replace(src, 'IF uid IS NULL OR NOT public.can_manage_kits(uid) THEN', 'IF uid IS NULL OR NOT public.retorno_pode_receber(uid) THEN');
  novo := replace(novo, 'Só a montagem confirma a chegada da maleta.', 'Só a montagem ou a Qualidade confirma a chegada da maleta.');
  novo := replace(novo, 'IF public.kit_cycle_in_scope(c.id) IS NOT TRUE THEN', 'IF public.retorno_ciclo_alcance(c.id) IS NOT TRUE THEN');
  IF novo !~ 'retorno_pode_receber' OR novo !~ 'retorno_ciclo_alcance' THEN RAISE EXCEPTION '0281: maleta_devolucao_receber não tem o trecho esperado'; END IF;
  EXECUTE novo;
END $do$;

CREATE OR REPLACE FUNCTION public.maleta_devolucao_cancelar(_id uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); d maleta_devolucoes; num int;
BEGIN
  SELECT * INTO d FROM maleta_devolucoes WHERE id = _id FOR UPDATE;
  IF d.id IS NULL OR d.status <> 'pedida' THEN RAISE EXCEPTION 'Devolução não está aberta.'; END IF;
  IF NOT (public.can_manage_kits(uid) OR public.has_role(uid, 'master') OR (d.representante_party_id IS NOT NULL AND public.rep_portal_pode(d.representante_party_id))) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  SELECT e.numero INTO num FROM retorno_expedicao_itens i JOIN retorno_expedicoes e ON e.id = i.expedicao_id
   WHERE i.devolucao_id = _id AND i.status = 'a_caminho' LIMIT 1;
  IF num IS NOT NULL THEN RAISE EXCEPTION 'A maleta está na expedição de retorno nº %: tire ela da expedição antes de desfazer.', num; END IF;
  UPDATE maleta_devolucoes SET status = 'cancelada', cancelado_por = uid, cancelado_em = now(), cancelado_motivo = nullif(btrim(coalesce(_motivo,'')), '') WHERE id = _id;
  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload, reason)
  VALUES (d.cycle_id, 'devolucao.cancelada', uid, jsonb_build_object('devolucao', _id), _motivo);
  RETURN jsonb_build_object('id', _id, 'status', 'cancelada');
END $function$;
REVOKE ALL ON FUNCTION public.maleta_devolucao_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_devolucao_cancelar(uuid, text) TO authenticated, service_role;

-- Correção (Daniel, 11/11): estoque ainda não contado deixa o depósito negativo; uma ENTRADA (delta positivo)
-- nunca piora o saldo e não pode ser recusada. Saída que deixa negativo continua bloqueada.
CREATE OR REPLACE FUNCTION public.apply_stock_delta(_variant uuid, _location uuid, _delta integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE novo integer;
BEGIN
  INSERT INTO public.stock_balances (variant_id, location_id, quantity)
  VALUES (_variant, _location, 0) ON CONFLICT (variant_id, location_id) DO NOTHING;
  UPDATE public.stock_balances SET quantity = quantity + _delta, updated_at = now()
   WHERE variant_id = _variant AND location_id = _location RETURNING quantity INTO novo;
  -- Saldo negativo só é aceito no desbloqueio interno auditado (estoque ainda não contado) ou quando entra peça.
  IF novo < 0 AND _delta < 0 AND coalesce(current_setting('lardan.stock_unblock', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Saldo insuficiente: a operação deixaria % peças neste local.', novo;
  END IF;
  RETURN novo;
END $function$;

-- Mudar remessa: remessa finalizada também recebe maleta já conferida (ex.: Ibaiti → Guilherme)
DO $do$
DECLARE src text; novo text;
BEGIN
  src := pg_get_functiondef('public.remessa_maleta_mudar_remessa(uuid,uuid,text)'::regprocedure);
  novo := replace(src,
    $a$IF r_new.status IN ('fechada','cancelada') THEN RAISE EXCEPTION 'A remessa % está finalizada ou cancelada.', r_new.numero; END IF;$a$,
    $b$IF r_new.status = 'cancelada' THEN RAISE EXCEPTION 'A remessa % está cancelada.', r_new.numero; END IF;
  IF r_new.status = 'fechada' AND c.status::text IN ('rascunho','montagem') THEN
    RAISE EXCEPTION 'A remessa % está finalizada: só recebe maleta já conferida.', r_new.numero;
  END IF;$b$);
  IF novo = src THEN RAISE EXCEPTION '0281: remessa_maleta_mudar_remessa não tem o trecho esperado'; END IF;
  EXECUTE novo;
END $do$;

CREATE OR REPLACE FUNCTION public.remessas_destino_lista(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles;
BEGIN
  IF uid IS NULL OR NOT (public.can_manage_kits(uid) OR public.has_role(uid, 'master')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'numero', r.numero, 'praca', p.nome,
            'representante_party_id', r.representante_party_id, 'representante', rp.display_name,
            'data_acerto', r.data_acerto, 'status', r.status) ORDER BY r.numero DESC)
    FROM remessas r LEFT JOIN cob_pracas p ON p.id = r.praca_id LEFT JOIN parties rp ON rp.id = r.representante_party_id
    WHERE r.status <> 'cancelada' AND r.id IS DISTINCT FROM c.remessa_id
      AND (r.status <> 'fechada' OR c.status::text NOT IN ('rascunho','montagem'))), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.remessas_destino_lista(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessas_destino_lista(uuid) TO authenticated, service_role;
