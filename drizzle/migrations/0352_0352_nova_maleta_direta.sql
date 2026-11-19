-- 0352 (Diego, 19/11/2026): "Nova maleta" direta, ao lado de "Nova remessa".
-- Sai sem representante intermediário: só consultora, data de acerto (obrigatória) e responsável (colaborador da Lardan).
-- Por baixo continua sendo uma remessa (de uma maleta só), marcada como direta: numeração, documentos, montagem,
-- acerto e finalização seguem o caminho oficial. A praça é a da consultora (as vendas ficam na cidade dela).
ALTER TABLE public.remessas ADD COLUMN IF NOT EXISTS direta boolean NOT NULL DEFAULT false;
ALTER TABLE public.remessas ADD COLUMN IF NOT EXISTS responsavel_user_id uuid;
COMMENT ON COLUMN public.remessas.direta IS '0352: aberta por "Nova maleta" (sem representante; uma maleta)';
COMMENT ON COLUMN public.remessas.responsavel_user_id IS '0352: colaborador da Lardan responsável pela maleta direta';

-- Responsáveis possíveis: equipe ativa (papéis que não são consultora/representante) ou colaboradora com acesso por código ativo.
CREATE OR REPLACE FUNCTION public.maleta_direta_responsaveis()
RETURNS TABLE(user_id uuid, nome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, coalesce(nullif(btrim(p.full_name),''), nullif(btrim(p.display_name),''), 'Colaborador')
  FROM public.profiles p
  WHERE p.is_active
    AND public.can_manage_kits(auth.uid()) AND NOT public.colab_restrita()
    AND (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role NOT IN ('consultora','representante'))
      OR EXISTS (SELECT 1 FROM public.colab_acessos ca WHERE ca.user_id = p.id AND ca.ativo))
  ORDER BY 2;
$$;

-- Busca de consultora em toda a rede (nome por partes, código, CPF), com a praça dela.
CREATE OR REPLACE FUNCTION public.maleta_direta_consultoras(_search text)
RETURNS TABLE(party_id uuid, display_name text, code text, cpf text, praca_id uuid, praca text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT cp.party_id, pa.display_name, pa.code, public.cpf_mascarado(pa.doc), cp.praca_id, pr.nome
  FROM public.consultant_profiles cp
  JOIN public.parties pa ON pa.id = cp.party_id AND pa.status NOT IN ('desligado','bloqueado','rascunho')
  LEFT JOIN public.cob_pracas pr ON pr.id = cp.praca_id
  WHERE public.can_manage_kits(auth.uid()) AND NOT public.colab_restrita()
    AND _search IS NOT NULL AND length(btrim(_search)) >= 2
    AND NOT EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id = pa.id)
    AND public.consultora_termo_casa(pa.id, pa.display_name, pa.code, pa.doc, _search)
  ORDER BY (upper(coalesce(pa.code,'')) = upper(btrim(_search))) DESC, pa.display_name
  LIMIT 30;
$$;

