-- ============================================================================
-- 0099 — Prontidão fiscal e ajustes da revisão de 16/10/2026
--
-- Seguro para a base real: só usa tabelas e rotinas que já existem em produção.
-- Nada aqui emite nota, liga emissão, cria cobrança ou move estoque.
--
--  1. Saldo de parcela igual em todo lugar (portal do representante e sugestão
--     do extrato passam a usar fin_installment_saldo).
--  2. Cartão Asaas: crédito nunca antecipado e varredura diária do crédito que
--     ficou para trás (quando o aviso PAYMENT_RECEIVED não chega).
--  3. Foto de divergência só de peça que está na maleta.
--  4. Faixas de comissão: só Master/Diretoria alteram.
--  5. Interruptor fiscal: só o Master liga, troca emissor, provedor ou ambiente,
--     e cada troca fica na auditoria.
--  6. nfe_chave_valida: confere a chave de acesso (44 dígitos, DV, CNPJ, modelo).
--  7. fiscal_prontidao: relatório só de leitura do que falta para emitir.
--  8. Visitante sem login deixa de executar 24 rotinas internas (já recusavam por dentro).
-- ============================================================================

-- 1. Saldo de parcela -----------------------------------------------------------
DO $saldo$
DECLARE r record; d text; n text;
  velho1 text := 'i.valor_cents - coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a WHERE a.installment_id=i.id),0)';
  velho2 text := 'i.valor_cents - coalesce((select sum(a.valor_cents) from financial_allocations a where a.installment_id=i.id),0)';
  novo text := 'public.fin_installment_saldo(i.id)';
  feitas int := 0;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
            WHERE s.nspname = 'public'
              AND p.proname IN ('rep_consultora_ficha_rep','rep_portal_abertos','rep_portal_busca_todas','fin_statement_suggest')
  LOOP
    d := pg_get_functiondef(r.oid);
    n := replace(replace(d, velho1, novo), velho2, novo);
    IF n = d AND position(novo in d) = 0 THEN RAISE EXCEPTION 'Definição inesperada em %; nada alterado.', r.oid::regprocedure; END IF;
    IF n <> d THEN EXECUTE n; END IF;  -- já corrigida: segue (reaplicação segura)
    feitas := feitas + 1;
  END LOOP;
  IF feitas <> 4 THEN RAISE EXCEPTION 'Esperava 4 rotinas de saldo, encontrei %.', feitas; END IF;
END $saldo$;

