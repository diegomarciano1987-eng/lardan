-- ============================================================================
-- 0116 — Correções do histórico SmallData (JFLEX) achadas na revisão de 22/10
--
-- 1. Valor devolvido zerado em maletas acertadas de remessas ainda abertas
--    (857–874 e 5 casos antigos): o arquivo de maletas trouxe peças devolvidas
--    com valor devolvido = 0, e o valor vendido saiu igual ao valor enviado.
--    Na carga real são 282 maletas e R$ 1,6 mi a mais de "venda" (14% do
--    total). O valor certo está nas categorias da própria maleta. Corrige o
--    que já está no banco e as próximas importações, em qualquer ordem.
--
-- 2. Consultoras cadastradas pela rotina 0114/0115 entraram todas como
--    "ativo", sem praça, e sem checagem de nome repetido. Aqui:
--      * legado_cadastros_revisao(): relatório para o Master (só contagens e
--        possíveis duplicadas por nome, CPF mascarado);
--      * legado_cadastros_ajustar(_aplicar): prévia por padrão; aplicando,
--        põe a praça e deixa inativa quem estava inativa no JFLEX ou sem
--        maleta há mais de 12 meses. Só mexe em cadastro criado pela rotina
--        e SEM nenhuma operação no Lardan (maleta, título, pedido, login).
--      * a rotina de cadastro passa a fazer isso sozinha e a pular quem tem
--        nome igual a um cadastro existente (fica para vínculo manual).
-- ============================================================================

-- ------------------------------------------------ 1. valor devolvido ---
CREATE OR REPLACE FUNCTION public.legado_maleta_valor_devolvido(_remessa int, _codcli int, _kit int)
RETURNS bigint LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT nullif(sum(valor_devolvido_cents), 0)::bigint FROM legado_maleta_categorias
   WHERE remessa = _remessa AND codcli = _codcli AND kit = _kit
$$;
REVOKE ALL ON FUNCTION public.legado_maleta_valor_devolvido(int,int,int) FROM PUBLIC, anon, authenticated;

-- maleta importada depois das categorias
CREATE OR REPLACE FUNCTION public.legado_maletas_corrige_valor()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.pecas_devolvidas > 0 AND coalesce(NEW.valor_devolvido_cents, 0) = 0 THEN
    NEW.valor_devolvido_cents := coalesce(public.legado_maleta_valor_devolvido(NEW.remessa, NEW.codcli, NEW.kit), 0);
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS legado_maletas_corrige_valor ON public.legado_maletas;
CREATE TRIGGER legado_maletas_corrige_valor BEFORE INSERT OR UPDATE ON public.legado_maletas
  FOR EACH ROW EXECUTE FUNCTION public.legado_maletas_corrige_valor();

-- categorias importadas depois da maleta (ordem normal da tela)
CREATE OR REPLACE FUNCTION public.legado_categorias_corrige_maleta()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  UPDATE legado_maletas m SET valor_devolvido_cents = s.v
    FROM (SELECT c.remessa, c.codcli, c.kit, sum(c.valor_devolvido_cents) v
            FROM legado_maleta_categorias c
           WHERE (c.remessa, c.codcli, c.kit) IN (SELECT DISTINCT n.remessa, n.codcli, n.kit FROM novas n)
           GROUP BY 1, 2, 3) s
   WHERE m.remessa = s.remessa AND m.codcli = s.codcli AND m.kit = s.kit
     AND m.pecas_devolvidas > 0 AND m.valor_devolvido_cents = 0 AND s.v > 0;
  RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS legado_categorias_corrige_maleta_ins ON public.legado_maleta_categorias;
DROP TRIGGER IF EXISTS legado_categorias_corrige_maleta_upd ON public.legado_maleta_categorias;
CREATE TRIGGER legado_categorias_corrige_maleta_ins AFTER INSERT ON public.legado_maleta_categorias
  REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.legado_categorias_corrige_maleta();
CREATE TRIGGER legado_categorias_corrige_maleta_upd AFTER UPDATE ON public.legado_maleta_categorias
  REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.legado_categorias_corrige_maleta();

