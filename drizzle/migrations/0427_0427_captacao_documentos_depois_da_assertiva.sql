-- 0427 — Documentos só depois da Assertiva (Diego, 28/11): "se a pessoa não estiver dentro dos parâmetros,
-- pra que pedir documentos e incomodar a candidata?"
--   • Concluir o teste NÃO cria mais o link dos documentos (sai a regra da 0416/0412).
--   • Teste + crédito dentro da regra (pré-aprovada) → link na hora (tela final do teste + Lara) → aprova sozinha com as fotos.
--   • Análise → nenhum pedido automático. A equipe (Daniel) ou o representante dela pede os documentos só se for seguir.
--     O representante só pede quando o crédito está dentro da regra (o mesmo limite de quem pode aprovar).
--   • Links já criados para quem caiu na Análise e não mandou nada são encerrados (a equipe pede de novo se quiser).
-- A trava da aprovação (teste + Assertiva + documentos) continua igual. Nada é apagado. Roda duas vezes sem erro.

-- 1. Concluir o teste não gera mais o link
DROP TRIGGER IF EXISTS zz_captacao_teste_documentos ON public.candidatura_testes;
DROP TRIGGER IF EXISTS zz_captacao_teste_documentos_ins ON public.candidatura_testes;

-- 2. A decisão só cria o link para a pré-aprovada
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.captacao_decidir(uuid)'::regprocedure); antes := def;
  IF position('0427' IN def) = 0 THEN
    def := replace(def, $a$    IF NOT v_docs THEN
      PERFORM public.candidatura_documentos_link_garantir(_lead);
      IF v_dec = 'aprovada_automatica' THEN PERFORM public.lara_pre_aprovada(_lead); END IF;
    END IF;$a$, $b$    -- 0427: documentos só para quem passou na regra; na Análise uma pessoa decide se pede
    IF NOT v_docs AND v_dec = 'aprovada_automatica' THEN
      PERFORM public.candidatura_documentos_link_garantir(_lead);
      PERFORM public.lara_pre_aprovada(_lead);
    END IF;$b$);
    IF def = antes THEN RAISE EXCEPTION '0427: ponto não encontrado em captacao_decidir'; END IF;
    EXECUTE def;
  END IF;
END $do$;

-- 3. Equipe pede os documentos: só depois da consulta (ou para quem já está aprovada)
CREATE OR REPLACE FUNCTION public.candidatura_documentos_link_gerar(_lead uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tok text;
BEGIN
  PERFORM public.crm_require('candidaturas.edit');
  IF NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = _lead AND l.archived_at IS NULL AND (l.outcome = 'ganha'
                 OR (l.outcome = 'aberta' AND EXISTS (SELECT 1 FROM candidatura_credito_consultas c WHERE c.lead_id = l.id AND c.situacao <> 'erro'))))
  THEN
    RAISE EXCEPTION 'Os documentos só são pedidos depois da consulta na Assertiva.';
  END IF;
  v_tok := public.candidatura_documentos_link_garantir(_lead);
  PERFORM public.crm_log(_lead, 'documentos', 'Documentos pedidos pela equipe', NULL, '{}'::jsonb, NULL);
  RETURN v_tok;
END $$;
REVOKE ALL ON FUNCTION public.candidatura_documentos_link_gerar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidatura_documentos_link_gerar(uuid) TO authenticated;

-- 4. Representante pede os documentos da candidata dele (crédito dentro da regra)
CREATE OR REPLACE FUNCTION public.rep_candidata_pedir_documentos(_rep uuid, _lead uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l leads; c candidatura_credito_consultas; v_tok text;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.' USING errcode = '42501'; END IF;
  SELECT * INTO l FROM leads WHERE id = _lead;
  IF l.id IS NULL OR l.representante_party_id IS DISTINCT FROM _rep THEN RAISE EXCEPTION 'Esta candidata não é sua.'; END IF;
  IF l.outcome <> 'aberta' OR l.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Esta candidatura não está mais aberta.'; END IF;
  SELECT * INTO c FROM candidatura_credito_consultas WHERE lead_id = _lead AND situacao <> 'erro' ORDER BY consultado_em DESC LIMIT 1;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Os documentos só são pedidos depois da consulta na Assertiva.'; END IF;
  IF c.situacao IS DISTINCT FROM 'ok' OR c.resultado IS DISTINCT FROM 'aprovada_regra' THEN
    RAISE EXCEPTION 'O crédito dela ficou fora da regra: a Lardan (Daniel) decide se pede os documentos.';
  END IF;
  v_tok := public.candidatura_documentos_link_garantir(_lead);
  PERFORM public.crm_log(_lead, 'documentos', 'Documentos pedidos pelo representante', NULL, jsonb_build_object('representante', _rep), NULL);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'captacao.documentos_pedidos_representante', 'leads', _lead::text, jsonb_build_object('representante', _rep));
  RETURN v_tok;
END $$;
REVOKE ALL ON FUNCTION public.rep_candidata_pedir_documentos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_candidata_pedir_documentos(uuid, uuid) TO authenticated;

-- 5. Situação no app do representante: avisa quando ele pode pedir os documentos
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.rep_candidata_situacao(uuid,uuid)'::regprocedure); antes := def;
  IF position('pode_pedir_documentos' IN def) = 0 THEN
    def := replace(def, $a$    'pode_aprovar', v_sit IN ('analise', 'documentos') AND cardinality(falta) = 0 AND v_credito = 'dentro' AND l.outcome = 'aberta');$a$,
      $b$    'pode_aprovar', v_sit IN ('analise', 'documentos') AND cardinality(falta) = 0 AND v_credito = 'dentro' AND l.outcome = 'aberta',
    'pode_pedir_documentos', v_sit = 'analise' AND v_credito = 'dentro' AND l.outcome = 'aberta' AND dl.finalizado_em IS NULL
                              AND (dl.token IS NULL OR dl.expira_em <= now()));$b$);
    IF def = antes THEN RAISE EXCEPTION '0427: ponto não encontrado em rep_candidata_situacao'; END IF;
    EXECUTE def;
  END IF;
END $do$;

-- 6. Links criados antes desta regra para quem está na Análise (ou ainda sem decisão) e não mandou nada: encerrados agora
UPDATE public.candidatura_documentos_link k SET expira_em = now()
 WHERE k.finalizado_em IS NULL AND k.expira_em > now()
   AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = k.lead_id AND l.outcome = 'aberta')
   AND NOT EXISTS (SELECT 1 FROM public.candidatura_documentos d WHERE d.lead_id = k.lead_id)
   AND coalesce((SELECT d.decisao FROM public.captacao_decisoes d WHERE d.lead_id = k.lead_id ORDER BY d.decidido_em DESC LIMIT 1), '') <> 'aprovada_automatica';