-- 2. Cartão Asaas ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asaas_cartao_creditar(_charge uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c record; conta uuid; conta_cartao uuid; s record; liquido bigint; chave text;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; t uuid;
BEGIN
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge;
  IF c.id IS NULL OR c.billing_type IS DISTINCT FROM 'CREDIT_CARD' THEN RETURN NULL; END IF;
  SELECT financial_account_id, conta_cartao_receber_id INTO conta, conta_cartao FROM public.asaas_accounts WHERE id = c.account_id;
  IF conta IS NULL OR conta_cartao IS NULL THEN RETURN NULL; END IF;
  IF c.external_status <> 'RECEIVED' OR c.credit_date IS NULL THEN
    RETURN jsonb_build_object('transferido', false, 'motivo', 'aguardando_credito');
  END IF;
  -- O dinheiro só existe na conta Asaas a partir da credit_date: nunca antecipar.
  IF c.credit_date > hoje THEN
    RETURN jsonb_build_object('transferido', false, 'motivo', 'aguardando_credito', 'credito_em', c.credit_date);
  END IF;
  SELECT * INTO s FROM public.financial_settlements
   WHERE idempotency_key = 'asaas:baixa:' || c.account_id || ':' || c.external_id AND financial_account_id = conta_cartao;
  IF s.id IS NULL THEN RETURN jsonb_build_object('transferido', false, 'motivo', 'baixa_nao_esta_na_conta_cartao'); END IF;
  IF EXISTS (SELECT 1 FROM public.financial_settlements WHERE reversed_of = s.id) THEN
    RETURN jsonb_build_object('transferido', false, 'motivo', 'baixa_estornada');
  END IF;
  SELECT coalesce(sum(valor_cents),0) INTO liquido FROM public.financial_account_movements
   WHERE settlement_id = s.id AND financial_account_id = conta_cartao;
  IF liquido <= 0 THEN RETURN jsonb_build_object('transferido', false, 'motivo', 'sem_valor'); END IF;
  chave := 'asaas:credito:' || c.account_id || ':' || c.external_id;
  PERFORM set_config('lardan.baixa_asaas', 'on', true);
  BEGIN
    t := public.fin_transfer_create(jsonb_build_object('from_account_id', conta_cartao, 'to_account_id', conta,
          'data', c.credit_date::text, 'valor_cents', liquido, 'idempotency_key', chave,
          'referencia', 'Asaas ' || c.external_id, 'motivo', 'Crédito do cartão na conta Asaas'));
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('lardan.baixa_asaas', 'off', true);
    RETURN jsonb_build_object('transferido', false, 'motivo', 'motor_recusou', 'erro', SQLERRM);
  END;
  PERFORM set_config('lardan.baixa_asaas', 'off', true);
  RETURN jsonb_build_object('transferido', true, 'transfer_id', t, 'valor_cents', liquido, 'data', c.credit_date);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_cartao_creditar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cartao_creditar(uuid) TO service_role;

-- Mesma varredura de antes + o crédito de cartão que ficou para trás.
CREATE OR REPLACE FUNCTION public.asaas_baixa_pendentes(_executar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE x record; r jsonb; itens jsonb := '[]'::jsonb; feitas int := 0; creditos int := 0;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN
    RAISE EXCEPTION 'Sem permissão para registrar baixa.';
  END IF;
  FOR x IN
    SELECT c.id, c.external_id, coalesce(c.received_cents, c.value_cents) v,
           coalesce(c.installment_id, m.installment_id) parcela
      FROM public.asaas_charges c
      JOIN public.asaas_accounts a ON a.id = c.account_id AND a.financial_account_id IS NOT NULL
      LEFT JOIN LATERAL (SELECT installment_id FROM public.asaas_charge_matches
                          WHERE charge_id = c.id AND status = 'confirmado' LIMIT 1) m ON true
     WHERE c.external_status = 'RECEIVED'
       AND coalesce(c.installment_id, m.installment_id) IS NOT NULL
       AND public.fin_installment_saldo(coalesce(c.installment_id, m.installment_id)) > 0
       AND NOT EXISTS (SELECT 1 FROM public.financial_settlements s
                        WHERE s.idempotency_key = 'asaas:baixa:' || c.account_id || ':' || c.external_id)
     LIMIT 500
  LOOP
    IF _executar THEN
      r := public.asaas_baixa_automatica(x.id);
      IF (r->>'baixa')::boolean THEN feitas := feitas + 1; END IF;
    ELSE r := null; END IF;
    itens := itens || jsonb_build_object('cobranca', x.external_id, 'valor_cents', x.v, 'installment_id', x.parcela, 'resultado', r);
  END LOOP;

  -- Cartão já baixado na conta "cartão a receber" cujo crédito chegou e ainda não foi transferido.
  FOR x IN
    SELECT c.id, c.external_id
      FROM public.asaas_charges c
      JOIN public.asaas_accounts a ON a.id = c.account_id
       AND a.financial_account_id IS NOT NULL AND a.conta_cartao_receber_id IS NOT NULL
     WHERE c.billing_type = 'CREDIT_CARD' AND c.external_status = 'RECEIVED'
       AND c.credit_date IS NOT NULL AND c.credit_date <= hoje
       AND EXISTS (SELECT 1 FROM public.financial_settlements s
                    WHERE s.idempotency_key = 'asaas:baixa:' || c.account_id || ':' || c.external_id
                      AND s.financial_account_id = a.conta_cartao_receber_id)
       AND NOT EXISTS (SELECT 1 FROM public.financial_transfers t
                        WHERE t.idempotency_key = 'asaas:credito:' || c.account_id || ':' || c.external_id)
     LIMIT 500
  LOOP
    IF _executar THEN
      r := public.asaas_cartao_creditar(x.id);
      IF coalesce((r->>'transferido')::boolean, false) THEN creditos := creditos + 1; END IF;
    ELSE r := null; END IF;
    itens := itens || jsonb_build_object('cobranca', x.external_id, 'credito_cartao', true, 'resultado', r);
  END LOOP;

  RETURN jsonb_build_object('executado', _executar, 'encontradas', jsonb_array_length(itens),
    'baixadas', feitas, 'creditos_cartao', creditos, 'itens', itens);
END $function$;

-- 3. Foto de divergência só de peça da maleta --------------------------------------
CREATE OR REPLACE FUNCTION public.kit_divergencia_foto_registrar(_cycle uuid, _variant uuid, _path text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.kit_cycles; n int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.id IS NULL OR c.consultora_party_id IS DISTINCT FROM public.my_party_id() THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF c.status NOT IN ('transito','recebida') THEN RAISE EXCEPTION 'Fotos de divergência só na conferência da chegada.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kit_balances b WHERE b.cycle_id = _cycle AND b.variant_id = _variant) THEN
    RAISE EXCEPTION 'Esta peça não faz parte da maleta.';
  END IF;
  IF split_part(_path,'/',1) <> auth.uid()::text OR split_part(_path,'/',2) <> 'maleta-' || _cycle::text THEN RAISE EXCEPTION 'Caminho da foto inválido.'; END IF;
  SELECT count(*) INTO n FROM public.kit_divergencia_fotos WHERE cycle_id = _cycle AND variant_id = _variant;
  IF n >= 3 THEN RAISE EXCEPTION 'Máximo de 3 fotos por peça.'; END IF;
  INSERT INTO public.kit_divergencia_fotos (cycle_id, variant_id, path, enviado_por) VALUES (_cycle, _variant, _path, auth.uid()) ON CONFLICT (path) DO NOTHING;
  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  SELECT _cycle, 'divergencia_foto', auth.uid(), jsonb_build_object('variant_id', _variant, 'path', _path)
  WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='kit_events' AND column_name='payload');
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.kit_divergencia_foto_registrar(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_divergencia_foto_registrar(uuid,uuid,text) TO authenticated;

-- 4. Faixas de comissão --------------------------------------------------------------
-- Marketing e suporte continuam vendo; só Master e Diretoria mudam percentual.
DROP POLICY IF EXISTS comissao_faixas_gerir ON public.consultora_comissao_faixas;
DROP POLICY IF EXISTS comissao_faixas_ler ON public.consultora_comissao_faixas;
DROP POLICY IF EXISTS comissao_faixas_alterar ON public.consultora_comissao_faixas;
CREATE POLICY comissao_faixas_ler ON public.consultora_comissao_faixas FOR SELECT TO authenticated
  USING (public.can_manage_leads(auth.uid()));
CREATE POLICY comissao_faixas_alterar ON public.consultora_comissao_faixas FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['master','diretoria']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['master','diretoria']::public.app_role[]));

-- 5. Interruptor fiscal -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fiscal_settings_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF (NEW.emission_active, NEW.environment, NEW.provider, NEW.emitter_entity_id)
     IS DISTINCT FROM (OLD.emission_active, OLD.environment, OLD.provider, OLD.emitter_entity_id) THEN
    -- Pessoa logada (ou papel de navegador): só o Master, e com a configuração coerente.
    -- current_setting('role') guarda o papel da requisição mesmo dentro de SECURITY DEFINER.
    IF auth.uid() IS NOT NULL OR coalesce(current_setting('role', true), '') IN ('authenticated','anon') THEN
      IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'master') THEN
        RAISE EXCEPTION 'Só o Master liga a emissão ou troca emissor, provedor e ambiente fiscal.' USING errcode='42501';
      END IF;
      IF NEW.emission_active AND (NEW.provider IS NULL OR NEW.emitter_entity_id IS NULL OR NEW.environment = 'nenhum') THEN
        RAISE EXCEPTION 'Para ligar a emissão defina antes o provedor, o emissor e o ambiente.';
      END IF;
      IF NEW.emission_active AND OLD.emission_active AND NEW.environment IS DISTINCT FROM OLD.environment THEN
        RAISE EXCEPTION 'Desligue a emissão antes de trocar de ambiente.';
      END IF;
    END IF;
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'fiscal.configuracao_alterada', 'fiscal_settings', 'fiscal',
            jsonb_build_object('antes', to_jsonb(OLD), 'depois', to_jsonb(NEW)));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_settings_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS fiscal_settings_guard ON public.fiscal_settings;
