-- 0351 (Diego, 19/11/2026): cobrança que a consultora gera no app para a cliente dela (título origem 'consultora')
-- só aparece no Contas a Receber / painel / fluxo de caixa da Lardan quando a cliente pagou (existe recebimento).
CREATE OR REPLACE FUNCTION public.fin_pedido_consultora_aguardando(_title uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.financial_titles t WHERE t.id = _title AND t.origem = 'consultora')
     AND NOT EXISTS (SELECT 1 FROM public.financial_allocations a
                       JOIN public.financial_installments i ON i.id = a.installment_id
                      WHERE i.title_id = _title)
$$;
REVOKE ALL ON FUNCTION public.fin_pedido_consultora_aguardando(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_pedido_consultora_aguardando(uuid) TO authenticated, service_role;

-- Aplica o filtro nas rotinas oficiais trocando um trecho exato da definição atual (falha se o trecho não existir).
CREATE OR REPLACE FUNCTION pg_temp.trocar(_fn regprocedure, _de text, _para text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d text := pg_get_functiondef(_fn);
BEGIN
  IF position(_de IN d) = 0 THEN RAISE EXCEPTION '0351: trecho não encontrado em %', _fn; END IF;
  IF position(_para IN d) > 0 THEN RETURN; END IF;
  EXECUTE replace(d, _de, _para);
END $f$;

SELECT pg_temp.trocar('public.fin_titles_list(text,text,text,text,integer,integer,uuid,uuid,uuid,boolean,date,date,text)'::regprocedure,
  E'    where t.direction = v_dir\n',
  E'    where t.direction = v_dir\n      and not public.fin_pedido_consultora_aguardando(t.id)\n');

SELECT pg_temp.trocar('public.fin_overview(date,date)'::regprocedure,
  'from fin_parcela_posicao(v_corte) where saldo_cents > 0)',
  'from fin_parcela_posicao(v_corte) where saldo_cents > 0 and not public.fin_pedido_consultora_aguardando(title_id))');

SELECT pg_temp.trocar('public.fin_pagar_receber(text,date,date,text,text,text,integer,integer)'::regprocedure,
  E'    where p.vencimento between v_de and v_ate\n',
  E'    where p.vencimento between v_de and v_ate\n      and not public.fin_pedido_consultora_aguardando(p.title_id)\n');

SELECT pg_temp.trocar('public.fin_pagar_receber(text,date,date,text,text,text,integer,integer)'::regprocedure,
  E'           ''linhas'', (select count(*) from f),\n',
  E'           ''linhas'', (select count(*) from f),\n'
  || E'           ''pedidos_consultora_aguardando'', (select jsonb_build_object(''qtd'', count(*), ''valor_cents'', coalesce(sum(i.valor_cents),0))\n'
  || E'               from financial_installments i join financial_titles t on t.id = i.title_id\n'
  || E'              where t.origem = ''consultora'' and t.status <> ''cancelado'' and pode_rec and _natureza in (''todos'',''receber'')\n'
  || E'                and i.vencimento between v_de and v_ate and public.fin_pedido_consultora_aguardando(t.id)),\n');

SELECT pg_temp.trocar('public.fin_cashflow(jsonb)'::regprocedure,
  'and t.status in (''ativo'',''aprovado'') and s.saldo > 0',
  'and t.status in (''ativo'',''aprovado'') and s.saldo > 0 and not public.fin_pedido_consultora_aguardando(t.id)');

SELECT pg_temp.trocar('public.fin_cashflow_detail(jsonb)'::regprocedure,
  E'      where i.vencimento between v_de and v_ate and t.status in (''ativo'',''aprovado'')\n',
  E'      where i.vencimento between v_de and v_ate and t.status in (''ativo'',''aprovado'')\n        and not public.fin_pedido_consultora_aguardando(t.id)\n');