-- 0184: preço de referência herda o preço do produto quando a variante não tem preço próprio
CREATE OR REPLACE FUNCTION public.kit_reference_price(_variant uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT nullif(p.price_cents,0) FROM public.public_price_list p WHERE p.variant_id = _variant),
    (SELECT nullif(v.price_cents,0) FROM public.product_variants v WHERE v.id = _variant),
    (SELECT nullif(pr.price_cents,0) FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id WHERE v.id = _variant),
    0)
$function$;

-- Finalizar remessa: tranca a remessa (não abre novas maletas nem muda envio). Exige todas as maletas conferidas ou adiante.
CREATE OR REPLACE FUNCTION public.remessa_finalizar(_remessa uuid, _confirmacao integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r remessas; v_pend int; v_total int;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para finalizar remessas.' USING errcode='42501'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF NOT public.colab_praca_ok(r.praca_id) AND public.colab_restrita() THEN RAISE EXCEPTION 'Remessa fora da carteira.' USING errcode='42501'; END IF;
  IF _confirmacao IS DISTINCT FROM r.numero THEN RAISE EXCEPTION 'Digite o número da remessa (%) para confirmar.', r.numero; END IF;
  IF r.status = 'fechada' THEN RETURN jsonb_build_object('numero', r.numero, 'repetida', true); END IF;
  IF r.status = 'cancelada' THEN RAISE EXCEPTION 'Esta remessa está cancelada.'; END IF;
  SELECT count(*) FILTER (WHERE status IN ('rascunho','montagem')), count(*) INTO v_pend, v_total
    FROM kit_cycles WHERE remessa_id = r.id AND status <> 'cancelada';
  IF v_total = 0 THEN RAISE EXCEPTION 'A remessa não tem maletas.'; END IF;
  IF v_pend > 0 THEN RAISE EXCEPTION 'Ainda há % maleta(s) em montagem. Confira todas antes de finalizar.', v_pend; END IF;
  UPDATE remessas SET status = 'fechada', updated_at = now() WHERE id = r.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_finalizar', 'remessas', r.id::text, jsonb_build_object('numero', r.numero, 'status_anterior', r.status, 'maletas', v_total));
  RETURN jsonb_build_object('numero', r.numero, 'maletas', v_total, 'repetida', false);
END $function$;

-- Reabrir (somente Master, com motivo): desfaz a finalização voltando ao status anterior gravado na auditoria.
CREATE OR REPLACE FUNCTION public.remessa_reabrir(_remessa uuid, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r remessas; v_ant text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master reabre remessa finalizada.' USING errcode='42501'; END IF;
  IF length(btrim(coalesce(_motivo,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.status <> 'fechada' THEN RAISE EXCEPTION 'A remessa não está finalizada.'; END IF;
  SELECT payload->>'status_anterior' INTO v_ant FROM audit_logs
   WHERE action = 'remessa_finalizar' AND entity = 'remessas' AND entity_id = r.id::text ORDER BY created_at DESC LIMIT 1;
  v_ant := coalesce(v_ant, 'montagem');
  UPDATE remessas SET status = v_ant, updated_at = now() WHERE id = r.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_reabrir', 'remessas', r.id::text, jsonb_build_object('numero', r.numero, 'status', v_ant, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('numero', r.numero, 'status', v_ant);
END $function$;

-- Consultoras sem praça (do representante da remessa ou sem representante) para trazer para a remessa.
CREATE OR REPLACE FUNCTION public.remessa_consultoras_sem_praca(_remessa uuid, _search text DEFAULT NULL)
 RETURNS TABLE(party_id uuid, display_name text, representante text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT cp.party_id, pa.display_name, rp.display_name
  FROM remessas r
  JOIN consultant_profiles cp ON cp.praca_id IS NULL
   AND (cp.representative_party_id IS NULL OR cp.representative_party_id = r.representante_party_id)
  JOIN parties pa ON pa.id = cp.party_id AND pa.status NOT IN ('desligado','bloqueado','inativo','rascunho')
  LEFT JOIN parties rp ON rp.id = cp.representative_party_id
  WHERE r.id = _remessa AND public.can_manage_kits(auth.uid()) AND public.colab_party_ok(cp.party_id)
    AND _search IS NOT NULL AND length(btrim(_search)) >= 2
    AND (pa.display_name ILIKE '%' || btrim(_search) || '%'
         OR (regexp_replace(btrim(_search),'\D','','g') <> '' AND regexp_replace(coalesce(pa.doc,''),'\D','','g') LIKE regexp_replace(btrim(_search),'\D','','g') || '%'))
  ORDER BY pa.display_name LIMIT 30;
$function$;

-- Coloca a consultora (sem praça) na praça da remessa; nunca muda quem já tem praça. Auditado.
CREATE OR REPLACE FUNCTION public.remessa_vincular_consultora(_remessa uuid, _consultora uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r remessas; cp consultant_profiles;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode='42501'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.status IN ('fechada','cancelada') THEN RAISE EXCEPTION 'Esta remessa está %.', r.status; END IF;
  SELECT * INTO cp FROM consultant_profiles WHERE party_id = _consultora FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro de consultora não encontrado.'; END IF;
  IF NOT public.colab_party_ok(_consultora) THEN RAISE EXCEPTION 'Consultora fora da carteira.' USING errcode='42501'; END IF;
  IF cp.praca_id = r.praca_id THEN RETURN jsonb_build_object('repetida', true); END IF;
  IF cp.praca_id IS NOT NULL THEN RAISE EXCEPTION 'Esta consultora já pertence a outra praça. Mude no cadastro dela.'; END IF;
  IF cp.representative_party_id IS NOT NULL AND cp.representative_party_id IS DISTINCT FROM r.representante_party_id THEN
    RAISE EXCEPTION 'Esta consultora é de outro representante.';
  END IF;
  UPDATE consultant_profiles SET praca_id = r.praca_id,
    representative_party_id = coalesce(representative_party_id, r.representante_party_id), updated_at = now()
   WHERE party_id = _consultora;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_vincular_consultora', 'consultant_profiles', _consultora::text,
    jsonb_build_object('remessa', r.numero, 'praca', r.praca_id, 'representante_antes', cp.representative_party_id));
  RETURN jsonb_build_object('repetida', false);
END $function$;

REVOKE ALL ON FUNCTION public.remessa_finalizar(uuid,integer), public.remessa_reabrir(uuid,text),
  public.remessa_consultoras_sem_praca(uuid,text), public.remessa_vincular_consultora(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_finalizar(uuid,integer), public.remessa_reabrir(uuid,text),
  public.remessa_consultoras_sem_praca(uuid,text), public.remessa_vincular_consultora(uuid,uuid) TO authenticated, service_role;