CREATE TRIGGER fiscal_settings_guard BEFORE UPDATE ON public.fiscal_settings
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_settings_guard();

-- 6. Chave de acesso da NF-e --------------------------------------------------------
-- 44 dígitos: UF(2) AAMM(4) CNPJ(14) modelo(2) série(3) número(9) tipo(1) código(8) DV(1).
CREATE OR REPLACE FUNCTION public.nfe_chave_valida(_chave text, _cnpj text DEFAULT NULL, _modelo text DEFAULT '55')
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $fn$
DECLARE soma int := 0; peso int := 2; i int; resto int; dv int;
BEGIN
  IF _chave IS NULL OR _chave !~ '^[0-9]{44}$' THEN RETURN false; END IF;
  FOR i IN REVERSE 43..1 LOOP
    soma := soma + substr(_chave, i, 1)::int * peso;
    peso := CASE WHEN peso = 9 THEN 2 ELSE peso + 1 END;
  END LOOP;
  resto := soma % 11;
  dv := CASE WHEN resto < 2 THEN 0 ELSE 11 - resto END;
  IF dv <> substr(_chave, 44, 1)::int THEN RETURN false; END IF;
  IF _modelo IS NOT NULL AND substr(_chave, 21, 2) <> _modelo THEN RETURN false; END IF;
  IF _cnpj IS NOT NULL AND substr(_chave, 7, 14) <> regexp_replace(_cnpj, '\D', '', 'g') THEN RETURN false; END IF;
  RETURN true;
