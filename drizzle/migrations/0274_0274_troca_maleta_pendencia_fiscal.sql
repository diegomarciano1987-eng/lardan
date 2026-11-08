-- 0274 (Diego, 08/11): a troca para abertura acontece na hora mesmo com nota fiscal emitida em nome da
-- consultora original; a montagem recebe uma pendência (nota de devolução da original + nota nova da abertura).
CREATE TABLE public.maleta_troca_pendencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id),
  remessa_id uuid REFERENCES public.remessas(id),
  maleta text,
  consultora_anterior_party_id uuid REFERENCES public.parties(id),
  consultora_anterior_nome text,
  consultora_nova_party_id uuid REFERENCES public.parties(id),
  consultora_nova_nome text,
  nota_numero text,
  nota_chave text,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','resolvida')),
  observacao text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_por uuid,
  resolvido_em timestamptz
);
CREATE INDEX maleta_troca_pendencias_remessa_idx ON public.maleta_troca_pendencias (remessa_id, status);
CREATE INDEX maleta_troca_pendencias_cycle_idx ON public.maleta_troca_pendencias (cycle_id);

GRANT SELECT ON public.maleta_troca_pendencias TO authenticated;
GRANT ALL ON public.maleta_troca_pendencias TO service_role;
ALTER TABLE public.maleta_troca_pendencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Montagem e Master leem pendências de troca" ON public.maleta_troca_pendencias
  FOR SELECT TO authenticated
  USING ((SELECT public.can_manage_kits(auth.uid())) OR (SELECT public.has_role(auth.uid(), 'master')));

