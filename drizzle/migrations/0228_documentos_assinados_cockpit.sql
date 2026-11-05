ALTER TABLE public.assinaturas_digitais DROP CONSTRAINT IF EXISTS assinaturas_digitais_tipo_check;
ALTER TABLE public.assinaturas_digitais ADD CONSTRAINT assinaturas_digitais_tipo_check CHECK (tipo IN ('contrato', 'promissoria', 'avulso'));
ALTER TABLE public.assinaturas_digitais ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'lardan';
ALTER TABLE public.assinaturas_digitais DROP CONSTRAINT IF EXISTS assinaturas_digitais_origem_check;
ALTER TABLE public.assinaturas_digitais ADD CONSTRAINT assinaturas_digitais_origem_check CHECK (origem IN ('lardan', 'zapsign_painel'));
ALTER TABLE public.assinaturas_digitais ADD COLUMN IF NOT EXISTS arquivo_path text;
ALTER TABLE public.assinaturas_digitais ADD COLUMN IF NOT EXISTS arquivo_sha256 text;
ALTER TABLE public.assinaturas_digitais ADD COLUMN IF NOT EXISTS assinante_nome text;
-- Bucket privado criado pela API de armazenamento; sem acesso direto do navegador.
CREATE OR REPLACE FUNCTION public.party_por_assinante(_cpf text, _fone text, _email text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c text := regexp_replace(coalesce(_cpf, ''), '\D', '', 'g'); f text := right(regexp_replace(coalesce(_fone, ''), '\D', '', 'g'), 11); e text := lower(btrim(coalesce(_email, ''))); ids uuid[];
BEGIN
 PERFORM public.fiscal_focus_exigir_servidor();
 IF length(c) = 11 THEN
 SELECT array_agg(id) INTO ids FROM parties WHERE doc_digits = c AND is_active;
 IF array_length(ids, 1) = 1 THEN RETURN ids[1]; END IF;
 IF array_length(ids, 1) > 1 THEN RETURN NULL; END IF;
 END IF;
 IF length(f) >= 10 THEN
 SELECT array_agg(DISTINCT party_id) INTO ids FROM contact_points WHERE kind IN ('whatsapp', 'telefone') AND right(regexp_replace(value, '\D', '', 'g'), length(f)) = f;
 IF array_length(ids, 1) = 1 THEN RETURN ids[1]; END IF;
 IF array_length(ids, 1) > 1 THEN RETURN NULL; END IF;
 END IF;
 IF e LIKE '%@%' THEN
 SELECT array_agg(DISTINCT party_id) INTO ids FROM contact_points WHERE kind = 'email' AND lower(btrim(value)) = e;
 IF array_length(ids, 1) = 1 THEN RETURN ids[1]; END IF;
 IF array_length(ids, 1) > 1 THEN RETURN NULL; END IF;
 END IF;
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.party_por_assinante(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_por_assinante(text, text, text) TO service_role;
-- Mantém a trava de contrato/promissória, não limita documentos avulsos.
DROP INDEX IF EXISTS public.assinaturas_pendente_unica;
CREATE UNIQUE INDEX assinaturas_pendente_unica ON public.assinaturas_digitais (party_id, tipo, coalesce(cycle_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'pendente' AND tipo IN ('contrato', 'promissoria');
CREATE OR REPLACE FUNCTION public.assinatura_avulsa_registrar(_d jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE novo uuid; st text;
BEGIN
 PERFORM public.fiscal_focus_exigir_servidor();
 st := CASE _d->>'status' WHEN 'signed' THEN 'assinado' WHEN 'refused' THEN 'recusado' WHEN 'deleted' THEN 'cancelado' ELSE 'pendente' END;
 INSERT INTO assinaturas_digitais (ambiente, tipo, origem, party_id, doc_token, signer_token, status, titulo, texto_hash, assinante_nome, assinado_em, criado_em)
 VALUES (_d->>'ambiente', 'avulso', 'zapsign_painel', (_d->>'party_id')::uuid, _d->>'doc_token', _d->>'signer_token', st, left(coalesce(_d->>'titulo', 'Documento ZapSign'), 250), 'zapsign:' || (_d->>'doc_token'), _d->>'assinante', CASE WHEN st = 'assinado' THEN nullif(_d->>'assinado_em', '')::timestamptz END, coalesce(nullif(_d->>'criado_em', '')::timestamptz, now()))
 ON CONFLICT (doc_token) DO UPDATE SET status = CASE WHEN assinaturas_digitais.status = 'assinado' THEN 'assinado' ELSE excluded.status END, assinado_em = coalesce(assinaturas_digitais.assinado_em, excluded.assinado_em), atualizado_em = now()
 RETURNING id INTO novo;
 RETURN jsonb_build_object('id', novo, 'status', st);
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_avulsa_registrar(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_avulsa_registrar(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.assinatura_arquivo_salvar(_doc_token text, _path text, _sha text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
 PERFORM public.fiscal_focus_exigir_servidor();
 IF NOT EXISTS (SELECT 1 FROM assinaturas_digitais WHERE doc_token = _doc_token AND _path = party_id::text || '/' || doc_token || '.pdf') THEN RAISE EXCEPTION 'Caminho inválido.' USING errcode = '22023'; END IF;
 UPDATE assinaturas_digitais SET arquivo_path = _path, arquivo_sha256 = _sha, atualizado_em = now() WHERE doc_token = _doc_token AND arquivo_path IS NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_arquivo_salvar(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_arquivo_salvar(text, text, text) TO service_role;
CREATE OR REPLACE FUNCTION public.documentos_pode_ver(_party uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT auth.uid() IS NOT NULL AND public.colab_party_ok(_party) AND (public.assinatura_pode(_party, public.my_party_id()) OR public.has_capability(auth.uid(), 'registry.view') OR public.has_capability(auth.uid(), 'finance.view'))
$$;
REVOKE ALL ON FUNCTION public.documentos_pode_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.documentos_pode_ver(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.documentos_assinados_da_pessoa(_party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
 IF NOT public.documentos_pode_ver(_party) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'data' DESC) FROM (
 SELECT jsonb_build_object('fonte', 'zapsign', 'id', a.id, 'tipo', a.tipo, 'origem', a.origem, 'titulo', a.titulo, 'status', a.status, 'ambiente', a.ambiente, 'maleta', k.code, 'valor_cents', a.valor_cents, 'assinante', a.assinante_nome, 'data', coalesce(a.assinado_em, a.criado_em), 'criado_em', a.criado_em, 'assinado_em', a.assinado_em, 'tem_copia', a.arquivo_path IS NOT NULL, 'sign_url', CASE WHEN a.status = 'pendente' THEN a.sign_url END) x
 FROM assinaturas_digitais a LEFT JOIN kit_cycles kc ON kc.id = a.cycle_id LEFT JOIN kits k ON k.id = kc.kit_id WHERE a.party_id = _party
 UNION ALL
 SELECT jsonb_build_object('fonte', 'clicksign', 'id', s.id, 'tipo', 'termo_maleta', 'origem', 'lardan', 'titulo', 'Termo de recebimento da maleta' || coalesce(' ' || k.code, ''), 'status', CASE s.estado WHEN 'finalizado' THEN 'assinado' WHEN 'assinado' THEN 'assinado' WHEN 'recusado' THEN 'recusado' WHEN 'cancelado' THEN 'cancelado' WHEN 'expirado' THEN 'cancelado' WHEN 'falha' THEN 'erro' ELSE 'pendente' END, 'ambiente', s.modo, 'maleta', k.code, 'valor_cents', NULL, 'assinante', NULL, 'data', coalesce(s.finalizado_em, s.assinado_em, s.created_at), 'criado_em', s.created_at, 'assinado_em', coalesce(s.finalizado_em, s.assinado_em), 'tem_copia', s.signed_path IS NOT NULL, 'sign_url', NULL)
 FROM kit_signature_requests s JOIN kit_cycles kc ON kc.id = s.cycle_id LEFT JOIN kits k ON k.id = kc.kit_id WHERE s.consultora_party_id = _party) t(x)), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.documentos_assinados_da_pessoa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.documentos_assinados_da_pessoa(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.assinaturas_sem_copia(_limite int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
 PERFORM public.fiscal_focus_exigir_servidor();
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('doc_token', doc_token, 'party_id', party_id)) FROM (SELECT doc_token, party_id FROM assinaturas_digitais WHERE status = 'assinado' AND arquivo_path IS NULL AND doc_token IS NOT NULL ORDER BY assinado_em NULLS LAST LIMIT least(greatest(coalesce(_limite, 20), 1), 100)) x), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.assinaturas_sem_copia(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinaturas_sem_copia(int) TO service_role;
CREATE OR REPLACE FUNCTION public.assinatura_ler_por_token(_doc_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
 PERFORM public.fiscal_focus_exigir_servidor();
 RETURN (SELECT to_jsonb(x) FROM assinaturas_digitais x WHERE x.doc_token = _doc_token);
END $fn$;
REVOKE ALL ON FUNCTION public.assinatura_ler_por_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_ler_por_token(text) TO service_role;