END $fn$;
GRANT EXECUTE ON FUNCTION public.nfe_chave_valida(text,text,text) TO authenticated, service_role;

-- 7. Prontidão fiscal (só leitura, só contagens) ---------------------------------------
CREATE OR REPLACE FUNCTION public.fiscal_prontidao()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE cfg record; be record; end_emissor record; pol record;
  consultoras jsonb; pecas jsonb; volume jsonb; emissor jsonb; bloqueios text[] := '{}';
  ativos constant text[] := ARRAY['montagem','conferida','expedida','transito','recebida','operacao','acerto'];
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_capability(auth.uid(),'finance.view') OR public.has_role(auth.uid(),'master')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode='42501';
  END IF;

  SELECT * INTO cfg FROM public.fiscal_settings WHERE id;
  SELECT * INTO be FROM public.business_entities WHERE id = cfg.emitter_entity_id;
  SELECT * INTO end_emissor FROM public.party_addresses a WHERE a.party_id = be.party_id
   ORDER BY a.is_primary DESC NULLS LAST, a.created_at LIMIT 1;
  SELECT * INTO pol FROM public.pricing_policies WHERE scope = 'fiscal' ORDER BY (status = 'vigente') DESC, created_at DESC LIMIT 1;

  emissor := jsonb_build_object(
    'definido', be.id IS NOT NULL,
    'cnpj_ok', coalesce(public.cnpj_is_valid(regexp_replace(coalesce(be.tax_id,''),'\D','','g')), false),
    'ie_ok', coalesce(btrim(be.state_registration),'') <> '',
    'uf', be.uf,
    'endereco_ok', end_emissor.id IS NOT NULL AND coalesce(btrim(end_emissor.street),'') <> ''
                   AND (coalesce(btrim(end_emissor.street_number),'') <> '' OR coalesce(end_emissor.no_number,false))
                   AND coalesce(btrim(end_emissor.district),'') <> ''
                   AND regexp_replace(coalesce(end_emissor.postal_code,''),'\D','','g') ~ '^[0-9]{8}$',
    'ibge_ok', coalesce(end_emissor.ibge_city_code,'') ~ '^[0-9]{7}$');

  WITH alvo AS (
    SELECT p.id, p.kind::text kind, p.doc_digits
      FROM public.consultant_profiles cp JOIN public.parties p ON p.id = cp.party_id
     WHERE p.status = 'ativo'
        OR EXISTS (SELECT 1 FROM public.kit_cycles k WHERE k.consultora_party_id = p.id AND k.status::text = ANY (ativos))
  ), ende AS (
    SELECT a.id, a.party_id, a.street, a.street_number, a.no_number, a.district, a.city, a.uf, a.postal_code, a.ibge_city_code
      FROM alvo
      LEFT JOIN LATERAL (SELECT * FROM public.party_addresses x WHERE x.party_id = alvo.id
                          ORDER BY x.is_primary DESC NULLS LAST, x.created_at LIMIT 1) a ON true
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM alvo),
    'com_maleta_ativa', (SELECT count(*) FROM alvo WHERE EXISTS (SELECT 1 FROM public.kit_cycles k WHERE k.consultora_party_id = alvo.id AND k.status::text = ANY (ativos))),
    'documento_invalido', (SELECT count(*) FROM alvo WHERE NOT CASE WHEN alvo.kind = 'pessoa' THEN coalesce(public.cpf_is_valid(alvo.doc_digits), false)
                                                              ELSE coalesce(public.cnpj_is_valid(alvo.doc_digits), false) END),
    'cnpj', (SELECT count(*) FROM alvo WHERE alvo.kind <> 'pessoa'),
    'sem_endereco', (SELECT count(*) FROM ende WHERE ende.id IS NULL),
    'sem_rua', (SELECT count(*) FROM ende WHERE ende.id IS NOT NULL AND coalesce(btrim(ende.street),'') = ''),
    'sem_numero', (SELECT count(*) FROM ende WHERE ende.id IS NOT NULL AND coalesce(btrim(ende.street_number),'') = '' AND NOT coalesce(ende.no_number,false)),
    'sem_bairro', (SELECT count(*) FROM ende WHERE ende.id IS NOT NULL AND coalesce(btrim(ende.district),'') = ''),
    'cep_invalido', (SELECT count(*) FROM ende WHERE ende.id IS NOT NULL AND regexp_replace(coalesce(ende.postal_code,''),'\D','','g') !~ '^[0-9]{8}$'),
    'sem_ibge', (SELECT count(*) FROM ende WHERE ende.id IS NOT NULL AND coalesce(ende.ibge_city_code,'') !~ '^[0-9]{7}$'),
    'ibge_deduzivel', (SELECT count(*) FROM ende WHERE ende.id IS NOT NULL AND coalesce(ende.ibge_city_code,'') !~ '^[0-9]{7}$'
                         AND EXISTS (SELECT 1 FROM public.ibge_municipios m WHERE m.uf = ende.uf AND m.nome_norm = public.norm_name(ende.city))),
    'fora_do_pr', (SELECT count(*) FROM ende WHERE ende.id IS NOT NULL AND coalesce(ende.uf,'') <> 'PR'),
    'prontas', (SELECT count(*) FROM alvo JOIN ende ON ende.party_id = alvo.id
                 WHERE CASE WHEN alvo.kind = 'pessoa' THEN coalesce(public.cpf_is_valid(alvo.doc_digits), false)
                            ELSE coalesce(public.cnpj_is_valid(alvo.doc_digits), false) END
                   AND coalesce(btrim(ende.street),'') <> '' AND coalesce(btrim(ende.district),'') <> ''
                   AND (coalesce(btrim(ende.street_number),'') <> '' OR coalesce(ende.no_number,false))
                   AND regexp_replace(coalesce(ende.postal_code,''),'\D','','g') ~ '^[0-9]{8}$'
                   AND (coalesce(ende.ibge_city_code,'') ~ '^[0-9]{7}$'
                        OR EXISTS (SELECT 1 FROM public.ibge_municipios m WHERE m.uf = ende.uf AND m.nome_norm = public.norm_name(ende.city)))))
  INTO consultoras;

  WITH v AS (
    SELECT DISTINCT b.variant_id FROM public.kit_balances b JOIN public.kit_cycles k ON k.id = b.cycle_id
     WHERE k.status::text = ANY (ativos)
  ), f AS (
    SELECT v.variant_id, regexp_replace(coalesce(nullif(btrim(pv.ncm),''), nullif(btrim(pr.ncm),''), ''), '\D', '', 'g') ncm,
           public.kit_reference_price(v.variant_id) preco
      FROM v JOIN public.product_variants pv ON pv.id = v.variant_id JOIN public.products pr ON pr.id = pv.product_id
  )
  SELECT jsonb_build_object(
    'variantes_em_maletas_ativas', (SELECT count(*) FROM f),
    'sem_ncm', (SELECT count(*) FROM f WHERE f.ncm = ''),
    'ncm_invalido', (SELECT count(*) FROM f WHERE f.ncm <> '' AND f.ncm !~ '^[0-9]{8}$'),
    'sem_preco_referencia', (SELECT count(*) FROM f WHERE coalesce(f.preco,0) <= 0),
    'ncms', coalesce((SELECT jsonb_agg(jsonb_build_object('ncm', x.ncm, 'variantes', x.n) ORDER BY x.n DESC)
                       FROM (SELECT f.ncm, count(*) n FROM f WHERE f.ncm ~ '^[0-9]{8}$' GROUP BY 1 ORDER BY 2 DESC LIMIT 10) x), '[]'::jsonb))
  INTO pecas;

  SELECT jsonb_build_object(
    'maletas_expedidas_30d', (SELECT count(*) FROM public.kit_cycles WHERE shipped_at >= now() - interval '30 days'),
    'maletas_expedidas_90d', (SELECT count(*) FROM public.kit_cycles WHERE shipped_at >= now() - interval '90 days'),
    'maletas_encerradas_30d', (SELECT count(*) FROM public.kit_cycles WHERE closed_at >= now() - interval '30 days'),
    'maletas_ativas', (SELECT count(*) FROM public.kit_cycles WHERE status::text = ANY (ativos)))
  INTO volume;

  IF NOT (emissor->>'definido')::boolean THEN bloqueios := bloqueios || 'Empresa emissora não cadastrada nem ligada à configuração fiscal.'::text;
  ELSIF NOT ((emissor->>'cnpj_ok')::boolean AND (emissor->>'ie_ok')::boolean AND (emissor->>'endereco_ok')::boolean AND (emissor->>'ibge_ok')::boolean) THEN
    bloqueios := bloqueios || 'Cadastro da empresa emissora incompleto (CNPJ, IE, endereço ou município IBGE).'::text;
  END IF;
  IF cfg.provider IS NULL THEN bloqueios := bloqueios || 'Provedor de emissão não configurado.'::text; END IF;
  IF pol.id IS NULL OR pol.status <> 'vigente' THEN
    bloqueios := bloqueios || 'Regra do valor fiscal (o "um terço") não está vigente: falta percentual, fundamento e responsável.'::text;
  END IF;
  IF (consultoras->>'total')::int > (consultoras->>'prontas')::int THEN
    bloqueios := bloqueios || format('%s consultoras com cadastro fiscal incompleto (documento ou endereço).',
                   (consultoras->>'total')::int - (consultoras->>'prontas')::int);
  END IF;
  IF (pecas->>'sem_ncm')::int + (pecas->>'ncm_invalido')::int > 0 THEN
    bloqueios := bloqueios || format('%s peças em maletas ativas sem NCM válido.', (pecas->>'sem_ncm')::int + (pecas->>'ncm_invalido')::int);
  END IF;
  IF to_regclass('public.fiscal_outbox') IS NULL THEN
    bloqueios := bloqueios || 'Cadeia fiscal (fila, tentativas, eventos) ainda não aplicada nesta base.'::text;
  END IF;
  IF to_regclass('public.kit_acertos') IS NULL THEN
    bloqueios := bloqueios || 'Acerto da maleta ainda não aplicado nesta base: sem ele não existe nota do vendido.'::text;
  END IF;

  RETURN jsonb_build_object(
    'gerado_em', now(),
    'pronto', cardinality(bloqueios) = 0,
    'bloqueios', to_jsonb(bloqueios),
    'configuracao', jsonb_build_object('emissao_ligada', coalesce(cfg.emission_active,false), 'provedor', cfg.provider, 'ambiente', cfg.environment),
    'emissor', emissor,
    'regra_valor', jsonb_build_object('status', pol.status, 'percentual', pol.percent),
    'pendencias_abertas', coalesce((SELECT jsonb_agg(escopo ORDER BY escopo) FROM public.fiscal_pendencias WHERE status = 'aberta'), '[]'::jsonb),
    'consultoras', consultoras,
    'pecas', pecas,
    'volume', volume);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_prontidao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_prontidao() TO authenticated;