CREATE OR REPLACE FUNCTION public.maleta_direta_abrir(
  _consultora uuid, _data_acerto date, _responsavel uuid, _deposito uuid DEFAULT NULL,
  _praca uuid DEFAULT NULL, _tipo_envio text DEFAULT 'pessoal', _numero integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_praca uuid; v_achou boolean; v_rem jsonb; v_id uuid; v jsonb; v_exist record;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) OR public.colab_restrita() THEN
    RAISE EXCEPTION 'Sem permissão para abrir maleta direta.' USING errcode = '42501';
  END IF;
  IF _consultora IS NULL THEN RAISE EXCEPTION 'Escolha a consultora.'; END IF;
  IF _data_acerto IS NULL THEN RAISE EXCEPTION 'Informe a data de acerto: ela é obrigatória.'; END IF;
  IF _data_acerto < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'A data de acerto não pode ser no passado.'; END IF;
  IF coalesce(_tipo_envio,'pessoal') NOT IN ('pessoal','correio') THEN RAISE EXCEPTION 'Forma de envio inválida.'; END IF;
  IF _responsavel IS NULL OR NOT EXISTS (SELECT 1 FROM public.maleta_direta_responsaveis() r WHERE r.user_id = _responsavel) THEN
    RAISE EXCEPTION 'Escolha o responsável: um colaborador ativo da Lardan.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('maleta_direta:' || _consultora::text));
  -- clique duplo: a mesma maleta direta aberta há instantes pela mesma pessoa volta, sem abrir outra
  SELECT r.id, r.numero, k.id AS cycle_id INTO v_exist
  FROM public.remessas r JOIN public.kit_cycles k ON k.remessa_id = r.id AND k.consultora_party_id = _consultora AND k.status <> 'cancelada'
  WHERE r.direta AND r.created_by = auth.uid() AND r.data_acerto = _data_acerto AND r.status <> 'cancelada'
    AND r.created_at > now() - interval '2 minutes'
  ORDER BY r.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('cycle_id', v_exist.cycle_id, 'remessa_id', v_exist.id, 'remessa_numero', v_exist.numero, 'repetida', true);
  END IF;

  SELECT cp.praca_id, true INTO v_praca, v_achou
  FROM public.consultant_profiles cp JOIN public.parties pa ON pa.id = cp.party_id
  WHERE cp.party_id = _consultora AND pa.status NOT IN ('desligado','bloqueado','rascunho')
  FOR UPDATE OF cp;
  IF v_achou IS NULL THEN RAISE EXCEPTION 'Consultora não encontrada (ou bloqueada/desligada).'; END IF;
  IF EXISTS (SELECT 1 FROM public.party_unificacoes u WHERE u.duplicada_id = _consultora) THEN
    RAISE EXCEPTION 'Este cadastro foi unificado em outro: escolha o cadastro principal.';
  END IF;

  IF v_praca IS NULL THEN
    IF _praca IS NULL THEN RAISE EXCEPTION 'Esta consultora ainda não tem praça: escolha a praça da cidade dela.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cob_pracas WHERE id = _praca AND ativo) THEN RAISE EXCEPTION 'Escolha uma praça ativa.'; END IF;
    UPDATE public.consultant_profiles SET praca_id = _praca WHERE party_id = _consultora AND praca_id IS NULL;
    v_praca := _praca;
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'maleta_direta_praca', 'consultant_profiles', _consultora::text, jsonb_build_object('praca', _praca));
  END IF;

  v_rem := public.remessa_criar(v_praca, _numero, NULL, _data_acerto, NULL, _deposito, 'Maleta direta');
  v_id := (v_rem->>'id')::uuid;
  UPDATE public.remessas SET direta = true, responsavel_user_id = _responsavel WHERE id = v_id;
  IF _tipo_envio = 'correio' THEN PERFORM public.remessa_tipo_envio_definir(v_id, 'correio'); END IF;
  v := public.remessa_abrir_maleta(v_id, _consultora);

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'maleta_direta_abrir', 'remessas', v_id::text,
          jsonb_build_object('numero', (v_rem->>'numero')::int, 'consultora', _consultora, 'cycle', v->>'cycle_id',
                             'responsavel', _responsavel, 'acerto', _data_acerto, 'praca', v_praca));
  RETURN v || jsonb_build_object('remessa_id', v_id, 'remessa_numero', (v_rem->>'numero')::int);
END $$;

REVOKE ALL ON FUNCTION public.maleta_direta_responsaveis() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.maleta_direta_consultoras(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.maleta_direta_abrir(uuid,date,uuid,uuid,uuid,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_direta_responsaveis() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.maleta_direta_consultoras(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.maleta_direta_abrir(uuid,date,uuid,uuid,uuid,text,integer) TO authenticated, service_role;

-- Na lista de remessas, a direta mostra "Maleta direta · Resp. Fulano" no lugar do representante (e a busca acha por isso).
CREATE OR REPLACE FUNCTION pg_temp.trocar(_fn regprocedure, _de text, _para text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d text := pg_get_functiondef(_fn);
BEGIN
  IF position(_para IN d) > 0 THEN RETURN; END IF;
  IF position(_de IN d) = 0 THEN RAISE EXCEPTION '0352: trecho não encontrado em %', _fn; END IF;
  EXECUTE replace(d, _de, _para);
END $f$;
SELECT pg_temp.trocar('public.remessas_lista(text)'::regprocedure,
  'SELECT r.id, r.numero, r.praca_id, p.nome, rp.display_name, r.data_emissao',
  'SELECT r.id, r.numero, r.praca_id, p.nome, coalesce(rp.display_name, (SELECT ''Maleta direta · Resp. '' || coalesce(nullif(btrim(pf.full_name),''''), ''colaborador'') FROM public.remessas rd LEFT JOIN public.profiles pf ON pf.id = rd.responsavel_user_id WHERE rd.id = r.id AND rd.direta)), r.data_emissao');