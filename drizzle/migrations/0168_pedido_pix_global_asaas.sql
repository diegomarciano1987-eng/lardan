CREATE TABLE public.pedido_pix_asaas (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 account_id uuid NOT NULL,
 qr_id text NOT NULL,
 chave text NOT NULL,
 payload text NOT NULL,
 atualizado_por uuid NOT NULL,
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pedido_pix_asaas TO service_role;
ALTER TABLE public.pedido_pix_asaas ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.pedido_pix_asaas_ler() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para documentos de maletas.' USING errcode='42501'; END IF;
 RETURN (SELECT to_jsonb(p)-'id'-'atualizado_por' FROM public.pedido_pix_asaas p WHERE id=true);
END $$;
REVOKE ALL ON FUNCTION public.pedido_pix_asaas_ler() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pedido_pix_asaas_ler() TO authenticated;
CREATE OR REPLACE FUNCTION public.pedido_pix_asaas_gravar(_actor uuid,_account uuid,_qr text,_chave text,_payload text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE antes jsonb;
BEGIN
 IF _actor IS NULL OR NOT public.has_role(_actor,'master') THEN RAISE EXCEPTION 'Só o Master atualiza o Pix do pedido.' USING errcode='42501'; END IF;
 IF _qr IS NULL OR length(_qr)=0 OR _chave IS NULL OR length(_chave)=0 OR _payload IS NULL OR _payload NOT LIKE '000201%' THEN RAISE EXCEPTION 'Pix oficial inválido.'; END IF;
 SELECT to_jsonb(p) INTO antes FROM public.pedido_pix_asaas p WHERE id=true;
 INSERT INTO public.pedido_pix_asaas(id,account_id,qr_id,chave,payload,atualizado_por) VALUES(true,_account,_qr,_chave,_payload,_actor)
 ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,qr_id=excluded.qr_id,chave=excluded.chave,payload=excluded.payload,atualizado_por=excluded.atualizado_por,atualizado_em=now();
 INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload) VALUES(_actor,'pedido.pix_asaas_atualizado','pedido_pix_asaas','pedido',jsonb_build_object('antes',antes,'account_id',_account,'qr_id',_qr));
END $$;
REVOKE ALL ON FUNCTION public.pedido_pix_asaas_gravar(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pedido_pix_asaas_gravar(uuid,uuid,text,text,text) TO service_role;