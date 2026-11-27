
CREATE OR REPLACE FUNCTION public.visao_unificada_mensal(_meses int DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_de date;
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  v_de := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - make_interval(months => greatest(1, least(coalesce(_meses,12), 36)) - 1))::date;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.mes) FROM (
    SELECT mes,
           sum(sd_maletas)::int sd_maletas, sum(sd_enviado)::bigint sd_enviado_cents, sum(sd_vendido)::bigint sd_vendido_cents,
           sum(ld_maletas)::int ld_maletas, sum(ld_enviado)::bigint ld_enviado_cents, sum(ld_vendido)::bigint ld_vendido_cents
    FROM (
      SELECT to_char(m.emissao, 'YYYY-MM') mes, count(*) sd_maletas, sum(m.valor_enviado_cents) sd_enviado, 0::numeric sd_vendido,
             0 ld_maletas, 0::numeric ld_enviado, 0::numeric ld_vendido
        FROM legado_maletas m
       WHERE m.tipo = 'remessa' AND m.emissao >= v_de
         AND NOT EXISTS (SELECT 1 FROM remessas r JOIN kit_cycles k ON k.remessa_id = r.id AND k.status <> 'cancelada' WHERE r.numero = m.remessa)
       GROUP BY 1
      UNION ALL
      SELECT to_char(m.fechamento, 'YYYY-MM'), 0, 0, sum(m.valor_venda_cents), 0, 0, 0
        FROM legado_maletas m
       WHERE m.tipo = 'remessa' AND m.fechamento >= v_de
         AND NOT EXISTS (SELECT 1 FROM remessas r JOIN kit_cycles k ON k.remessa_id = r.id AND k.status <> 'cancelada' WHERE r.numero = m.remessa)
       GROUP BY 1
      UNION ALL
      SELECT to_char((coalesce(k.shipped_at, k.received_at) AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM'), 0, 0, 0, count(*), sum(k.reference_total_cents), 0
        FROM kit_cycles k
       WHERE k.status NOT IN ('cancelada','rascunho','montagem','conferida') AND coalesce(k.shipped_at, k.received_at) >= v_de
       GROUP BY 1
      UNION ALL
      SELECT to_char((coalesce(p.encerrada_em, p.conferida_em, p.fechada_em) AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM'), 0, 0, 0, 0, 0,
             sum(coalesce(p.vendido_final_cents, p.total_vendido_cents))
        FROM kit_pre_baixas p
       WHERE p.status NOT IN ('aberta','cancelada') AND coalesce(p.encerrada_em, p.conferida_em, p.fechada_em) >= v_de
       GROUP BY 1
    ) u WHERE mes IS NOT NULL GROUP BY mes) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.visao_unificada_mensal(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.visao_unificada_mensal(int) TO authenticated, service_role;
