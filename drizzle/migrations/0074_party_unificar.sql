
CREATE TABLE IF NOT EXISTS public.party_unificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonica_id uuid NOT NULL REFERENCES public.parties(id),
  duplicada_id uuid NOT NULL REFERENCES public.parties(id),
  motivo text NOT NULL,
  movidos jsonb NOT NULL DEFAULT '{}',
  removidos jsonb NOT NULL DEFAULT '[]',
  antes_duplicada jsonb,
  autor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.party_unificacoes TO authenticated;
GRANT ALL ON public.party_unificacoes TO service_role;
ALTER TABLE public.party_unificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY party_unificacoes_ler ON public.party_unificacoes FOR SELECT TO authenticated USING (public.has_capability(auth.uid(),'registry.manage'));

CREATE OR REPLACE FUNCTION public.party_unificar(_canonica uuid, _duplicada uuid, _motivo text, _executar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE fk record; n bigint; prev jsonb := '{}'; mov jsonb := '{}'; rem jsonb := '[]'; ids jsonb; antes jsonb; can parties; dup parties; v uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.has_capability(auth.uid(),'registry.manage') AND (public.has_role(auth.uid(),'master') OR public.has_role(auth.uid(),'diretoria'))) THEN
    RAISE EXCEPTION 'Unificação exige Master ou Diretoria.'; END IF;
  IF _canonica = _duplicada THEN RAISE EXCEPTION 'Escolha dois cadastros diferentes.'; END IF;
  IF coalesce(btrim(_motivo),'') = '' THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  SELECT * INTO can FROM parties WHERE id=_canonica FOR UPDATE;
  SELECT * INTO dup FROM parties WHERE id=_duplicada FOR UPDATE;
  IF can.id IS NULL OR dup.id IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;
  IF dup.doc_digits IS NOT NULL AND can.doc_digits IS NOT NULL AND dup.doc_digits <> can.doc_digits THEN RAISE EXCEPTION 'Os dois cadastros têm CPFs diferentes: não são a mesma pessoa.'; END IF;
  IF EXISTS (SELECT 1 FROM consultant_profiles WHERE party_id=_duplicada) AND EXISTS (SELECT 1 FROM consultant_profiles WHERE party_id=_canonica) THEN
    RAISE EXCEPTION 'Os dois cadastros têm ficha de consultora: revisar à mão.'; END IF;
  IF EXISTS (SELECT 1 FROM vendedora_profiles WHERE party_id=_duplicada) AND EXISTS (SELECT 1 FROM vendedora_profiles WHERE party_id=_canonica) THEN
    RAISE EXCEPTION 'Os dois cadastros têm ficha de vendedora: revisar à mão.'; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE party_id=_duplicada) AND EXISTS (SELECT 1 FROM profiles WHERE party_id=_canonica) THEN
    RAISE EXCEPTION 'Os dois cadastros têm login próprio: revisar à mão.'; END IF;

  FOR fk IN SELECT c.conrelid::regclass::text t, a.attname::text col FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
     WHERE c.contype='f' AND c.confrelid='public.parties'::regclass AND c.conrelid <> 'public.party_unificacoes'::regclass LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I=$1', fk.t, fk.col) INTO n USING _duplicada;
    IF n > 0 THEN prev := prev || jsonb_build_object(fk.t||'.'||fk.col, n); END IF;
  END LOOP;
  IF NOT _executar THEN RETURN jsonb_build_object('previa',true,'canonica',can.code,'duplicada',dup.code,'registros',prev); END IF;

  antes := to_jsonb(dup) - 'doc' - 'doc_digits' - 'doc_canon' - 'rg';
  -- conflitos de chave única: papéis e caso de cobrança
  INSERT INTO party_roles(party_id, role, status) SELECT _canonica, r.role, r.status FROM party_roles r WHERE r.party_id=_duplicada
    AND NOT EXISTS (SELECT 1 FROM party_roles x WHERE x.party_id=_canonica AND x.role=r.role);
  rem := rem || coalesce((SELECT jsonb_agg(jsonb_build_object('tabela','party_roles','linha',to_jsonb(r))) FROM party_roles r WHERE r.party_id=_duplicada),'[]');
  DELETE FROM party_roles WHERE party_id=_duplicada;
  IF EXISTS (SELECT 1 FROM cob_casos WHERE party_id=_canonica) THEN
    rem := rem || coalesce((SELECT jsonb_agg(jsonb_build_object('tabela','cob_casos','linha',to_jsonb(c))) FROM cob_casos c WHERE c.party_id=_duplicada),'[]');
    DELETE FROM cob_casos WHERE party_id=_duplicada;
  END IF;
  -- move todo o resto, com as rotinas oficiais liberadas só nesta transação
  PERFORM set_config('lardann.asaas_intent','on',true); PERFORM set_config('lardann.asaas_link','on',true);
  PERFORM set_config('lardan.party_unificar','on',true);
  FOR fk IN SELECT c.conrelid::regclass::text t, a.attname::text col FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
     WHERE c.contype='f' AND c.confrelid='public.parties'::regclass AND c.conrelid <> 'public.party_unificacoes'::regclass LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(id),''[]'') FROM %s WHERE %I=$1', fk.t, fk.col) INTO ids USING _duplicada;
    IF jsonb_array_length(ids) > 0 THEN
      BEGIN
        EXECUTE format('UPDATE %s SET %I=$1 WHERE %I=$2', fk.t, fk.col, fk.col) USING _canonica, _duplicada;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Não deu para mover % (%): %. Nada foi alterado.', fk.t, fk.col, SQLERRM;
      END;
      mov := mov || jsonb_build_object(fk.t||'.'||fk.col, ids);
    END IF;
  END LOOP;
  PERFORM set_config('lardann.asaas_intent','off',true); PERFORM set_config('lardann.asaas_link','off',true);
  -- CPF: se só a duplicada tinha, passa para a canônica
  IF can.doc_digits IS NULL AND dup.doc_digits IS NOT NULL THEN
    UPDATE parties SET doc=NULL WHERE id=_duplicada;
    UPDATE parties SET doc=dup.doc_digits WHERE id=_canonica;
  END IF;
  UPDATE parties SET status='inativo', is_active=false,
    notes=coalesce(notes||E'\n','')||'Unificado em '||coalesce(can.code,_canonica::text)||' em '||to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')||' — '||_motivo
   WHERE id=_duplicada;
  UPDATE parties SET status=CASE WHEN status IN ('inativo','desligado') THEN 'ativo' ELSE status END, is_active=true WHERE id=_canonica;
  INSERT INTO party_unificacoes(canonica_id,duplicada_id,motivo,movidos,removidos,antes_duplicada,autor_id)
  VALUES(_canonica,_duplicada,_motivo,mov,rem,antes,auth.uid()) RETURNING id INTO v;
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'party.unificada','parties',_canonica::text,
    jsonb_build_object('unificacao',v,'canonica',can.code,'duplicada',dup.code,'registros',prev,'motivo',_motivo));
  RETURN jsonb_build_object('previa',false,'unificacao',v,'canonica',can.code,'duplicada',dup.code,'registros',prev);
