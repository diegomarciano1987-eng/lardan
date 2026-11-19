-- 0357: no Relatório de acertos, o representante do SmallData só vira um cadastro do Lardan que tem papel de representante.
-- Antes, o vínculo antigo do SmallData (ex.: 3009 → cadastro da consultora Gracielle, 3010 → cadastro de teste "guilherme")
-- aparecia como nome do representante. O vínculo antigo NÃO é alterado (regra 3009/3010 preservada); só a leitura do relatório.
-- Ordem: vínculo do SmallData se for representante → mesmo nome de um único representante do cadastro → nome do SmallData.
CREATE OR REPLACE FUNCTION public.rep_nome_norm(_nome text)
 RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $$
  SELECT nullif(btrim(regexp_replace(regexp_replace(lower(translate(coalesce(_nome, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
    '\([^)]*\)', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;
REVOKE ALL ON FUNCTION public.rep_nome_norm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_nome_norm(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acertos_relatorio(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.kit_ve_rede() THEN
    RAISE EXCEPTION 'Sem permissão para ver os acertos.' USING errcode = '42501';
  END IF;
  IF _de IS NULL OR _ate IS NULL OR _ate < _de THEN RAISE EXCEPTION 'Período inválido.'; END IF;
  IF _ate - _de > 92 THEN RAISE EXCEPTION 'Escolha um período de até 3 meses.'; END IF;

  WITH reps AS (   -- cadastros de representante do Lardan (papel representante, não desligado)
    SELECT p.id, p.display_name, public.rep_nome_norm(p.display_name) AS nn
      FROM parties p
     WHERE p.status <> 'desligado'
       AND EXISTS (SELECT 1 FROM party_roles pr WHERE pr.party_id = p.id AND pr.role = 'representante')
  ), rep_smalldata AS (   -- 0357: SmallData → cadastro de representante; nunca um cadastro sem papel de representante
    SELECT lrep.codigo,
           coalesce(lig.id, nom.id) AS rep_id,
           coalesce(lig.display_name, nom.display_name, lrep.nome) AS rep_nome
      FROM legado_representantes lrep
      LEFT JOIN reps lig ON lig.id = lrep.party_id
      LEFT JOIN LATERAL (SELECT r.id, r.display_name FROM reps r WHERE r.nn = public.rep_nome_norm(lrep.nome)
                          AND (SELECT count(*) FROM reps r2 WHERE r2.nn = r.nn) = 1) nom ON lig.id IS NULL
  ), lardan AS (
    SELECT 'lardan'::text AS fonte, k.code AS maleta, r.numero AS remessa, public.kit_data_acerto(c) AS acerto,
           c.consultora_party_id AS party_id, p.display_name AS consultora, p.code AS codigo,
           coalesce(pc.nome, 'Sem praça') AS praca,
           CASE WHEN coalesce(r.direta, false) THEN 'Maleta direta' ELSE coalesce(rp.display_name, 'Sem representante') END AS representante,
           c.quantity_total AS pecas, c.reference_total_cents AS valor_cents,
           CASE WHEN pb.id IS NULL THEN 'sem_pre_baixa' ELSE public.pre_baixa_situacao(pb) END AS situacao,
           (SELECT regexp_replace(cp.value, '\D', '', 'g') FROM contact_points cp WHERE cp.party_id = c.consultora_party_id
             AND cp.kind::text IN ('whatsapp', 'telefone') ORDER BY (cp.kind::text = 'whatsapp') DESC, cp.is_primary DESC LIMIT 1) AS telefone,
           (SELECT a.city || coalesce('/' || a.uf, '') FROM party_addresses a WHERE a.party_id = c.consultora_party_id ORDER BY a.is_primary DESC, a.created_at LIMIT 1) AS cidade,
           coalesce(r.direta, false) AS direta,
           r.praca_id::text AS praca_id,
           CASE WHEN coalesce(r.direta, false) THEN NULL ELSE rp.id::text END AS rep_id
      FROM kit_cycles c
      JOIN kits k ON k.id = c.kit_id
      JOIN parties p ON p.id = c.consultora_party_id
      LEFT JOIN remessas r ON r.id = c.remessa_id
      LEFT JOIN cob_pracas pc ON pc.id = r.praca_id
      LEFT JOIN parties rp ON rp.id = coalesce(r.representante_party_id, c.representante_party_id)
      LEFT JOIN kit_pre_baixas pb ON pb.cycle_id = c.id
     WHERE c.status IN ('expedida', 'transito', 'recebida', 'operacao', 'acerto')
       AND public.kit_data_acerto(c) BETWEEN _de AND _ate
       AND public.kit_cycle_in_scope(c.id)
  ), smalldata AS (
    SELECT 'smalldata'::text AS fonte, 'Kit ' || m.kit AS maleta, m.remessa AS remessa, lr.vencimento AS acerto,
           lc.party_id, coalesce(p.display_name, lc.nome) AS consultora, coalesce(p.code, m.codcli::text) AS codigo,
           coalesce(pc.nome, lp.nome, 'Praça ' || lr.praca) AS praca,
           coalesce(rv.rep_nome, 'Representante ' || lr.representante) AS representante,
           m.pecas_enviadas AS pecas, m.valor_enviado_cents AS valor_cents, 'smalldata'::text AS situacao,
           coalesce(nullif(regexp_replace(coalesce(lc.celular, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(lc.telefone, ''), '\D', '', 'g'), '')) AS telefone,
           nullif(concat_ws('/', nullif(lc.cidade, ''), nullif(lc.uf, '')), '') AS cidade,
           false AS direta,
           coalesce(pc.id::text, 'leg:' || lr.praca) AS praca_id,
           coalesce(rv.rep_id::text, 'leg:' || lr.representante) AS rep_id
      FROM legado_maletas m
      JOIN legado_remessas lr ON lr.numero = m.remessa
      LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
      LEFT JOIN parties p ON p.id = lc.party_id
      LEFT JOIN legado_pracas lp ON lp.codigo = lr.praca
      LEFT JOIN cob_pracas pc ON pc.id = lp.praca_id
      LEFT JOIN rep_smalldata rv ON rv.codigo = lr.representante
     WHERE m.tipo = 'remessa' AND m.fechamento IS NULL AND m.fechamento_smalldata IS NULL
       AND lr.vencimento BETWEEN _de AND _ate
       AND public.legado_maleta_na_rua(m.remessa, m.codcli)
       AND public.colab_legacy_rep_ok(lr.representante)
       AND NOT EXISTS (SELECT 1 FROM kit_cycles c2 JOIN remessas r2 ON r2.id = c2.remessa_id
                        WHERE r2.numero = m.remessa AND c2.consultora_party_id = lc.party_id AND c2.status <> 'cancelada')
  )
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.praca, x.representante, x.acerto, x.consultora), '[]'::jsonb) INTO res
    FROM (SELECT * FROM lardan UNION ALL SELECT * FROM smalldata) x;
  RETURN jsonb_build_object('de', _de, 'ate', _ate, 'gerado_em', now(), 'linhas', res);
END $function$;
REVOKE ALL ON FUNCTION public.acertos_relatorio(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acertos_relatorio(date, date) TO authenticated, service_role;