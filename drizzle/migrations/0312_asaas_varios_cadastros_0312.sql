-- 0312 — clientes com vários cadastros no Asaas (13/11/2026, plano aprovado pelo Diego).
-- Mesmo CPF = mesma pessoa: todos os cadastros Asaas da pessoa ficam 'vinculado' e o espelho do cadastro (Lardan manda) vai para
-- cada um. Um único cadastro "principal" por pessoa e conta recebe cobranças novas e reemissões pelo saldo; é escolhido sozinho
-- (o mais recente com boleto em aberto; empate pelo criado por último) e só muda por asaas_cliente_principal_trocar (motivo + auditoria).
-- Nenhum boleto é cancelado, reemitido ou alterado por esta mudança; nenhum dinheiro é lançado.

ALTER TABLE public.asaas_customers ADD COLUMN IF NOT EXISTS principal boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS asaas_customers_um_principal ON public.asaas_customers (account_id, party_id) WHERE principal;
COMMENT ON COLUMN public.asaas_customers.principal IS
  '0312: cadastro Asaas usado para cobranças novas quando a pessoa tem vários cadastros vinculados na mesma conta. Só muda por asaas_cliente_principal_escolher/asaas_cliente_principal_trocar.';

-- cadastro usado para cobrar: o único vinculado, ou o principal quando há vários (NULL = nenhum ou vários sem principal)
CREATE OR REPLACE FUNCTION public.asaas_cliente_principal_id(_account uuid, _party uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(c.id))[1]
              ELSE (array_agg(c.id) FILTER (WHERE c.principal))[1] END
    FROM public.asaas_customers c
   WHERE c.account_id = _account AND c.party_id = _party AND c.match_status = 'vinculado'
$$;
REVOKE ALL ON FUNCTION public.asaas_cliente_principal_id(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_principal_id(uuid, uuid) TO service_role;

-- escolha automática do principal (só quando há vários vinculados e nenhum principal)
CREATE OR REPLACE FUNCTION public.asaas_cliente_principal_escolher(_account uuid, _party uuid, _actor uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int; v uuid; esc record;
BEGIN
  IF _account IS NULL OR _party IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('asaas_principal:' || _account::text || ':' || _party::text, 0));
  SELECT count(*) INTO n FROM public.asaas_customers WHERE account_id = _account AND party_id = _party AND match_status = 'vinculado';
  IF n <= 1 THEN RETURN public.asaas_cliente_principal_id(_account, _party); END IF;
  SELECT id INTO v FROM public.asaas_customers WHERE account_id = _account AND party_id = _party AND match_status = 'vinculado' AND principal;
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT c.id, c.external_id, a.n AS abertas, coalesce(nullif(c.raw->>'dateCreated', ''), c.created_at::date::text) AS criado INTO esc
    FROM public.asaas_customers c
    LEFT JOIN LATERAL (SELECT count(*) AS n FROM public.asaas_charges h
                        WHERE h.account_id = c.account_id AND h.customer_external_id = c.external_id
                          AND h.external_status IN ('PENDING','OVERDUE')) a ON true
   WHERE c.account_id = _account AND c.party_id = _party AND c.match_status = 'vinculado'
   ORDER BY (a.n > 0) DESC, coalesce(nullif(c.raw->>'dateCreated', ''), c.created_at::date::text) DESC, c.external_id DESC
   LIMIT 1;
  -- um principal antigo que deixou de estar vinculado não pode segurar o índice
  UPDATE public.asaas_customers SET principal = false WHERE account_id = _account AND party_id = _party AND principal AND id <> esc.id;
  UPDATE public.asaas_customers SET principal = true, updated_at = now() WHERE id = esc.id;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_actor, 'asaas.cliente.principal_escolhido', 'parties', _party::text,
          jsonb_build_object('cliente', esc.external_id, 'cadastros', n, 'boletos_abertos', esc.abertas, 'criado_no_asaas', esc.criado,
                             'motivo', 'automático: o cadastro mais recente com boleto em aberto; empate pelo criado por último'));
  RETURN esc.id;
