CREATE OR REPLACE FUNCTION public.cob_confissao_dados(_simulacao uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record; p record; a record; m record; zap text; mail text; pend jsonb := '[]'; plano text; dividas text; pendente jsonb;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança' USING errcode='42501'; END IF;
  SELECT * INTO s FROM cob_simulacoes WHERE id=_simulacao;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acordo não encontrado.'; END IF;
  IF s.status NOT IN ('simulada','aguardando_entrada','efetivada') THEN RAISE EXCEPTION 'Acordo cancelado ou excluído não gera termo.'; END IF;
  IF jsonb_array_length(coalesce(s.plano,'[]')) = 0 THEN RAISE EXCEPTION 'Acordo sem parcelas.'; END IF;
  SELECT * INTO m FROM assinatura_modelos WHERE tipo='confissao';
  SELECT * INTO p FROM parties WHERE id=s.party_id;
  SELECT * INTO a FROM party_addresses WHERE party_id=s.party_id ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT regexp_replace(value,'\D','','g') INTO zap FROM contact_points WHERE party_id=s.party_id AND kind='whatsapp' ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT value INTO mail FROM contact_points WHERE party_id=s.party_id AND kind='email' ORDER BY is_primary DESC, created_at LIMIT 1;
  IF zap IS NULL OR length(zap) < 10 THEN pend := pend || '["WhatsApp"]'; END IF;
  IF p.doc_digits IS NULL OR length(p.doc_digits) <> 11 THEN pend := pend || '["CPF"]'; END IF;
  IF a.city IS NULL THEN pend := pend || '["Endereço"]'; END IF;
  SELECT string_agg('- Parcela '||coalesce(x.v->>'numero', x.ord::text)||': R$ '||replace(to_char((x.v->>'valor_cents')::numeric/100,'FM999999990.00'),'.',',')||' com vencimento em '||to_char((x.v->>'data')::date,'DD/MM/YYYY'), E'\n' ORDER BY x.ord)
    INTO plano FROM jsonb_array_elements(s.plano) WITH ORDINALITY x(v, ord);
  IF coalesce(s.entrada_cents,0) > 0 THEN
    plano := '- Entrada: R$ '||replace(to_char(s.entrada_cents::numeric/100,'FM999999990.00'),'.',',')||coalesce(' em '||to_char(s.entrada_data,'DD/MM/YYYY'),'')||E'\n'||coalesce(plano,'');
  END IF;
  SELECT string_agg('- Vencimento '||to_char(c.vencimento,'DD/MM/YYYY')||': R$ '||replace(to_char(c.saldo_cents::numeric/100,'FM999999990.00'),'.',','), E'\n' ORDER BY c.vencimento)
    INTO dividas FROM public.cob_parcelas_abertas() c WHERE c.installment_id = ANY(s.installment_ids);
  SELECT to_jsonb(x) INTO pendente FROM (SELECT id, sign_url FROM assinaturas_digitais WHERE simulacao_id=_simulacao AND tipo='confissao' AND status='pendente' ORDER BY criado_em DESC LIMIT 1) x;
  RETURN jsonb_build_object(
    'party_id', s.party_id, 'pendente', pendente,
    'modelo', jsonb_build_object('titulo', m.titulo, 'texto', m.texto, 'revisado', m.revisado),
    'pendencias', pend,
    'signer', jsonb_build_object('nome', p.display_name, 'cpf', p.doc_digits, 'whatsapp', zap, 'email', mail),
    'campos', jsonb_build_object('nome', p.display_name,
      'cpf', CASE WHEN length(p.doc_digits)=11 THEN regexp_replace(p.doc_digits,'^(\d{3})(\d{3})(\d{3})(\d{2})$','\1.\2.\3-\4') ELSE coalesce(p.doc_digits,'') END,
      'codigo', p.code, 'endereco', btrim(concat_ws(', ', a.street, a.street_number)), 'bairro', coalesce(a.district,''),
      'cidade', coalesce(a.city||'/'||a.uf,''), 'cep', coalesce(regexp_replace(a.postal_code,'^(\d{5})(\d{3})$','\1-\2'),''),
      'whatsapp', coalesce(zap,''), 'representante','', 'praca','', 'maleta','', 'remessa','',
      'valor_cents', s.total_cents, 'plano', coalesce(plano,''), 'dividas', coalesce(dividas,'- Conforme parcelas em aberto na data do acordo')));
END $$;
REVOKE ALL ON FUNCTION public.cob_confissao_dados(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_confissao_dados(uuid) TO authenticated;