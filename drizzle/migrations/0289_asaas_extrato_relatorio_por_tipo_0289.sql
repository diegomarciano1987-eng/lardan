-- 0289: relatório da etapa B traz até 150 registros de cada tipo (antes 300 no total, e a identificação escondia os outros)
CREATE OR REPLACE FUNCTION public.asaas_auto_extrato_relatorio(_de date, _ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ini timestamptz; fim timestamptz;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'finance.reconcile') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  ini := (coalesce(_de, current_date)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  fim := ((coalesce(_ate, _de, current_date) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  RETURN jsonb_build_object(
    'ligado', (SELECT extrato_ligado FROM public.asaas_auto_config WHERE id),
    'resumo', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'qtd', qtd, 'valor_cents', v) ORDER BY tipo)
       FROM (SELECT tipo, count(*) qtd, coalesce(sum(valor_cents), 0) v FROM public.asaas_auto_extrato
              WHERE desfeito_em IS NULL AND criado_em >= ini AND criado_em < fim GROUP BY tipo) z), '[]'::jsonb),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(y) - 'rn' ORDER BY y.quando DESC) FROM (
       SELECT e.id, e.tipo, e.motivo, e.valor_cents, e.criado_em quando, e.desfeito_em, e.desfeito_motivo, e.detalhe,
              c.external_id pay, p.display_name pessoa, p.code pessoa_codigo, t.numero titulo_numero,
              row_number() OVER (PARTITION BY e.tipo ORDER BY e.criado_em DESC) rn
         FROM public.asaas_auto_extrato e
         LEFT JOIN public.asaas_charges c ON c.id = e.charge_id
         LEFT JOIN public.parties p ON p.id = (e.detalhe->>'party_para')::uuid
         LEFT JOIN public.financial_titles t ON t.id = e.title_id
        WHERE e.criado_em >= ini AND e.criado_em < fim) y WHERE y.rn <= 150), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.asaas_auto_extrato_relatorio(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_auto_extrato_relatorio(date,date) TO authenticated;