END $$;
REVOKE ALL ON FUNCTION public.asaas_cliente_principal_escolher(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_principal_escolher(uuid, uuid, uuid) TO service_role;

-- troca manual (casos raros): motivo obrigatório e auditoria
CREATE OR REPLACE FUNCTION public.asaas_cliente_principal_trocar(_customer uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.asaas_customers; antigo text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.asaas_ator_pode(auth.uid(), 'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM public.asaas_customers WHERE id = _customer;
  IF c.id IS NULL OR c.party_id IS NULL OR c.match_status <> 'vinculado' THEN
    RAISE EXCEPTION 'Este cadastro do Asaas não está ligado a uma cliente.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('asaas_principal:' || c.account_id::text || ':' || c.party_id::text, 0));
  IF c.principal THEN RETURN jsonb_build_object('ok', true, 'sem_mudanca', true, 'para', c.external_id); END IF;
  SELECT external_id INTO antigo FROM public.asaas_customers WHERE account_id = c.account_id AND party_id = c.party_id AND principal;
  UPDATE public.asaas_customers SET principal = false WHERE account_id = c.account_id AND party_id = c.party_id AND principal;
  UPDATE public.asaas_customers SET principal = true, updated_at = now() WHERE id = c.id;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'asaas.cliente.principal_trocado', 'parties', c.party_id::text,
          jsonb_build_object('de', antigo, 'para', c.external_id, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('ok', true, 'de', antigo, 'para', c.external_id);
END $$;
REVOKE ALL ON FUNCTION public.asaas_cliente_principal_trocar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_cliente_principal_trocar(uuid, text) TO authenticated, service_role;

-- quadro "Clientes com vários cadastros no Asaas" (só leitura)
CREATE OR REPLACE FUNCTION public.asaas_clientes_varios_cadastros()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.asaas_ator_pode(auth.uid(), 'finance.receivable.view') THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'pessoa') FROM (
      SELECT jsonb_build_object(
        'party_id', g.party_id, 'pessoa', p.display_name, 'codigo', p.code,
        'pendentes', count(*) FILTER (WHERE c.match_status = 'pendente'),
        'iguais', count(*) FILTER (WHERE e.estado IN ('igual','atualizado')),
        'principal', (array_agg(c.external_id) FILTER (WHERE c.principal AND c.match_status = 'vinculado'))[1],
        'cadastros', jsonb_agg(jsonb_build_object(
            'customer_id', c.id, 'external_id', c.external_id, 'principal', c.principal AND c.match_status = 'vinculado',
            'situacao', c.match_status, 'espelho', e.estado, 'conferido_em', e.conferido_em,
            'criado', coalesce(nullif(c.raw->>'dateCreated', ''), c.created_at::date::text),
            'abertas', (SELECT count(*) FROM asaas_charges h WHERE h.account_id = c.account_id AND h.customer_external_id = c.external_id AND h.external_status IN ('PENDING','OVERDUE')),
            'aberto_cents', (SELECT coalesce(sum(h.value_cents), 0) FROM asaas_charges h WHERE h.account_id = c.account_id AND h.customer_external_id = c.external_id AND h.external_status IN ('PENDING','OVERDUE')))
          ORDER BY (c.principal AND c.match_status = 'vinculado') DESC, coalesce(nullif(c.raw->>'dateCreated', ''), c.created_at::date::text) DESC, c.external_id DESC)) AS x
        FROM (SELECT party_id, account_id FROM asaas_customers WHERE party_id IS NOT NULL AND match_status IN ('vinculado','pendente')
               GROUP BY 1, 2 HAVING count(*) > 1) g
        JOIN parties p ON p.id = g.party_id
        JOIN asaas_customers c ON c.party_id = g.party_id AND c.account_id = g.account_id AND c.match_status IN ('vinculado','pendente')
        LEFT JOIN asaas_cliente_espelho e ON e.customer_id = c.id
       GROUP BY g.party_id, g.account_id, p.display_name, p.code) s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.asaas_clientes_varios_cadastros() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_clientes_varios_cadastros() TO authenticated, service_role;

-- ligar os cadastros pendentes do mesmo CPF e escolher o principal (prévia sem _aplicar; aplicar só Master do financeiro)
CREATE OR REPLACE FUNCTION public.asaas_duplicados_ligar(_aplicar boolean DEFAULT false, _party uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; lista jsonb := '[]'::jsonb; ligados int := 0; principais int := 0; v_actor uuid := auth.uid();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT (v_actor IS NOT NULL AND public.asaas_ator_pode(v_actor, 'finance.receivable.manage')
       AND (NOT coalesce(_aplicar, false) OR public.has_role(v_actor, 'master'))) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  FOR r IN
    SELECT c.id, c.external_id, c.account_id, c.party_id, p.display_name
      FROM asaas_customers c JOIN parties p ON p.id = c.party_id
     WHERE c.match_status = 'pendente' AND (_party IS NULL OR c.party_id = _party)
       AND length(coalesce(p.doc_digits, '')) IN (11, 14)
       AND regexp_replace(coalesce(c.doc, ''), '\D', '', 'g') = p.doc_digits
     ORDER BY p.display_name, c.external_id
  LOOP
    lista := lista || jsonb_build_object('pessoa', r.display_name, 'party_id', r.party_id, 'cliente', r.external_id);
    IF coalesce(_aplicar, false) THEN
      UPDATE asaas_customers SET match_status = 'vinculado', updated_at = now(),
             match_note = left(coalesce(nullif(match_note, '') || ' · ', '') || '0312: mesmo CPF da pessoa; todos os cadastros Asaas dela ficam ligados', 500)
       WHERE id = r.id AND match_status = 'pendente';
      INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
      VALUES (v_actor, 'asaas.cliente.vinculo_confirmado_0312', 'parties', r.party_id::text,
              jsonb_build_object('cliente', r.external_id, 'motivo', 'mesmo CPF da pessoa; vários cadastros no Asaas ligados juntos'));
      ligados := ligados + 1;
    END IF;
  END LOOP;
  IF coalesce(_aplicar, false) THEN
    FOR r IN SELECT account_id, party_id FROM asaas_customers
              WHERE match_status = 'vinculado' AND party_id IS NOT NULL AND (_party IS NULL OR party_id = _party)
              GROUP BY 1, 2 HAVING count(*) > 1 AND NOT bool_or(principal) LOOP
      PERFORM public.asaas_cliente_principal_escolher(r.account_id, r.party_id, v_actor);
      principais := principais + 1;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('aplicado', coalesce(_aplicar, false), 'pendentes_elegiveis', jsonb_array_length(lista),
                            'ligados', ligados, 'principais_escolhidos', principais, 'lista', lista);
END $$;
REVOKE ALL ON FUNCTION public.asaas_duplicados_ligar(boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_duplicados_ligar(boolean, uuid) TO authenticated, service_role;

-- cadastro automático: duplicado novo (mesmo CPF) já entra ligado; principal escolhido sozinho
CREATE OR REPLACE FUNCTION public.asaas_clientes_cadastrar(_actor uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cu record; d text; pid uuid; novos int := 0; ligados int := 0;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.has_capability(auth.uid(),'finance.settlement.create') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  FOR cu IN SELECT * FROM asaas_customers WHERE party_id IS NULL AND length(regexp_replace(coalesce(doc,''),'\D','','g')) IN (11,14) LOOP
    d := regexp_replace(cu.doc,'\D','','g');
    SELECT min(id::text)::uuid INTO pid FROM parties WHERE doc_digits = d HAVING count(*) = 1;
    IF pid IS NULL AND NOT EXISTS (SELECT 1 FROM parties WHERE doc_digits = d) THEN
      INSERT INTO parties(kind, display_name, legal_name, doc, doc_digits, status, notes, created_by)
      VALUES (CASE WHEN length(d)=14 THEN 'organizacao' ELSE 'pessoa' END::party_kind,
              coalesce(nullif(trim(cu.name),''),'Cliente Asaas '||cu.external_id), cu.name, d, d, 'ativo',
              'Cadastrado automaticamente a partir do cliente Asaas '||cu.external_id, _actor)
      RETURNING id INTO pid;
      INSERT INTO party_roles(party_id, role, status, notes, created_by)
      VALUES (pid, 'cliente', 'ativo', 'Origem: cobrança Asaas', _actor);
      novos := novos + 1;
      INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
      VALUES (_actor,'asaas.cliente.cadastro_automatico','parties',pid, jsonb_build_object('asaas_customer', cu.external_id));
    END IF;
    IF pid IS NOT NULL THEN
      -- 0312: mesmo CPF = mesma pessoa; todos os cadastros ficam ligados e um principal recebe as cobranças novas
      UPDATE asaas_customers SET party_id = pid, match_status = 'vinculado', updated_at = now() WHERE id = cu.id;
      UPDATE asaas_charges SET party_id = pid WHERE party_id IS NULL AND account_id = cu.account_id AND customer_external_id = cu.external_id;
      IF (SELECT count(*) FROM asaas_customers o WHERE o.party_id = pid AND o.account_id = cu.account_id AND o.match_status = 'vinculado') > 1 THEN
        PERFORM public.asaas_cliente_principal_escolher(cu.account_id, pid, _actor);
      END IF;
      ligados := ligados + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('novos', novos, 'ligados', ligados);
END $function$;

-- emissão e reemissão usam o principal ---------------------------------------------------------------------------------------
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.asaas_exec_cliente_reservar(uuid,text,integer,uuid,integer,integer)'::regprocedure); antes := def;
  IF position('asaas_cliente_principal_id' IN def) > 0 THEN RETURN; END IF;
  def := replace(def,
    $a$  IF n>1 THEN RETURN jsonb_build_object('reservada',false,'revisao',true,'motivo','Mais de um cliente vinculado; escolha canônica obrigatória.'); END IF;
  SELECT * INTO cu FROM public.asaas_customers WHERE account_id=it.account_id AND party_id=it.party_id AND match_status='vinculado';$a$,
    $b$  -- 0312: vários cadastros vinculados = usa o principal (escolhido sozinho se ainda não houver)
  IF n>1 AND public.asaas_cliente_principal_id(it.account_id,it.party_id) IS NULL THEN
    PERFORM public.asaas_cliente_principal_escolher(it.account_id,it.party_id,_actor);
  END IF;
  SELECT * INTO cu FROM public.asaas_customers WHERE id = public.asaas_cliente_principal_id(it.account_id,it.party_id);
  IF n>1 AND cu.id IS NULL THEN RETURN jsonb_build_object('reservada',false,'revisao',true,'motivo','Mais de um cliente vinculado e nenhum principal.'); END IF;$b$);
  IF def = antes THEN RAISE EXCEPTION '0312: ponto não encontrado em asaas_exec_cliente_reservar; revisar.'; END IF;
  EXECUTE def;
END $do$;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.asaas_cobranca_preparar_nucleo(jsonb,uuid,boolean)'::regprocedure); antes := def;
  IF position('asaas_cliente_principal_id' IN def) > 0 THEN RETURN; END IF;
  def := replace(def,
    $a$ IF n>1 THEN RAISE EXCEPTION 'Mais de um cliente Asaas vinculado: defina o canônico antes de cobrar.'; END IF;$a$,
    $b$ IF n>1 AND public.asaas_cliente_principal_id(conta.id,v_party) IS NULL THEN PERFORM public.asaas_cliente_principal_escolher(conta.id,v_party,_actor); END IF;
 IF n>1 AND public.asaas_cliente_principal_id(conta.id,v_party) IS NULL THEN RAISE EXCEPTION 'Mais de um cliente Asaas vinculado e nenhum principal.'; END IF;$b$);
  def := replace(def,
    $a$ SELECT * INTO cliente FROM public.asaas_customers WHERE account_id=conta.id AND party_id=v_party AND match_status='vinculado';$a$,
    $b$ SELECT * INTO cliente FROM public.asaas_customers WHERE id=public.asaas_cliente_principal_id(conta.id,v_party);$b$);
  IF position('asaas_cliente_principal_escolher' IN def) = 0 OR position('WHERE id=public.asaas_cliente_principal_id(conta.id,v_party)' IN def) = 0 THEN
    RAISE EXCEPTION '0312: ponto não encontrado em asaas_cobranca_preparar_nucleo; revisar.';
  END IF;
  EXECUTE def;
END $do$;

DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.asaas_saldo_plano(uuid,boolean)'::regprocedure); antes := def;
  IF position('asaas_cliente_principal_id' IN def) > 0 THEN RETURN; END IF;
  def := replace(def,
    $a$        IF v_clientes <> 1 THEN v_acao := 'excecao';$a$,
    $b$        -- 0312: vários cadastros com principal definido contam como um (a nova cobrança sai no principal)
        IF v_clientes > 1 AND public.asaas_cliente_principal_id(v_conta, v_party) IS NOT NULL THEN v_clientes := 1; END IF;
        IF v_clientes <> 1 THEN v_acao := 'excecao';$b$);
  IF def = antes THEN RAISE EXCEPTION '0312: ponto não encontrado em asaas_saldo_plano; revisar.'; END IF;
  EXECUTE def;
END $do$;

DO $do$ DECLARE def text; antes text; BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cob_acordo_cobrancas_preparar';
  antes := def;
  IF position('asaas_cliente_principal_id' IN def) > 0 THEN RETURN; END IF;
  def := replace(def,
    $a$  SELECT * INTO cliente FROM asaas_customers WHERE account_id=conta.id AND party_id=v_party AND match_status='vinculado' LIMIT 1;$a$,
    $b$  PERFORM public.asaas_cliente_principal_escolher(conta.id, v_party, auth.uid()); -- 0312: vários cadastros = principal
  SELECT * INTO cliente FROM asaas_customers WHERE id = public.asaas_cliente_principal_id(conta.id, v_party);$b$);
  IF def = antes THEN RAISE EXCEPTION '0312: ponto não encontrado em cob_acordo_cobrancas_preparar; revisar.'; END IF;
  EXECUTE def;
END $do$;
