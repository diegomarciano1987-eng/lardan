
CREATE OR REPLACE FUNCTION public.correios_maleta_individualizar(_cycle uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE k record; r record; e record; v_num int; v_nova uuid; v_due timestamptz; v_ator uuid;
BEGIN
  SELECT * INTO k FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF NOT FOUND OR k.status::text IN ('cancelada','encerrada','rascunho','montagem') OR k.remessa_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO e FROM correios_envios WHERE cycle_id = _cycle AND direcao = 'ida'
     AND status NOT IN ('cancelada','erro','expirada') ORDER BY entregue_em DESC NULLS LAST, created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM remessas WHERE id = k.remessa_id;
  v_due := CASE WHEN e.entregue_em IS NOT NULL THEN e.entregue_em + interval '30 days' END;
  v_ator := coalesce(e.criado_por, r.responsavel_user_id);
  IF r.direta THEN
    v_nova := r.id;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('remessa_numero'));
    SELECT coalesce(max(numero),0) + 1 INTO v_num FROM remessas;
    INSERT INTO remessas (numero, praca_id, representante_party_id, origin_location_id, data_emissao, data_acerto, status, observacoes,
                          created_by, tipo_envio, direta, responsavel_user_id)
    VALUES (v_num, r.praca_id, NULL, r.origin_location_id, coalesce(r.data_emissao, current_date),
            coalesce((v_due AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto), 'montagem',
            'Maleta individual pelos Correios (veio da remessa ' || r.numero || ')', v_ator, 'correio', true, v_ator)
    RETURNING id INTO v_nova;
    UPDATE kit_cycles SET remessa_id = v_nova, updated_at = now() WHERE id = _cycle;
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (v_ator, 'maleta.correios_individual', 'kit_cycles', _cycle::text,
            jsonb_build_object('remessa_antiga', r.numero, 'remessa_antiga_id', r.id, 'remessa_nova', v_num, 'remessa_nova_id', v_nova,
                               'due_antes', k.due_at, 'envio', e.id));
  END IF;
  IF v_due IS NOT NULL AND k.status::text NOT IN ('acerto') THEN
    UPDATE kit_cycles SET due_at = v_due, updated_at = now() WHERE id = _cycle AND due_at IS DISTINCT FROM v_due;
    UPDATE remessas SET data_acerto = (v_due AT TIME ZONE 'America/Sao_Paulo')::date, updated_at = now()
     WHERE id = v_nova AND data_acerto IS DISTINCT FROM (v_due AT TIME ZONE 'America/Sao_Paulo')::date;
  END IF;
  RETURN v_nova;
END $$;
REVOKE ALL ON FUNCTION public.correios_maleta_individualizar(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correios_maleta_individualizar(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.zz_correios_individual_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.direcao = 'ida' AND NEW.status IN ('postada','em_transito','entregue') THEN
    BEGIN
      PERFORM public.correios_maleta_individualizar(NEW.cycle_id);
    EXCEPTION WHEN others THEN
      UPDATE correios_envios SET auto_erro = left('individual: ' || SQLERRM, 300) WHERE id = NEW.id;
    END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_correios_individual ON public.correios_envios;
CREATE TRIGGER zz_correios_individual AFTER INSERT OR UPDATE OF status, entregue_em ON public.correios_envios
  FOR EACH ROW EXECUTE FUNCTION public.zz_correios_individual_trg();

DO $$ DECLARE c uuid; BEGIN
  FOR c IN SELECT DISTINCT cycle_id FROM correios_envios WHERE direcao = 'ida' AND status IN ('postada','em_transito','entregue') LOOP
    BEGIN PERFORM public.correios_maleta_individualizar(c);
    EXCEPTION WHEN others THEN RAISE NOTICE 'ciclo %: %', c, SQLERRM; END;
  END LOOP;
END $$;
