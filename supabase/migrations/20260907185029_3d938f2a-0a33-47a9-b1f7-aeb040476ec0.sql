-- Limpeza controlada definitiva da homologação (rotina de manutenção v2)
CREATE TABLE IF NOT EXISTS public.homolog_purge_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  rollback_id text NOT NULL,
  modo text NOT NULL,
  prefixo text NOT NULL,
  ator uuid,
  motivo text,
  antes jsonb NOT NULL DEFAULT '{}'::jsonb,
  depois jsonb NOT NULL DEFAULT '{}'::jsonb,
  resultado jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT ALL ON public.homolog_purge_runs TO service_role;
ALTER TABLE public.homolog_purge_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.homolog_purge_scope (
  movement_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.homolog_purge_scope TO service_role;
ALTER TABLE public.homolog_purge_scope ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.block_stock_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('lardan.purge_v2', true), '') ~ '^831a7919.*4cb665$'
     AND EXISTS (SELECT 1 FROM public.homolog_purge_scope s WHERE s.movement_id = OLD.id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Movimentações de estoque são imutáveis.';
END $function$;

CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF coalesce(current_setting('lardan.purge_v2', true), '') ~ '^831a7919.*4cb665$' THEN
      RETURN NEW;
    END IF;
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN
      RAISE EXCEPTION 'Somente o Master pode ativar ou desativar usuários.';
    END IF;
    IF OLD.id = auth.uid() AND NEW.is_active = false THEN
      RAISE EXCEPTION 'O Master não pode desativar a própria conta.';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP FUNCTION IF EXISTS public.homolog_purge(text);
DROP FUNCTION IF EXISTS public.homolog_purge_stock(text, integer);
DROP FUNCTION IF EXISTS public.homolog_purge_catalogo(text, integer);
DROP FUNCTION IF EXISTS public.homolog_purge_movimentos(text);

CREATE OR REPLACE FUNCTION public.homolog_purge_v2(
  _rollback_id text,
  _confirmacao text,
  _modo text,
  _prefixo text,
  _protegidos text[],
  _limites jsonb,
  _ator uuid,
  _motivo text,
  _idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _canon text[] := ARRAY[
    'brinco-lume-dourado','brinco-aurora-perola','brinco-iris-cristal','brinco-serena-argola',
    'brinco-celeste-gota','colar-essenza','colar-lumiere','colar-riviera-cristal','colar-elo-dourado',
    'colar-ponto-de-luz','anel-solenne','anel-eclat','anel-lumiere','anel-riviera','anel-aura-dourada',
    'pulseira-serena','pulseira-lumi','pulseira-riviera','bracelete-essenza','pulseira-elo-dourado'];
  _claims jsonb;
  _jwt_role text;
  _like text;
  _prev public.homolog_purge_runs%ROWTYPE;
  _run_id uuid;
  _antes jsonb;
  _plano jsonb;
  _diff jsonb := '{}'::jsonb;
  _k text;
  _atual bigint;
  _esperado bigint;
  _prot_ids uuid[];
  _brinco uuid;
  _dep01 uuid;
  _removidos jsonb;
  _depois jsonb;
  _t0 timestamptz := clock_timestamp();
  _n bigint;
  _res jsonb;
BEGIN
  _claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  _jwt_role := coalesce(_claims->>'role', '');
  IF _jwt_role <> '' AND _jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'Rotina de manutenção restrita ao serviço interno.' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Rotina de manutenção restrita ao serviço interno.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(_rollback_id, '') !~ '^831a7919.*4cb665$' THEN
    RAISE EXCEPTION 'Identificador de rollback inválido ou ausente.' USING ERRCODE = '22023';
  END IF;
  IF _confirmacao IS DISTINCT FROM 'LIMPEZA CONTROLADA DEFINITIVA DA HOMOLOGACAO' THEN
    RAISE EXCEPTION 'Confirmação textual exata ausente.' USING ERRCODE = '22023';
  END IF;
  IF _modo NOT IN ('simular', 'executar') THEN
    RAISE EXCEPTION 'Modo deve ser simular ou executar.' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(_prefixo, '')) < 6 THEN
    RAISE EXCEPTION 'Marcador sintético deve ter ao menos 6 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF _protegidos IS NULL OR NOT (_protegidos @> _canon) THEN
    RAISE EXCEPTION 'Lista protegida incompleta: os 20 slugs são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF _limites IS NULL OR _limites = '{}'::jsonb THEN
    RAISE EXCEPTION 'Limites máximos esperados são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(_idempotency_key, '')) < 8 THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(_motivo, '')) < 8 THEN
    RAISE EXCEPTION 'Motivo obrigatório.' USING ERRCODE = '22023';
  END IF;

  _like := _prefixo || '-%';

  SELECT * INTO _prev FROM public.homolog_purge_runs
   WHERE idempotency_key = _idempotency_key AND modo = 'executar' AND finished_at IS NOT NULL;
  IF FOUND THEN
    RETURN _prev.resultado || jsonb_build_object('repetido', true, 'novos_efeitos', 0);
  END IF;

  SELECT array_agg(id) INTO _prot_ids FROM public.products WHERE slug = ANY (_canon);
  IF coalesce(array_length(_prot_ids, 1), 0) <> 20 THEN
    RAISE EXCEPTION 'Os 20 produtos protegidos não foram todos localizados (encontrados %).',
      coalesce(array_length(_prot_ids, 1), 0) USING ERRCODE = '22023';
  END IF;
  SELECT id INTO _brinco FROM public.products WHERE slug = 'brinco01';
  SELECT id INTO _dep01 FROM public.locations WHERE code = 'DEP-01';
  IF _dep01 IS NULL THEN
    RAISE EXCEPTION 'Depósito Principal (DEP-01) não encontrado.' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM public.categories WHERE status = 'publicado') < 4 THEN
    RAISE EXCEPTION 'As quatro categorias publicadas são pré-requisito da limpeza.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.products WHERE id = ANY (_prot_ids) AND status = 'publicado') <> 20 THEN
    RAISE EXCEPTION 'Os 20 produtos protegidos precisam estar publicados antes da limpeza.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE _s_prod ON COMMIT DROP AS
    SELECT id FROM public.products WHERE slug LIKE _like;
  CREATE TEMP TABLE _s_var ON COMMIT DROP AS
    SELECT v.id FROM public.product_variants v JOIN _s_prod p ON p.id = v.product_id;
  CREATE TEMP TABLE _s_loc ON COMMIT DROP AS
    SELECT id FROM public.locations WHERE code LIKE upper(_prefixo) || '%';
  CREATE TEMP TABLE _s_mov ON COMMIT DROP AS
    SELECT m.id FROM public.stock_movements m
     WHERE m.variant_id IN (SELECT id FROM _s_var)
        OR m.from_location_id IN (SELECT id FROM _s_loc)
        OR m.to_location_id IN (SELECT id FROM _s_loc);
  CREATE TEMP TABLE _s_job ON COMMIT DROP AS
    SELECT id, file_id FROM public.import_jobs;
  CREATE TEMP TABLE _s_party_del ON COMMIT DROP AS
    SELECT id FROM public.parties
     WHERE (display_name LIKE 'HOMOLOG%' AND id NOT IN (SELECT party_id FROM public.profiles WHERE party_id IS NOT NULL))
        OR id IN (SELECT party_id FROM public.suppliers WHERE name LIKE upper(_prefixo) || '%' AND party_id IS NOT NULL);
  CREATE TEMP TABLE _s_party_anon ON COMMIT DROP AS
    SELECT id FROM public.parties
     WHERE display_name LIKE 'HOMOLOG%' AND id IN (SELECT party_id FROM public.profiles WHERE party_id IS NOT NULL);
  CREATE TEMP TABLE _s_conta ON COMMIT DROP AS
    SELECT id FROM public.profiles WHERE email LIKE '%@lardan.test';
  CREATE TEMP TABLE _s_media ON COMMIT DROP AS
    SELECT m.id FROM public.media_assets m
     WHERE m.alt LIKE 'Anel de homologação foto%'
       AND NOT EXISTS (SELECT 1 FROM public.product_media pm WHERE pm.media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.hero_media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.collections c WHERE c.hero_media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.award_campaigns a WHERE a.media_id = m.id);

  IF EXISTS (SELECT 1 FROM _s_prod WHERE id = ANY (_prot_ids)) THEN
    RAISE EXCEPTION 'Abortado: alvo de exclusão atinge produto protegido.' USING ERRCODE = '42501';
  END IF;
  IF _brinco IS NOT NULL AND EXISTS (SELECT 1 FROM _s_prod WHERE id = _brinco) THEN
    RAISE EXCEPTION 'Abortado: brinco01 não pode ser excluído fisicamente.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM _s_var v JOIN public.product_variants pv ON pv.id = v.id WHERE pv.product_id = ANY (_prot_ids)) THEN
    RAISE EXCEPTION 'Abortado: alvo de exclusão atinge variante protegida.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM _s_loc WHERE id = _dep01) THEN
    RAISE EXCEPTION 'Abortado: o Depósito Principal não pode ser removido.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _s_mov m JOIN public.stock_movements sm ON sm.id = m.id
     JOIN public.product_variants pv ON pv.id = sm.variant_id
     WHERE pv.product_id = ANY (_prot_ids)) THEN
    RAISE EXCEPTION 'Abortado: alvo de exclusão atinge movimentação protegida.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM _s_media m JOIN public.media_assets ma ON ma.id = m.id WHERE ma.is_archived IS FALSE
             AND EXISTS (SELECT 1 FROM public.product_media pm WHERE pm.media_id = ma.id)) THEN
    RAISE EXCEPTION 'Abortado: mídia em uso no site.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM _s_conta c JOIN public.profiles p ON p.id = c.id WHERE p.email NOT LIKE '%@lardan.test') THEN
    RAISE EXCEPTION 'Abortado: conta fora do domínio de teste no alvo.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.categories c
     WHERE c.slug LIKE _like AND (c.status = 'publicado'
       OR EXISTS (SELECT 1 FROM public.products p WHERE p.category_id = c.id AND p.slug NOT LIKE _like))) THEN
    RAISE EXCEPTION 'Abortado: categoria sintética publicada ou com dependente real.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.collections c
     WHERE c.slug LIKE _like AND (c.status = 'publicado'
       OR EXISTS (SELECT 1 FROM public.products p WHERE p.collection_id = c.id AND p.slug NOT LIKE _like))) THEN
    RAISE EXCEPTION 'Abortado: coleção sintética publicada ou com dependente real.' USING ERRCODE = '42501';
  END IF;

  _antes := jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'product_variants', (SELECT count(*) FROM public.product_variants),
    'variant_costs', (SELECT count(*) FROM public.variant_costs),
    'categories', (SELECT count(*) FROM public.categories),
    'collections', (SELECT count(*) FROM public.collections),
    'suppliers', (SELECT count(*) FROM public.suppliers),
    'locations', (SELECT count(*) FROM public.locations),
    'stock_balances', (SELECT count(*) FROM public.stock_balances),
    'stock_movements', (SELECT count(*) FROM public.stock_movements),
    'stock_reservations', (SELECT count(*) FROM public.stock_reservations),
    'import_files', (SELECT count(*) FROM public.import_files),
    'import_jobs', (SELECT count(*) FROM public.import_jobs),
    'import_rows', (SELECT count(*) FROM public.import_rows),
    'parties', (SELECT count(*) FROM public.parties),
    'profiles', (SELECT count(*) FROM public.profiles),
    'media_assets', (SELECT count(*) FROM public.media_assets),
    'audit_logs', (SELECT count(*) FROM public.audit_logs),
    'unidades_dep01', (SELECT coalesce(sum(quantity), 0) FROM public.stock_balances WHERE location_id = _dep01)
  );

  _plano := jsonb_build_object(
    'produtos', (SELECT count(*) FROM _s_prod),
    'variantes', (SELECT count(*) FROM _s_var),
    'custos', (SELECT count(*) FROM public.variant_costs WHERE variant_id IN (SELECT id FROM _s_var)),
    'movimentos', (SELECT count(*) FROM _s_mov),
    'saldos', (SELECT count(*) FROM public.stock_balances
                WHERE variant_id IN (SELECT id FROM _s_var) OR location_id IN (SELECT id FROM _s_loc)),
    'unidades_sinteticas', (SELECT coalesce(sum(quantity), 0) FROM public.stock_balances
                WHERE variant_id IN (SELECT id FROM _s_var) OR location_id IN (SELECT id FROM _s_loc)),
    'precos_publicos', (SELECT count(*) FROM public.public_price_list WHERE product_id IN (SELECT id FROM _s_prod)),
    'vinculos_midia', (SELECT count(*) FROM public.product_media WHERE product_id IN (SELECT id FROM _s_prod)),
    'categorias', (SELECT count(*) FROM public.categories WHERE slug LIKE _like),
    'colecoes', (SELECT count(*) FROM public.collections WHERE slug LIKE _like),
    'fornecedores', (SELECT count(*) FROM public.suppliers WHERE name LIKE upper(_prefixo) || '%'),
    'locais', (SELECT count(*) FROM _s_loc),
    'import_files', (SELECT count(*) FROM public.import_files),
    'import_jobs', (SELECT count(*) FROM _s_job),
    'import_rows', (SELECT count(*) FROM public.import_rows),
    'pessoas_removidas', (SELECT count(*) FROM _s_party_del),
    'pessoas_anonimizadas', (SELECT count(*) FROM _s_party_anon),
    'contas_desativadas', (SELECT count(*) FROM _s_conta),
    'midias_orfas', (SELECT count(*) FROM _s_media)
  );

  FOR _k IN SELECT jsonb_object_keys(_limites) LOOP
    _esperado := (_limites ->> _k)::bigint;
    _atual := coalesce((_plano ->> _k)::bigint, -1);
    IF _atual IS DISTINCT FROM _esperado THEN
      _diff := _diff || jsonb_build_object(_k, jsonb_build_object('aprovado', _esperado, 'atual', _atual));
    END IF;
  END LOOP;

  IF _diff <> '{}'::jsonb THEN
    IF _modo = 'executar' THEN
      RAISE EXCEPTION 'Abortado antes da primeira exclusão: contagens divergentes %', _diff::text
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('ok', false, 'modo', _modo, 'antes', _antes, 'plano', _plano,
                              'divergencias', _diff, 'protegidos', to_jsonb(_canon));
  END IF;

  IF _brinco IS NOT NULL THEN
    _n := (SELECT count(*) FROM public.stock_reservations r
            JOIN public.product_variants v ON v.id = r.variant_id
           WHERE v.product_id = _brinco AND r.status = 'ativa');
    _plano := _plano || jsonb_build_object('brinco01_reservas_ativas', _n,
      'brinco01_fisico', (SELECT coalesce(sum(b.quantity), 0) FROM public.stock_balances b
                           JOIN public.product_variants v ON v.id = b.variant_id WHERE v.product_id = _brinco));
  END IF;

  IF _modo = 'simular' THEN
    RETURN jsonb_build_object('ok', true, 'modo', 'simular', 'antes', _antes, 'plano', _plano,
                              'divergencias', '{}'::jsonb, 'protegidos', to_jsonb(_canon),
                              'duracao_ms', extract(milliseconds FROM clock_timestamp() - _t0));
  END IF;

  PERFORM set_config('lardan.purge_v2', _rollback_id, true);

  INSERT INTO public.homolog_purge_runs (idempotency_key, rollback_id, modo, prefixo, ator, motivo, antes)
  VALUES (_idempotency_key, _rollback_id, _modo, _prefixo, _ator, _motivo, _antes)
  RETURNING id INTO _run_id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_ator, 'homolog_purge_v2.inicio', 'homolog_purge_runs', _run_id::text,
          jsonb_build_object('rollback_id', _rollback_id, 'motivo', _motivo, 'plano', _plano, 'antes', _antes));

  _removidos := '{}'::jsonb;

  UPDATE public.stock_reservations r
     SET status = 'cancelada', released_at = now(),
         cancel_reason = 'Encerramento controlado da homologação'
    FROM public.product_variants v
   WHERE v.id = r.variant_id AND v.product_id = _brinco AND r.status = 'ativa';
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('brinco01_reservas_canceladas', _n);

  UPDATE public.stock_balances b
     SET reserved = (SELECT coalesce(sum(r.quantity), 0) FROM public.stock_reservations r
                      WHERE r.variant_id = b.variant_id AND r.location_id = b.location_id AND r.status = 'ativa'),
         updated_at = now()
    FROM public.product_variants v
   WHERE v.id = b.variant_id AND v.product_id = _brinco;

  UPDATE public.stock_balances b
     SET quantity = 0, updated_at = now()
    FROM public.product_variants v
   WHERE v.id = b.variant_id AND v.product_id = _brinco AND b.quantity <> 0;
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('brinco01_saldos_zerados', _n);

  UPDATE public.products SET status = 'arquivado', published_at = NULL, is_featured = false,
         is_new_arrival = false, updated_at = now()
   WHERE id = _brinco;
  UPDATE public.product_variants SET is_active = false, updated_at = now() WHERE product_id = _brinco;
  DELETE FROM public.public_price_list WHERE product_id = _brinco;

  UPDATE public.import_rows SET product_id = NULL, variant_id = NULL, movement_id = NULL
   WHERE product_id IS NOT NULL OR variant_id IS NOT NULL OR movement_id IS NOT NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('import_rows_desvinculadas', _n);

  UPDATE public.stock_movements SET reservation_id = NULL
   WHERE id IN (SELECT id FROM _s_mov) AND reservation_id IS NOT NULL;

  INSERT INTO public.homolog_purge_scope (movement_id, run_id) SELECT id, _run_id FROM _s_mov;
  DELETE FROM public.stock_movements WHERE id IN (SELECT id FROM _s_mov);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('stock_movements', _n);

  DELETE FROM public.stock_balances
   WHERE variant_id IN (SELECT id FROM _s_var) OR location_id IN (SELECT id FROM _s_loc);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('stock_balances', _n);

  DELETE FROM public.variant_costs WHERE variant_id IN (SELECT id FROM _s_var);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('variant_costs', _n);

  DELETE FROM public.public_price_list WHERE product_id IN (SELECT id FROM _s_prod);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('public_price_list', _n);

  DELETE FROM public.product_media WHERE product_id IN (SELECT id FROM _s_prod);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('product_media', _n);

  DELETE FROM public.product_variants WHERE id IN (SELECT id FROM _s_var);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('product_variants', _n);

  DELETE FROM public.products WHERE id IN (SELECT id FROM _s_prod);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('products', _n);

  DELETE FROM public.categories c WHERE c.slug LIKE _like
     AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.category_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.categories f WHERE f.parent_id = c.id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('categories', _n);

  DELETE FROM public.collections c WHERE c.slug LIKE _like
     AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.collection_id = c.id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('collections', _n);

  DELETE FROM public.suppliers s WHERE s.name LIKE upper(_prefixo) || '%'
     AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.supplier_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM public.variant_costs vc WHERE vc.supplier_id = s.id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('suppliers', _n);

  DELETE FROM public.locations l WHERE l.id IN (SELECT id FROM _s_loc) AND l.id <> _dep01
     AND NOT EXISTS (SELECT 1 FROM public.stock_balances b WHERE b.location_id = l.id)
     AND NOT EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.from_location_id = l.id OR m.to_location_id = l.id)
     AND NOT EXISTS (SELECT 1 FROM public.stock_reservations r WHERE r.location_id = l.id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('locations', _n);

  DELETE FROM public.import_rows WHERE job_id IN (SELECT id FROM _s_job);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('import_rows', _n);

  DELETE FROM public.import_jobs WHERE id IN (SELECT id FROM _s_job);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('import_jobs', _n);

  DELETE FROM public.import_files;
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('import_files', _n);

  DELETE FROM public.party_addresses WHERE party_id IN (SELECT id FROM _s_party_del);
  DELETE FROM public.contact_points WHERE party_id IN (SELECT id FROM _s_party_del);
  DELETE FROM public.party_roles WHERE party_id IN (SELECT id FROM _s_party_del);
  DELETE FROM public.party_links WHERE party_id IN (SELECT id FROM _s_party_del);
  DELETE FROM public.consultant_profiles WHERE party_id IN (SELECT id FROM _s_party_del);
  UPDATE public.consultant_profiles SET representative_party_id = NULL
   WHERE representative_party_id IN (SELECT id FROM _s_party_del);
  UPDATE public.consultant_profiles SET sponsor_party_id = NULL
   WHERE sponsor_party_id IN (SELECT id FROM _s_party_del);
  UPDATE public.suppliers SET party_id = NULL WHERE party_id IN (SELECT id FROM _s_party_del);
  UPDATE public.business_entities SET party_id = NULL WHERE party_id IN (SELECT id FROM _s_party_del);
  UPDATE public.leads SET party_id = NULL WHERE party_id IN (SELECT id FROM _s_party_del);
  DELETE FROM public.external_data_applications WHERE party_id IN (SELECT id FROM _s_party_del);
  DELETE FROM public.parties WHERE id IN (SELECT id FROM _s_party_del);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('parties', _n);

  UPDATE public.parties
     SET display_name = 'Registro histórico de homologação',
         legal_name = NULL, social_name = NULL, doc = NULL, rg = NULL, rg_issuer = NULL,
         birth_date = NULL, profession = NULL, marital_status = NULL, avatar_url = NULL,
         notes = 'Anonimizado no encerramento controlado da homologação.',
         status = 'inativo', is_active = false, updated_at = now()
   WHERE id IN (SELECT id FROM _s_party_anon);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('parties_anonimizadas', _n);
  DELETE FROM public.party_addresses WHERE party_id IN (SELECT id FROM _s_party_anon);
  DELETE FROM public.contact_points WHERE party_id IN (SELECT id FROM _s_party_anon);
  DELETE FROM public.party_roles WHERE party_id IN (SELECT id FROM _s_party_anon);

  UPDATE public.profiles
     SET is_active = false,
         full_name = 'Conta de homologação encerrada',
         display_name = NULL, phone = NULL, avatar_url = NULL, job_title = NULL,
         email = 'encerrada+' || left(id::text, 8) || '@homologacao.invalido',
         updated_at = now()
   WHERE id IN (SELECT id FROM _s_conta);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('contas_encerradas', _n);

  DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM _s_conta);

  DELETE FROM public.media_assets WHERE id IN (SELECT id FROM _s_media);
  GET DIAGNOSTICS _n = ROW_COUNT;
  _removidos := _removidos || jsonb_build_object('media_assets', _n);

  IF (SELECT count(*) FROM public.products WHERE id = ANY (_prot_ids) AND status = 'publicado') <> 20 THEN
    RAISE EXCEPTION 'Invariante quebrada: produtos protegidos publicados <> 20.';
  END IF;
  IF (SELECT count(*) FROM public.product_variants WHERE product_id = ANY (_prot_ids)) <> 38 THEN
    RAISE EXCEPTION 'Invariante quebrada: variantes protegidas <> 38.';
  END IF;
  IF (SELECT count(*) FROM public.product_media WHERE product_id = ANY (_prot_ids)) <> 40 THEN
    RAISE EXCEPTION 'Invariante quebrada: fotos protegidas <> 40.';
  END IF;
  IF (SELECT count(*) FROM public.categories WHERE status = 'publicado') <> 4 THEN
    RAISE EXCEPTION 'Invariante quebrada: categorias publicadas <> 4.';
  END IF;
  IF (SELECT coalesce(sum(b.quantity), 0) FROM public.stock_balances b
       JOIN public.product_variants v ON v.id = b.variant_id
      WHERE v.product_id = ANY (_prot_ids)) <> 240 THEN
    RAISE EXCEPTION 'Invariante quebrada: unidades dos 20 produtos <> 240.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_balances WHERE reserved < 0 OR reserved > quantity) THEN
    RAISE EXCEPTION 'Invariante quebrada: reservado negativo ou maior que o físico.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE slug LIKE _like) THEN
    RAISE EXCEPTION 'Invariante quebrada: ainda existem produtos sintéticos.';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs) < (_antes ->> 'audit_logs')::bigint THEN
    RAISE EXCEPTION 'Invariante quebrada: auditoria foi reduzida.';
  END IF;

  _depois := jsonb_build_object(
    'products', (SELECT count(*) FROM public.products),
    'product_variants', (SELECT count(*) FROM public.product_variants),
    'variant_costs', (SELECT count(*) FROM public.variant_costs),
    'categories', (SELECT count(*) FROM public.categories),
    'collections', (SELECT count(*) FROM public.collections),
    'suppliers', (SELECT count(*) FROM public.suppliers),
    'locations', (SELECT count(*) FROM public.locations),
    'stock_balances', (SELECT count(*) FROM public.stock_balances),
    'stock_movements', (SELECT count(*) FROM public.stock_movements),
    'stock_reservations', (SELECT count(*) FROM public.stock_reservations),
    'import_files', (SELECT count(*) FROM public.import_files),
    'import_jobs', (SELECT count(*) FROM public.import_jobs),
    'import_rows', (SELECT count(*) FROM public.import_rows),
    'parties', (SELECT count(*) FROM public.parties),
    'profiles', (SELECT count(*) FROM public.profiles),
    'media_assets', (SELECT count(*) FROM public.media_assets),
    'audit_logs', (SELECT count(*) FROM public.audit_logs),
    'unidades_dep01', (SELECT coalesce(sum(quantity), 0) FROM public.stock_balances WHERE location_id = _dep01)
  );

  DELETE FROM public.homolog_purge_scope WHERE run_id = _run_id;

  _res := jsonb_build_object('ok', true, 'modo', 'executar', 'run_id', _run_id,
    'rollback_id', _rollback_id, 'ator', _ator, 'motivo', _motivo,
    'antes', _antes, 'plano', _plano, 'removidos', _removidos, 'depois', _depois,
    'protegidos', to_jsonb(_canon), 'repetido', false,
    'duracao_ms', extract(milliseconds FROM clock_timestamp() - _t0));

  UPDATE public.homolog_purge_runs
     SET depois = _depois, resultado = _res, finished_at = now()
   WHERE id = _run_id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_ator, 'homolog_purge_v2.fim', 'homolog_purge_runs', _run_id::text, _res);

  PERFORM set_config('lardan.purge_v2', '', true);
  RETURN _res;
END $function$;

REVOKE ALL ON FUNCTION public.homolog_purge_v2(text, text, text, text, text[], jsonb, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.homolog_purge_v2(text, text, text, text, text[], jsonb, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homolog_purge_v2(text, text, text, text, text[], jsonb, uuid, text, text) TO service_role;