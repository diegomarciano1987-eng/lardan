DO $ddl$ DECLARE r record; d text; t text; names text[]; BEGIN
 names:=ARRAY['legado_bi_alertas','legado_bi_base','legado_bi_base_total','legado_bi_kpis','legado_bi_painel','legado_bi_top','legado_bi_jornada','legado_bi_praca_categoria','legado_bi_produtos','legado_bi_insights','legado_bi_opcoes','legado_rede_mensal','legado_rede_ranking','legado_remessa_detalhe','legado_remessas_lista','legado_resumo','legado_consultora_dados','legado_consultora_dados_rep','legado_consultora_historico'];
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(names) LOOP
 d:=pg_get_functiondef(r.oid);
 IF r.proname='legado_consultora_historico' THEN
 d:=replace(d,'SELECT representative_party_id INTO v_rep FROM consultant_profiles WHERE party_id = _party;', E'IF public.colab_restrita() AND NOT public.colab_party_ok(_party) THEN RAISE EXCEPTION ''Cadastro fora da carteira.'' USING errcode=''42501''; END IF;\n SELECT representative_party_id INTO v_rep FROM consultant_profiles WHERE party_id = _party;');
 d:=replace(d,'party_id = v_rep OR upper(trim(nome)) = v_nome','party_id = v_rep OR (NOT public.colab_restrita() AND upper(trim(nome)) = v_nome)');
 END IF;
 FOREACH t IN ARRAY ARRAY['legado_acertos_consultora','legado_maleta_categorias','legado_maleta_vendidos','legado_representantes','legado_acertos_praca','legado_consultoras','legado_maleta_status','legado_remessas','legado_maletas','legado_pracas','legado_notas'] LOOP d:=regexp_replace(d,'\m'||t||'\M','colab_v_'||t,'g'); END LOOP;
 IF r.proname='legado_remessas_lista' THEN d:=replace(d,'GROUP BY r.numero, lp.nome, lp.praca_id, lr.nome, lr.party_id','GROUP BY r.numero, r.emissao, r.vencimento, r.status, r.praca, r.representante, lp.nome, lp.praca_id, lr.nome, lr.party_id'); END IF;
 EXECUTE d;
 END LOOP;
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['list_parties','get_party_full','find_party_duplicates','registry_duplicates','registry_counts','search_registry']) LOOP
 d:=pg_get_functiondef(r.oid);
 IF r.proname='get_party_full' THEN d:=replace(d,'ver_doc :=',E'IF NOT public.colab_party_ok(_id) THEN RAISE EXCEPTION ''Cadastro fora da carteira.'' USING errcode=''42501''; END IF;\n ver_doc :='); END IF;
 IF r.proname='registry_counts' THEN d:=replace(d,'SELECT jsonb_build_object(',E'IF public.colab_restrita() THEN RETURN jsonb_build_object(''consultoras'',(SELECT count(*) FROM public.colab_v_consultant_profiles)); END IF;\n SELECT jsonb_build_object('); END IF;
 IF r.proname='search_registry' THEN
 d:=replace(d,'IF public.has_capability(auth.uid(), ''partners.view'') OR public.has_capability(auth.uid(), ''registry.view'') THEN','IF NOT public.colab_restrita() AND (public.has_capability(auth.uid(), ''partners.view'') OR public.has_capability(auth.uid(), ''registry.view'')) THEN');
 d:=replace(d,'IF public.has_capability(auth.uid(), ''stock.view'') OR public.has_capability(auth.uid(), ''registry.view'') THEN','IF NOT public.colab_restrita() AND (public.has_capability(auth.uid(), ''stock.view'') OR public.has_capability(auth.uid(), ''registry.view'')) THEN');
 d:=replace(d,'IF public.has_capability(auth.uid(), ''leads.view'') THEN','IF NOT public.colab_restrita() AND public.has_capability(auth.uid(), ''leads.view'') THEN');
 END IF;
 FOREACH t IN ARRAY ARRAY['consultant_profiles','party_addresses','contact_points','party_roles','party_links','parties'] LOOP d:=regexp_replace(d,'\m'||t||'\M','colab_v_'||t,'g'); END LOOP;
 EXECUTE d;
 END LOOP;
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['praca_consultoras','remessas_lista','remessa_maletas','pracas_resumo']) LOOP
 d:=pg_get_functiondef(r.oid);
 FOREACH t IN ARRAY ARRAY['consultant_profiles','cob_pracas','remessas','kit_cycles'] LOOP d:=regexp_replace(d,'\m'||t||'\M','colab_v_'||t,'g'); END LOOP;
 IF r.proname='pracas_resumo' THEN d:=replace(d,'WHERE public.is_staff(auth.uid())','WHERE public.is_staff(auth.uid()) OR (public.colab_restrita() AND (public.can_view_kits(auth.uid()) OR public.has_capability(auth.uid(),''registry.view'')))'); END IF;
 EXECUTE d;
 END LOOP;
 SELECT pg_get_functiondef('public.network_scope()'::regprocedure) INTO d;
 d:=replace(d,'  if public.has_role(uid,''master'')', E'  if public.colab_restrita() then\n if public.colab_rep() is null then raise exception ''Vincule um representante para consultar a rede.'' using errcode=''42501''; end if;\n if not (public.has_capability(uid,''network.aggregate.view'') or public.has_capability(uid,''partners.view'')) then raise exception ''Sem permissão.'' using errcode=''42501''; end if;\n return jsonb_build_object(''modo'',''representante'',''party_id'',public.colab_rep());\n end if;\n  if public.has_role(uid,''master'')'); EXECUTE d;
 SELECT pg_get_functiondef('public.network_geo_candidaturas(jsonb)'::regprocedure) INTO d;
 d:=replace(d,E'begin\n',E'begin\n if public.colab_restrita() then raise exception ''Candidaturas não disponíveis neste escopo.'' using errcode=''42501''; end if;\n'); EXECUTE d;
 SELECT pg_get_functiondef('public.colab_caps_permitidas()'::regprocedure) INTO d;
 d:=regexp_replace(d,'''stock\.[^'']*'',?\s*','','g'); EXECUTE d;
 SELECT pg_get_functiondef('public.has_capability(uuid,text)'::regprocedure) INTO d;
 d:=replace(d,'AND (EXISTS',E'AND (NOT public.colab_restrita() OR (_cap NOT LIKE ''stock.%'' AND EXISTS(SELECT 1 FROM colab_acessos WHERE user_id=_user_id AND ativo)))\n AND (EXISTS'); EXECUTE d;
END $ddl$;
CREATE OR REPLACE FUNCTION public.kit_scope_all() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT NOT public.colab_restrita() AND (coalesce(public.has_capability(auth.uid(),'kit.view.all'),false) OR coalesce(public.has_capability(auth.uid(),'kit.manage'),false)) $$;
CREATE OR REPLACE FUNCTION public.kit_cycle_in_scope(_cycle_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT EXISTS (SELECT 1 FROM kit_cycles c WHERE c.id=_cycle_id AND CASE WHEN public.colab_restrita() THEN public.colab_cycle_ok(c.id) ELSE public.kit_scope_all() OR (public.my_party_id() IS NOT NULL AND (c.consultora_party_id=public.my_party_id() OR c.representante_party_id=public.my_party_id() OR c.custodian_party_id=public.my_party_id() OR EXISTS(SELECT 1 FROM kit_transfers t WHERE t.cycle_id=c.id AND public.my_party_id() IN(t.from_party_id,t.to_party_id)))) END)
$$;
DO $ddl$ DECLARE t text;p text; BEGIN FOR t,p IN SELECT * FROM (VALUES ('parties','public.colab_party_ok(id)'),('consultant_profiles','public.colab_party_ok(party_id)'),('party_roles','public.colab_party_ok(party_id)'),('contact_points','public.colab_party_ok(party_id)'),('party_addresses','public.colab_party_ok(party_id)'),('party_links','NOT public.colab_restrita()'),('remessas','public.colab_rem_ok(id)'),('cob_pracas','public.colab_praca_ok(id)'),('kit_cycles','public.colab_cycle_ok(id)'),('suppliers','NOT public.colab_restrita()'),('business_entities','NOT public.colab_restrita()'),('locations','NOT public.colab_restrita()')) s(tab,pred) LOOP EXECUTE format('CREATE POLICY colab_carteira_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',t,p,p); END LOOP; END $ddl$;
CREATE OR REPLACE FUNCTION public.colab_operacao_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF public.colab_restrita() THEN IF TG_TABLE_NAME='remessas' THEN IF NEW.representante_party_id IS DISTINCT FROM public.colab_rep() OR NOT public.colab_praca_ok(NEW.praca_id) THEN RAISE EXCEPTION 'Remessa fora da carteira.' USING errcode='42501'; END IF; ELSIF TG_TABLE_NAME='kit_cycles' THEN IF NEW.representante_party_id IS DISTINCT FROM public.colab_rep() OR (NEW.consultora_party_id IS NOT NULL AND NOT public.colab_party_ok(NEW.consultora_party_id)) THEN RAISE EXCEPTION 'Maleta fora da carteira.' USING errcode='42501'; END IF; END IF; END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.colab_operacao_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER colab_carteira_guard BEFORE INSERT OR UPDATE ON public.remessas FOR EACH ROW EXECUTE FUNCTION public.colab_operacao_guard();
CREATE TRIGGER colab_carteira_guard BEFORE INSERT OR UPDATE ON public.kit_cycles FOR EACH ROW EXECUTE FUNCTION public.colab_operacao_guard();