CREATE OR REPLACE FUNCTION public.maleta_troca_pendencia_resolver(_id uuid, _obs text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE p maleta_troca_pendencias;
BEGIN
  IF NOT (public.can_manage_kits(auth.uid()) OR public.has_role(auth.uid(), 'master')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  SELECT * INTO p FROM maleta_troca_pendencias WHERE id = _id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Pendência não encontrada.'; END IF;
  IF p.status = 'resolvida' THEN RETURN jsonb_build_object('repetida', true); END IF;
  UPDATE maleta_troca_pendencias SET status = 'resolvida', resolvido_por = auth.uid(), resolvido_em = now(),
         observacao = nullif(trim(coalesce(_obs, '')), '') WHERE id = p.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'maleta.troca_pendencia_resolvida', 'kit_cycles', p.cycle_id::text,
          jsonb_build_object('pendencia', p.id, 'observacao', _obs));
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.maleta_troca_pendencia_resolver(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_troca_pendencia_resolver(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_maleta_trocar_destino(_rep uuid, _cycle uuid, _consultora uuid DEFAULT NULL, _lead uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); c kit_cycles; anterior uuid; anterior_nome text; v_num int; res jsonb;
        nf record; v_pend uuid; v_maleta text; nova_nome text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF (_consultora IS NULL) = (_lead IS NULL) THEN RAISE EXCEPTION 'Escolha uma consultora ou uma candidata.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL OR c.custodian_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta maleta não está com você.'; END IF;
  IF c.status <> 'transito' THEN RAISE EXCEPTION 'Confirme o recebimento da maleta antes de passar.'; END IF;
  anterior := c.consultora_party_id;
  IF anterior IS NULL THEN
    RETURN public.rep_maleta_repassar(_rep, _cycle, _consultora, _lead);
  END IF;
  IF anterior = _consultora THEN RAISE EXCEPTION 'Esta maleta já é dela.'; END IF;
  SELECT display_name INTO anterior_nome FROM parties WHERE id = anterior;
  SELECT code INTO v_maleta FROM kits WHERE id = c.kit_id;

  IF EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.status IN ('pendente','transito')) THEN
    RAISE EXCEPTION 'Esta maleta já foi entregue em mãos para %. Ela precisa ser devolvida antes.', anterior_nome;
  END IF;
  IF EXISTS (SELECT 1 FROM kit_acceptances a WHERE a.cycle_id = c.id) THEN
    RAISE EXCEPTION '% já aceitou esta maleta. Não dá para trocar.', anterior_nome;
  END IF;
  IF EXISTS (SELECT 1 FROM kit_signature_requests s WHERE s.cycle_id = c.id AND s.estado::text NOT ILIKE 'cancel%') THEN
    RAISE EXCEPTION 'Já existe termo de aceite de % para esta maleta. Fale com a montagem.', anterior_nome;
  END IF;
  IF EXISTS (SELECT 1 FROM assinaturas_digitais s WHERE s.cycle_id = c.id AND s.status::text NOT ILIKE 'cancel%') THEN
    RAISE EXCEPTION 'Já existe promissória de % para esta maleta. Fale com a montagem.', anterior_nome;
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_focus_envios e WHERE e.cycle_id = c.id AND e.status::text IN ('pendente','processando','processando_autorizacao')) THEN
    RAISE EXCEPTION 'A nota fiscal desta maleta está sendo emitida agora. Tente de novo em alguns minutos.';
  END IF;
  IF EXISTS (SELECT 1 FROM sales_order_items i WHERE i.cycle_id = c.id) THEN
    RAISE EXCEPTION 'Já existe pedido de cliente com peças desta maleta. Não dá para trocar.';
  END IF;
  IF EXISTS (SELECT 1 FROM kit_pre_baixas p WHERE p.cycle_id = c.id) THEN
    RAISE EXCEPTION 'Esta maleta já tem acerto começado. Não dá para trocar.';
  END IF;
  IF EXISTS (SELECT 1 FROM correios_envios e WHERE e.cycle_id = c.id) THEN
    RAISE EXCEPTION 'Esta maleta tem envio pelos Correios. Não dá para trocar.';
  END IF;

  -- nota de remessa já autorizada em nome da original: a troca segue, a montagem resolve a parte fiscal
  SELECT e.numero::text AS numero, e.chave_nfe AS chave INTO nf FROM fiscal_focus_envios e
   WHERE e.cycle_id = c.id AND e.operacao = 'remessa' AND e.status = 'autorizado'
   ORDER BY e.created_at DESC LIMIT 1;
  IF nf IS NULL OR nf.chave IS NULL THEN
    SELECT f.number::text AS numero, f.access_key AS chave INTO nf FROM fiscal_documents f
     WHERE f.cycle_id = c.id AND f.status::text NOT ILIKE 'cancel%' AND f.status::text NOT ILIKE 'rejeit%'
     ORDER BY f.created_at DESC LIMIT 1;
  END IF;

  IF c.abertura_numero IS NULL AND c.remessa_id IS NOT NULL THEN
    SELECT coalesce(max(abertura_numero), 0) + 1 INTO v_num FROM kit_cycles
     WHERE remessa_id = c.remessa_id AND representante_party_id IS NOT DISTINCT FROM c.representante_party_id;
  ELSE
    v_num := c.abertura_numero;
  END IF;
  UPDATE kit_cycles SET consultora_party_id = NULL, abertura_numero = v_num, updated_by = uid, updated_at = now() WHERE id = c.id;
  UPDATE remessa_informacoes SET cycle_id = NULL, updated_at = now() WHERE cycle_id = c.id;

  BEGIN
    res := public.rep_maleta_repassar(_rep, _cycle, _consultora, _lead);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ela já tem uma maleta nesta remessa.';
  END;
  SELECT display_name INTO nova_nome FROM parties WHERE id = (res->>'consultora_party_id')::uuid;

  IF nf IS NOT NULL AND (nf.numero IS NOT NULL OR nf.chave IS NOT NULL) THEN
    -- a fila automática não pode tentar uma nota nova enquanto a antiga não for resolvida
    DELETE FROM fiscal_fila WHERE cycle_id = c.id AND etapa = 'remessa' AND status = 'pendente' AND criado_em = now();
    INSERT INTO maleta_troca_pendencias (cycle_id, remessa_id, maleta, consultora_anterior_party_id, consultora_anterior_nome,
                                         consultora_nova_party_id, consultora_nova_nome, nota_numero, nota_chave, criado_por)
    VALUES (c.id, c.remessa_id, v_maleta, anterior, anterior_nome, (res->>'consultora_party_id')::uuid, nova_nome, nf.numero, nf.chave, uid)
    RETURNING id INTO v_pend;
  END IF;

  INSERT INTO kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (c.id, 'maleta.trocada_para_abertura', uid, jsonb_build_object('representante', _rep, 'consultora_anterior', anterior,
          'consultora_nova', res->>'consultora_party_id', 'candidata', _lead, 'abertura_numero', v_num, 'pendencia_fiscal', v_pend));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'maleta.trocada_para_abertura', 'kit_cycles', c.id::text, jsonb_build_object('representante', _rep,
          'consultora_anterior', anterior, 'consultora_anterior_nome', anterior_nome,
          'consultora_nova', res->>'consultora_party_id', 'candidata', _lead, 'abertura_numero', v_num,
          'nota_anterior', nf.numero, 'pendencia_fiscal', v_pend));
  RETURN res || jsonb_build_object('consultora_anterior', anterior_nome, 'abertura_numero', v_num, 'pendencia_fiscal', v_pend IS NOT NULL);
END $function$;