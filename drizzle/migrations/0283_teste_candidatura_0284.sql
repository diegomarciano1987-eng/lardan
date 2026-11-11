-- 0284: teste de candidatura (documento do Daniel 30/09/2026): link único, 3 partes, cálculo no servidor.
CREATE TABLE public.candidatura_teste_config (
  versao text PRIMARY KEY,
  params jsonb NOT NULL,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.candidatura_teste_config TO authenticated;
GRANT ALL ON public.candidatura_teste_config TO service_role;
ALTER TABLE public.candidatura_teste_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY teste_config_ler ON public.candidatura_teste_config FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'candidaturas.view')));
CREATE POLICY teste_config_master ON public.candidatura_teste_config FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'master'::public.app_role)) AND criado_por = auth.uid());

CREATE TABLE public.candidatura_testes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  origem text NOT NULL CHECK (origem IN ('site','equipe','representante')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  aceite_em timestamptz,
  aceite_texto text,
  parte smallint NOT NULL DEFAULT 1,
  respostas jsonb NOT NULL DEFAULT '{}'::jsonb,
  disc_ordem jsonb,
  disc_respostas jsonb NOT NULL DEFAULT '[]'::jsonb,
  disc_inicio timestamptz,
  disc_fim timestamptz,
  concluido_em timestamptz,
  resultado jsonb,
  versao_teste text,
  rp_ajuste boolean NOT NULL DEFAULT false,
  rp_ajuste_motivo text,
  rp_ajuste_por uuid,
  rp_ajuste_em timestamptz,
  serasa_confere text CHECK (serasa_confere IN ('sim','nao')),
  cancelado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidatura_testes_lead_idx ON public.candidatura_testes (lead_id);
CREATE UNIQUE INDEX candidatura_testes_um_aberto ON public.candidatura_testes (lead_id)
  WHERE concluido_em IS NULL AND cancelado_em IS NULL;
GRANT SELECT ON public.candidatura_testes TO authenticated;
GRANT ALL ON public.candidatura_testes TO service_role;
ALTER TABLE public.candidatura_testes ENABLE ROW LEVEL SECURITY;
CREATE POLICY testes_ler_equipe ON public.candidatura_testes FOR SELECT TO authenticated
  USING ((SELECT public.has_capability(auth.uid(), 'candidaturas.view')));

-- Gera (ou devolve o aberto) link do teste. Equipe com candidaturas.edit ou o representante da candidata.
CREATE OR REPLACE FUNCTION public.candidatura_teste_gerar(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_rep uuid; v_equipe boolean; v_t public.candidatura_testes; v_dias int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sem_sessao'; END IF;
  SELECT representante_party_id INTO v_rep FROM public.leads WHERE id = _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  v_equipe := public.has_capability(v_uid, 'candidaturas.edit') OR public.has_role(v_uid, 'master'::public.app_role);
  IF NOT v_equipe AND NOT (v_rep IS NOT NULL AND public.rep_portal_pode(v_rep)) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;
  SELECT * INTO v_t FROM public.candidatura_testes WHERE lead_id = _lead AND concluido_em IS NULL AND cancelado_em IS NULL FOR UPDATE;
  IF FOUND AND v_t.expira_em > now() THEN
    RETURN jsonb_build_object('token', v_t.token, 'novo', false, 'expira_em', v_t.expira_em);
  END IF;
  IF FOUND THEN UPDATE public.candidatura_testes SET cancelado_em = now(), atualizado_em = now() WHERE id = v_t.id; END IF;
  SELECT coalesce((params->>'validade_dias')::int, 15) INTO v_dias FROM public.candidatura_teste_config ORDER BY criado_em DESC LIMIT 1;
  v_dias := coalesce(v_dias, 15);
  INSERT INTO public.candidatura_testes (lead_id, token, origem, criado_por, expira_em, respostas)
  VALUES (_lead, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          CASE WHEN v_equipe THEN 'equipe' ELSE 'representante' END, v_uid, now() + make_interval(days => v_dias),
          coalesce((SELECT respostas FROM public.candidatura_testes WHERE lead_id = _lead AND cancelado_em IS NOT NULL ORDER BY criado_em DESC LIMIT 1), '{}'::jsonb))
  RETURNING * INTO v_t;
  PERFORM public.crm_log(_lead, 'teste', 'Link do teste de candidatura gerado', NULL, jsonb_build_object('teste', v_t.id, 'origem', v_t.origem));
  UPDATE public.candidatura_assessments SET status = 'enviado', sent_at = now(), updated_at = now()
   WHERE lead_id = _lead AND assessment_type = 'disc' AND status IN ('nao_realizado','cancelado');
  RETURN jsonb_build_object('token', v_t.token, 'novo', true, 'expira_em', v_t.expira_em,
    'concluido_antes', EXISTS (SELECT 1 FROM public.candidatura_testes WHERE lead_id = _lead AND concluido_em IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public.candidatura_teste_gerar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidatura_teste_gerar(uuid) TO authenticated;

-- Site: cria o teste logo depois da candidatura nova (só o servidor chama).
CREATE OR REPLACE FUNCTION public.candidatura_teste_site(_protocolo text, _site jsonb, _aceite text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_lead uuid; v_token text; v_dias int;
BEGIN
  SELECT id INTO v_lead FROM public.leads WHERE protocol = _protocolo;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  IF EXISTS (SELECT 1 FROM public.candidatura_testes WHERE lead_id = v_lead) THEN RETURN NULL; END IF;
  SELECT coalesce((params->>'validade_dias')::int, 15) INTO v_dias FROM public.candidatura_teste_config ORDER BY criado_em DESC LIMIT 1;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.candidatura_testes (lead_id, token, origem, expira_em, aceite_em, aceite_texto, respostas)
  VALUES (v_lead, v_token, 'site', now() + make_interval(days => coalesce(v_dias, 15)), now(), left(_aceite, 400),
          jsonb_strip_nulls(jsonb_build_object('experiencia_venda', _site->>'experiencia_venda', 'horas_semana', _site->>'horas_semana')));
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION public.candidatura_teste_site(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_teste_site(text, jsonb, text) TO service_role;

-- Depois de concluir (só o servidor chama): avaliação concluída, histórico e etapa "Documentação" se ainda no começo do funil.
CREATE OR REPLACE FUNCTION public.candidatura_teste_concluido(_teste uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t public.candidatura_testes; v_from uuid; v_doc uuid;
BEGIN
  SELECT * INTO v_t FROM public.candidatura_testes WHERE id = _teste AND concluido_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'teste_nao_concluido'; END IF;
  IF EXISTS (SELECT 1 FROM public.candidatura_assessments WHERE lead_id = v_t.lead_id AND assessment_type = 'disc') THEN
    UPDATE public.candidatura_assessments SET status = 'concluido', completed_at = v_t.concluido_em, result_reference = v_t.id::text,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('perfil', v_t.resultado->>'disc_perfil', 'versao', v_t.versao_teste), updated_at = now()
     WHERE lead_id = v_t.lead_id AND assessment_type = 'disc';
  ELSE
    INSERT INTO public.candidatura_assessments (lead_id, assessment_type, status, sent_at, completed_at, result_reference, metadata)
    VALUES (v_t.lead_id, 'disc', 'concluido', v_t.criado_em, v_t.concluido_em, v_t.id::text,
            jsonb_build_object('perfil', v_t.resultado->>'disc_perfil', 'versao', v_t.versao_teste));
  END IF;
  PERFORM public.crm_log(v_t.lead_id, 'teste', 'Teste de candidatura concluído', NULL,
    jsonb_build_object('teste', v_t.id, 'perfil', v_t.resultado->>'disc_perfil'), NULL);
  SELECT l.stage_id INTO v_from FROM public.leads l JOIN public.candidatura_stages s ON s.id = l.stage_id
   WHERE l.id = v_t.lead_id AND s.key IN ('nova','primeiro','conversa','perfil') AND l.outcome IS NULL;
  SELECT id INTO v_doc FROM public.candidatura_stages WHERE key = 'documentacao' AND is_active;
  IF v_from IS NOT NULL AND v_doc IS NOT NULL THEN
    UPDATE public.leads SET stage_id = v_doc, stage_entered_at = now(), updated_at = now() WHERE id = v_t.lead_id;
    INSERT INTO public.candidatura_stage_history (lead_id, from_stage_id, to_stage_id, actor_id, note)
    VALUES (v_t.lead_id, v_from, v_doc, NULL, 'Teste de candidatura concluído');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.candidatura_teste_concluido(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_teste_concluido(uuid) TO service_role;

-- Representante: só perfil DISC, rede alta/média/baixa, acompanhamento e o sonho. Nunca risco, restrição ou O1–O5.
CREATE OR REPLACE FUNCTION public.rep_candidata_perfil(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_l public.leads; v_t public.candidatura_testes; v_aberto public.candidatura_testes; v_acomp text;
BEGIN
  SELECT * INTO v_l FROM public.leads WHERE id = _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura_inexistente'; END IF;
  IF NOT (public.has_capability(auth.uid(), 'candidaturas.view')
          OR (v_l.representante_party_id IS NOT NULL AND public.rep_portal_pode(v_l.representante_party_id))) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;
  SELECT * INTO v_t FROM public.candidatura_testes WHERE lead_id = _lead AND concluido_em IS NOT NULL ORDER BY concluido_em DESC LIMIT 1;
  SELECT * INTO v_aberto FROM public.candidatura_testes WHERE lead_id = _lead AND concluido_em IS NULL AND cancelado_em IS NULL AND expira_em > now() LIMIT 1;
  IF v_t.id IS NOT NULL THEN
    SELECT params->'textos'->'acompanhamento'->>(v_t.resultado->>'disc_principal') INTO v_acomp
      FROM public.candidatura_teste_config ORDER BY criado_em DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'sonho', v_l.dream, 'sonho_valor_cents', v_l.dream_value_cents,
    'concluido_em', v_t.concluido_em,
    'disc_perfil', v_t.resultado->>'disc_perfil', 'disc_pct', v_t.resultado->'disc_pct',
    'rede', v_t.resultado->>'rp_faixa', 'acompanhamento', nullif(v_acomp, ''),
    'link_aberto', v_aberto.token, 'link_parte', v_aberto.parte, 'link_criado_em', v_aberto.criado_em);
END $$;
REVOKE ALL ON FUNCTION public.rep_candidata_perfil(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_candidata_perfil(uuid) TO authenticated;
