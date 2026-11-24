CREATE OR REPLACE FUNCTION public.fin_statement_lines_list(_filtros jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_rows jsonb; v_total int; v_lim int := least(coalesce((_filtros->>'limit')::int,25),100);
  v_off int := coalesce((_filtros->>'offset')::int,0); v_q text := nullif(_filtros->>'q','');
  v_acc uuid := nullif(_filtros->>'financial_account_id','')::uuid;
  v_st text := nullif(_filtros->>'status',''); v_imp uuid := nullif(_filtros->>'import_id','')::uuid;
  v_de date := nullif(_filtros->>'de','')::date; v_ate date := nullif(_filtros->>'ate','')::date;
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  with base as (
    select l.* from financial_statement_lines l
    where (v_acc is null or l.financial_account_id = v_acc)
      and (v_st is null or l.status::text = v_st)
      and (v_imp is null or l.import_id = v_imp)
      and (v_de is null or l.data >= v_de)
      and (v_ate is null or l.data <= v_ate)
      and (v_q is null or l.historico ilike '%'||v_q||'%' or l.documento ilike '%'||v_q||'%' or l.bank_id ilike '%'||v_q||'%')
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc, x.line_no nulls last, x.id), '[]'::jsonb), (select count(*) from base)
    into v_rows, v_total
  from (select * from base order by data desc, line_no nulls last, id limit v_lim offset v_off) x;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $function$;

