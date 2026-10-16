-- Preserve the official installment editor and replace only the invalid Asaas column.
DO $migration$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fin_installment_editar(uuid,date,bigint,text)'::regprocedure);
  IF position('c.status in' in d)=0 THEN RAISE EXCEPTION 'Definição inesperada da edição de parcela'; END IF;
  EXECUTE replace(d,'c.status in','c.external_status in');
  d := pg_get_functiondef('public.fin_title_detail(uuid)'::regprocedure);
  IF position('''estorno'', s.is_reversal' in d)=0 THEN RAISE EXCEPTION 'Definição inesperada do detalhe'; END IF;
  EXECUTE replace(d,'''estorno'', s.is_reversal','''estorno'', s.is_reversal, ''reversed_of'', s.reversed_of, ''ja_estornada'', EXISTS (SELECT 1 FROM public.financial_settlements rev WHERE rev.reversed_of=s.id)');
END $migration$;

-- Append-only authorization and before-snapshots for a narrowly scoped date correction.
CREATE TABLE public.fin_estorno_data_correcoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.financial_settlements(id),
  data_anterior date NOT NULL,
  data_nova date NOT NULL,
  motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
  actor_id uuid NOT NULL,
  transaction_id bigint NOT NULL,
  antes_settlement jsonb NOT NULL,
  antes_movements jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fin_estorno_data_correcoes TO authenticated;
GRANT ALL ON public.fin_estorno_data_correcoes TO service_role;
ALTER TABLE public.fin_estorno_data_correcoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Leitura financeira de correções" ON public.fin_estorno_data_correcoes FOR SELECT TO authenticated USING (public.has_capability(auth.uid(),'finance.settlement.reverse'));
CREATE TRIGGER fin_estorno_correcoes_immutable BEFORE UPDATE OR DELETE ON public.fin_estorno_data_correcoes FOR EACH ROW EXECUTE FUNCTION public.fin_block_mutation();

CREATE OR REPLACE FUNCTION public.fin_estorno_data_mutation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE sid uuid;
BEGIN
  IF coalesce(current_setting('lardan.fin_expurgo',true),'')='on' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='financial_settlements' THEN sid:=OLD.id; ELSE sid:=OLD.settlement_id; END IF;
    IF (to_jsonb(NEW)-'data')=(to_jsonb(OLD)-'data') AND EXISTS (
      SELECT 1 FROM public.fin_estorno_data_correcoes c
      WHERE c.settlement_id=sid AND c.transaction_id=txid_current() AND c.actor_id=auth.uid()
        AND c.data_nova=NEW.data AND c.data_anterior=OLD.data
    ) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Registro financeiro histórico não pode ser alterado nem apagado (%). Use a rotina oficial.',TG_TABLE_NAME USING errcode='42501';
END $function$;
REVOKE ALL ON FUNCTION public.fin_estorno_data_mutation_guard() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER fin_settlements_immutable BEFORE UPDATE OR DELETE ON public.financial_settlements FOR EACH ROW EXECUTE FUNCTION public.fin_estorno_data_mutation_guard();
CREATE OR REPLACE TRIGGER fin_movements_immutable BEFORE UPDATE OR DELETE ON public.financial_account_movements FOR EACH ROW EXECUTE FUNCTION public.fin_estorno_data_mutation_guard();

CREATE OR REPLACE FUNCTION public.fin_estorno_data_set(_settlement uuid,_data date,_motivo text,_esperada date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE s public.financial_settlements; original public.financial_settlements; cid uuid; snapshots jsonb; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'finance.settlement.reverse') THEN RAISE EXCEPTION 'Sem permissão para corrigir estorno'; END IF;
  IF coalesce(btrim(_motivo),'')='' THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  SELECT * INTO s FROM public.financial_settlements WHERE id=_settlement FOR UPDATE;
  IF s.id IS NULL OR NOT s.is_reversal OR s.reversed_of IS NULL THEN RAISE EXCEPTION 'Escolha um estorno registrado'; END IF;
  IF _esperada IS NULL OR s.data<>_esperada THEN RAISE EXCEPTION 'A data mudou. Atualize a ficha antes de salvar'; END IF;
  SELECT * INTO original FROM public.financial_settlements WHERE id=s.reversed_of FOR UPDATE;
  IF _data IS NULL OR _data<original.data THEN RAISE EXCEPTION 'O estorno não pode ser anterior à baixa original'; END IF;
  IF _data>hoje THEN RAISE EXCEPTION 'A data do estorno não pode ser futura'; END IF;
  IF public.fin_periodo_fechado(s.data,NULL) OR public.fin_periodo_fechado(_data,NULL) OR EXISTS (
    SELECT 1 FROM public.financial_allocations a JOIN public.financial_installments i ON i.id=a.installment_id JOIN public.financial_titles t ON t.id=i.title_id
    WHERE a.settlement_id=s.id AND (public.fin_periodo_fechado(s.data,t.business_entity_id) OR public.fin_periodo_fechado(_data,t.business_entity_id))
  ) THEN RAISE EXCEPTION 'Período fechado: correção de data bloqueada'; END IF;
  IF s.data=_data THEN RETURN jsonb_build_object('ok',true,'repetido',true); END IF;
  PERFORM id FROM public.financial_account_movements WHERE settlement_id=s.id FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') INTO snapshots FROM public.financial_account_movements m WHERE m.settlement_id=s.id;
  INSERT INTO public.fin_estorno_data_correcoes(settlement_id,data_anterior,data_nova,motivo,actor_id,transaction_id,antes_settlement,antes_movements)
    VALUES(s.id,s.data,_data,btrim(_motivo),auth.uid(),txid_current(),to_jsonb(s),snapshots) RETURNING id INTO cid;
  UPDATE public.financial_settlements SET data=_data WHERE id=s.id;
  UPDATE public.financial_account_movements SET data=_data WHERE settlement_id=s.id;
  INSERT INTO public.financial_title_events(title_id,evento,motivo,payload,actor_id)
    SELECT DISTINCT i.title_id,'estorno_data_corrigida',btrim(_motivo),jsonb_build_object('settlement_id',s.id,'data_anterior',s.data,'data_nova',_data,'correcao_id',cid),auth.uid()
    FROM public.financial_allocations a JOIN public.financial_installments i ON i.id=a.installment_id WHERE a.settlement_id=s.id;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'financeiro.estorno_data_corrigida','financial_settlements',s.id::text,jsonb_build_object('data_anterior',s.data,'data_nova',_data,'motivo',btrim(_motivo),'correcao_id',cid));
  RETURN jsonb_build_object('ok',true,'repetido',false,'correcao_id',cid);
END $function$;
REVOKE ALL ON FUNCTION public.fin_estorno_data_set(uuid,date,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fin_estorno_data_set(uuid,date,text,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.registry_duplicate_candidates(_nome text DEFAULT NULL,_doc text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $function$
DECLARE nome text := lower(regexp_replace(btrim(coalesce(_nome,'')),'\s+',' ','g')); doc text := nullif(regexp_replace(coalesce(_doc,''),'\D','','g'),'');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'registry.view') THEN RAISE EXCEPTION 'Sem permissão para consultar cadastros'; END IF;
  IF length(nome)>240 OR length(coalesce(doc,''))>14 THEN RAISE EXCEPTION 'Busca inválida'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT p.id,p.code,p.display_name,p.doc_masked,p.status,CASE WHEN doc IS NOT NULL AND p.doc_digits=doc THEN 'documento' ELSE 'nome' END motivo
    FROM public.parties p WHERE (length(nome)>=3 AND lower(regexp_replace(btrim(p.display_name),'\s+',' ','g'))=nome) OR (length(doc)>=11 AND p.doc_digits=doc)
    ORDER BY p.code LIMIT 20
  ) x),'[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.registry_duplicate_candidates(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.registry_duplicate_candidates(text,text) TO authenticated;