COMMENT ON FUNCTION public.fiscal_prontidao() IS 'Só leitura e só contagens: o que falta para emitir NF-e (emissor, regra de valor, cadastro das consultoras, NCM das peças, volume).';

-- 8. Visitante sem login não executa rotinas internas -------------------------------
-- Todas já recusam sem login por dentro; aqui a porta também fica fechada (defesa em
-- profundidade e sem sondagem de papéis por id). Rotinas públicas de verdade (vitrine,
-- catálogo público, candidatura, contato, indicação, PDV por token) não entram na lista.
DO $anon$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
            WHERE s.nspname = 'public' AND p.proname = ANY (ARRAY[
              'catalog_overview','catalog_pendencias','cob_pode','cob_carteira','cob_devedor','cob_registrar',
              'cob_mover_etapa','cob_promessa_criar','cob_promessa_cancelar','cob_tarefa_criar','cob_tarefa_concluir',
              'pdv_gestao','pdv_membro_de','pdv_usuarios_disponiveis','pdv_estoque_resumo','pdv_unidade_criar',
              'e_vendedora_interna','rep_eu','fin_projecao_diaria','praca_criar','praca_alternar','praca_consultoras',
              'kit_consultora_doc','remessa_parametros_salvar'])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.oid::regprocedure);
  END LOOP;
END $anon$;
