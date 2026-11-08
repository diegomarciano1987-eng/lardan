-- 0269 (Diego, 08/11/2026): "se tem qualquer movimento em nome delas é porque ela está ativa".
-- Ajuste único de dados: ativa as consultoras marcadas como inativas que têm movimento em aberto hoje:
--   * maleta Lardan não cancelada e não encerrada;
--   * maleta do SmallData sem fechamento e "na rua" (mesma regra de legado_maleta_na_rua);
--   * convite de acesso pendente/aceito ou conta já ligada;
--   * pedido de venda, pré-baixa ou troca registrada na Lardan (fora do histórico SmallData).
-- Bloqueada/desligada e cadastro unificado nunca (a função recusa). Cada ativação fica no audit_logs
-- com origem 'ajuste 0269: movimento em aberto' — para desfazer, ler essas linhas.
-- Pode rodar duas vezes: quem já está ativa não muda.
WITH mov AS (
  SELECT consultora_party_id pid FROM public.kit_cycles WHERE status::text NOT IN ('encerrada','cancelada')
  UNION SELECT lc.party_id FROM public.legado_maletas lm
          JOIN public.legado_consultoras lc ON lc.codcli = lm.codcli
          LEFT JOIN public.legado_maleta_status s ON s.remessa = lm.remessa AND s.codcli = lm.codcli
          LEFT JOIN public.legado_maleta_situacoes n ON n.codigo = s.status
         WHERE lm.fechamento IS NULL AND coalesce(n.na_rua, s.remessa IS NULL)
  UNION SELECT party_id FROM public.access_invites WHERE status IN ('pendente','falha_envio','aceito')
  UNION SELECT party_id FROM public.profiles WHERE party_id IS NOT NULL
  UNION SELECT consultora_party_id FROM public.sales_orders
  UNION SELECT consultora_party_id FROM public.kit_pre_baixas
  UNION SELECT consultora_party_id FROM public.qualidade_trocas WHERE origem <> 'legado_smalldata'
)
SELECT count(*) FILTER (WHERE public.consultora_ativar_por_movimento(m.pid, NULL, 'ajuste 0269: movimento em aberto')) AS ativadas
  FROM mov m
  JOIN public.party_roles pr ON pr.party_id = m.pid AND pr.role = 'consultora'
  JOIN public.parties p ON p.id = m.pid
 WHERE m.pid IS NOT NULL AND (p.status::text = 'inativo' OR pr.status::text = 'inativo');
