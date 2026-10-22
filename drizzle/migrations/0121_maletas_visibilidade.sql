-- ============================================================================
-- 0120 — Maletas da consultora: onde estão e por que ela não vê
--
-- Achado de 22/10: o cockpit da consultora (cobrança) não tinha seção de
-- maletas, e a aba "Estoque e maletas" do cadastro era só um aviso. Além disso:
--   * maleta que está na rua pelo SmallData NÃO existe na operação do Lardan
--     (só no histórico, sem acerto) — a consultora não vê no app;
--   * maleta do Lardan só aparece no app dela se estiver expedida, em trânsito,
--     recebida, em operação ou em acerto, e se o login dela estiver ligado
--     à MESMA pessoa da maleta (cadastro repetido esconde a maleta).
-- Só leitura: nada aqui muda maleta, estoque ou cadastro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.maletas_pode_ver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (public.kit_scope_all() OR public.legado_pode_ver(auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.maletas_pode_ver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maletas_pode_ver() TO authenticated;

-- Por que uma maleta do Lardan não aparece no app da consultora (NULL = aparece).
CREATE OR REPLACE FUNCTION public.maleta_motivo_invisivel(_cycle uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN c.consultora_party_id IS NULL THEN 'maleta sem consultora'
    WHEN c.status IN ('rascunho', 'montagem', 'conferida') THEN 'ainda na matriz (' || c.status || '): aparece quando for expedida'
    WHEN c.status IN ('encerrada', 'cancelada') THEN 'maleta ' || c.status
    WHEN NOT EXISTS (SELECT 1 FROM profiles pf WHERE pf.party_id = c.consultora_party_id) THEN
      CASE WHEN EXISTS (SELECT 1 FROM parties o JOIN parties p ON p.id = c.consultora_party_id
                         JOIN profiles pf ON pf.party_id = o.id AND pf.is_active
                        WHERE o.id <> p.id AND o.kind = 'pessoa'
                          AND ((p.doc_digits IS NOT NULL AND o.doc_digits = p.doc_digits)
                               OR public.fin_unaccent_lower(btrim(o.display_name)) = public.fin_unaccent_lower(btrim(p.display_name))))
           THEN 'a maleta está em um cadastro e o login da consultora em OUTRO cadastro da mesma pessoa: unificar os cadastros'
           ELSE 'consultora sem login no app' END
    WHEN NOT EXISTS (SELECT 1 FROM profiles pf WHERE pf.party_id = c.consultora_party_id AND pf.is_active) THEN 'login da consultora desativado'
    ELSE NULL END
  FROM kit_cycles c WHERE c.id = _cycle
$$;
REVOKE ALL ON FUNCTION public.maleta_motivo_invisivel(uuid) FROM PUBLIC, anon, authenticated;

-- Maletas de UMA consultora: Lardan (abertas) + SmallData na rua + cadastros da mesma pessoa.
CREATE OR REPLACE FUNCTION public.consultora_maletas(_party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p record; cods int[]; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.maletas_pode_ver() THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  SELECT * INTO p FROM parties WHERE id = _party;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não encontrada.'; END IF;
  SELECT array_agg(codcli) INTO cods FROM legado_consultoras WHERE party_id = _party;

  RETURN jsonb_build_object(
    'pessoa', jsonb_build_object('party_id', p.id, 'nome', p.display_name, 'codigo', p.code, 'status', p.status,
       'tem_login', EXISTS (SELECT 1 FROM profiles pf WHERE pf.party_id = p.id),
       'login_ativo', EXISTS (SELECT 1 FROM profiles pf WHERE pf.party_id = p.id AND pf.is_active),
       'codigos_smalldata', to_jsonb(coalesce(cods, '{}'))),
    'lardan', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'cycle_id', c.id, 'kit', k.code, 'kit_nome', k.label, 'status', c.status, 'remessa', r.numero,
        'saida', c.shipped_at, 'vencimento', coalesce(c.due_at::date, r.data_acerto),
        'pecas', coalesce(c.quantity_total, (SELECT sum(b.qty_allocated) FROM kit_balances b WHERE b.cycle_id = c.id)),
        'valor_cents', c.reference_total_cents,
        'motivo_invisivel', public.maleta_motivo_invisivel(c.id)) ORDER BY c.created_at DESC)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id
     WHERE c.consultora_party_id = _party AND c.status NOT IN ('encerrada', 'cancelada')), '[]'::jsonb),
    'smalldata', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'remessa', m.remessa, 'kit', m.kit, 'emissao', m.emissao, 'vencimento', lr.vencimento, 'praca', lp.nome,
        'representante', rp.nome, 'pecas', m.pecas_enviadas, 'valor_enviado_cents', m.valor_enviado_cents,
        'dias_na_rua', hoje - m.emissao, 'atrasada', lr.vencimento IS NOT NULL AND lr.vencimento < hoje,
        'nf_remessa', m.nf_remessa) ORDER BY m.emissao DESC NULLS LAST)
      FROM legado_maletas m JOIN legado_remessas lr ON lr.numero = m.remessa
      LEFT JOIN legado_pracas lp ON lp.codigo = lr.praca LEFT JOIN legado_representantes rp ON rp.codigo = lr.representante
     WHERE m.codcli = ANY (coalesce(cods, '{}')) AND m.tipo = 'remessa' AND m.fechamento IS NULL), '[]'::jsonb),
    -- outros cadastros que parecem a mesma pessoa (CPF igual ou nome igual)
    'mesma_pessoa', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'party_id', o.id, 'nome', o.display_name, 'codigo', o.code, 'status', o.status,
        'motivo', CASE WHEN p.doc_digits IS NOT NULL AND o.doc_digits = p.doc_digits THEN 'mesmo CPF' ELSE 'mesmo nome' END,
        'tem_login', EXISTS (SELECT 1 FROM profiles pf WHERE pf.party_id = o.id AND pf.is_active),
        'maletas_abertas', (SELECT count(*) FROM kit_cycles c WHERE c.consultora_party_id = o.id AND c.status NOT IN ('encerrada', 'cancelada'))))
      FROM parties o
     WHERE o.id <> p.id AND o.kind = 'pessoa'
       AND ((p.doc_digits IS NOT NULL AND o.doc_digits = p.doc_digits)
            OR public.fin_unaccent_lower(btrim(o.display_name)) = public.fin_unaccent_lower(btrim(p.display_name)))), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.consultora_maletas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_maletas(uuid) TO authenticated;

