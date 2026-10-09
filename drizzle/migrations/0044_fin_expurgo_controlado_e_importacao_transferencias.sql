CREATE TABLE IF NOT EXISTS public.fin_expurgo_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote text NOT NULL,
  motivo text NOT NULL,
  tabela text NOT NULL,
  registro_id uuid NOT NULL,
  registro jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fin_expurgo_backup TO authenticated;
GRANT ALL ON public.fin_expurgo_backup TO service_role;
ALTER TABLE public.fin_expurgo_backup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financeiro lê backup de expurgo" ON public.fin_expurgo_backup
  FOR SELECT TO authenticated USING (public.has_capability(auth.uid(),'finance.view'));
COMMENT ON TABLE public.fin_expurgo_backup IS 'Cópia integral de registros financeiros removidos por expurgo controlado aprovado; permite rollback.';

CREATE OR REPLACE FUNCTION public.fin_block_mutation()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_setting('lardan.fin_expurgo', true),'') = 'on' and TG_OP = 'DELETE' then
    return old;
  end if;
  raise exception 'Registro financeiro histórico não pode ser alterado nem apagado (%). Use estorno.', TG_TABLE_NAME
    using errcode = '42501';
end $function$;

CREATE OR REPLACE FUNCTION public.fin_expurgo_transferencias(_ids uuid[], _lote text, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_t int; v_m int;
begin
  if coalesce(trim(_motivo),'') = '' or coalesce(trim(_lote),'') = '' then raise exception 'Lote e motivo obrigatórios'; end if;
  if exists (select 1 from financial_account_movements where transfer_id = any(_ids) and settlement_id is not null) then
    raise exception 'Transferência ligada a baixa não pode ser expurgada';
  end if;
  insert into fin_expurgo_backup(lote,motivo,tabela,registro_id,registro)
    select _lote,_motivo,'financial_account_movements',m.id,to_jsonb(m) from financial_account_movements m where m.transfer_id = any(_ids);
  insert into fin_expurgo_backup(lote,motivo,tabela,registro_id,registro)
    select _lote,_motivo,'financial_transfers',t.id,to_jsonb(t) from financial_transfers t where t.id = any(_ids);
  perform set_config('lardan.fin_expurgo','on',true);
  update financial_transfers set reversed_of = null where reversed_of = any(_ids) and not (id = any(_ids));
  delete from financial_account_movements where transfer_id = any(_ids);
  get diagnostics v_m = row_count;
  delete from financial_transfers where id = any(_ids);
  get diagnostics v_t = row_count;
  perform set_config('lardan.fin_expurgo','off',true);
  insert into audit_logs(action, entity, entity_id, payload)
    values ('fin.expurgo_transferencias','financial_transfers',null,
            jsonb_build_object('lote',_lote,'motivo',_motivo,'transferencias',v_t,'movimentos',v_m));
  return jsonb_build_object('transferencias',v_t,'movimentos',v_m);
end $function$;

CREATE OR REPLACE FUNCTION public.fin_expurgo_movimentos(_ids uuid[], _lote text, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_m int;
begin
  if coalesce(trim(_motivo),'') = '' or coalesce(trim(_lote),'') = '' then raise exception 'Lote e motivo obrigatórios'; end if;
  if exists (select 1 from financial_account_movements where id = any(_ids) and (settlement_id is not null or transfer_id is not null)) then
    raise exception 'Somente movimentos avulsos (sem baixa nem transferência) podem ser expurgados aqui';
  end if;
  insert into fin_expurgo_backup(lote,motivo,tabela,registro_id,registro)
    select _lote,_motivo,'financial_account_movements',m.id,to_jsonb(m) from financial_account_movements m where m.id = any(_ids);
  perform set_config('lardan.fin_expurgo','on',true);
  delete from financial_account_movements where id = any(_ids);
  get diagnostics v_m = row_count;
  perform set_config('lardan.fin_expurgo','off',true);
  insert into audit_logs(action, entity, entity_id, payload)
    values ('fin.expurgo_movimentos','financial_account_movements',null,
            jsonb_build_object('lote',_lote,'motivo',_motivo,'movimentos',v_m));
  return jsonb_build_object('movimentos',v_m);
end $function$;

CREATE OR REPLACE FUNCTION public.fin_transferencias_importar(_rows jsonb, _lote text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r jsonb; v_id uuid; v_ins int := 0; v_skip int := 0; v_key text; v_valor bigint; v_data date;
begin
  for r in select * from jsonb_array_elements(_rows) loop
    v_key := 'contaazul:transf:' || (r->>'id_ca');
    if exists (select 1 from financial_transfers where idempotency_key = v_key) then v_skip := v_skip + 1; continue; end if;
    v_valor := (r->>'valor_cents')::bigint; v_data := (r->>'data')::date;
    if v_valor is null or v_valor <= 0 or (r->>'from') = (r->>'to') then raise exception 'Linha inválida %', r; end if;
    insert into financial_transfers (from_account_id,to_account_id,data,valor_cents,referencia,motivo,idempotency_key,payload_fingerprint)
    values ((r->>'from')::uuid,(r->>'to')::uuid,v_data,v_valor,'Conta Azul '||(r->>'id_ca'),nullif(r->>'motivo',''),v_key,
            fin_fingerprint(jsonb_build_object('from',r->>'from','to',r->>'to','data',v_data::text,'valor_cents',v_valor)))
    returning id into v_id;
    insert into financial_account_movements (financial_account_id,kind,data,valor_cents,transfer_id,descricao)
    values ((r->>'from')::uuid,'transferencia_saida',v_data,-v_valor,v_id,nullif(r->>'motivo','')),
           ((r->>'to')::uuid,'transferencia_entrada',v_data,v_valor,v_id,nullif(r->>'motivo',''));
    v_ins := v_ins + 1;
  end loop;
  insert into audit_logs(action, entity, entity_id, payload)
    values ('fin.importar_transferencias','financial_transfers',null,jsonb_build_object('lote',_lote,'inseridas',v_ins,'ja_existiam',v_skip));
  return jsonb_build_object('inseridas',v_ins,'ja_existiam',v_skip);
end $function$;

REVOKE ALL ON FUNCTION public.fin_expurgo_transferencias(uuid[],text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin_expurgo_movimentos(uuid[],text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin_transferencias_importar(jsonb,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_expurgo_transferencias(uuid[],text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fin_expurgo_movimentos(uuid[],text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fin_transferencias_importar(jsonb,text) TO service_role;