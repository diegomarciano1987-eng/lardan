-- Corrige a aplicação da planilha do jurídico: o registro de auditoria usava uma coluna inexistente (diff), e a gravação falhava inteira.
CREATE OR REPLACE FUNCTION public.cob_judicial_planilha_importar(_linhas jsonb, _aplicar boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l jsonb; v_cpf text; v_num text; v_chave text; v_party uuid; n int; v_lote uuid := gen_random_uuid();
  tot int:=0; com int:=0; sem int:=0; amb int:=0; novos int:=0; atual int:=0; mover int:=0; ja int:=0;
  semlista jsonb := '[]'; ativo boolean; movidos uuid[] := '{}'; chaves text[] := '{}';
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF _aplicar AND NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'Somente o Master aplica a importação'; END IF;
  IF jsonb_typeof(_linhas) <> 'array' OR jsonb_array_length(_linhas) > 3000 THEN RAISE EXCEPTION 'Planilha inválida'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(_linhas) LOOP
    tot := tot+1;
    v_cpf := nullif(regexp_replace(coalesce(l->>'cpf',''),'\D','','g'),'');
    v_num := CASE WHEN coalesce(l->>'numero','') ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$' THEN l->>'numero' END;
    v_chave := CASE WHEN v_num IS NOT NULL THEN 'proc:'||v_num||':'||coalesce(v_cpf,'') ELSE 'plan:'||coalesce(l->>'id','?')||':'||coalesce(v_cpf,'') END;
    v_party := NULL; n := 0;
    IF length(v_cpf) >= 11 THEN
      SELECT count(*), min(id::text)::uuid INTO n, v_party FROM parties WHERE doc_digits = v_cpf;
      IF n > 1 THEN v_party := NULL; amb := amb+1; END IF;
    END IF;
    IF v_party IS NULL THEN
      sem := sem+1;
      IF jsonb_array_length(semlista) < 300 THEN semlista := semlista || jsonb_build_object('id',l->>'id','nome',l->>'nome','cpf',CASE WHEN v_cpf IS NULL THEN NULL ELSE left(v_cpf,3)||'.***.***-'||right(v_cpf,2) END,'motivo',CASE WHEN n>1 THEN 'CPF em mais de um cadastro' WHEN v_cpf IS NULL OR length(v_cpf)<11 THEN 'Sem CPF na planilha' ELSE 'CPF não cadastrado' END); END IF;
    ELSE com := com+1; END IF;
    IF NOT (v_chave = ANY(chaves)) THEN
      chaves := chaves || v_chave;
      IF EXISTS (SELECT 1 FROM cob_judicial_processos WHERE origem_chave=v_chave) THEN atual := atual+1; ELSE novos := novos+1; END IF;
    END IF;
    ativo := coalesce(l->>'status','') !~* 'extint';
    IF v_party IS NOT NULL AND ativo AND NOT (v_party = ANY(movidos)) THEN
      movidos := movidos || v_party;
      IF EXISTS (SELECT 1 FROM cob_casos WHERE party_id=v_party AND etapa='acompanhamento') THEN ja := ja+1; ELSE mover := mover+1; END IF;
    END IF;
    IF _aplicar THEN
      INSERT INTO cob_judicial_processos(origem_chave,party_id,cpf,nome,numero_processo,status,valor_causa_cents,valor_bloqueado_cents,fase,cidade,praca,responsavel,status_citacao,proxima_acao,tipo,link_pasta,ultima_atualizacao,planilha_id,lote,importado_por)
      VALUES (v_chave,v_party,v_cpf,left(l->>'nome',200),coalesce(v_num,nullif(l->>'numero','')),left(l->>'status',80),
        nullif(l->>'valor_causa_cents','')::bigint,nullif(l->>'valor_bloqueado_cents','')::bigint,left(l->>'fase',500),left(l->>'cidade',120),left(l->>'praca',120),
        left(l->>'responsavel',80),left(l->>'status_citacao',200),left(l->>'proxima_acao',4000),left(l->>'tipo',2000),
        CASE WHEN coalesce(l->>'link','') ~ '^https:/{2}' THEN left(l->>'link',1000) END,
        nullif(l->>'ultima_atualizacao','')::date,CASE WHEN l->>'id' ~ '^[0-9]{1,9}$' THEN (l->>'id')::int END,v_lote,auth.uid())
      ON CONFLICT (origem_chave) DO UPDATE SET party_id=excluded.party_id,nome=excluded.nome,numero_processo=excluded.numero_processo,status=excluded.status,
        valor_causa_cents=excluded.valor_causa_cents,valor_bloqueado_cents=excluded.valor_bloqueado_cents,fase=excluded.fase,cidade=excluded.cidade,praca=excluded.praca,
        responsavel=excluded.responsavel,status_citacao=excluded.status_citacao,proxima_acao=excluded.proxima_acao,tipo=excluded.tipo,
        link_pasta=coalesce(excluded.link_pasta,cob_judicial_processos.link_pasta),ultima_atualizacao=excluded.ultima_atualizacao,planilha_id=excluded.planilha_id,lote=excluded.lote,updated_at=now();
      IF v_party IS NOT NULL AND ativo THEN
        INSERT INTO cob_judicial(party_id,processo,comarca,advogado,observacao,encaminhado_por,updated_by)
        VALUES (v_party,v_num,left(l->>'cidade',120),left(l->>'responsavel',80),'Importado da planilha do jurídico',auth.uid(),auth.uid())
        ON CONFLICT (party_id) DO UPDATE SET processo=coalesce(cob_judicial.processo,excluded.processo),comarca=coalesce(cob_judicial.comarca,excluded.comarca),
          advogado=coalesce(cob_judicial.advogado,excluded.advogado),updated_at=now(),updated_by=auth.uid();
        IF NOT EXISTS (SELECT 1 FROM cob_casos WHERE party_id=v_party AND etapa='acompanhamento') THEN
          INSERT INTO cob_casos(party_id,etapa,updated_by) VALUES(v_party,'acompanhamento',auth.uid())
          ON CONFLICT (party_id) DO UPDATE SET etapa='acompanhamento',updated_at=now(),updated_by=auth.uid();
          INSERT INTO cob_interacoes(party_id,tipo,observacao,autor_id) VALUES(v_party,'etapa','Movida para Judicial pela planilha do jurídico'||coalesce(' · processo '||v_num,''),auth.uid());
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF _aplicar THEN
    INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'cob_judicial_planilha_importar','cob_judicial_processos',v_lote::text,
      jsonb_build_object('linhas',tot,'com_pessoa',com,'sem_pessoa',sem,'novos',novos,'atualizados',atual,'movidas',mover));
  END IF;
  RETURN jsonb_build_object('lote',CASE WHEN _aplicar THEN v_lote END,'linhas',tot,'com_pessoa',com,'sem_pessoa',sem,'ambiguos',amb,'novos',novos,'atualizados',atual,'mover_judicial',mover,'ja_judicial',ja,'sem_lista',semlista);
END $$;
REVOKE ALL ON FUNCTION public.cob_judicial_planilha_importar(jsonb,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_judicial_planilha_importar(jsonb,boolean) TO authenticated;