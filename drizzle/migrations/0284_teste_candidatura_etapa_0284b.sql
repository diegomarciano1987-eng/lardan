-- 0284b: candidatura em aberto tem outcome 'aberta' (não NULL): conclusão do teste só move as abertas no começo do funil.
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
   WHERE l.id = v_t.lead_id AND s.key IN ('nova','primeiro','conversa','perfil') AND coalesce(l.outcome, 'aberta') = 'aberta';
  SELECT id INTO v_doc FROM public.candidatura_stages WHERE key = 'documentacao' AND is_active;
  IF v_from IS NOT NULL AND v_doc IS NOT NULL THEN
    UPDATE public.leads SET stage_id = v_doc, stage_entered_at = now(), updated_at = now() WHERE id = v_t.lead_id;
    INSERT INTO public.candidatura_stage_history (lead_id, from_stage_id, to_stage_id, actor_id, note)
    VALUES (v_t.lead_id, v_from, v_doc, NULL, 'Teste de candidatura concluído');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.candidatura_teste_concluido(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidatura_teste_concluido(uuid) TO service_role;
