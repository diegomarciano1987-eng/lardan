CREATE OR REPLACE FUNCTION public.cob_historica_buscar(_termo text, _corte date DEFAULT '2025-12-31')
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN coalesce((SELECT array_agg(DISTINCT p.id) FROM public.cob_parcelas_abertas() a JOIN parties p ON p.id = a.party_id
     WHERE a.vencimento <= _corte AND a.saldo_cents > 0
       AND public.consultora_termo_casa(p.id, coalesce(p.display_name, p.legal_name), p.code, p.doc_digits, _termo)), '{}');
END $$;
REVOKE ALL ON FUNCTION public.cob_historica_buscar(text, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_historica_buscar(text, date) TO authenticated;