-- o que já está no banco
UPDATE public.legado_maletas m SET valor_devolvido_cents = s.v
  FROM (SELECT remessa, codcli, kit, sum(valor_devolvido_cents) v FROM public.legado_maleta_categorias GROUP BY 1, 2, 3) s
 WHERE m.remessa = s.remessa AND m.codcli = s.codcli AND m.kit = s.kit
   AND m.pecas_devolvidas > 0 AND m.valor_devolvido_cents = 0 AND s.v > 0;

-- ------------------------------------- 2. cadastros criados pelo histórico ---
-- Cadastro criado pela rotina e ainda sem nenhuma operação no Lardan.
CREATE OR REPLACE FUNCTION public.legado_cadastro_sem_operacao(_party uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM audit_logs a WHERE a.action = 'legado.consultora_cadastrada' AND a.entity_id = _party::text)
     AND NOT EXISTS (SELECT 1 FROM kit_cycles k WHERE _party IN (k.consultora_party_id, k.representante_party_id, k.custodian_party_id))
     AND NOT EXISTS (SELECT 1 FROM financial_titles t WHERE _party IN (t.party_id, t.pagador_party_id))
     AND NOT EXISTS (SELECT 1 FROM sales_orders o WHERE _party IN (o.consultora_party_id, o.customer_party_id, o.pay_party_id))
     AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.party_id = _party)
$$;
REVOKE ALL ON FUNCTION public.legado_cadastro_sem_operacao(uuid) FROM PUBLIC, anon, authenticated;

-- Situação que o cadastro deveria ter, pelo JFLEX: ativa só se ativa lá E com maleta nos últimos 12 meses.
CREATE OR REPLACE FUNCTION public.legado_status_esperado(_codcli int)
RETURNS public.party_status LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN coalesce(lc.ativo, false)
                AND (SELECT max(m.emissao) FROM legado_maletas m WHERE m.codcli = lc.codcli) >= current_date - 365
              THEN 'ativo' ELSE 'inativo' END::public.party_status
    FROM legado_consultoras lc WHERE lc.codcli = _codcli
$$;
REVOKE ALL ON FUNCTION public.legado_status_esperado(int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.legado_cadastros_revisao()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['master']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só o Master.' USING errcode = '42501';
  END IF;
  WITH criadas AS (
    SELECT p.id, p.status, p.display_name, lc.codcli, lc.praca, cp.praca_id, public.legado_status_esperado(lc.codcli) esperado,
           public.legado_cadastro_sem_operacao(p.id) livre
      FROM audit_logs a JOIN parties p ON p.id::text = a.entity_id
      JOIN legado_consultoras lc ON lc.party_id = p.id
      LEFT JOIN consultant_profiles cp ON cp.party_id = p.id
     WHERE a.action = 'legado.consultora_cadastrada'),
  dup AS (
    SELECT c.id criada, c.codcli, c.display_name, q.id outra, q.display_name outra_nome,
           CASE WHEN q.doc_digits IS NULL THEN NULL ELSE '***.' || substr(q.doc_digits, 4, 3) || '.***-**' END outra_cpf
      FROM criadas c JOIN parties q ON q.id <> c.id AND q.kind = 'pessoa'
       AND public.fin_unaccent_lower(btrim(q.display_name)) = public.fin_unaccent_lower(btrim(c.display_name))
       AND NOT EXISTS (SELECT 1 FROM audit_logs a2 WHERE a2.action = 'legado.consultora_cadastrada' AND a2.entity_id = q.id::text))
  SELECT jsonb_build_object(
    'criadas', (SELECT count(*) FROM criadas),
    'ativas', (SELECT count(*) FROM criadas WHERE status = 'ativo'),
    'deveriam_estar_inativas', (SELECT count(*) FROM criadas WHERE status = 'ativo' AND esperado = 'inativo'),
    'sem_praca', (SELECT count(*) FROM criadas WHERE praca_id IS NULL),
    'praca_disponivel', (SELECT count(*) FROM criadas c JOIN legado_pracas lp ON lp.codigo = c.praca WHERE c.praca_id IS NULL AND lp.praca_id IS NOT NULL),
    'com_operacao_no_lardan', (SELECT count(*) FROM criadas WHERE NOT livre),
    'possiveis_duplicadas', (SELECT count(DISTINCT criada) FROM dup),
    'duplicadas', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.display_name), '[]'::jsonb) FROM (SELECT * FROM dup LIMIT 300) d))
  INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.legado_cadastros_revisao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_cadastros_revisao() TO authenticated;

