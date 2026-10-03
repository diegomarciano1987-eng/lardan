CREATE TABLE public.pdv_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id uuid NOT NULL REFERENCES public.pdv_unidades(id),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  instagram text, email text, observacoes text,
  criado_por uuid REFERENCES public.pdv_membros(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unidade_id, party_id));
GRANT ALL ON public.pdv_clientes TO service_role;
GRANT SELECT ON public.pdv_clientes TO authenticated;
ALTER TABLE public.pdv_clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gestao le clientes do pdv" ON public.pdv_clientes FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master') OR public.has_role(auth.uid(),'diretoria'));

CREATE OR REPLACE FUNCTION public.pdv_cliente_salvar(_token_hash text, _c jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; m pdv_membros; uid uuid; pid uuid;
  nome text := nullif(trim(left(_c->>'nome',150)),'');
  doc text := nullif(regexp_replace(coalesce(_c->>'doc',''),'\D','','g'),'');
  tel text := nullif(regexp_replace(coalesce(_c->>'telefone',''),'\D','','g'),'');
  mail text := nullif(lower(trim(left(_c->>'email',255))),'');
  insta text := nullif(regexp_replace(trim(left(coalesce(_c->>'instagram',''),60)),'^@+',''),'');
  nasc date; cep text := nullif(regexp_replace(coalesce(_c->>'cep',''),'\D','','g'),'');
BEGIN
  s := public.pdv_sessao(_token_hash); m := public.pdv_exigir_operadora(s);
  SELECT user_id INTO uid FROM pdv_membros WHERE id=m.id;
  IF nome IS NULL THEN RAISE EXCEPTION 'Informe o nome da cliente.'; END IF;
  IF doc IS NOT NULL AND length(doc)<>11 THEN RAISE EXCEPTION 'CPF deve ter 11 dígitos.'; END IF;
  IF tel IS NOT NULL AND length(tel) NOT IN (10,11) THEN RAISE EXCEPTION 'WhatsApp deve ter DDD + número (10 ou 11 dígitos).'; END IF;
  IF mail IS NOT NULL AND mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.'; END IF;
  IF nullif(_c->>'nascimento','') IS NOT NULL THEN nasc := (_c->>'nascimento')::date; END IF;
  pid := nullif(_c->>'party_id','')::uuid;
  IF pid IS NOT NULL AND NOT EXISTS(select 1 from pdv_clientes where party_id=pid and unidade_id=s.unidade_id) THEN pid := null; END IF;
  IF pid IS NULL AND doc IS NOT NULL THEN SELECT id INTO pid FROM parties WHERE doc_digits=doc AND is_active ORDER BY created_at LIMIT 1; END IF;
  IF pid IS NULL AND tel IS NOT NULL THEN
    SELECT c.party_id INTO pid FROM pdv_clientes c JOIN contact_points cp ON cp.party_id=c.party_id
     WHERE c.unidade_id=s.unidade_id AND regexp_replace(coalesce(cp.value_norm,cp.value),'\D','','g') IN (tel,'55'||tel) LIMIT 1;
  END IF;
  IF pid IS NULL THEN
    INSERT INTO parties(kind,display_name,legal_name,doc,doc_digits,birth_date,status,created_by)
    VALUES ('pessoa',nome,nome,doc,doc,nasc,'ativo',uid) RETURNING id INTO pid;
  ELSE
    UPDATE parties SET birth_date=coalesce(birth_date,nasc), doc=coalesce(doc,doc), doc_digits=coalesce(doc_digits,doc) WHERE id=pid;
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

CREATE OR REPLACE FUNCTION public.pdv_venda_vincular_cliente(_token_hash text, _venda uuid, _party uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; BEGIN
  s := public.pdv_sessao(_token_hash);
  IF NOT EXISTS(select 1 from pdv_clientes where party_id=_party and unidade_id=s.unidade_id) THEN RAISE EXCEPTION 'Cliente não é desta loja.'; END IF;
  UPDATE pdv_vendas SET party_id=_party WHERE id=_venda AND unidade_id=s.unidade_id AND party_id IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.pdv_clientes_listar(_token_hash text, _q text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; q text := lower(trim(coalesce(_q,''))); qd text := regexp_replace(coalesce(_q,''),'\D','','g');
BEGIN
  s := public.pdv_sessao(_token_hash);
  RETURN coalesce((select jsonb_agg(x order by x->>'nome') from (
    select jsonb_build_object('party_id',p.id,'nome',p.display_name,'doc',p.doc_masked,'nascimento',p.birth_date,'instagram',c.instagram,'email',c.email,'observacoes',c.observacoes,'desde',c.created_at,
      'whatsapp',(select cp.value from contact_points cp where cp.party_id=p.id and cp.kind='whatsapp' order by cp.is_primary desc, cp.created_at limit 1),
      'cidade',(select a.city||coalesce('/'||a.uf,'') from party_addresses a where a.party_id=p.id order by a.is_primary desc limit 1),
      'compras',(select count(*) from pdv_vendas v where v.party_id=p.id and v.unidade_id=s.unidade_id and v.status='concluida'),
      'total',(select coalesce(sum(total_cents),0) from pdv_vendas v where v.party_id=p.id and v.unidade_id=s.unidade_id and v.status='concluida'),
      'ultima',(select max(created_at) from pdv_vendas v where v.party_id=p.id and v.unidade_id=s.unidade_id and v.status<>'cancelada')) x
    from pdv_clientes c join parties p on p.id=c.party_id
    where c.unidade_id=s.unidade_id and (q='' or lower(p.display_name) like '%'||q||'%' or lower(coalesce(c.instagram,'')) like '%'||ltrim(q,'@')||'%'
      or (length(qd)>=3 and (p.doc_digits like qd||'%' or exists(select 1 from contact_points cp where cp.party_id=p.id and regexp_replace(cp.value,'\D','','g') like '%'||qd||'%'))))
    limit 300) z),'[]');
END $$;

CREATE OR REPLACE FUNCTION public.pdv_vendas_listar(_token_hash text, _dias int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; d int := least(greatest(coalesce(_dias,1),1),365);
BEGIN
  s := public.pdv_sessao(_token_hash);
  RETURN coalesce((select jsonb_agg(x order by x->>'hora' desc) from (
    select jsonb_build_object('id',v.id,'codigo',v.codigo,'hora',v.created_at,'status',v.status,'subtotal',v.subtotal_cents,'desconto',v.desconto_cents,'total',v.total_cents,
      'vendedora',public.pdv_nome_usuario(m.user_id),'cliente',v.cliente_nome,'telefone',v.cliente_telefone,'cancel_motivo',v.cancel_motivo,
      'itens',coalesce((select jsonb_agg(jsonb_build_object('qtd',i.qtd,'nome',i.nome,'total',i.total_cents)) from pdv_venda_itens i where i.venda_id=v.id),'[]'),
      'pagamentos',coalesce((select jsonb_agg(jsonb_build_object('forma',p.forma,'valor',p.valor_cents,'parcelas',p.parcelas,'troco',p.troco_cents,'status',p.status)) from pdv_pagamentos p where p.venda_id=v.id),'[]')) x
    from pdv_vendas v join pdv_membros m on m.id=v.membro_id
    where v.unidade_id=s.unidade_id and (v.created_at at time zone 'America/Sao_Paulo')::date > (now() at time zone 'America/Sao_Paulo')::date - d
    order by v.created_at desc limit 300) z),'[]');
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['pdv_cliente_salvar(text,jsonb)','pdv_venda_vincular_cliente(text,uuid,uuid)','pdv_clientes_listar(text,text)','pdv_vendas_listar(text,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;