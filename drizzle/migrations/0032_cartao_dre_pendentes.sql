DO $do$
declare d text := pg_get_functiondef('public.fin_dre_base(date,date,text,uuid,uuid)'::regprocedure);
begin
  d := replace(d, $a$select 'cartao'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome, l.valor_cents$a$,
                  $a$select case when l.chart_account_id is null then 'titulo' else 'cartao' end::text, ca.natureza::text, ca.id, ca.codigo, ca.nome, l.valor_cents$a$);
  d := replace(d, $a$select 'cartao'::text, ca.natureza::text, ca.id, ca.codigo, ca.nome,
           (floor$a$, $a$select case when ln.lchart is null then 'titulo' else 'cartao' end::text, ca.natureza::text, ca.id, ca.codigo, ca.nome,
           (floor$a$);
  if position('when l.chart_account_id is null' in d) = 0 or position('when ln.lchart is null' in d) = 0 then
    raise exception 'patch não aplicado';
  end if;
  execute d;
end $do$;