CREATE OR REPLACE FUNCTION public.legado_cadastros_ajustar(_aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE n_praca int := 0; n_inativas int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['master']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só o Master.' USING errcode = '42501';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _leg_aj (party_id uuid, codcli int, praca_id uuid, esperado public.party_status) ON COMMIT DROP;
  TRUNCATE _leg_aj;
  INSERT INTO _leg_aj
  SELECT p.id, lc.codcli, lp.praca_id, public.legado_status_esperado(lc.codcli)
    FROM audit_logs a JOIN parties p ON p.id::text = a.entity_id
    JOIN legado_consultoras lc ON lc.party_id = p.id
    LEFT JOIN legado_pracas lp ON lp.codigo = lc.praca
   WHERE a.action = 'legado.consultora_cadastrada' AND public.legado_cadastro_sem_operacao(p.id);

  SELECT count(*) INTO n_praca FROM _leg_aj j JOIN consultant_profiles cp ON cp.party_id = j.party_id
   WHERE cp.praca_id IS NULL AND j.praca_id IS NOT NULL;
  SELECT count(*) INTO n_inativas FROM _leg_aj j JOIN parties p ON p.id = j.party_id
   WHERE j.esperado = 'inativo' AND p.status = 'ativo';

  IF _aplicar THEN
    UPDATE consultant_profiles cp SET praca_id = j.praca_id FROM _leg_aj j
     WHERE cp.party_id = j.party_id AND cp.praca_id IS NULL AND j.praca_id IS NOT NULL;
    UPDATE parties p SET status = 'inativo', is_active = false FROM _leg_aj j
     WHERE p.id = j.party_id AND j.esperado = 'inativo' AND p.status = 'ativo';
    UPDATE party_roles r SET status = 'inativo' FROM _leg_aj j
     WHERE r.party_id = j.party_id AND r.role = 'consultora' AND j.esperado = 'inativo' AND r.status = 'ativo';
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'legado.cadastros_ajustados', 'parties', 'jflex',
            jsonb_build_object('praca_definida', n_praca, 'inativadas', n_inativas));
  END IF;
  RETURN jsonb_build_object('aplicado', _aplicar, 'cadastros_sem_operacao', (SELECT count(*) FROM _leg_aj),
                            'praca_definida', n_praca, 'inativadas', n_inativas);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_cadastros_ajustar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_cadastros_ajustar(boolean) TO authenticated;

