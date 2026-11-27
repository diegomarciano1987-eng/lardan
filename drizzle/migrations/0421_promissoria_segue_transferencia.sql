CREATE OR REPLACE FUNCTION public.promissoria_papel_segue_consultora()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n int := 0; v_volta uuid;
BEGIN
  IF NEW.consultora_party_id IS NOT DISTINCT FROM OLD.consultora_party_id THEN RETURN NEW; END IF;
  UPDATE public.promissorias_papel
     SET cancelada_em = now(), cancelada_por = auth.uid(),
         cancelada_motivo = 'Maleta transferida para outra consultora (a promissória de papel era de quem tinha a maleta antes).'
   WHERE cycle_id = NEW.id AND cancelada_em IS NULL AND party_id IS DISTINCT FROM NEW.consultora_party_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- troca desfeita: a promissória de papel de quem volta a ter a maleta volta a valer
  IF NEW.consultora_party_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.promissorias_papel WHERE cycle_id = NEW.id AND cancelada_em IS NULL) THEN
    SELECT id INTO v_volta FROM public.promissorias_papel
     WHERE cycle_id = NEW.id AND party_id = NEW.consultora_party_id AND cancelada_motivo LIKE 'Maleta transferida para outra consultora%'
     ORDER BY cancelada_em DESC LIMIT 1;
    IF v_volta IS NOT NULL THEN
      UPDATE public.promissorias_papel SET cancelada_em = NULL, cancelada_por = NULL, cancelada_motivo = NULL WHERE id = v_volta;
    END IF;
  END IF;
  IF n > 0 OR v_volta IS NOT NULL THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'promissoria.papel_segue_consultora', 'kit_cycles', NEW.id::text,
            jsonb_build_object('anterior', OLD.consultora_party_id, 'nova', NEW.consultora_party_id, 'canceladas', n, 'reativada', v_volta));
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.promissoria_papel_segue_consultora() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS zz_promissoria_papel_segue ON public.kit_cycles;
CREATE TRIGGER zz_promissoria_papel_segue AFTER UPDATE OF consultora_party_id ON public.kit_cycles
  FOR EACH ROW EXECUTE FUNCTION public.promissoria_papel_segue_consultora();