END $$;
REVOKE ALL ON FUNCTION public.party_unificar(uuid,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_unificar(uuid,uuid,text,boolean) TO authenticated, service_role;

-- relatório de suspeitos de duplicidade: mesmo CPF, ou mesmo nome (sem acento/maiúscula) com no máximo um CPF
CREATE OR REPLACE FUNCTION public.party_duplicados()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability(auth.uid(),'registry.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(g ORDER BY g->>'chave') FROM (
    SELECT jsonb_build_object('chave',k,'tipo',tipo,'qtd',count(*),'cadastros',jsonb_agg(jsonb_build_object('id',id,'code',code,'nome',display_name,'cpf',doc_masked,'ativo',is_active,'papeis',(SELECT jsonb_agg(role) FROM party_roles r WHERE r.party_id=x.id)) ORDER BY (doc_digits IS NULL), created_at)) g
    FROM (SELECT p.*, CASE WHEN doc_digits IS NOT NULL THEN 'cpf:'||doc_digits END k1, 'nome:'||lower(unaccent_safe(display_name)) k2 FROM parties p WHERE p.kind='pessoa' AND p.status<>'inativo' OR true) x0
    CROSS JOIN LATERAL (VALUES (x0.k1,'mesmo CPF'),(x0.k2,'mesmo nome')) kv(k,tipo)
    JOIN parties x ON x.id=x0.id
    WHERE k IS NOT NULL
    GROUP BY k,tipo HAVING count(*)>1 AND (tipo='mesmo CPF' OR count(DISTINCT x0.doc_digits) <= 1)) q),'[]');
END $$;
