CREATE OR REPLACE FUNCTION public.fin_test_isolate_accounts(_ids uuid[], _marca text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_role text; v_id uuid; v_nome text; v_criada timestamptz; v_isoladas int := 0;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    session_user);
  if v_role is distinct from 'service_role' and session_user <> 'service_role' then
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
    if v_nome is null then raise exception 'Conta % não existe', v_id; end if;
    if position(_marca in v_nome) <> 1 then
      raise exception 'Conta % não pertence a esta execução de teste', v_id;
    end if;
    if v_criada < now() - interval '24 hours' then
      raise exception 'Conta % é anterior a esta execução', v_id;
    end if;
    if exists (select 1 from financial_settlements s where s.financial_account_id = v_id) then
      raise exception 'Conta % tem baixas: não pode ser isolada', v_id;
    end if;

    update financial_accounts
       set is_homologacao = true, is_active = false, updated_at = now()
     where id = v_id;
    insert into audit_logs (entity, entity_id, action, actor_id, payload)
    values ('financial_accounts', v_id, 'fin.homologacao.isolar', null,
            jsonb_build_object('marca', _marca, 'nome', v_nome));
    v_isoladas := v_isoladas + 1;
  end loop;

  return jsonb_build_object('isoladas', v_isoladas);
end $function$;
REVOKE EXECUTE ON FUNCTION public.fin_test_isolate_accounts(uuid[], text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.fin_test_isolate_accounts(uuid[], text) TO service_role;