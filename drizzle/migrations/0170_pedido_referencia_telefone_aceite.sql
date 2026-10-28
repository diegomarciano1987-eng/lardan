CREATE OR REPLACE FUNCTION public.peca_referencia_etiqueta(_variante text, _produto text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT coalesce(CASE WHEN nullif(btrim(_variante),'') IS NOT NULL AND btrim(_variante) !~ '^0+$' THEN btrim(_variante) END, CASE WHEN nullif(btrim(_produto),'') IS NOT NULL AND btrim(_produto) !~ '^0+$' THEN btrim(_produto) END) $$;
REVOKE ALL ON FUNCTION public.peca_referencia_etiqueta(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peca_referencia_etiqueta(text,text) TO authenticated, service_role;
CREATE TABLE public.pedido_colaboradora_telefones (user_id uuid PRIMARY KEY REFERENCES public.profiles(id), telefone text NOT NULL, atualizado_por uuid NOT NULL, atualizado_em timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.pedido_colaboradora_telefones TO authenticated;
GRANT ALL ON public.pedido_colaboradora_telefones TO service_role;
ALTER TABLE public.pedido_colaboradora_telefones ENABLE ROW LEVEL SECURITY;
CREATE POLICY pedido_colaboradora_telefone_ler ON public.pedido_colaboradora_telefones FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()) OR (SELECT public.has_role(auth.uid(),'master')));
CREATE OR REPLACE FUNCTION public.pedido_colaboradoras_ler() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para configurar impressão.' USING errcode='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',p.id,'nome',p.full_name,'codigo',ca.codigo,'telefone',t.telefone,'padrao',cfg.pedidos_telefone) ORDER BY p.full_name,p.id)
 FROM profiles p LEFT JOIN colab_acessos ca ON ca.user_id=p.id AND ca.ativo LEFT JOIN pedido_colaboradora_telefones t ON t.user_id=p.id CROSS JOIN pedido_config cfg
 WHERE p.is_active AND (ca.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=p.id AND ur.role IN ('montagem','master')))
 AND (public.has_role(auth.uid(),'master') OR p.id=auth.uid())), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pedido_colaboradoras_ler() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pedido_colaboradoras_ler() TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.pedido_colaboradora_telefone_salvar(_user uuid,_telefone text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE antes jsonb; tel text:=btrim(coalesce(_telefone,''));
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'Só o Master configura os telefones por colaboradora.' USING errcode='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=_user AND p.is_active AND (EXISTS(SELECT 1 FROM colab_acessos c WHERE c.user_id=p.id AND c.ativo) OR EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=p.id AND r.role IN ('montagem','master')))) THEN RAISE EXCEPTION 'Colaboradora ativa não encontrada.'; END IF;
 IF tel<>'' AND (length(tel)>24 OR regexp_replace(tel,'[^0-9]','','g') !~ '^(55)?[0-9]{10,11}$') THEN RAISE EXCEPTION 'Informe um telefone com DDD válido.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('pedido-telefone:'||_user::text));
 SELECT to_jsonb(t) INTO antes FROM pedido_colaboradora_telefones t WHERE user_id=_user;
 IF tel='' THEN DELETE FROM pedido_colaboradora_telefones WHERE user_id=_user;
 ELSE INSERT INTO pedido_colaboradora_telefones(user_id,telefone,atualizado_por) VALUES(_user,tel,auth.uid()) ON CONFLICT(user_id) DO UPDATE SET telefone=excluded.telefone,atualizado_por=excluded.atualizado_por,atualizado_em=now(); END IF;
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'pedido.telefone_colaboradora','pedido_colaboradora_telefones',_user::text,jsonb_build_object('antes',antes,'telefone',nullif(tel,'')));
 RETURN jsonb_build_object('telefone',nullif(tel,''));
END $$;
REVOKE ALL ON FUNCTION public.pedido_colaboradora_telefone_salvar(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pedido_colaboradora_telefone_salvar(uuid,text) TO authenticated,service_role;
DO $$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.kit_pedido_dados(uuid)'::regprocedure);
 IF position('coalesce(nullif(v.reference_code, ''''), v.legacy_code)' in def)=0 OR position('''empresa'', to_jsonb(cfg)' in def)=0 THEN RAISE EXCEPTION 'A função do pedido mudou; revisar antes de aplicar.'; END IF;
 def:=replace(def,'coalesce(nullif(v.reference_code, ''''), v.legacy_code)','public.peca_referencia_etiqueta(v.reference_code, pr.reference_code)');
 def:=replace(def,'''empresa'', to_jsonb(cfg) - ''id'' - ''atualizado_por'' - ''atualizado_em'' - ''preco_virada_em'',','''empresa'', (to_jsonb(cfg) - ''id'' - ''atualizado_por'' - ''atualizado_em'' - ''preco_virada_em'') || jsonb_build_object(''pedidos_telefone'', coalesce((SELECT t.telefone FROM public.pedido_colaboradora_telefones t WHERE t.user_id=auth.uid()), cfg.pedidos_telefone)),');
 EXECUTE def;
END $$;
CREATE OR REPLACE FUNCTION public.consultora_aceites_pendentes() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE eu uuid:=public.my_party_id();
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id',c.id,'codigo',k.code,'situacao',c.status,'remessa',r.numero) ORDER BY c.created_at,c.id)
 FROM kit_cycles c JOIN kits k ON k.id=c.kit_id LEFT JOIN remessas r ON r.id=c.remessa_id
 WHERE c.consultora_party_id=eu AND c.status IN ('expedida','transito','recebida')
 AND EXISTS(SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.party_id=eu AND p.is_active)
 AND NOT EXISTS(SELECT 1 FROM kit_acceptances a WHERE a.cycle_id=c.id)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.consultora_aceites_pendentes() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consultora_aceites_pendentes() TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.consultora_aceite_dados(_cycle uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb; itens jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM kit_cycles c JOIN profiles p ON p.party_id=c.consultora_party_id WHERE c.id=_cycle AND p.id=auth.uid() AND p.is_active AND c.consultora_party_id=public.my_party_id()) THEN RAISE EXCEPTION 'Esta maleta não pertence ao seu login.' USING errcode='42501'; END IF;
 d:=public.kit_detail(_cycle);
 SELECT coalesce(jsonb_agg(x.item || jsonb_build_object('referencia',public.peca_referencia_etiqueta(v.reference_code,p.reference_code),'categoria',cat.name) ORDER BY cat.name,p.name,v.id),'[]'::jsonb) INTO itens
 FROM jsonb_array_elements(d->'composicao') x(item) JOIN product_variants v ON v.id=(x.item->>'variant_id')::uuid JOIN products p ON p.id=v.product_id LEFT JOIN categories cat ON cat.id=p.category_id;
 RETURN d || jsonb_build_object('composicao',itens,'remessa_numero',(SELECT r.numero FROM kit_cycles c JOIN remessas r ON r.id=c.remessa_id WHERE c.id=_cycle));
END $$;
REVOKE ALL ON FUNCTION public.consultora_aceite_dados(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consultora_aceite_dados(uuid) TO authenticated,service_role;