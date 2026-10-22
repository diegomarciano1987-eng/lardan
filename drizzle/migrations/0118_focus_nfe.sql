-- ============================================================================
-- 0118 — Focus NFe: envios, retorno e testes em homologação
--        + nome "SmallData" em todo texto que aparece para o usuário
--
-- Focus:
--   * fiscal_focus_envios guarda cada NF-e enviada à Focus (referência única,
--     ambiente, operação, conteúdo enviado, retorno da SEFAZ, chave, número,
--     série, caminhos do XML e do DANFE). Sem acesso direto do navegador.
--   * Só o servidor grava (service_role): o usuário pede pela tela, o servidor
--     confere a permissão, chama a Focus e registra o retorno. O aviso da Focus
--     (webhook) passa pela mesma rotina de retorno.
--   * Nesta rodada a emissão é SÓ EM HOMOLOGAÇÃO (sem valor fiscal): remessa,
--     devolução, venda e perda de teste, com consultora e peças reais do
--     cadastro, para validar token, certificado e o roteiro com a SEFAZ.
--     Produção depende da cadeia fiscal (db/pendentes 01/02/04/06/11).
-- ============================================================================

-- ------------------------------------------------- textos: SmallData ---
DO $ren$
DECLARE f record; def text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosrc LIKE '%JFLEX%'
              AND p.proname IN ('remessa_criar', 'legado_exigir_importador', 'legado_consultoras_cadastrar')
  LOOP
    def := pg_get_functiondef(f.oid);
    EXECUTE replace(def, 'JFLEX', 'SmallData');
  END LOOP;
END $ren$;
UPDATE public.parties SET notes = replace(notes, 'histórico JFLEX', 'histórico SmallData')
 WHERE notes LIKE 'Cadastrada a partir do histórico JFLEX%';
UPDATE public.party_roles SET notes = 'Histórico SmallData' WHERE notes = 'Histórico JFLEX';
UPDATE public.fiscal_roteiro_referencia SET fonte = replace(fonte, 'JFLEX', 'SmallData') WHERE fonte LIKE '%JFLEX%';
COMMENT ON TABLE public.legado_maletas IS 'Histórico do SmallData (só leitura). Valores em varejo; a nota fiscal saiu a 1/3. Venda = enviadas − devolvidas, válida só com fechamento.';

-- ------------------------------------------------------------ envios ---
CREATE TABLE IF NOT EXISTS public.fiscal_focus_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL UNIQUE CHECK (ref ~ '^[A-Za-z0-9_-]{6,60}$'),
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao', 'producao')),
  operacao text NOT NULL CHECK (operacao IN ('remessa', 'devolucao', 'venda', 'perda')),
  teste boolean NOT NULL DEFAULT true,
  ref_origem text REFERENCES public.fiscal_focus_envios(ref),     -- devolução/venda/perda apontam a remessa
  party_id uuid REFERENCES public.parties(id),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'processando_autorizacao', 'autorizado', 'erro_autorizacao', 'denegado', 'cancelado', 'erro_envio')),
  status_sefaz text, mensagem_sefaz text, erros jsonb,
  chave_nfe text CHECK (chave_nfe IS NULL OR chave_nfe ~ '^\d{44}$'),
  numero text, serie text, caminho_xml text, caminho_danfe text, caminho_xml_cancelamento text,
  tentativas int NOT NULL DEFAULT 0,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiscal_focus_envios_criado_idx ON public.fiscal_focus_envios (created_at DESC);
ALTER TABLE public.fiscal_focus_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_focus_envios FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fiscal_focus_envios TO service_role;

