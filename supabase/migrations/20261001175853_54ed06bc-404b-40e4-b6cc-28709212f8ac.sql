
do $mig$
declare d text; n text;
begin
  -- fin_dre: competência por parcela
  d := pg_get_functiondef('public.fin_dre(jsonb)'::regprocedure);
  n := replace(d,
$o$    select ca.natureza::text, ca.id, ca.codigo, ca.nome, t.valor_cents, t.id, t.cost_center_id
    from financial_titles t left join chart_of_accounts ca on ca.id = t.chart_account_id
    where t.status in ('ativo','aprovado')
      and coalesce(t.competencia, t.emissao) between v_de and v_ate$o$,
$o$    select ca.natureza::text, ca.id, ca.codigo, ca.nome, i.valor_cents, t.id, t.cost_center_id
    from financial_installments i join financial_titles t on t.id = i.title_id
    left join chart_of_accounts ca on ca.id = t.chart_account_id
    where t.status in ('ativo','aprovado')
      and coalesce(i.competencia, t.competencia, t.emissao) between v_de and v_ate$o$);
  n := replace(n, 'Competência: valor de cada título uma vez, pela data de competência (ou emissão, quando não houver).',
                  'Competência: valor de cada parcela uma vez, pela competência da parcela (ou do título, ou emissão).');
  if n = d then raise exception 'fin_dre: trecho não encontrado'; end if;
  execute n;

  -- fin_dre_detalhe: uma linha por parcela
  d := pg_get_functiondef('public.fin_dre_detalhe(jsonb)'::regprocedure);
  n := replace(d,
$o$    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'data', coalesce(t.competencia, t.emissao),
             'descricao', t.descricao, 'contraparte', coalesce(p.display_name,p.legal_name,p.code),
             'direction', t.direction::text, 'valor_cents', t.valor_cents)
             order by coalesce(t.competencia, t.emissao)), '[]'::jsonb),
           coalesce(sum(t.valor_cents),0)
      into v_rows, v_soma
    from financial_titles t join parties p on p.id = t.party_id
    where t.status in ('ativo','aprovado')
      and coalesce(t.competencia, t.emissao) between v_de and v_ate$o$,
$o$    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'data', coalesce(i.competencia, t.competencia, t.emissao),
             'descricao', t.descricao || case when i.total_parcelas > 1 then ' — parcela '||i.numero||'/'||i.total_parcelas else '' end,
             'contraparte', coalesce(p.display_name,p.legal_name,p.code),
             'direction', t.direction::text, 'valor_cents', i.valor_cents, 'total_contrato_cents', t.valor_cents)
             order by coalesce(i.competencia, t.competencia, t.emissao)), '[]'::jsonb),
           coalesce(sum(i.valor_cents),0)
      into v_rows, v_soma
    from financial_installments i join financial_titles t on t.id = i.title_id join parties p on p.id = t.party_id
    where t.status in ('ativo','aprovado')
      and coalesce(i.competencia, t.competencia, t.emissao) between v_de and v_ate$o$);
  if n = d then raise exception 'fin_dre_detalhe: trecho não encontrado'; end if;
  execute n;

  -- fin_cashflow: transferência uma vez; implantação separada
  d := pg_get_functiondef('public.fin_cashflow(jsonb)'::regprocedure);
  n := d;
  n := replace(n, $o$           (m.kind in ('transferencia_entrada','transferencia_saida') or m.transfer_id is not null) as e_transferencia,$o$,
$o$           (m.kind in ('transferencia_entrada','transferencia_saida') or m.transfer_id is not null) as e_transferencia,
           coalesce((select fa2.is_implantacao or ta2.is_implantacao from financial_transfers ft2
                      join financial_accounts fa2 on fa2.id = ft2.from_account_id
                      join financial_accounts ta2 on ta2.id = ft2.to_account_id where ft2.id = m.transfer_id), a.is_implantacao) as e_implantacao,$o$);
  n := replace(n, $o$           sum(case when faixa='transferencia' then abs(valor_cents) else 0 end) as transferencias,$o$,
$o$           sum(case when faixa='transferencia' and not e_implantacao and valor_cents < 0 then -valor_cents else 0 end) as transferencias,
           sum(case when faixa='transferencia' and e_implantacao and valor_cents < 0 then -valor_cents else 0 end) as transf_implantacao,$o$);
  n := replace(n, $o$           coalesce(r.transferencias,0) as transferencias_cents,$o$,
$o$           coalesce(r.transferencias,0) as transferencias_cents, coalesce(r.transf_implantacao,0) as transferencias_implantacao_cents,$o$);
  n := replace(n, $o$      'transferencias_cents', coalesce((select sum(transferencias_cents) from acumulado),0),$o$,
$o$      'transferencias_cents', coalesce((select sum(transferencias_cents) from acumulado),0),
      'transferencias_implantacao_cents', coalesce((select sum(transferencias_implantacao_cents) from acumulado),0),$o$);
  n := replace(n, $o$'saidas_realizadas_cents', saidas_realizadas, 'transferencias_cents', transferencias_cents,$o$,
$o$'saidas_realizadas_cents', saidas_realizadas, 'transferencias_cents', transferencias_cents,
        'transferencias_implantacao_cents', transferencias_implantacao_cents,$o$);
  if (length(n) - length(d)) < 600 then raise exception 'fin_cashflow: trechos não encontrados'; end if;
  execute n;
end $mig$;