-- Maletas repassadas (60 dias) sem a promissória da consultora atual
CREATE OR REPLACE FUNCTION public.rep_promissorias_pendentes(_rep uuid)
 RETURNS TABLE(cycle_id uuid, maleta text, remessa integer, status text, party_id uuid, consultora text, codigo text,
               telefone text, anterior text, movida_em timestamptz, digital text, sign_url text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN QUERY
  WITH mov AS (
    SELECT DISTINCT ON (e.cycle_id) e.cycle_id, e.created_at,
           coalesce(e.payload->>'consultora_anterior', e.payload->>'anterior') anterior_id
      FROM public.kit_events e
     WHERE e.kind IN ('maleta.transferida','maleta.trocada_para_abertura','maleta.repassada','maleta.segunda')
       AND e.created_at > now() - interval '60 days'
     ORDER BY e.cycle_id, e.created_at DESC)
  SELECT kc.id, k.code, r.numero, kc.status::text, pa.id, pa.display_name, pa.code,
         (SELECT ct.value FROM public.contact_points ct WHERE ct.party_id = pa.id AND ct.kind IN ('whatsapp','telefone')
           ORDER BY (ct.kind = 'whatsapp') DESC, ct.is_primary DESC, ct.created_at LIMIT 1),
         (SELECT pp.display_name FROM public.parties pp WHERE pp.id::text = mov.anterior_id AND pp.id <> pa.id),
         mov.created_at, d.status, d.sign_url
    FROM mov
    JOIN public.kit_cycles kc ON kc.id = mov.cycle_id
    JOIN public.kits k ON k.id = kc.kit_id
    JOIN public.parties pa ON pa.id = kc.consultora_party_id
    LEFT JOIN public.remessas r ON r.id = kc.remessa_id
    LEFT JOIN public.consultant_profiles cp ON cp.party_id = pa.id
    LEFT JOIN LATERAL (SELECT x.status, CASE WHEN x.status = 'pendente' THEN x.sign_url END sign_url
                         FROM public.assinaturas_digitais x
                        WHERE x.cycle_id = kc.id AND x.party_id = pa.id AND x.tipo = 'promissoria'
                          AND x.status <> 'cancelado' AND x.invalidada_em IS NULL
                        ORDER BY (x.status = 'assinado') DESC, x.criado_em DESC LIMIT 1) d ON true
   WHERE (kc.representante_party_id = _rep OR r.representante_party_id = _rep OR kc.custodian_party_id = _rep OR cp.representative_party_id = _rep)
     AND kc.status::text IN ('conferida','expedida','transito','recebida','operacao','acerto')
     AND pa.status::text NOT IN ('bloqueado','desligado')
     AND coalesce(d.status, '') <> 'assinado'
     AND NOT EXISTS (SELECT 1 FROM public.promissorias_papel p WHERE p.cycle_id = kc.id AND p.party_id = pa.id AND p.cancelada_em IS NULL)
   ORDER BY mov.created_at DESC
   LIMIT 200;
END $function$;
REVOKE ALL ON FUNCTION public.rep_promissorias_pendentes(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rep_promissorias_pendentes(uuid) TO authenticated, service_role;

-- Aberturas aguardando assinatura: papel conferido pela própria consultora
CREATE OR REPLACE FUNCTION public.rep_aberturas_assinatura(_rep uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  WITH novas AS (
    SELECT cp.party_id, cp.joined_at FROM consultant_profiles cp
     WHERE cp.representative_party_id = _rep AND cp.joined_at >= current_date - 60),
  mal AS (
    SELECT DISTINCT ON (kc.consultora_party_id) kc.consultora_party_id party_id, kc.id cycle_id, k.code maleta, kc.status::text status,
           kc.abertura_numero, r.numero remessa
      FROM kit_cycles kc JOIN kits k ON k.id = kc.kit_id LEFT JOIN remessas r ON r.id = kc.remessa_id
     WHERE kc.consultora_party_id IN (SELECT party_id FROM novas)
       AND kc.status::text IN ('conferida','expedida','transito','recebida','operacao','acerto')
     ORDER BY kc.consultora_party_id, kc.created_at DESC),
  linhas AS (
    SELECT n.party_id, n.joined_at, pa.display_name nome,
           (SELECT ct.value FROM contact_points ct WHERE ct.party_id = n.party_id AND ct.kind = 'whatsapp' ORDER BY ct.is_primary DESC, ct.created_at LIMIT 1) telefone,
           m.cycle_id, m.maleta, m.status maleta_status, m.abertura_numero, m.remessa,
           (SELECT x.status FROM assinaturas_digitais x WHERE x.party_id = n.party_id AND x.tipo = 'contrato' AND x.status <> 'cancelado' AND x.invalidada_em IS NULL ORDER BY (x.status = 'assinado') DESC, x.criado_em DESC LIMIT 1) contrato,
           (SELECT x.status FROM assinaturas_digitais x WHERE x.party_id = n.party_id AND x.tipo = 'promissoria' AND x.cycle_id = m.cycle_id AND x.status <> 'cancelado' AND x.invalidada_em IS NULL ORDER BY (x.status = 'assinado') DESC, x.criado_em DESC LIMIT 1) promissoria,
           EXISTS (SELECT 1 FROM promissorias_papel p WHERE p.cycle_id = m.cycle_id AND p.party_id = n.party_id AND p.cancelada_em IS NULL) promissoria_papel,
           (SELECT max(x.assinado_em) FROM assinaturas_digitais x WHERE x.party_id = n.party_id AND x.status = 'assinado') ultima_assinatura
      FROM novas n JOIN parties pa ON pa.id = n.party_id JOIN mal m ON m.party_id = n.party_id
     WHERE pa.status::text NOT IN ('bloqueado','desligado'))
  SELECT jsonb_build_object(
    'pendentes', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.joined_at DESC, l.nome) FROM linhas l
                            WHERE coalesce(l.contrato, '') <> 'assinado' OR (coalesce(l.promissoria, '') <> 'assinado' AND NOT l.promissoria_papel)), '[]'::jsonb),
    'concluidas', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.ultima_assinatura DESC NULLS LAST) FROM (
                              SELECT * FROM linhas l WHERE l.contrato = 'assinado' AND (l.promissoria = 'assinado' OR l.promissoria_papel)
                              ORDER BY l.ultima_assinatura DESC NULLS LAST LIMIT 20) l), '[]'::jsonb))
    INTO v;
  RETURN v;
END $function$;