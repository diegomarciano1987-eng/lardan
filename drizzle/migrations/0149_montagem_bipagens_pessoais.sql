CREATE TABLE public.montagem_operacoes (id uuid PRIMARY KEY, actor_user_id uuid NOT NULL, cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id), variant_id uuid NOT NULL REFERENCES public.product_variants(id), origem text NOT NULL, delta integer NOT NULL, quantidade integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.montagem_operacoes TO authenticated;
GRANT ALL ON public.montagem_operacoes TO service_role;
ALTER TABLE public.montagem_operacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY montagem_propria ON public.montagem_operacoes FOR SELECT TO authenticated USING (actor_user_id=auth.uid() AND public.kit_cycle_in_scope(cycle_id));
CREATE TRIGGER montagem_operacoes_imutavel BEFORE UPDATE OR DELETE ON public.montagem_operacoes FOR EACH ROW EXECUTE FUNCTION public.block_audit_mutation();
CREATE INDEX montagem_operacoes_actor_data ON public.montagem_operacoes(actor_user_id,created_at);
CREATE OR REPLACE FUNCTION public.montagem_item_operar(_cycle uuid,_variant uuid,_delta integer,_origem text,_operacao uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := public.kit_require_manage(); anterior integer; nova integer; existente public.montagem_operacoes;
BEGIN
 IF NOT public.kit_cycle_in_scope(_cycle) THEN RAISE EXCEPTION 'Maleta fora da carteira.' USING errcode='42501'; END IF;
 IF _operacao IS NULL OR _origem NOT IN ('bipagem','manual','retirada') OR _delta NOT IN(-1,1) OR (_origem='bipagem' AND _delta<>1) THEN RAISE EXCEPTION 'Operação inválida.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_operacao::text,0));
 SELECT * INTO existente FROM montagem_operacoes WHERE id=_operacao;
 IF FOUND THEN
  IF existente.actor_user_id<>uid OR existente.cycle_id<>_cycle OR existente.variant_id<>_variant OR existente.delta<>_delta OR existente.origem<>_origem THEN RAISE EXCEPTION 'Identificador de operação já utilizado.'; END IF;
  RETURN jsonb_build_object('quantidade',existente.quantidade,'repetida',true);
 END IF;
 PERFORM 1 FROM kit_cycles WHERE id=_cycle FOR UPDATE;
 SELECT i.quantity INTO anterior FROM kit_composition_items i JOIN kit_compositions c ON c.id=i.composition_id WHERE c.cycle_id=_cycle AND i.variant_id=_variant ORDER BY c.version DESC LIMIT 1;
 nova := greatest(0,coalesce(anterior,0)+_delta);
 PERFORM public.kit_item_upsert(_cycle,_variant,nova);
 INSERT INTO montagem_operacoes(id,actor_user_id,cycle_id,variant_id,origem,delta,quantidade) VALUES(_operacao,uid,_cycle,_variant,_origem,nova-coalesce(anterior,0),nova);
 RETURN jsonb_build_object('quantidade',nova,'repetida',false);
END $$;
REVOKE ALL ON FUNCTION public.montagem_item_operar(uuid,uuid,integer,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.montagem_item_operar(uuid,uuid,integer,text,uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.montagem_meu_resumo(_de date,_ate date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.meu_acesso_colab() OR NOT public.has_capability(auth.uid(),'kit.view') THEN RAISE EXCEPTION 'Sem acesso ao trabalho de montagem.' USING errcode='42501'; END IF;
 IF _de IS NULL OR _ate IS NULL OR _ate<_de OR _ate-_de>366 THEN RAISE EXCEPTION 'Período inválido.'; END IF;
 RETURN (WITH base AS (SELECT o.*, (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date dia FROM montagem_operacoes o WHERE o.actor_user_id=auth.uid() AND public.kit_cycle_in_scope(o.cycle_id) AND o.created_at>=(_de::timestamp AT TIME ZONE 'America/Sao_Paulo') AND o.created_at<((_ate+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')) SELECT jsonb_build_object('pecas',coalesce(sum(delta) FILTER(WHERE origem='bipagem'),0),'maletas',count(DISTINCT cycle_id) FILTER(WHERE origem='bipagem'),'retiradas',coalesce(-sum(delta) FILTER(WHERE delta<0),0),'ajustes',count(*) FILTER(WHERE origem='manual'),'saldo',coalesce(sum(delta),0),'hoje',coalesce(sum(delta) FILTER(WHERE origem='bipagem' AND dia=(now() AT TIME ZONE 'America/Sao_Paulo')::date),0),'dias',coalesce((SELECT jsonb_agg(x ORDER BY x.dia) FROM(SELECT dia,coalesce(sum(delta) FILTER(WHERE origem='bipagem'),0) pecas,count(DISTINCT cycle_id) FILTER(WHERE origem='bipagem') maletas FROM base GROUP BY dia)x),'[]'::jsonb),'recentes',coalesce((SELECT jsonb_agg(x) FROM(SELECT o.created_at,o.origem,o.delta,k.code codigo,r.numero remessa FROM base o JOIN kit_cycles c ON c.id=o.cycle_id JOIN kits k ON k.id=c.kit_id LEFT JOIN remessas r ON r.id=c.remessa_id ORDER BY o.created_at DESC LIMIT 30)x),'[]'::jsonb),'inicio',(SELECT min(created_at) FROM montagem_operacoes WHERE actor_user_id=auth.uid())) FROM base);
END $$;
REVOKE ALL ON FUNCTION public.montagem_meu_resumo(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.montagem_meu_resumo(date,date) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.kit_identificacao_buscar(_codigo text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT c.id FROM kits k JOIN kit_cycles c ON c.kit_id=k.id WHERE (k.code=btrim(_codigo) OR k.qr_token=btrim(_codigo)) AND public.kit_cycle_in_scope(c.id) AND public.has_capability(auth.uid(),'kit.view') ORDER BY c.created_at DESC LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.kit_identificacao_buscar(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kit_identificacao_buscar(text) TO authenticated,service_role;