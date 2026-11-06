-- 1) Numeração das maletas de abertura
ALTER TABLE public.kit_cycles ADD COLUMN IF NOT EXISTS abertura_numero integer;

WITH n AS (
  SELECT c.id, c.kit_id, r.numero, row_number() OVER (PARTITION BY c.remessa_id, c.representante_party_id ORDER BY c.created_at) k
  FROM kit_cycles c JOIN remessas r ON r.id = c.remessa_id
  JOIN kits kt ON kt.id = c.kit_id
  WHERE c.remessa_id IS NOT NULL AND kt.label LIKE 'Remessa % · com o representante'
)
UPDATE kit_cycles c SET abertura_numero = n.k FROM n WHERE c.id = n.id;

UPDATE kits kt SET label = 'ABERTURA ' || c.abertura_numero || ' · Remessa ' || r.numero
FROM kit_cycles c JOIN remessas r ON r.id = c.remessa_id
WHERE c.kit_id = kt.id AND c.abertura_numero IS NOT NULL AND kt.label LIKE 'Remessa % · com o representante';

CREATE OR REPLACE FUNCTION public.remessa_abrir_maleta_representante(_remessa uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r remessas; v jsonb; v_cycle uuid; v_num int;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para abrir maletas.'; END IF;
  SELECT * INTO r FROM remessas WHERE id = _remessa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.status IN ('fechada', 'cancelada') THEN RAISE EXCEPTION 'Esta remessa está %.', r.status; END IF;
  IF r.representante_party_id IS NULL THEN RAISE EXCEPTION 'Esta remessa não tem representante: escolha uma consultora.'; END IF;
  SELECT coalesce(max(abertura_numero), 0) + 1 INTO v_num FROM kit_cycles
   WHERE remessa_id = r.id AND representante_party_id = r.representante_party_id;
  v := public.kit_cycle_create(jsonb_build_object(
    'representante_party_id', r.representante_party_id, 'origin_location_id', r.origin_location_id,
    'label', 'ABERTURA ' || v_num || ' · Remessa ' || r.numero,
    'due_at', CASE WHEN r.data_acerto IS NULL THEN NULL ELSE (r.data_acerto::timestamp AT TIME ZONE 'America/Sao_Paulo') END));
  v_cycle := (v->>'cycle_id')::uuid;
  UPDATE kit_cycles SET remessa_id = r.id, abertura_numero = v_num WHERE id = v_cycle;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_abrir_maleta_representante', 'remessas', r.id::text,
          jsonb_build_object('numero', r.numero, 'cycle', v_cycle, 'representante', r.representante_party_id, 'abertura_numero', v_num));
  RETURN v || jsonb_build_object('remessa_numero', r.numero, 'abertura_numero', v_num);
END $function$;

-- pedido impresso recebe o número (patch idempotente da definição viva)
DO $$
DECLARE d text := pg_get_functiondef('public.kit_pedido_dados'::regproc);
BEGIN
  IF position('''abertura_numero''' in d) = 0 THEN
    IF position('''abertura'', kc.consultora_party_id IS NULL,' in d) = 0 THEN RAISE EXCEPTION 'kit_pedido_dados: trecho esperado não encontrado'; END IF;
    EXECUTE replace(d, '''abertura'', kc.consultora_party_id IS NULL,', '''abertura'', kc.consultora_party_id IS NULL, ''abertura_numero'', kc.abertura_numero,');
  END IF;
END $$;

-- 2) Lead do site vai direto para o representante da rota (só quando há um único)
CREATE OR REPLACE FUNCTION public.lead_rota_representante()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pr uuid; rep uuid;
BEGIN
  IF NEW.representante_party_id IS NOT NULL OR NEW.city IS NULL OR NEW.uf IS NULL THEN RETURN NEW; END IF;
  pr := public.praca_pela_cidade(NEW.city, NEW.uf);
  IF pr IS NULL THEN RETURN NEW; END IF;
  rep := public.consultora_rep_pela_praca(pr);
  IF rep IS NOT NULL THEN NEW.representante_party_id := rep; NEW.representante_origem := 'rota'; END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW; -- nunca impede a candidatura
END $function$;
DROP TRIGGER IF EXISTS zzz_lead_rota_representante ON public.leads;
CREATE TRIGGER zzz_lead_rota_representante BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.lead_rota_representante();

