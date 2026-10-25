-- Refazer conciliação depois de desfeita: a chave de repetição da conciliação estornada
-- não pode devolver "repetido" (o botão dizia "Conciliado!" sem lançar nada).
create or replace function public.fin_reconcile_chave_livre(_key text)
returns text language plpgsql stable set search_path = public as $$
declare k text := _key; n int := 1;
begin
  if _key is null then return null; end if;
  while exists (select 1 from financial_reconciliations where idempotency_key = k and status = 'estornada') loop
    k := _key || ':refeita:' || n; n := n + 1;
  end loop;
  return k;
end $$;
revoke all on function public.fin_reconcile_chave_livre(text) from public, anon, authenticated;

do $mig$
declare d text; novo text;
begin
  d := pg_get_functiondef('public.fin_reconcile(jsonb)'::regprocedure);
  novo := regexp_replace(d, '(perform pg_advisory_xact_lock\(hashtext\(''fin_reconcile:'' \|\| v_key\)\);)',
    E'\\1\n    v_key := public.fin_reconcile_chave_livre(v_key);');
  if novo = d then raise exception 'fin_reconcile: ponto de troca não encontrado'; end if;
  execute novo;

  d := pg_get_functiondef('public.fin_reconcile_baixa_existente'::regproc);
  novo := regexp_replace(d, '(perform pg_advisory_xact_lock\(hashtext\(''fin_reconcile:'' \|\| _idempotency_key\)\);)',
    E'\\1\n    _idempotency_key := public.fin_reconcile_chave_livre(_idempotency_key);');
  if novo = d then raise exception 'fin_reconcile_baixa_existente: ponto de troca não encontrado'; end if;
  execute novo;

  d := pg_get_functiondef('public.fin_mesa_novo_conciliar'::regproc);
  novo := regexp_replace(d, '(v_key := ''mesa-novo:'' \|\| l\.id;)',
    E'\\1\n  v_key := public.fin_reconcile_chave_livre(v_key);');
  novo := replace(novo, 'Já existe um lançamento criado para esta linha do extrato.',
    'Já existe um lançamento criado para esta linha do extrato. Use "Vincular a existente" para conciliar com ele.');
  if novo = d then raise exception 'fin_mesa_novo_conciliar: ponto de troca não encontrado'; end if;
  execute novo;
end $mig$;