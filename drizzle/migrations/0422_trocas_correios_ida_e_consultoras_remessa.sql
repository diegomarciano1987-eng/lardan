CREATE OR REPLACE FUNCTION public.qualidade_correios_dados(_troca uuid, _direcao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t qualidade_trocas; emitente uuid; dest jsonb; rem jsonb; pend text[] := '{}'; valor bigint; vivo record;
BEGIN
  IF NOT (public.has_capability(auth.uid(),'quality.manage') OR public.correios_eh_servidor()) THEN
    RAISE EXCEPTION 'Sem permissão para enviar troca pelos Correios.' USING errcode = '42501'; END IF;
  IF _direcao NOT IN ('volta','ida') THEN RAISE EXCEPTION 'Direção inválida.'; END IF;
  SELECT * INTO t FROM qualidade_trocas WHERE id = _troca;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Troca não encontrada.'; END IF;
  IF t.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Troca sem consultora ligada ao cadastro.'; END IF;
  IF t.status IN ('resolvida','recusada') THEN RAISE EXCEPTION 'Troca já finalizada.'; END IF;
  IF _direcao = 'ida' AND t.status NOT IN ('aberta','em_analise','aguardando_envio') THEN RAISE EXCEPTION 'Troca sem envio possível.'; END IF;
  SELECT be.party_id INTO emitente FROM fiscal_settings fs JOIN business_entities be ON be.id = fs.emitter_entity_id LIMIT 1;
  IF emitente IS NULL THEN pend := array_append(pend, 'emissor sem cadastro'); END IF;
  SELECT * INTO vivo FROM qualidade_correios_envios WHERE troca_id = _troca AND direcao = _direcao AND status NOT IN ('erro','cancelada') ORDER BY created_at DESC LIMIT 1;
  IF _direcao = 'volta' THEN
    rem := public.correios_endereco(t.consultora_party_id); dest := public.correios_endereco(emitente);
    IF coalesce(rem->>'email','') = '' THEN rem := jsonb_set(rem, '{email}', to_jsonb('lardansemijoias@gmail.com'::text)); END IF;
    valor := coalesce(t.dev_valor_cents, 0);
  ELSE
    rem := public.correios_endereco(emitente); dest := public.correios_endereco(t.consultora_party_id);
    valor := coalesce(t.rep_valor_cents, t.dev_valor_cents, 0);
  END IF;
  IF coalesce(dest->>'cep','') !~ '^[0-9]{8}$' THEN pend := array_append(pend, 'CEP do destinatário inválido'); END IF;
  IF coalesce(btrim(dest->>'logradouro'),'') = '' OR coalesce(btrim(dest->>'bairro'),'') = '' OR coalesce(dest->>'cidade','') = '' THEN pend := array_append(pend, 'endereço do destinatário incompleto'); END IF;
  IF coalesce(rem->>'cep','') !~ '^[0-9]{8}$' OR coalesce(btrim(rem->>'logradouro'),'') = '' OR coalesce(btrim(rem->>'bairro'),'') = '' THEN pend := array_append(pend, 'endereço do remetente incompleto'); END IF;
  IF length(coalesce(rem->>'doc','')) NOT IN (11,14) THEN pend := array_append(pend, 'remetente sem CPF/CNPJ'); END IF;
  RETURN jsonb_build_object('troca_id', _troca, 'direcao', _direcao, 'destinatario', dest, 'remetente', rem,
    'valor_declarado_cents', valor, 'pendencias', to_jsonb(pend),
    'envio_vivo', CASE WHEN vivo.id IS NULL THEN NULL ELSE jsonb_build_object('id', vivo.id, 'status', vivo.status, 'codigo_objeto', vivo.codigo_objeto) END);
END $function$;

CREATE OR REPLACE FUNCTION public.remessas_consultoras_com_maleta(_remessas uuid[])
 RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $f$
  WITH c AS (
    SELECT kc.remessa_id, kc.consultora_party_id FROM kit_cycles kc
     WHERE kc.remessa_id = ANY(_remessas) AND kc.consultora_party_id IS NOT NULL AND kc.status::text <> 'cancelada')
  SELECT jsonb_build_object(
    'total', (SELECT count(DISTINCT consultora_party_id) FROM c),
    'por_remessa', coalesce((SELECT jsonb_object_agg(remessa_id, n) FROM (SELECT remessa_id, count(DISTINCT consultora_party_id) n FROM c GROUP BY 1) x), '{}'::jsonb))
$f$;
REVOKE ALL ON FUNCTION public.remessas_consultoras_com_maleta(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remessas_consultoras_com_maleta(uuid[]) TO authenticated, service_role;