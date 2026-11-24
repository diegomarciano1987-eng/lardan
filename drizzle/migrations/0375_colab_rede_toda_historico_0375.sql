CREATE OR REPLACE FUNCTION public.consultora_aneis_tamanhos(_party uuid)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  IF _party IS DISTINCT FROM public.my_party_id() THEN
    IF NOT (((public.is_staff(uid) OR public.colab_conta())
              AND (public.legado_pode_ver(uid) OR public.can_view_kits(uid) OR public.has_capability(uid, 'registry.view')))
            OR (public.has_role(uid, 'representante') AND EXISTS (SELECT 1 FROM consultant_profiles cp
                  WHERE cp.party_id = _party AND cp.representative_party_id = public.my_party_id()))) THEN
      RAISE EXCEPTION 'Sem permissão para ver as vendas desta consultora.' USING errcode = '42501';
    END IF;
    IF public.colab_conta() AND NOT (public.has_capability(uid, 'kit.manage') OR public.colab_rede_toda() OR public.colab_party_ok(_party)) THEN
      RAISE EXCEPTION 'Cadastro fora da carteira.' USING errcode = '42501';
    END IF;
  END IF;
  RETURN public.consultora_aneis_tamanhos_dados(_party);
END $function$;

CREATE OR REPLACE FUNCTION public.consultora_banhos_categoria(_party uuid)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode = '42501'; END IF;
  IF _party IS DISTINCT FROM public.my_party_id() THEN
    IF NOT (((public.is_staff(uid) OR public.colab_conta())
              AND (public.legado_pode_ver(uid) OR public.can_view_kits(uid) OR public.has_capability(uid, 'registry.view')))
            OR (public.has_role(uid, 'representante') AND EXISTS (SELECT 1 FROM consultant_profiles cp
                  WHERE cp.party_id = _party AND cp.representative_party_id = public.my_party_id()))) THEN
      RAISE EXCEPTION 'Sem permissão para ver as vendas desta consultora.' USING errcode = '42501';
    END IF;
    IF public.colab_conta() AND NOT (public.has_capability(uid, 'kit.manage') OR public.colab_rede_toda() OR public.colab_party_ok(_party)) THEN
      RAISE EXCEPTION 'Cadastro fora da carteira.' USING errcode = '42501';
    END IF;
  END IF;
  RETURN public.consultora_banhos_dados(_party);
END $function$;

CREATE OR REPLACE FUNCTION public.legado_consultora_historico(_party uuid)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cods int[]; v_rep uuid; v_nome text; v_rep_nome text; v_reps int[]; v_rems int[];
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para ver o histórico.' USING errcode = '42501'; END IF;
  -- Montagem (kit.manage) ou rede toda liberada: histórico SmallData completo da rede, só leitura.
  IF public.colab_conta() AND (public.has_capability(auth.uid(), 'kit.manage') OR public.colab_rede_toda()) THEN
    SELECT array_agg(codcli ORDER BY codcli) INTO cods FROM legado_consultoras WHERE party_id = _party;
    IF cods IS NULL THEN RETURN jsonb_build_object('vinculada', false); END IF;
    RETURN public.legado_consultora_dados_rede(cods) || jsonb_build_object('vinculada', true);
  END IF;
  SELECT array_agg(codcli ORDER BY codcli) INTO cods FROM colab_v_legado_consultoras WHERE party_id = _party;
  IF cods IS NULL THEN RETURN jsonb_build_object('vinculada', false); END IF;
  IF public.colab_restrita() AND NOT public.colab_party_ok(_party) THEN RAISE EXCEPTION 'Cadastro fora da carteira.' USING errcode='42501'; END IF;
  SELECT representative_party_id INTO v_rep FROM consultant_profiles WHERE party_id = _party;
  IF v_rep IS NULL THEN
    RETURN public.legado_consultora_dados(cods) || jsonb_build_object('vinculada', true);
  END IF;
  SELECT display_name, upper(trim(display_name)) INTO v_rep_nome, v_nome FROM parties WHERE id = v_rep;
  SELECT array_agg(codigo) INTO v_reps FROM colab_v_legado_representantes WHERE party_id = v_rep OR (NOT public.colab_restrita() AND upper(trim(nome)) = v_nome);
  SELECT coalesce(array_agg(DISTINCT m.remessa), '{}') INTO v_rems
    FROM colab_v_legado_maletas m JOIN colab_v_legado_remessas r ON r.numero = m.remessa
   WHERE m.codcli = ANY (cods) AND r.representante = ANY (coalesce(v_reps, '{}'));
  RETURN public.legado_consultora_dados_rep(cods, v_rems) || jsonb_build_object('vinculada', true,
    'filtro_representante', jsonb_build_object('party_id', v_rep, 'nome', v_rep_nome, 'codigos', to_jsonb(coalesce(v_reps, '{}')),
      'remessas', cardinality(v_rems),
      'remessas_total', (SELECT count(DISTINCT remessa) FROM colab_v_legado_maletas WHERE codcli = ANY (cods))));
END $function$;