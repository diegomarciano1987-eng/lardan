CREATE TABLE public.consultora_pos_venda (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), protocolo bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 consultora_party_id uuid NOT NULL REFERENCES public.parties(id), order_id uuid NOT NULL REFERENCES public.sales_orders(id), item_id uuid NOT NULL REFERENCES public.sales_order_items(id),
 tipo text NOT NULL CHECK(tipo IN ('troca','garantia')), motivo text NOT NULL CHECK(length(trim(motivo))>=3), observacao text, solucao text NOT NULL CHECK(solucao IN ('reposicao','troca','credito')),
 status text NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta','em_analise','aprovada','recusada','resolvida')), compra_em date NOT NULL, excecao boolean NOT NULL DEFAULT false,
 snapshot jsonb NOT NULL, fotos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(fotos)='array' AND jsonb_array_length(fotos)<=3), resposta text,
 idempotency_key text NOT NULL UNIQUE, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.consultora_pos_venda TO authenticated;
GRANT ALL ON public.consultora_pos_venda TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.consultora_pos_venda_protocolo_seq TO service_role;
ALTER TABLE public.consultora_pos_venda ENABLE ROW LEVEL SECURITY;
CREATE POLICY pos_venda_leitura ON public.consultora_pos_venda FOR SELECT TO authenticated USING ((public.has_role(auth.uid(),'consultora') AND consultora_party_id=public.my_party_id()) OR public.has_role(auth.uid(),'master') OR public.has_role(auth.uid(),'qualidade'));
CREATE TRIGGER pos_venda_audit AFTER INSERT OR UPDATE ON public.consultora_pos_venda FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TABLE public.consultora_pos_venda_eventos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.consultora_pos_venda(id), status text NOT NULL, resposta text, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.consultora_pos_venda_eventos TO authenticated;
GRANT ALL ON public.consultora_pos_venda_eventos TO service_role;
ALTER TABLE public.consultora_pos_venda_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY pos_venda_eventos_leitura ON public.consultora_pos_venda_eventos FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.consultora_pos_venda r WHERE r.id=request_id));
CREATE OR REPLACE FUNCTION public.consultora_pos_venda_abrir(_item uuid,_tipo text,_motivo text,_observacao text,_solucao text,_fotos jsonb,_excecao boolean,_chave text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.sales_orders; i public.sales_order_items; r public.consultora_pos_venda; compra date; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; dentro boolean; snap jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN RAISE EXCEPTION 'Acesso não liberado.'; END IF;
 IF length(coalesce(_chave,''))<8 THEN RAISE EXCEPTION 'Chave inválida.'; END IF;
 SELECT * INTO i FROM public.sales_order_items WHERE id=_item;
 SELECT * INTO o FROM public.sales_orders WHERE id=i.order_id AND consultora_party_id=public.my_party_id();
 IF o.id IS NULL OR o.payment_status<>'pago' OR o.status='cancelado' THEN RAISE EXCEPTION 'Escolha uma peça de um pedido pago da sua cliente.'; END IF;
 IF _tipo NOT IN ('troca','garantia') OR _solucao NOT IN ('reposicao','troca','credito') OR length(trim(coalesce(_motivo,'')))<3 THEN RAISE EXCEPTION 'Informe tipo, motivo e solução.'; END IF;
 IF jsonb_typeof(_fotos) IS DISTINCT FROM 'array' OR jsonb_array_length(_fotos)>3 THEN RAISE EXCEPTION 'Envie até três fotos.'; END IF;
 IF _tipo='garantia' AND jsonb_array_length(_fotos)=0 THEN RAISE EXCEPTION 'Envie uma foto da peça para solicitar garantia.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(_fotos) f WHERE f NOT LIKE auth.uid()::text||'/%') THEN RAISE EXCEPTION 'Foto não pertence à sua conta.'; END IF;
 compra := (coalesce(o.pay_paid_at,o.created_at) AT TIME ZONE 'America/Sao_Paulo')::date;
 dentro := hoje>=compra AND CASE WHEN _tipo='troca' THEN hoje<=compra+45 ELSE hoje<=(compra+interval '2 years')::date END;
 IF NOT dentro AND NOT coalesce(_excecao,false) THEN RAISE EXCEPTION 'Fora do prazo. Peça uma exceção.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_chave,0));
 SELECT * INTO r FROM public.consultora_pos_venda WHERE idempotency_key=_chave;
 IF r.id IS NOT NULL THEN
  IF r.created_by<>auth.uid() OR r.item_id<>_item OR r.tipo<>_tipo OR r.motivo<>trim(_motivo) OR r.solucao<>_solucao OR r.fotos<>_fotos THEN RAISE EXCEPTION 'Chave usada em outra solicitação.'; END IF;
  RETURN jsonb_build_object('id',r.id,'protocolo','TG-'||lpad(r.protocolo::text,6,'0'),'repetida',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.consultora_pos_venda WHERE item_id=i.id AND status NOT IN ('recusada','resolvida')) THEN RAISE EXCEPTION 'Esta peça já tem uma solicitação aberta.'; END IF;
 SELECT jsonb_build_object('cliente',o.customer_name,'pedido',o.code,'quantidade',i.quantity,'preco_cents',i.unit_price_cents,'produto',p.name,'variant_id',i.variant_id,'supplier_id',p.supplier_id,'cycle_id',i.cycle_id) INTO snap FROM public.product_variants v JOIN public.products p ON p.id=v.product_id WHERE v.id=i.variant_id;
 INSERT INTO public.consultora_pos_venda(consultora_party_id,order_id,item_id,tipo,motivo,observacao,solucao,compra_em,excecao,snapshot,fotos,idempotency_key,created_by) VALUES(o.consultora_party_id,o.id,i.id,_tipo,trim(_motivo),left(_observacao,1000),_solucao,compra,NOT dentro,snap,_fotos,_chave,auth.uid()) RETURNING * INTO r;
 INSERT INTO public.consultora_pos_venda_eventos(request_id,status,actor_id) VALUES(r.id,'aberta',auth.uid());
 RETURN jsonb_build_object('id',r.id,'protocolo','TG-'||lpad(r.protocolo::text,6,'0'),'repetida',false);
END $$;
REVOKE ALL ON FUNCTION public.consultora_pos_venda_abrir(uuid,text,text,text,text,jsonb,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consultora_pos_venda_abrir(uuid,text,text,text,text,jsonb,boolean,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.consultora_pos_venda_analisar(_id uuid,_status text,_resposta text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.consultora_pos_venda;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'master') OR public.has_role(auth.uid(),'qualidade')) THEN RAISE EXCEPTION 'Sem permissão para analisar.'; END IF;
 SELECT * INTO r FROM public.consultora_pos_venda WHERE id=_id FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Solicitação inexistente.'; END IF;
 IF NOT ((r.status='aberta' AND _status='em_analise') OR (r.status='em_analise' AND _status IN ('aprovada','recusada')) OR (r.status='aprovada' AND _status='resolvida')) THEN RAISE EXCEPTION 'Mudança de situação não permitida.'; END IF;
 IF length(trim(coalesce(_resposta,'')))<5 THEN RAISE EXCEPTION 'Informe a resposta e o encaminhamento.'; END IF;
 UPDATE public.consultora_pos_venda SET status=_status,resposta=left(_resposta,2000),updated_at=now() WHERE id=r.id;
 INSERT INTO public.consultora_pos_venda_eventos(request_id,status,resposta,actor_id) VALUES(r.id,_status,left(_resposta,2000),auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.consultora_pos_venda_analisar(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consultora_pos_venda_analisar(uuid,text,text) TO authenticated,service_role;
COMMENT ON TABLE public.consultora_pos_venda IS 'Audited after-sale review requests. No automatic stock, credit, refund or settlement; official operational movements remain required.';