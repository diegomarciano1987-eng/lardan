-- 0275 (Diego, 08/11/2026): "sim, ative" — ativa as consultoras marcadas como ATIVAS no SmallData
-- (legado_consultoras.ativo, fora das internas) que continuavam inativas aqui sem movimento em aberto.
-- Usa a mesma função oficial do 0269: bloqueada/desligada, cadastro unificado ou sem papel de consultora
-- nunca (a função recusa). Cada ativação fica no audit_logs com origem 'ajuste 0275: ativa no SmallData'
-- — para desfazer, ler essas linhas. Pode rodar duas vezes: quem já está ativa não muda.
WITH alvo AS (
  SELECT DISTINCT lc.party_id AS pid
    FROM public.legado_consultoras lc
   WHERE lc.ativo IS TRUE AND lc.party_id IS NOT NULL AND NOT coalesce(lc.interna, false)
)
SELECT count(*) FILTER (WHERE public.consultora_ativar_por_movimento(a.pid, NULL, 'ajuste 0275: ativa no SmallData')) AS ativadas
  FROM alvo a
  JOIN public.party_roles pr ON pr.party_id = a.pid AND pr.role = 'consultora'
  JOIN public.parties p ON p.id = a.pid
 WHERE p.status::text = 'inativo' OR pr.status::text = 'inativo';
