-- 1. A rotina perigosa deixa de existir.
DROP FUNCTION IF EXISTS public.fin_homolog_purge();

-- 2. Marca de isolamento (não apaga nada; separa massa de homologação do real).
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS is_homologacao boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS financial_accounts_homolog_idx
  ON public.financial_accounts (is_homologacao) WHERE is_homologacao;

-- 3. Isolamento por IDs efetivamente criados pela execução do teste.
CREATE OR REPLACE FUNCTION public.fin_test_isolate_accounts(_ids uuid[], _marca text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_id uuid; v_nome text; v_criada timestamptz; v_vinculos int; v_ok int := 0;
begin
  -- Só a bancada técnica (chave de serviço) executa.
  if current_user <> 'service_role' then
    raise exception 'Rotina técnica de homologação: acesso negado';
  end if;
  if _marca is null or _marca !~ '^HOMOLOG' then
    raise exception 'Marca de homologação inválida';
  end if;
  if _ids is null or array_length(_ids,1) is null then
    return jsonb_build_object('isoladas', 0);
  end if;

  foreach v_id in array _ids loop
    select nome, created_at into v_nome, v_criada from financial_accounts where id = v_id;
    if v_nome is null then
      raise exception 'Conta % não existe: limpeza recusada', v_id;
    end if;
    if position(_marca in v_nome) <> 1 then
      raise exception 'Conta % não pertence à execução % : limpeza recusada', v_id, _marca;
    end if;
    if v_criada < now() - interval '24 hours' then
      raise exception 'Conta % é anterior a esta execução: limpeza recusada', v_id;
    end if;
    select count(*) into v_vinculos
    from financial_settlements s where s.financial_account_id = v_id;
    if v_vinculos > 0 then
      raise exception 'Conta % tem baixas registradas: limpeza recusada', v_id;
    end if;
    select count(*) into v_vinculos
    from financial_reconciliations r
    join financial_statement_lines l on l.id = r.statement_line_id
    join financial_statement_imports im on im.id = l.import_id
    where im.financial_account_id = v_id;
    if v_vinculos > 0 then
      raise exception 'Conta % tem conciliações: limpeza recusada', v_id;
    end if;

    update financial_accounts
       set is_homologacao = true, is_active = false, updated_at = now()
     where id = v_id;
    v_ok := v_ok + 1;
  end loop;

  insert into audit_logs (entity, entity_id, action, actor_id, payload)
  values ('financial_accounts', null, 'fin.homologacao.isolar', null,
          jsonb_build_object('marca', _marca, 'ids', to_jsonb(_ids), 'isoladas', v_ok));

  return jsonb_build_object('isoladas', v_ok, 'movimentos_preservados', true);
end $function$;

REVOKE EXECUTE ON FUNCTION public.fin_test_isolate_accounts(uuid[], text) FROM anon, authenticated, public;

-- 4. Contas isoladas somem dos números reais (nada é apagado).
CREATE OR REPLACE FUNCTION public.fin_accounts_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  if not has_capability(auth.uid(),'finance.bank.view') then raise exception 'Sem permissão'; end if;
  select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', a.id, 'nome', a.nome, 'kind', a.kind, 'banco', a.banco,
      'is_active', a.is_active,
      'saldo_cents', coalesce((select sum(m.valor_cents) from financial_account_movements m
                                where m.financial_account_id = a.id),0),
      'ultimo_movimento', (select max(m.data)::text from financial_account_movements m
                            where m.financial_account_id = a.id)
    ) as x
    from financial_accounts a
    where not a.is_homologacao
  ) s;
  return r;
end $function$;

REVOKE EXECUTE ON FUNCTION public.fin_accounts_overview() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fin_accounts_overview() TO authenticated;