CREATE OR REPLACE FUNCTION public.asaas_nome_norm(_t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT nullif(btrim(regexp_replace(lower(translate(coalesce(_t,''),'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),'\s+',' ','g')),'') $$;

-- nome do pagador que o Asaas escreve no extrato ("Cobrança recebida - fatura nr. 123 Nome")
CREATE OR REPLACE FUNCTION public.asaas_nome_pix(_charge_external text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT nullif(btrim(regexp_replace(l.historico,'^.*fatura nr\.\s*\d+\s*','')),'')
        FROM financial_statement_lines l WHERE l.raw->>'paymentId' = _charge_external AND l.historico ILIKE '%fatura nr.%'
       ORDER BY l.data DESC LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.asaas_nome_pix(text) FROM PUBLIC, anon;

-- liga ao cadastro as cobranças recebidas sem cliente: só com CPF igual ou nome igual e único
CREATE OR REPLACE FUNCTION public.asaas_mesa_identificar_nucleo(_party uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; alvo uuid; n int := 0;
BEGIN
  FOR r IN
    SELECT c.id, c.external_id, regexp_replace(coalesce(cu.doc,''),'\D','','g') doc,
           public.asaas_nome_norm(coalesce(cu.name, public.asaas_nome_pix(c.external_id))) nome
      FROM asaas_charges c
      LEFT JOIN asaas_customers cu ON cu.account_id=c.account_id AND cu.external_id=c.customer_external_id
     WHERE c.party_id IS NULL AND c.installment_id IS NULL AND c.title_id IS NULL AND c.external_status='RECEIVED'
  LOOP
    alvo := NULL;
    IF length(r.doc) IN (11,14) THEN
      SELECT CASE WHEN count(*)=1 THEN min(p.id::text)::uuid END INTO alvo FROM parties p WHERE p.doc_digits = r.doc AND p.is_active;
    END IF;
    IF alvo IS NULL AND r.nome IS NOT NULL AND position(' ' in r.nome) > 0 THEN
      SELECT CASE WHEN count(*)=1 THEN min(p.id::text)::uuid END INTO alvo FROM parties p
       WHERE p.is_active AND public.asaas_nome_norm(p.display_name) = r.nome;
    END IF;
    IF alvo IS NOT NULL AND (_party IS NULL OR alvo = _party) THEN
      UPDATE asaas_charges SET party_id = alvo,
             reconcile_note = coalesce(reconcile_note || ' | ','') || 'Cliente reconhecido pelo ' || CASE WHEN length(r.doc) IN (11,14) THEN 'CPF/nome' ELSE 'nome do Pix' END
       WHERE id = r.id AND party_id IS NULL;
      INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
      VALUES (auth.uid(), 'asaas_mesa_identificar', 'asaas_charges', r.id::text, jsonb_build_object('party_id', alvo, 'external_id', r.external_id));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.asaas_mesa_identificar_nucleo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_mesa_identificar_nucleo(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_mesa_identificar() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  RETURN public.asaas_mesa_identificar_nucleo(NULL);
END $$;
REVOKE ALL ON FUNCTION public.asaas_mesa_identificar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_mesa_identificar() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asaas_mesa_definir_cliente(_charge uuid, _party uuid, _motivo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ DECLARE c record; BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF length(btrim(coalesce(_motivo,''))) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM asaas_charges WHERE id=_charge FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança inexistente.'; END IF;
  IF c.installment_id IS NOT NULL OR c.title_id IS NOT NULL THEN RAISE EXCEPTION 'Cobrança já vinculada a um título.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id=_party AND is_active) THEN RAISE EXCEPTION 'Cadastro não encontrado ou inativo.'; END IF;
  UPDATE asaas_charges SET party_id=_party, reconcile_note = coalesce(reconcile_note || ' | ','') || 'Cliente definido na Mesa: ' || btrim(_motivo) WHERE id=_charge;
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'asaas_mesa_definir_cliente', 'asaas_charges', _charge::text, jsonb_build_object('antes', c.party_id, 'party_id', _party, 'motivo', btrim(_motivo)));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.asaas_mesa_definir_cliente(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_mesa_definir_cliente(uuid,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asaas_mesa_party_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN
  IF EXISTS (SELECT 1 FROM asaas_charges WHERE party_id IS NULL AND installment_id IS NULL AND title_id IS NULL AND external_status='RECEIVED') THEN
    PERFORM public.asaas_mesa_identificar_nucleo(NEW.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL; -- nunca trava o cadastro
END $$;
REVOKE ALL ON FUNCTION public.asaas_mesa_party_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS asaas_mesa_party_identificar ON public.parties;
CREATE TRIGGER asaas_mesa_party_identificar AFTER INSERT OR UPDATE OF display_name, doc_digits ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.asaas_mesa_party_trg();

CREATE OR REPLACE FUNCTION public.asaas_mesa_pendentes(_busca text DEFAULT NULL::text, _offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE res jsonb; b text := nullif(btrim(coalesce(_busca,'')),''); dig text := regexp_replace(coalesce(_busca,''),'\D','','g');
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  WITH base AS (
    SELECT c.id, c.external_id, c.value_cents, coalesce(c.net_value_cents, c.value_cents - coalesce(c.fee_cents,0)) liquido_cents,
           c.payment_date, c.due_date, c.billing_type, c.party_id,
           coalesce(p.display_name, cu.name) nome, public.asaas_nome_pix(c.external_id) nome_pix,
           CASE WHEN length(regexp_replace(coalesce(cu.doc,''),'\D','','g'))=11
                THEN '***.'||substr(regexp_replace(cu.doc,'\D','','g'),4,3)||'.'||substr(regexp_replace(cu.doc,'\D','','g'),7,3)||'-**'
                ELSE cu.doc END doc,
           c.raw->>'description' descricao
      FROM asaas_charges c
      LEFT JOIN asaas_customers cu ON cu.account_id=c.account_id AND cu.external_id=c.customer_external_id
      LEFT JOIN parties p ON p.id=c.party_id
     WHERE c.external_status='RECEIVED' AND c.installment_id IS NULL AND c.title_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM financial_statement_lines l JOIN asaas_accounts aa ON aa.financial_account_id = l.financial_account_id
                        WHERE aa.id = c.account_id AND l.documento = c.external_id AND l.kind = 'entrada' AND l.status = 'conciliada')
  ), f AS (
    SELECT * FROM base WHERE (b IS NULL
            OR (b ILIKE 'pay\_%' AND external_id = b)
            OR (b NOT ILIKE 'pay\_%' AND (
                  coalesce(nome,'') ILIKE '%'||b||'%' OR coalesce(nome_pix,'') ILIKE '%'||b||'%'
                  OR external_id ILIKE '%'||b||'%'
                  OR (b !~ '[A-Za-z]' AND length(dig) >= 3 AND regexp_replace(coalesce(doc,''),'\D','','g') LIKE '%'||dig||'%'))))
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM f),'soma_cents',(SELECT coalesce(sum(value_cents),0) FROM f),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.payment_date DESC NULLS LAST, x.id) FROM
       (SELECT * FROM f ORDER BY payment_date DESC NULLS LAST, id LIMIT 50 OFFSET greatest(_offset,0)) x),'[]'))
    INTO res;
  RETURN res;
END $function$;

DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.proname='asaas_auto_extrato_nucleo' AND p.pronamespace='public'::regnamespace;
  IF d IS NOT NULL AND position('tarifas de notificação do mês (5.1.1)' in d) > 0 THEN
    EXECUTE replace(d, 'tarifas de notificação do mês (5.1.1)', 'tarifas de notificação do mês (conta do plano configurada)');
  END IF;
END $$;