CREATE TABLE IF NOT EXISTS public.fiscal_focus_eventos (
  id bigserial PRIMARY KEY,
  ref text NOT NULL,
  fonte text NOT NULL CHECK (fonte IN ('envio', 'consulta', 'webhook', 'cancelamento')),
  dedupe text UNIQUE,
  resposta jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiscal_focus_eventos_ref_idx ON public.fiscal_focus_eventos (ref);
ALTER TABLE public.fiscal_focus_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_focus_eventos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fiscal_focus_eventos TO service_role;

-- Só o servidor (service_role, sem usuário).
CREATE OR REPLACE FUNCTION public.fiscal_focus_exigir_servidor()
RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' AND auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Somente servidor.' USING errcode = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_focus_exigir_servidor() FROM PUBLIC, anon, authenticated;

-- Quem pode: emitir/cancelar teste = Master; ver = Master, diretoria e financeiro.
CREATE OR REPLACE FUNCTION public.fiscal_focus_pode(_acao text DEFAULT 'ver')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND CASE
    WHEN _acao = 'ver' THEN public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro']::public.app_role[])
    ELSE public.has_any_role(auth.uid(), ARRAY['master']::public.app_role[]) END
$$;
REVOKE ALL ON FUNCTION public.fiscal_focus_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_pode(text) TO authenticated;

-- CNPJ do emissor configurado em fiscal_settings (ou NULL).
CREATE OR REPLACE FUNCTION public.fiscal_focus_emitente()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('cnpj', regexp_replace(coalesce(b.tax_id, ''), '\D', '', 'g'), 'nome', b.legal_name,
                            'ie', b.state_registration, 'uf', b.uf, 'ambiente', s.environment, 'ativo', s.emission_active)
    FROM fiscal_settings s LEFT JOIN business_entities b ON b.id = s.emitter_entity_id
   WHERE s.id AND public.fiscal_focus_pode('ver')
$$;
REVOKE ALL ON FUNCTION public.fiscal_focus_emitente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_emitente() TO authenticated;

-- Dados fiscais de uma consultora e de peças do cadastro, para montar a nota.
-- _itens: [{"variant_id": uuid, "quantidade": int}]. Devolve pendências em vez de falhar.
CREATE OR REPLACE FUNCTION public.fiscal_focus_dados(_party uuid, _itens jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p record; a record; pend text[] := '{}'; itens jsonb; email text; fone text;
BEGIN
  IF NOT public.fiscal_focus_pode('emitir') THEN RAISE EXCEPTION 'Só o Master.' USING errcode = '42501'; END IF;
  _itens := coalesce(_itens, '[]'::jsonb);   -- sem peças: só os dados da destinatária
  IF jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) > 60 THEN
    RAISE EXCEPTION 'Informe até 60 peças.';
  END IF;
  SELECT * INTO p FROM parties WHERE id = _party;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não encontrada.'; END IF;
  SELECT * INTO a FROM party_addresses WHERE party_id = _party ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT value INTO email FROM contact_points WHERE party_id = _party AND kind = 'email' ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT regexp_replace(value, '\D', '', 'g') INTO fone FROM contact_points WHERE party_id = _party AND kind IN ('whatsapp', 'telefone')
   ORDER BY is_primary DESC, created_at LIMIT 1;

  IF p.doc_digits IS NULL OR length(p.doc_digits) <> 11 OR NOT public.doc_is_valid(public.doc_canon(p.doc_digits)) THEN pend := array_append(pend, 'CPF inválido ou ausente'::text); END IF;
  IF a.id IS NULL THEN pend := array_append(pend, 'sem endereço'::text);
  ELSE
    IF coalesce(btrim(a.street), '') = '' THEN pend := array_append(pend, 'endereço sem rua'::text); END IF;
    IF coalesce(btrim(a.district), '') = '' THEN pend := array_append(pend, 'endereço sem bairro'::text); END IF;
    IF a.ibge_city_code IS NULL OR a.ibge_city_code !~ '^\d{7}$' THEN pend := array_append(pend, 'cidade sem código IBGE'::text); END IF;
    IF coalesce(regexp_replace(a.postal_code, '\D', '', 'g'), '') !~ '^\d{8}$' THEN pend := array_append(pend, 'CEP inválido'::text); END IF;
    IF a.uf IS NULL THEN pend := array_append(pend, 'endereço sem UF'::text); END IF;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'variant_id', v.id,
           'codigo', coalesce(nullif(v.sku, ''), nullif(v.reference_code, ''), nullif(pr.internal_code, ''), left(v.id::text, 8)),
           'descricao', btrim(pr.name || coalesce(' ' || nullif(v.label, ''), '')),
           'ncm', coalesce(nullif(regexp_replace(coalesce(v.ncm, pr.ncm, ''), '\D', '', 'g'), ''), '71171900'),
           'quantidade', (i->>'quantidade')::int,
           'preco_varejo_cents', coalesce(nullif(v.price_cents, 0), pr.price_cents))
         ORDER BY ord)
    INTO itens
    FROM jsonb_array_elements(_itens) WITH ORDINALITY AS t(i, ord)
    JOIN product_variants v ON v.id = (i->>'variant_id')::uuid
    JOIN products pr ON pr.id = v.product_id;
  itens := coalesce(itens, '[]'::jsonb);
  IF jsonb_array_length(itens) <> jsonb_array_length(_itens) THEN RAISE EXCEPTION 'Peça não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(itens) x WHERE coalesce((x->>'quantidade')::int, 0) < 1) THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(itens) x WHERE coalesce((x->>'preco_varejo_cents')::bigint, 0) <= 0) THEN
    pend := array_append(pend, 'peça sem preço de varejo'::text);
  END IF;

  RETURN jsonb_build_object(
    'destinatario', jsonb_build_object(
       'party_id', p.id, 'nome', p.display_name, 'cpf', p.doc_digits,
       'logradouro', a.street, 'numero', coalesce(nullif(btrim(a.street_number), ''), 'S/N'), 'complemento', a.complement,
       'bairro', a.district, 'municipio', a.city, 'uf', a.uf, 'cep', regexp_replace(coalesce(a.postal_code, ''), '\D', '', 'g'),
       'codigo_municipio', a.ibge_city_code, 'email', email, 'telefone', fone),
    'itens', itens,
    'pendencias', to_jsonb(pend));
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_dados(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_dados(uuid,jsonb) TO authenticated;

-- Servidor registra o envio (antes de chamar a Focus).
CREATE OR REPLACE FUNCTION public.fiscal_focus_envio_registrar(_ref text, _ambiente text, _operacao text, _ref_origem text,
  _party uuid, _payload jsonb, _ator uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE e record;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF _ambiente <> 'homologacao' THEN RAISE EXCEPTION 'Nesta versão só há emissão em homologação.'; END IF;
  IF _ref_origem IS NOT NULL THEN
    SELECT * INTO e FROM fiscal_focus_envios WHERE ref = _ref_origem;
    IF NOT FOUND OR e.operacao <> 'remessa' OR e.status <> 'autorizado' THEN
      RAISE EXCEPTION 'A nota de origem precisa ser uma remessa autorizada.';
    END IF;
  ELSIF _operacao <> 'remessa' THEN
    RAISE EXCEPTION 'Devolução, venda e perda precisam da remessa de origem.';
  END IF;
  INSERT INTO fiscal_focus_envios (ref, ambiente, operacao, teste, ref_origem, party_id, payload, criado_por)
  VALUES (_ref, _ambiente, _operacao, true, _ref_origem, _party, _payload, _ator);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_ator, 'fiscal.focus_envio', 'fiscal_focus_envios', _ref,
          jsonb_build_object('ambiente', _ambiente, 'operacao', _operacao, 'ref_origem', _ref_origem));
  RETURN jsonb_build_object('ref', _ref);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_envio_registrar(text,text,text,text,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_envio_registrar(text,text,text,text,uuid,jsonb,uuid) TO service_role;

-- Retorno da Focus (resposta do envio, consulta, aviso ou cancelamento). Idempotente.
CREATE OR REPLACE FUNCTION public.fiscal_focus_retorno(_ref text, _fonte text, _resposta jsonb, _dedupe text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE e record; st text; chave text;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  SELECT * INTO e FROM fiscal_focus_envios WHERE ref = _ref FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ignorado', true, 'motivo', 'referência desconhecida'); END IF;
  IF _dedupe IS NOT NULL THEN
    INSERT INTO fiscal_focus_eventos (ref, fonte, dedupe, resposta) VALUES (_ref, _fonte, _dedupe, _resposta) ON CONFLICT (dedupe) DO NOTHING;
    IF NOT FOUND THEN RETURN jsonb_build_object('repetido', true, 'status', e.status); END IF;
  ELSE
    INSERT INTO fiscal_focus_eventos (ref, fonte, resposta) VALUES (_ref, _fonte, _resposta);
  END IF;

  st := _resposta->>'status';
  IF st = 'erro_cancelamento' THEN st := e.status; END IF;              -- cancelamento recusado: nota segue como estava
  IF st IS NULL OR st NOT IN ('processando_autorizacao','autorizado','erro_autorizacao','denegado','cancelado','erro_envio') THEN
    st := e.status;
  END IF;
  -- nunca volta de um estado final para "processando" (aviso atrasado)
  IF e.status IN ('autorizado','cancelado','denegado') AND st = 'processando_autorizacao' THEN st := e.status; END IF;
  IF e.status = 'cancelado' AND st = 'autorizado' THEN st := 'cancelado'; END IF;
  chave := nullif(regexp_replace(coalesce(_resposta->>'chave_nfe', ''), '\D', '', 'g'), '');
  IF chave IS NOT NULL AND chave !~ '^\d{44}$' THEN chave := NULL; END IF;

  UPDATE fiscal_focus_envios SET
    status = st,
    status_sefaz = coalesce(_resposta->>'status_sefaz', status_sefaz),
    mensagem_sefaz = coalesce(left(_resposta->>'mensagem_sefaz', 500), left(_resposta->>'mensagem', 500), mensagem_sefaz),
    erros = CASE WHEN _resposta ? 'erros' THEN _resposta->'erros' ELSE erros END,
    chave_nfe = coalesce(chave, chave_nfe),
    numero = coalesce(_resposta->>'numero', numero),
    serie = coalesce(_resposta->>'serie', serie),
    caminho_xml = coalesce(_resposta->>'caminho_xml_nota_fiscal', caminho_xml),
    caminho_danfe = coalesce(_resposta->>'caminho_danfe', caminho_danfe),
    caminho_xml_cancelamento = coalesce(_resposta->>'caminho_xml_cancelamento', caminho_xml_cancelamento),
    tentativas = tentativas + CASE WHEN _fonte = 'envio' THEN 1 ELSE 0 END,
    updated_at = now()
  WHERE ref = _ref;
  IF st IS DISTINCT FROM e.status THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'fiscal.focus_status', 'fiscal_focus_envios', _ref,
            jsonb_build_object('de', e.status, 'para', st, 'fonte', _fonte, 'status_sefaz', _resposta->>'status_sefaz'));
  END IF;
  RETURN jsonb_build_object('ref', _ref, 'status', st);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_retorno(text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_retorno(text,text,jsonb,text) TO service_role;

-- Leitura para o servidor (montar devolução/venda/perda a partir da remessa).
CREATE OR REPLACE FUNCTION public.fiscal_focus_envio(_ref text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  RETURN (SELECT to_jsonb(e) FROM fiscal_focus_envios e WHERE ref = _ref);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_envio(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_envio(text) TO service_role;

-- Lista para a tela (sem CPF nem endereço).
CREATE OR REPLACE FUNCTION public.fiscal_focus_envios_lista(_limite int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.fiscal_focus_pode('ver') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'ref', e.ref, 'ambiente', e.ambiente, 'operacao', e.operacao, 'teste', e.teste, 'ref_origem', e.ref_origem,
      'consultora', p.display_name, 'status', e.status, 'status_sefaz', e.status_sefaz, 'mensagem_sefaz', e.mensagem_sefaz,
      'erros', e.erros, 'chave_nfe', e.chave_nfe, 'numero', e.numero, 'serie', e.serie,
      'tem_danfe', e.caminho_danfe IS NOT NULL, 'tem_xml', e.caminho_xml IS NOT NULL,
      'valor_total', e.payload->'valor_total', 'pecas', (SELECT sum((i->>'quantidade_comercial')::numeric) FROM jsonb_array_elements(e.payload->'items') i),
      'itens', (SELECT jsonb_agg(jsonb_build_object('codigo', i->>'codigo_produto', 'descricao', i->>'descricao',
                                                    'quantidade', (i->>'quantidade_comercial')::numeric))
                  FROM jsonb_array_elements(e.payload->'items') i),
      'created_at', e.created_at, 'updated_at', e.updated_at) ORDER BY e.created_at DESC)
    FROM (SELECT * FROM fiscal_focus_envios ORDER BY created_at DESC LIMIT least(greatest(coalesce(_limite, 30), 1), 200)) e
    LEFT JOIN parties p ON p.id = e.party_id), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_envios_lista(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_envios_lista(int) TO authenticated;