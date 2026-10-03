CREATE OR REPLACE FUNCTION public.pdv_cliente_salvar(_token_hash text, _c jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; m pdv_membros; uid uuid; pid uuid;
  nome text := nullif(trim(left(_c->>'nome',150)),'');
  v_doc text := nullif(regexp_replace(coalesce(_c->>'doc',''),'\D','','g'),'');
  tel text := nullif(regexp_replace(coalesce(_c->>'telefone',''),'\D','','g'),'');
  mail text := nullif(lower(trim(left(_c->>'email',255))),'');
  insta text := nullif(regexp_replace(trim(left(coalesce(_c->>'instagram',''),60)),'^@+',''),'');
  nasc date; cep text := nullif(regexp_replace(coalesce(_c->>'cep',''),'\D','','g'),'');
BEGIN
  s := public.pdv_sessao(_token_hash); m := public.pdv_exigir_operadora(s);
  SELECT user_id INTO uid FROM pdv_membros WHERE id=m.id;
  IF nome IS NULL THEN RAISE EXCEPTION 'Informe o nome da cliente.'; END IF;
  IF v_doc IS NOT NULL AND length(v_doc)<>11 THEN RAISE EXCEPTION 'CPF deve ter 11 dígitos.'; END IF;
  IF tel IS NOT NULL AND length(tel) NOT IN (10,11) THEN RAISE EXCEPTION 'WhatsApp deve ter DDD + número (10 ou 11 dígitos).'; END IF;
  IF mail IS NOT NULL AND mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.'; END IF;
  IF nullif(_c->>'nascimento','') IS NOT NULL THEN nasc := (_c->>'nascimento')::date; END IF;
  pid := nullif(_c->>'party_id','')::uuid;
  IF pid IS NOT NULL AND NOT EXISTS(select 1 from pdv_clientes where party_id=pid and unidade_id=s.unidade_id) THEN pid := null; END IF;
  IF pid IS NULL AND v_doc IS NOT NULL THEN SELECT id INTO pid FROM parties WHERE doc_digits=v_doc AND is_active ORDER BY created_at LIMIT 1; END IF;
  IF pid IS NULL AND tel IS NOT NULL THEN
    SELECT c.party_id INTO pid FROM pdv_clientes c JOIN contact_points cp ON cp.party_id=c.party_id
     WHERE c.unidade_id=s.unidade_id AND regexp_replace(coalesce(cp.value_norm,cp.value),'\D','','g') IN (tel,'55'||tel) LIMIT 1;
  END IF;
  IF pid IS NULL THEN
    INSERT INTO parties(kind,display_name,legal_name,doc,doc_digits,birth_date,status,created_by)
    VALUES ('pessoa',nome,nome,v_doc,v_doc,nasc,'ativo',uid) RETURNING id INTO pid;
  ELSE
    UPDATE parties SET birth_date=coalesce(birth_date,nasc), doc=coalesce(parties.doc,v_doc), doc_digits=coalesce(parties.doc_digits,v_doc) WHERE id=pid;
  END IF;
  IF NOT EXISTS(select 1 from party_roles where party_id=pid and role='cliente') THEN
    INSERT INTO party_roles(party_id,role,created_by) VALUES (pid,'cliente',uid); END IF;
  IF tel IS NOT NULL AND NOT EXISTS(select 1 from contact_points where party_id=pid and regexp_replace(coalesce(value_norm,value),'\D','','g') IN (tel,'55'||tel)) THEN
    INSERT INTO contact_points(party_id,kind,value,label) VALUES (pid,'whatsapp',tel,'PDV'); END IF;
  IF mail IS NOT NULL AND NOT EXISTS(select 1 from contact_points where party_id=pid and lower(value)=mail) THEN
    INSERT INTO contact_points(party_id,kind,value,label) VALUES (pid,'email',mail,'PDV'); END IF;
  IF cep IS NOT NULL AND length(cep)=8 AND NOT EXISTS(select 1 from party_addresses where party_id=pid) THEN
    INSERT INTO party_addresses(party_id,label,postal_code,street,street_number,complement,district,city,uf,is_primary)
    VALUES (pid,'Principal',cep,nullif(left(_c->>'rua',150),''),nullif(left(_c->>'numero',20),''),nullif(left(_c->>'complemento',80),''),nullif(left(_c->>'bairro',80),''),nullif(left(_c->>'cidade',80),''),nullif(upper(left(_c->>'uf',2)),''),true);
  END IF;
  INSERT INTO pdv_clientes(unidade_id,party_id,instagram,email,observacoes,criado_por)
  VALUES (s.unidade_id,pid,insta,mail,nullif(left(_c->>'observacoes',500),''),m.id)
  ON CONFLICT (unidade_id,party_id) DO UPDATE SET instagram=coalesce(excluded.instagram,pdv_clientes.instagram), email=coalesce(excluded.email,pdv_clientes.email), observacoes=coalesce(excluded.observacoes,pdv_clientes.observacoes), updated_at=now();
  RETURN jsonb_build_object('party_id',pid,'nome',(select display_name from parties where id=pid));
END $$;
REVOKE ALL ON FUNCTION public.pdv_cliente_salvar(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_cliente_salvar(text,jsonb) TO service_role;