-- Panorama da rede: maletas do Lardan que a consultora não vê e maletas na rua só no SmallData.
CREATE OR REPLACE FUNCTION public.maletas_visibilidade(_limite int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.maletas_pode_ver() THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  _limite := least(greatest(coalesce(_limite, 200), 1), 1000);
  RETURN (
    WITH ativas AS (
      SELECT c.*, public.maleta_motivo_invisivel(c.id) motivo FROM kit_cycles c
       WHERE c.status IN ('expedida', 'transito', 'recebida', 'operacao', 'acerto')),
    rua AS (
      SELECT m.*, lr.vencimento, lr.praca, lc.party_id, coalesce(lc.nome, 'Consultora ' || m.codcli) nome
        FROM legado_maletas m JOIN legado_remessas lr ON lr.numero = m.remessa
        LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
       WHERE m.tipo = 'remessa' AND m.fechamento IS NULL AND NOT coalesce(lc.interna, false))
    SELECT jsonb_build_object(
      'lardan', jsonb_build_object(
        'ativas', (SELECT count(*) FROM ativas),
        'invisiveis', (SELECT count(*) FROM ativas WHERE motivo IS NOT NULL),
        'lista', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', a.id, 'kit', k.code, 'status', a.status, 'remessa', r.numero,
                    'party_id', a.consultora_party_id, 'consultora', pa.display_name, 'motivo', a.motivo) ORDER BY pa.display_name)
                    FROM (SELECT * FROM ativas WHERE motivo IS NOT NULL LIMIT _limite) a JOIN kits k ON k.id = a.kit_id
                    LEFT JOIN remessas r ON r.id = a.remessa_id LEFT JOIN parties pa ON pa.id = a.consultora_party_id), '[]'::jsonb)),
      'smalldata', jsonb_build_object(
        'maletas', (SELECT count(*) FROM rua),
        'consultoras', (SELECT count(DISTINCT codcli) FROM rua),
        'sem_cadastro', (SELECT count(DISTINCT codcli) FROM rua WHERE party_id IS NULL),
        'pecas', (SELECT coalesce(sum(pecas_enviadas), 0) FROM rua),
        'valor_enviado_cents', (SELECT coalesce(sum(valor_enviado_cents), 0) FROM rua),
        'atrasadas', (SELECT count(*) FROM rua WHERE vencimento < hoje),
        'por_remessa', coalesce((SELECT jsonb_agg(x ORDER BY x.remessa DESC) FROM (
            SELECT r.remessa, min(r.emissao) emissao, max(r.vencimento) vencimento, lp.nome praca, count(*) maletas,
                   sum(r.pecas_enviadas) pecas, sum(r.valor_enviado_cents) valor_enviado_cents
              FROM rua r LEFT JOIN legado_pracas lp ON lp.codigo = r.praca GROUP BY r.remessa, lp.nome) x), '[]'::jsonb),
        'lista', coalesce((SELECT jsonb_agg(jsonb_build_object('remessa', r.remessa, 'kit', r.kit, 'codcli', r.codcli, 'party_id', r.party_id,
                    'consultora', r.nome, 'emissao', r.emissao, 'vencimento', r.vencimento, 'pecas', r.pecas_enviadas,
                    'valor_enviado_cents', r.valor_enviado_cents) ORDER BY r.remessa DESC, r.nome)
                    FROM (SELECT * FROM rua ORDER BY remessa DESC, nome LIMIT _limite) r), '[]'::jsonb))));
END $fn$;
REVOKE ALL ON FUNCTION public.maletas_visibilidade(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maletas_visibilidade(int) TO authenticated;