-- 3) Representante devolve a candidata para a Lardan
CREATE OR REPLACE FUNCTION public.rep_lead_devolver(_rep uuid, _lead uuid, _motivo text, _obs text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE le leads; nome text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo,''))) < 3 THEN RAISE EXCEPTION 'Escolha o motivo da devolução.'; END IF;
  SELECT * INTO le FROM leads WHERE id = _lead FOR UPDATE;
  IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não está com você.'; END IF;
  IF EXISTS (SELECT 1 FROM kit_cycles WHERE consultora_party_id = le.party_id AND le.party_id IS NOT NULL AND status NOT IN ('encerrada','cancelada')) THEN
    RAISE EXCEPTION 'Ela já tem maleta: não dá para devolver.'; END IF;
  SELECT display_name INTO nome FROM parties WHERE id = _rep;
  UPDATE leads SET representante_party_id = NULL, representante_origem = 'devolvida' WHERE id = _lead;
  DELETE FROM rep_crm_cards WHERE lead_id = _lead;
  INSERT INTO lead_events (lead_id, event_type, title, note, actor_id, metadata)
  VALUES (_lead, 'responsavel', 'Devolvido pelo representante ' || coalesce(nome,''),
          btrim(_motivo) || coalesce(' — ' || nullif(btrim(_obs),''), ''), auth.uid(),
          jsonb_build_object('representante', _rep, 'motivo', btrim(_motivo), 'obs', nullif(btrim(_obs),'')));
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'candidatura.devolvida_representante', 'leads', _lead::text, jsonb_build_object('representante', _rep, 'motivo', _motivo));
END $function$;
REVOKE ALL ON FUNCTION public.rep_lead_devolver(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_lead_devolver(uuid,uuid,text,text) TO authenticated;

-- 4) Atendimento presencial: completar dados + perfil rápido
CREATE OR REPLACE FUNCTION public.rep_lead_atendimento(_rep uuid, _lead uuid, _dados jsonb, _perfil jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE le leads; cpf text := regexp_replace(coalesce(_dados->>'cpf',''),'\D','','g'); res text; pts int := 0; k text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  SELECT * INTO le FROM leads WHERE id = _lead FOR UPDATE;
  IF le.id IS NULL OR le.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não está com você.'; END IF;
  IF cpf <> '' THEN
    IF length(cpf) <> 11 THEN RAISE EXCEPTION 'CPF inválido.'; END IF;
    IF le.cpf_digits IS NOT NULL AND le.cpf_digits <> cpf THEN RAISE EXCEPTION 'Esta candidata já tem outro CPF. Fale com a Lardan.'; END IF;
  END IF;
  UPDATE leads SET
    cpf = CASE WHEN cpf <> '' AND cpf_digits IS NULL THEN cpf ELSE leads.cpf END,
    email = coalesce(nullif(btrim(_dados->>'email'),''), email),
    postal_code = coalesce(nullif(regexp_replace(coalesce(_dados->>'cep',''),'\D','','g'),''), postal_code),
    street = coalesce(nullif(btrim(_dados->>'rua'),''), street),
    street_number = coalesce(nullif(btrim(_dados->>'numero'),''), street_number)
  WHERE id = _lead;
  IF _perfil IS NOT NULL AND jsonb_typeof(_perfil) = 'object' AND _perfil <> '{}'::jsonb THEN
    FOR k IN SELECT jsonb_object_keys(_perfil) LOOP pts := pts + coalesce((_perfil->>k)::int, 0); END LOOP;
    res := CASE WHEN pts >= 10 THEN 'Perfil forte' WHEN pts >= 7 THEN 'Perfil bom' ELSE 'Precisa de acompanhamento' END;
    INSERT INTO candidatura_assessments (lead_id, assessment_type, status, completed_at, result_reference, metadata)
    VALUES (_lead, 'perfil_presencial', 'concluido', now(), res,
            jsonb_build_object('respostas', _perfil, 'pontos', pts, 'representante', _rep, 'por', auth.uid()));
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'candidatura.atendimento_presencial', 'leads', _lead::text, jsonb_build_object('representante', _rep, 'perfil', res));
  RETURN jsonb_build_object('perfil', res, 'pontos', pts);
END $function$;
REVOKE ALL ON FUNCTION public.rep_lead_atendimento(uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_lead_atendimento(uuid,uuid,jsonb,jsonb) TO authenticated;