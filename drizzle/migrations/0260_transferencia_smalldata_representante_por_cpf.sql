-- Pacote 0259-2: somente prévia; preservar ligações de representantes.
CREATE OR REPLACE FUNCTION public.legado_transferencia_previa(_legado int, _actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE prev text; cfg legado_transferencia_remessas; rem remessas; rep_party uuid; rep_nome text; rep_cpf text; rep_ok boolean; problemas text[] := '{}';
        res jsonb; maletas jsonb; pend jsonb; faltas jsonb; existentes jsonb; tot jsonb;
BEGIN
  prev := public.legado_transferencia_ator(_actor);
  SELECT * INTO cfg FROM legado_transferencia_remessas WHERE legado_remessa = _legado;
  IF cfg.legado_remessa IS NULL THEN RAISE EXCEPTION 'Remessa % do SmallData não está preparada para transferência.', _legado; END IF;
  SELECT * INTO rem FROM remessas WHERE numero = cfg.remessa_destino;
  -- CPF do SmallData é a prova; party_id não é alterado.
  SELECT lr.party_id, lr.nome, nullif(regexp_replace(coalesce(lr.cpf, ''), '\D', '', 'g'), '') INTO rep_party, rep_nome, rep_cpf
    FROM legado_representantes lr WHERE lr.codigo = cfg.representante;
  rep_ok := rem.representante_party_id IS NOT NULL AND (
              (rep_cpf IS NOT NULL AND EXISTS (SELECT 1 FROM parties pa WHERE pa.id = rem.representante_party_id AND pa.doc_digits = rep_cpf))
              OR (rep_cpf IS NULL AND rem.representante_party_id = rep_party));
  IF rem.id IS NULL THEN problemas := problemas || format('A remessa %s ainda não existe no Lardan Cloud: crie a remessa antes.', cfg.remessa_destino);
  ELSE
    IF rem.status IN ('fechada', 'cancelada') THEN problemas := problemas || format('A remessa %s está %s.', rem.numero, rem.status); END IF;
    IF rem.representante_party_id IS NULL THEN problemas := problemas || format('A remessa %s não tem representante.', rem.numero);
    ELSIF NOT rep_ok THEN
      problemas := problemas || format('A remessa %s é de %s, mas no SmallData estas maletas são do representante %s (%s)%s.', rem.numero,
        (SELECT display_name FROM parties WHERE id = rem.representante_party_id), cfg.representante, coalesce(rep_nome, 'sem nome'),
        CASE WHEN rep_cpf IS NULL THEN ', sem CPF no SmallData' ELSE ', CPF diferente' END);
    END IF;
    IF rem.origin_location_id IS NULL THEN problemas := problemas || format('A remessa %s não tem depósito de saída.', rem.numero); END IF;
  END IF;
  DROP TABLE IF EXISTS _ltr_res;
  CREATE TEMP TABLE _ltr_res ON COMMIT DROP AS SELECT * FROM public.legado_transferencia_resolver(_legado, false);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kit', m.kit, 'pecas_smalldata', m.pecas_legado, 'valor_smalldata_cents', m.valor_legado_cents,
           'pecas', (SELECT coalesce(sum(r.quantidade), 0) FROM _ltr_res r WHERE r.kit = m.kit AND r.codcli = m.codcli),
           'valor_cloud_cents', (SELECT coalesce(sum(r.quantidade * r.preco_cents), 0) FROM _ltr_res r WHERE r.kit = m.kit AND r.codcli = m.codcli),
           'situacao', m.situacao, 'cycle_id', m.cycle_id,
           'maleta', (SELECT k.label FROM kit_cycles c JOIN kits k ON k.id = c.kit_id WHERE c.id = m.cycle_id)) ORDER BY m.kit), '[]')
    INTO maletas FROM legado_transferencia_maletas m WHERE m.legado_remessa = _legado;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kit', r.kit, 'produto', r.produto, 'tamanho', r.tamanho, 'nome', r.nome,
           'codigo', r.codigo, 'quantidade', r.quantidade, 'situacao', r.situacao) ORDER BY r.kit, r.produto), '[]')
    INTO pend FROM _ltr_res r WHERE r.situacao <> 'ok';
  IF rem.origin_location_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'nome'), '[]') INTO faltas FROM (
      SELECT jsonb_build_object('variant_id', r.variant_id, 'nome', min(r.nome), 'codigo', min(r.codigo), 'precisa', sum(r.quantidade),
               'disponivel', public.stock_available(r.variant_id, rem.origin_location_id)) x
        FROM _ltr_res r JOIN legado_transferencia_maletas m ON m.legado_remessa = _legado AND m.codcli = r.codcli AND m.kit = r.kit AND m.cycle_id IS NULL
       WHERE r.variant_id IS NOT NULL
       GROUP BY r.variant_id
      HAVING public.stock_available(r.variant_id, rem.origin_location_id) < sum(r.quantidade)
      UNION ALL
      SELECT jsonb_build_object('variant_id', NULL, 'nome', r.nome, 'codigo', r.codigo, 'precisa', r.quantidade, 'disponivel', 0)
        FROM _ltr_res r JOIN legado_transferencia_maletas m ON m.legado_remessa = _legado AND m.codcli = r.codcli AND m.kit = r.kit AND m.cycle_id IS NULL
       WHERE r.situacao = 'aro_a_criar') s;
  ELSE faltas := '[]'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('maleta', k.label, 'status', c.status, 'consultora', pa.display_name,
           'trazida_do_smalldata', EXISTS (SELECT 1 FROM legado_transferencia_maletas m WHERE m.cycle_id = c.id)) ORDER BY c.created_at), '[]')
    INTO existentes FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN parties pa ON pa.id = c.consultora_party_id
   WHERE c.remessa_id = rem.id AND c.status <> 'cancelada';
  SELECT jsonb_build_object('maletas', count(DISTINCT (codcli, kit)), 'linhas', count(*), 'pecas', coalesce(sum(quantidade), 0),
           'valor_cloud_cents', coalesce(sum(quantidade * preco_cents), 0),
           'sem_cadastro', count(*) FILTER (WHERE situacao = 'sem_cadastro'), 'aro_a_criar', count(*) FILTER (WHERE situacao = 'aro_a_criar'))
    INTO tot FROM _ltr_res;
  res := jsonb_build_object(
    'smalldata', jsonb_build_object('remessa', cfg.legado_remessa, 'representante', cfg.representante, 'representante_nome', rep_nome,
      'praca', cfg.praca, 'emissao', cfg.emissao, 'vencimento', cfg.vencimento,
      'valor_cents', (SELECT sum(valor_legado_cents) FROM legado_transferencia_maletas WHERE legado_remessa = _legado)),
    'destino', jsonb_build_object('remessa', cfg.remessa_destino, 'existe', rem.id IS NOT NULL, 'status', rem.status,
      'representante', (SELECT display_name FROM parties WHERE id = rem.representante_party_id),
      'praca', (SELECT nome FROM cob_pracas WHERE id = rem.praca_id), 'data_acerto', rem.data_acerto,
      'maletas_ja_na_remessa', existentes),
    'totais', tot, 'maletas', maletas, 'pecas_pendentes', pend, 'falta_no_deposito', faltas,
    'ja_feitas', (SELECT count(*) FROM legado_transferencia_maletas WHERE legado_remessa = _legado AND cycle_id IS NOT NULL),
    'problemas', to_jsonb(problemas),
    'pode_aplicar', cardinality(problemas) = 0 AND (tot ->> 'sem_cadastro')::int = 0);
  PERFORM set_config('request.jwt.claims', prev, true);
  RETURN res;
END $f$;