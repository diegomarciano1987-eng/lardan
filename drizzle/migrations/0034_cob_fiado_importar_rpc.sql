CREATE OR REPLACE FUNCTION public.cob_fiado_importar(_lote text, _linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare r record; v_party uuid; v_title uuid; v_praca uuid; v_conta uuid; v_ent uuid := '470f4648-849b-4b7d-91c4-042988e6727d';
  v_bol uuid; n_imp int := 0; n_pend int := 0; n_pul int := 0;
begin
  select id into v_bol from payment_methods where codigo='boleto_banc_rio';
  insert into chart_of_accounts(business_entity_id,codigo,nome,natureza)
    select v_ent,'FIADO-HIST','Fiado histórico de consultoras (saldo de implantação)','ativo'
    where not exists(select 1 from chart_of_accounts where codigo='FIADO-HIST');
  select id into v_conta from chart_of_accounts where codigo='FIADO-HIST';
  insert into cob_pracas(codigo,nome)
    select distinct on ((e->>'praca')::int) (e->>'praca')::int, e->>'praca_nome' from jsonb_array_elements(_linhas) e
    where nullif(e->>'praca','') is not null on conflict (codigo) do nothing;
  for r in select (e->>'linha')::int linha, e->'payload' payload, coalesce(e->>'doc','') doc, e->>'codcli' codcli,
      nullif(e->>'praca','')::int praca, nullif(e->>'rep','')::uuid rep, (e->>'dcob')::date dcob, (e->>'venc')::date venc,
      (e->>'parc')::int parc, (e->>'valor')::bigint valor from jsonb_array_elements(_linhas) e loop
    if exists(select 1 from cob_fiado_linhas where lote=_lote and linha=r.linha) then n_pul := n_pul+1; continue; end if;
    v_praca := null; select id into v_praca from cob_pracas where codigo=r.praca;
    v_party := null;
    if r.doc !~ '^0*$' then select id into v_party from parties where doc_digits=r.doc limit 1; end if;
    if v_party is null then
      insert into cob_fiado_linhas(lote,linha,payload,representante_party_id,praca_id,data_cobranca,vencimento,parcela,valor_cents,situacao,motivo)
      values (_lote,r.linha,r.payload,r.rep,v_praca,r.dcob,r.venc,r.parc,r.valor,'pendente','CPF sem cadastro ou inválido; aguardando decisão');
      n_pend := n_pend+1; continue;
    end if;
    insert into financial_titles(direction,business_entity_id,party_id,pagador_party_id,descricao,emissao,competencia,valor_cents,chart_account_id,payment_method_id,origem,sistema_origem,id_externo,observacao,status)
    values ('receivable',v_ent,v_party,v_party,'Fiado histórico — parcela '||r.parc,current_date,r.venc,r.valor,v_conta,v_bol,'importacao','fiado_historico','fiado:'||_lote||':'||r.linha,
      'Importado da planilha de fiados (linha '||r.linha||'); cobrança prevista em '||to_char(r.dcob,'DD/MM/YYYY'),'ativo')
    returning id into v_title;
    insert into financial_installments(title_id,numero,total_parcelas,vencimento,valor_cents) values (v_title,1,1,r.venc,r.valor);
    insert into financial_title_events(title_id,evento,payload) values (v_title,'criado',jsonb_build_object('valor_cents',r.valor,'origem','fiado_historico','lote',_lote,'linha',r.linha));
    insert into cob_fiado_linhas(lote,linha,payload,party_id,title_id,representante_party_id,praca_id,data_cobranca,vencimento,parcela,valor_cents,situacao)
    values (_lote,r.linha,r.payload,v_party,v_title,r.rep,v_praca,r.dcob,r.venc,r.parc,r.valor,'importada');
    insert into party_codigos_legados(party_id,sistema,codigo) values (v_party,'cliente',r.codcli) on conflict do nothing;
    update consultant_profiles set praca_id=coalesce(praca_id,v_praca), representative_party_id=coalesce(representative_party_id,r.rep) where party_id=v_party;
    n_imp := n_imp+1;
  end loop;
  return jsonb_build_object('importadas',n_imp,'pendentes',n_pend,'ja_existiam',n_pul);
end $$;
REVOKE ALL ON FUNCTION public.cob_fiado_importar(text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cob_fiado_importar(text, jsonb) TO service_role;