-- A rotina de cadastro (0115) passa a: pular nome igual a cadastro existente,
-- definir a praça e criar inativa quem não está ativa no JFLEX.
CREATE OR REPLACE FUNCTION public.legado_consultoras_cadastrar(_lote text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l record; pid uuid; d text; st public.party_status;
  criadas int := 0; puladas int := 0; nao_pessoa int := 0; mesmo_nome int := 0;
BEGIN
  IF NOT (coalesce(auth.role(),'') = 'service_role' AND auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Somente servidor.' USING errcode = '42501';
  END IF;
  IF length(coalesce(_lote,'')) < 4 THEN RAISE EXCEPTION 'Informe o lote.'; END IF;
  FOR l IN
    SELECT * FROM legado_consultoras lc
     WHERE lc.party_id IS NULL AND EXISTS (SELECT 1 FROM legado_maletas m WHERE m.codcli = lc.codcli)
     ORDER BY lc.codcli FOR UPDATE
  LOOP
    d := nullif(regexp_replace(coalesce(l.cpf,''), '\D', '', 'g'), '');
    IF upper(coalesce(l.nome,'')) ~ '(LARDAN|MALETA|DESIGN)' OR d ~ '^(\d)\1{10}$' THEN nao_pessoa := nao_pessoa + 1; CONTINUE; END IF;
    IF d IS NOT NULL AND EXISTS (SELECT 1 FROM parties p WHERE p.doc_digits = d) THEN puladas := puladas + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM party_codigos_legados c WHERE c.sistema = 'cliente' AND c.codigo = l.codcli::text) THEN puladas := puladas + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM parties p WHERE p.kind = 'pessoa'
                AND public.fin_unaccent_lower(btrim(p.display_name)) = public.fin_unaccent_lower(btrim(l.nome))) THEN
      mesmo_nome := mesmo_nome + 1; CONTINUE;   -- pode ser a mesma pessoa sem CPF: vínculo manual
    END IF;
    IF d IS NOT NULL AND (length(d) <> 11 OR NOT public.doc_is_valid(public.doc_canon(d))) THEN d := NULL; END IF;
    st := public.legado_status_esperado(l.codcli);
    INSERT INTO parties (kind, display_name, legal_name, doc, birth_date, status, is_active, doc_source, notes)
    VALUES ('pessoa', btrim(l.nome), btrim(l.nome), d, l.nascimento, st, st = 'ativo', CASE WHEN d IS NULL THEN NULL ELSE 'jflex' END,
            'Cadastrada a partir do histórico JFLEX (cód. ' || l.codcli || ', lote ' || _lote || ').')
    RETURNING id INTO pid;
    INSERT INTO party_roles (party_id, role, status, started_at, notes)
    VALUES (pid, 'consultora', st, coalesce(l.cadastro_em, current_date), 'Histórico JFLEX');
    INSERT INTO consultant_profiles (party_id, praca_id)
    VALUES (pid, (SELECT lp.praca_id FROM legado_pracas lp WHERE lp.codigo = l.praca)) ON CONFLICT DO NOTHING;
    IF coalesce(l.rua, l.cidade) IS NOT NULL THEN
      INSERT INTO party_addresses (party_id, label, postal_code, street, street_number, no_number, complement, district, city, uf, ibge_city_code, is_primary, country, address_source)
      VALUES (pid, 'Principal', nullif(regexp_replace(coalesce(l.cep,''),'\D','','g'),''), l.rua, nullif(btrim(l.numero),''),
              nullif(btrim(l.numero),'') IS NULL, l.complemento, l.bairro, l.cidade, l.uf, l.ibge, true, 'BR', 'jflex');
    END IF;
    IF nullif(regexp_replace(coalesce(l.celular,''),'\D','','g'),'') IS NOT NULL THEN
      INSERT INTO contact_points (party_id, kind, label, value, is_primary) VALUES (pid, 'whatsapp', 'Celular', l.celular, true);
    END IF;
    IF nullif(btrim(coalesce(l.email,'')),'') IS NOT NULL THEN
      INSERT INTO contact_points (party_id, kind, label, value, is_primary) VALUES (pid, 'email', 'E-mail', btrim(l.email), false);
    END IF;
    INSERT INTO party_codigos_legados (party_id, sistema, codigo) VALUES (pid, 'cliente', l.codcli::text);
    UPDATE legado_consultoras SET party_id = pid, vinculo = 'codigo', vinculado_em = now() WHERE codcli = l.codcli;
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'legado.consultora_cadastrada', 'parties', pid::text,
            jsonb_build_object('codcli', l.codcli, 'lote', _lote, 'cpf_informado', d IS NOT NULL, 'status', st));
    criadas := criadas + 1;
  END LOOP;
  RETURN jsonb_build_object('criadas', criadas, 'puladas_ja_tem_cadastro', puladas, 'nao_pessoa', nao_pessoa,
                            'puladas_mesmo_nome', mesmo_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_consultoras_cadastrar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.legado_consultoras_cadastrar(text) TO service_role;