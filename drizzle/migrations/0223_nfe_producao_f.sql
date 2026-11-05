-- 0216f — painel do Master: estado, ligar/desligar produção e emissor
CREATE OR REPLACE FUNCTION public.fiscal_producao_estado()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record; pil jsonb;
BEGIN
  IF NOT public.fiscal_focus_pode('ver') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  SELECT * INTO s FROM fiscal_settings WHERE id;
  SELECT jsonb_build_object('cycle_id', kc.id, 'kit', k.code, 'consultora', p.display_name, 'status', kc.status, 'remessa', r.numero)
    INTO pil FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id LEFT JOIN parties p ON p.id = kc.consultora_party_id
    LEFT JOIN remessas r ON r.id = kc.remessa_id WHERE kc.id = s.producao_piloto_cycle_id;
  RETURN jsonb_build_object(
    'ativa', public.fiscal_focus_producao_ativa(), 'emissao_ligada', s.emission_active, 'ambiente', s.environment, 'provedor', s.provider,
    'piloto', pil, 'todas', s.producao_todas, 'automatico', s.producao_automatico, 'serie', s.serie_producao, 'email_copia', s.email_copia_xml,
    'observacao', s.note,
    'fila', jsonb_build_object(
      'pendentes', (SELECT count(*) FROM fiscal_fila WHERE status = 'pendente'),
      'com_erro', (SELECT count(*) FROM fiscal_fila WHERE status = 'erro'),
      'erros', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', f.cycle_id, 'etapa', f.etapa, 'erro', f.erro, 'consultora', p.display_name))
                          FROM (SELECT * FROM fiscal_fila WHERE status = 'erro' ORDER BY atualizado_em DESC LIMIT 20) f
                          JOIN kit_cycles kc ON kc.id = f.cycle_id LEFT JOIN parties p ON p.id = kc.consultora_party_id), '[]'::jsonb)),
    'notas_producao', (SELECT count(*) FROM fiscal_focus_envios WHERE ambiente = 'producao' AND status = 'autorizado'),
    'emails_pendentes', (SELECT count(*) FROM fiscal_focus_envios WHERE ambiente = 'producao' AND status IN ('autorizado', 'cancelado') AND email_enviado_em IS NULL));
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_producao_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_producao_estado() TO authenticated;

CREATE OR REPLACE FUNCTION public.fiscal_producao_definir(_ligar boolean, _piloto_kit text, _todas boolean, _automatico boolean,
  _email text, _confirmacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record; piloto uuid; mail text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master.' USING errcode = '42501'; END IF;
  SELECT * INTO s FROM fiscal_settings WHERE id FOR UPDATE;
  IF nullif(btrim(coalesce(_piloto_kit, '')), '') IS NOT NULL THEN
    SELECT kc.id INTO piloto FROM kits k JOIN kit_cycles kc ON kc.kit_id = k.id
     WHERE upper(k.code) = upper(btrim(_piloto_kit)) AND kc.status::text NOT IN ('encerrada', 'cancelada')
     ORDER BY kc.created_at DESC LIMIT 1;
    IF piloto IS NULL THEN RAISE EXCEPTION 'Maleta % não encontrada (ou já encerrada).', _piloto_kit; END IF;
  END IF;
  mail := nullif(lower(btrim(coalesce(_email, ''))), '');
  IF mail IS NOT NULL AND mail !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN RAISE EXCEPTION 'E-mail inválido.'; END IF;
  IF _ligar AND NOT s.emission_active THEN
    IF coalesce(_confirmacao, '') <> 'LIGAR PRODUCAO' THEN RAISE EXCEPTION 'Digite LIGAR PRODUCAO para confirmar.'; END IF;
    IF piloto IS NULL AND NOT coalesce(_todas, false) THEN RAISE EXCEPTION 'Escolha a maleta piloto (ou libere todas) antes de ligar.'; END IF;
    IF s.provider IS DISTINCT FROM 'focus' OR s.emitter_entity_id IS NULL THEN RAISE EXCEPTION 'Defina antes o emissor e o provedor Focus.'; END IF;
    UPDATE fiscal_settings SET environment = 'producao' WHERE id;
  END IF;
  UPDATE fiscal_settings SET
    emission_active = coalesce(_ligar, false) AND environment = 'producao',
    environment = CASE WHEN coalesce(_ligar, false) THEN 'producao' ELSE environment END,
    producao_piloto_cycle_id = piloto,
    producao_todas = coalesce(_todas, false),
    producao_automatico = coalesce(_automatico, false) AND coalesce(_ligar, false),
    email_copia_xml = mail
  WHERE id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'fiscal.producao_definida', 'fiscal_settings', 'fiscal',
          jsonb_build_object('ligar', _ligar, 'piloto', piloto, 'todas', _todas, 'automatico', _automatico, 'email', mail));
  RETURN public.fiscal_producao_estado();
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_producao_definir(boolean,text,boolean,boolean,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_producao_definir(boolean,text,boolean,boolean,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fiscal_focus_emitente()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('cnpj', regexp_replace(coalesce(b.tax_id, ''), '[^0-9]', '', 'g'), 'nome', b.legal_name,
                            'ie', b.state_registration, 'uf', b.uf, 'ambiente', s.environment, 'ativo', s.emission_active)
    FROM fiscal_settings s LEFT JOIN business_entities b ON b.id = s.emitter_entity_id
   WHERE s.id AND (public.fiscal_focus_pode('ver') OR public.fiscal_focus_eh_servidor())
$$;
REVOKE ALL ON FUNCTION public.fiscal_focus_emitente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_emitente() TO authenticated, service_role;