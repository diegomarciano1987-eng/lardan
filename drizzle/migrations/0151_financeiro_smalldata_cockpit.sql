-- 0149 — financeiro do SmallData no cockpit da consultora. Não apaga nada, não remove coluna e pode rodar duas vezes.
CREATE OR REPLACE FUNCTION public.legado_centavos(_v text) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(round(nullif(btrim(replace(coalesce(_v, ''), ',', '.')), '')::numeric * 100), 0)::bigint
$$;

CREATE TABLE IF NOT EXISTS public.legado_cobrancas (
  chave text PRIMARY KEY,
  codcli integer NOT NULL,
  praca integer,
  vendedor integer,
  tipo smallint,
  data date,
  remessa integer,
  valor_remessa_cents bigint NOT NULL DEFAULT 0,
  venda_bruta_cents bigint NOT NULL DEFAULT 0,
  venda_liquida_cents bigint NOT NULL DEFAULT 0,
  venda_pago_cents bigint NOT NULL DEFAULT 0,
  venda_fiado_cents bigint NOT NULL DEFAULT 0,
  fiado_anterior_cents bigint NOT NULL DEFAULT 0,
  fiado_pago_cents bigint NOT NULL DEFAULT 0,
  fiado_pendente_cents bigint NOT NULL DEFAULT 0,
  juros_cents bigint NOT NULL DEFAULT 0,
  multa_cents bigint NOT NULL DEFAULT 0,
  cheque_devolvido_cents bigint NOT NULL DEFAULT 0,
  total_pago_cents bigint NOT NULL DEFAULT 0,
  desconto_cents bigint NOT NULL DEFAULT 0,
  dinheiro_cents bigint NOT NULL DEFAULT 0,
  cheque_cents bigint NOT NULL DEFAULT 0,
  cartao_cents bigint NOT NULL DEFAULT 0,
  deposito_cents bigint NOT NULL DEFAULT 0,
  boleto_cents bigint NOT NULL DEFAULT 0,
  credito_cartao_cents bigint NOT NULL DEFAULT 0,
  fiado_novo_cents bigint NOT NULL DEFAULT 0,
  encerramento integer,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legado_cobrancas_codcli ON public.legado_cobrancas (codcli, data);

CREATE TABLE IF NOT EXISTS public.legado_fiados (
  id integer PRIMARY KEY,
  chave_cob text,
  codcli integer NOT NULL,
  data_cob date,
  parcela integer,
  vencimento date,
  forma text,
  status text,                    -- A = em aberto, F = quitado
  data_status date,
  valor_cents bigint NOT NULL DEFAULT 0,
  juros_cents bigint NOT NULL DEFAULT 0,
  multa_cents bigint NOT NULL DEFAULT 0,
  desconto_cents bigint NOT NULL DEFAULT 0,
  data_pgto date,
  chave_baixa text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legado_fiados_codcli ON public.legado_fiados (codcli, status);
CREATE INDEX IF NOT EXISTS legado_fiados_casamento ON public.legado_fiados (vencimento, valor_cents);

CREATE TABLE IF NOT EXISTS public.legado_pagamentos (
  origem text NOT NULL CHECK (origem IN ('boleto', 'deposito', 'cartao', 'cheque')),
  id integer NOT NULL,
  chave_cob text,
  codcli integer NOT NULL,
  data date,
  vencimento date,
  data_pgto date,
  data_devolucao date,
  valor_cents bigint NOT NULL DEFAULT 0,
  valor_pago_cents bigint NOT NULL DEFAULT 0,
  taxa_cents bigint NOT NULL DEFAULT 0,
  parcela integer,
  parcelas integer,
  situacao text,
  detalhe text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origem, id)
);
CREATE INDEX IF NOT EXISTS legado_pagamentos_codcli ON public.legado_pagamentos (codcli, data);

-- fiado do SmallData ↔ linha da planilha / título do Lardan
CREATE TABLE IF NOT EXISTS public.legado_fiado_vinculo (
  fiado_id integer PRIMARY KEY REFERENCES public.legado_fiados(id),
  linha_id uuid NOT NULL UNIQUE REFERENCES public.cob_fiado_linhas(id),
  party_id uuid REFERENCES public.parties(id),
  title_id uuid,
  como text NOT NULL CHECK (como IN ('linha_importada', 'pendente_resolvida')),
  lote text NOT NULL,
  ator uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.legado_fiado_vinculo ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legado_cobrancas','legado_fiados','legado_pagamentos','legado_fiado_vinculo'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ───────────────────────── importação pela tela do histórico ─────────────────────────
DO $imp$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.legado_importar(text,text,jsonb)'::regprocedure);
  IF position('''cobrancas''' IN def) > 0 THEN RETURN; END IF;
  novo := regexp_replace(def, '(\n\s*CASE _tipo\s*\n)', E'\\1' || $q$  WHEN 'cobrancas' THEN
    INSERT INTO legado_cobrancas AS t (chave, codcli, praca, vendedor, tipo, data, remessa, valor_remessa_cents, venda_bruta_cents,
      venda_liquida_cents, venda_pago_cents, venda_fiado_cents, fiado_anterior_cents, fiado_pago_cents, fiado_pendente_cents, juros_cents,
      multa_cents, cheque_devolvido_cents, total_pago_cents, desconto_cents, dinheiro_cents, cheque_cents, cartao_cents, deposito_cents,
      boleto_cents, credito_cartao_cents, fiado_novo_cents, encerramento)
    SELECT btrim(x.chave), x.codcli::int, nullif(x.praca,'')::int, nullif(x.vendedor,'')::int, nullif(x.tipo,'')::smallint,
           nullif(x.data,'')::date, nullif(nullif(x.remessa,''),'0')::int,
           legado_centavos(x.valor_remessa), legado_centavos(x.venda_bruta), legado_centavos(x.venda_liquida), legado_centavos(x.venda_pago),
           legado_centavos(x.venda_fiado), legado_centavos(x.fiado_anterior), legado_centavos(x.fiado_pago), legado_centavos(x.fiado_pendente),
           legado_centavos(x.juros), legado_centavos(x.multa), legado_centavos(x.cheque_devolvido), legado_centavos(x.total_pago),
           legado_centavos(x.desconto), legado_centavos(x.dinheiro), legado_centavos(x.cheque), legado_centavos(x.cartao),
           legado_centavos(x.deposito), legado_centavos(x.boleto), legado_centavos(x.credito_cartao), legado_centavos(x.fiado_novo),
           nullif(x.encerramento,'')::int
      FROM jsonb_to_recordset(_linhas) x(chave text, codcli text, praca text, vendedor text, tipo text, data text, remessa text,
           valor_remessa text, venda_bruta text, venda_liquida text, venda_pago text, venda_fiado text, fiado_anterior text, fiado_pago text,
           fiado_pendente text, juros text, multa text, cheque_devolvido text, total_pago text, desconto text, dinheiro text, cheque text,
           cartao text, deposito text, boleto text, credito_cartao text, fiado_novo text, encerramento text)
     WHERE nullif(btrim(x.chave),'') IS NOT NULL AND nullif(x.codcli,'') IS NOT NULL
    ON CONFLICT (chave) DO UPDATE SET codcli = excluded.codcli, praca = excluded.praca, vendedor = excluded.vendedor, tipo = excluded.tipo,
      data = excluded.data, remessa = excluded.remessa, valor_remessa_cents = excluded.valor_remessa_cents,
      venda_bruta_cents = excluded.venda_bruta_cents, venda_liquida_cents = excluded.venda_liquida_cents,
      venda_pago_cents = excluded.venda_pago_cents, venda_fiado_cents = excluded.venda_fiado_cents,
      fiado_anterior_cents = excluded.fiado_anterior_cents, fiado_pago_cents = excluded.fiado_pago_cents,
      fiado_pendente_cents = excluded.fiado_pendente_cents, juros_cents = excluded.juros_cents, multa_cents = excluded.multa_cents,
      cheque_devolvido_cents = excluded.cheque_devolvido_cents, total_pago_cents = excluded.total_pago_cents,
      desconto_cents = excluded.desconto_cents, dinheiro_cents = excluded.dinheiro_cents, cheque_cents = excluded.cheque_cents,
      cartao_cents = excluded.cartao_cents, deposito_cents = excluded.deposito_cents, boleto_cents = excluded.boleto_cents,
      credito_cartao_cents = excluded.credito_cartao_cents, fiado_novo_cents = excluded.fiado_novo_cents,
      encerramento = excluded.encerramento, atualizado_em = now();
  WHEN 'fiados' THEN
    INSERT INTO legado_fiados AS t (id, chave_cob, codcli, data_cob, parcela, vencimento, forma, status, data_status, valor_cents,
      juros_cents, multa_cents, desconto_cents, data_pgto, chave_baixa)
    SELECT x.id::int, nullif(btrim(x.chave_cob),''), x.codcli::int, nullif(x.data_cob,'')::date, nullif(x.parcela,'')::int,
           nullif(x.vencimento,'')::date, nullif(btrim(x.forma),''), nullif(upper(btrim(x.status)),''), nullif(x.data_status,'')::date,
           legado_centavos(x.valor), legado_centavos(x.juros), legado_centavos(x.multa), legado_centavos(x.desconto),
           nullif(x.data_pgto,'')::date, nullif(btrim(x.chave_baixa),'')
      FROM jsonb_to_recordset(_linhas) x(id text, chave_cob text, codcli text, data_cob text, parcela text, vencimento text, forma text,
           status text, data_status text, valor text, juros text, multa text, desconto text, data_pgto text, chave_baixa text)
     WHERE nullif(x.id,'') IS NOT NULL AND nullif(x.codcli,'') IS NOT NULL
    ON CONFLICT (id) DO UPDATE SET chave_cob = excluded.chave_cob, codcli = excluded.codcli, data_cob = excluded.data_cob,
      parcela = excluded.parcela, vencimento = excluded.vencimento, forma = excluded.forma, status = excluded.status,
      data_status = excluded.data_status, valor_cents = excluded.valor_cents, juros_cents = excluded.juros_cents,
      multa_cents = excluded.multa_cents, desconto_cents = excluded.desconto_cents, data_pgto = excluded.data_pgto,
      chave_baixa = excluded.chave_baixa, atualizado_em = now();
  WHEN 'pagamentos' THEN
    INSERT INTO legado_pagamentos AS t (origem, id, chave_cob, codcli, data, vencimento, data_pgto, data_devolucao, valor_cents,
      valor_pago_cents, taxa_cents, parcela, parcelas, situacao, detalhe)
    SELECT lower(btrim(x.origem)), x.id::int, nullif(btrim(x.chave_cob),''), x.codcli::int, nullif(x.data,'')::date,
           nullif(x.vencimento,'')::date, nullif(x.data_pgto,'')::date, nullif(x.data_devolucao,'')::date, legado_centavos(x.valor),
           legado_centavos(x.valor_pago), legado_centavos(x.taxa), nullif(x.parcela,'')::int, nullif(x.parcelas,'')::int,
           nullif(btrim(x.situacao),''), nullif(btrim(x.detalhe),'')
      FROM jsonb_to_recordset(_linhas) x(origem text, id text, chave_cob text, codcli text, data text, vencimento text, data_pgto text,
           data_devolucao text, valor text, valor_pago text, taxa text, parcela text, parcelas text, situacao text, detalhe text)
     WHERE nullif(x.id,'') IS NOT NULL AND nullif(x.codcli,'') IS NOT NULL AND lower(btrim(x.origem)) IN ('boleto','deposito','cartao','cheque')
    ON CONFLICT (origem, id) DO UPDATE SET chave_cob = excluded.chave_cob, codcli = excluded.codcli, data = excluded.data,
      vencimento = excluded.vencimento, data_pgto = excluded.data_pgto, data_devolucao = excluded.data_devolucao,
      valor_cents = excluded.valor_cents, valor_pago_cents = excluded.valor_pago_cents, taxa_cents = excluded.taxa_cents,
      parcela = excluded.parcela, parcelas = excluded.parcelas, situacao = excluded.situacao, detalhe = excluded.detalhe,
      atualizado_em = now();
$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não encontrei o ponto de inserção em legado_importar.'; END IF;
  EXECUTE novo;
END $imp$;

-- ───────────────────────── 2. leitura para o cockpit ─────────────────────────
CREATE OR REPLACE FUNCTION public.party_atual(_p uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE c(id, n) AS (
    SELECT _p, 0
    UNION ALL
    SELECT u.canonica_id, c.n + 1 FROM c JOIN party_unificacoes u ON u.duplicada_id = c.id WHERE c.n < 10)
  SELECT id FROM c ORDER BY n DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.party_atual(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.party_e_unificadas(_p uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE c(id, n) AS (
    SELECT _p, 0
    UNION ALL
    SELECT u.duplicada_id, c.n + 1 FROM c JOIN party_unificacoes u ON u.canonica_id = c.id WHERE c.n < 10)
  SELECT array_agg(DISTINCT id) FROM c
$$;
REVOKE ALL ON FUNCTION public.party_e_unificadas(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.legado_codigos_da_pessoa(_party uuid) RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT c), '{}') FROM (
    SELECT codcli c FROM legado_consultoras WHERE party_id = _party
    UNION SELECT codigo::int FROM party_codigos_legados WHERE party_id = _party AND sistema = 'cliente' AND codigo ~ '^[0-9]{1,9}$'
  ) s
$$;
REVOKE ALL ON FUNCTION public.legado_codigos_da_pessoa(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consultora_financeiro_smalldata(_party uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; cods int[];
BEGIN
  IF NOT (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'registry.finance.view')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o financeiro desta pessoa' USING errcode = '42501';
  END IF;
  cods := public.legado_codigos_da_pessoa(_party);
  RETURN jsonb_build_object(
    'codigos', to_jsonb(cods),
    'resumo', (
      SELECT jsonb_build_object(
        'acertos', count(*) FILTER (WHERE c.tipo IN (1, 2)),
        'primeiro_acerto', min(c.data) FILTER (WHERE c.tipo IN (1, 2)),
        'ultimo_acerto', max(c.data) FILTER (WHERE c.tipo IN (1, 2)),
        'venda_bruta_cents', coalesce(sum(c.venda_bruta_cents) FILTER (WHERE c.tipo IN (1, 2)), 0),
        'venda_liquida_cents', coalesce(sum(c.venda_liquida_cents) FILTER (WHERE c.tipo IN (1, 2)), 0),
        'total_pago_cents', coalesce(sum(c.total_pago_cents), 0),
        'dinheiro_cents', coalesce(sum(c.dinheiro_cents), 0),
        'cheque_cents', coalesce(sum(c.cheque_cents), 0),
        'cartao_cents', coalesce(sum(c.cartao_cents + c.credito_cartao_cents), 0),
        'deposito_cents', coalesce(sum(c.deposito_cents), 0),
        'boleto_cents', coalesce(sum(c.boleto_cents), 0),
        'desconto_cents', coalesce(sum(c.desconto_cents), 0))
        || (SELECT jsonb_build_object(
          'fiado_gerado_cents', coalesce(sum(f.valor_cents), 0),
          'fiado_quitado_cents', coalesce(sum(f.valor_cents) FILTER (WHERE f.status = 'F'), 0),
          'fiado_aberto_cents', coalesce(sum(f.valor_cents) FILTER (WHERE f.status = 'A'), 0),
          'fiado_aberto_parcelas', count(*) FILTER (WHERE f.status = 'A'),
          'fiado_vencido_cents', coalesce(sum(f.valor_cents) FILTER (WHERE f.status = 'A' AND f.vencimento < hoje), 0),
          'fiado_aberto_no_lardan_cents', coalesce(sum(f.valor_cents) FILTER (WHERE f.status = 'A' AND v.fiado_id IS NOT NULL), 0),
          'fiado_aberto_sem_lardan_cents', coalesce(sum(f.valor_cents) FILTER (WHERE f.status = 'A' AND v.fiado_id IS NULL), 0))
          FROM legado_fiados f LEFT JOIN legado_fiado_vinculo v ON v.fiado_id = f.id
         WHERE f.codcli = ANY (cods))
      FROM legado_cobrancas c WHERE c.codcli = ANY (cods)),
    'acertos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'chave', c.chave, 'data', c.data, 'tipo', c.tipo,
        'rotulo', CASE c.tipo WHEN 1 THEN 'Acerto da maleta' WHEN 2 THEN 'Acerto da 2ª maleta' WHEN 4 THEN 'Pagamento de fiado'
                              WHEN 5 THEN 'Fiado pago por boleto' WHEN 6 THEN 'Acordo de fiado' ELSE 'Lançamento ' || c.tipo END,
        'remessa', c.remessa, 'venda_bruta_cents', c.venda_bruta_cents, 'venda_liquida_cents', c.venda_liquida_cents,
        'fiado_pago_cents', c.fiado_pago_cents, 'total_pago_cents', c.total_pago_cents, 'dinheiro_cents', c.dinheiro_cents,
        'cheque_cents', c.cheque_cents, 'cartao_cents', c.cartao_cents + c.credito_cartao_cents, 'deposito_cents', c.deposito_cents,
        'boleto_cents', c.boleto_cents, 'desconto_cents', c.desconto_cents, 'fiado_novo_cents', c.fiado_novo_cents,
        'juros_cents', c.juros_cents + c.multa_cents) ORDER BY c.data DESC NULLS LAST, c.chave DESC)
      FROM (SELECT * FROM legado_cobrancas WHERE codcli = ANY (cods) ORDER BY data DESC NULLS LAST LIMIT 500) c), '[]'::jsonb),
    'fiados', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'parcela', f.parcela, 'data_cob', f.data_cob, 'vencimento', f.vencimento, 'forma', f.forma,
        'situacao', CASE WHEN f.status = 'A' THEN 'aberto' ELSE 'quitado' END,
        'atraso', CASE WHEN f.status = 'A' AND f.vencimento < hoje THEN hoje - f.vencimento END,
        'valor_cents', f.valor_cents, 'juros_cents', f.juros_cents + f.multa_cents, 'desconto_cents', f.desconto_cents,
        'data_pgto', f.data_pgto, 'no_lardan', v.fiado_id IS NOT NULL, 'title_id', v.title_id)
        ORDER BY (f.status = 'A') DESC, f.vencimento DESC NULLS LAST, f.id DESC)
      FROM (SELECT * FROM legado_fiados WHERE codcli = ANY (cods) ORDER BY (status = 'A') DESC, vencimento DESC NULLS LAST LIMIT 1000) f
      LEFT JOIN legado_fiado_vinculo v ON v.fiado_id = f.id), '[]'::jsonb),
    'pagamentos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'origem', p.origem, 'data', p.data, 'vencimento', p.vencimento, 'data_pgto', p.data_pgto, 'data_devolucao', p.data_devolucao,
        'valor_cents', p.valor_cents, 'valor_pago_cents', p.valor_pago_cents, 'taxa_cents', p.taxa_cents,
        'parcela', p.parcela, 'parcelas', p.parcelas,
        'situacao', CASE WHEN p.origem = 'boleto' THEN CASE p.situacao WHEN 'P' THEN 'pago' WHEN 'G' THEN 'gerado' WHEN 'C' THEN 'cancelado' ELSE p.situacao END
                         WHEN p.origem = 'cheque' AND p.data_devolucao IS NOT NULL THEN 'devolvido'
                         ELSE p.situacao END,
        'detalhe', p.detalhe) ORDER BY p.data DESC NULLS LAST)
      FROM (SELECT * FROM legado_pagamentos WHERE codcli = ANY (cods) ORDER BY data DESC NULLS LAST LIMIT 1000) p), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.consultora_financeiro_smalldata(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_financeiro_smalldata(uuid) TO authenticated, service_role;

-- ───────────────────────── 3. conciliação do fiado ─────────────────────────
CREATE OR REPLACE FUNCTION public.cob_fiado_smalldata_conciliar(_aplicar boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_lote text; r record; v_title uuid; v_conta uuid; v_ent uuid; v_bol uuid; res jsonb; n_res int := 0;
BEGIN
  IF NOT (uid IS NULL AND coalesce(auth.role(), '') = 'service_role') THEN
    IF uid IS NULL OR NOT (public.has_role(uid, 'master') OR (NOT coalesce(_aplicar, false) AND public.cob_pode(uid))) THEN
      RAISE EXCEPTION 'Só o Master aplica a conciliação do fiado.' USING errcode = '42501';
    END IF;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _cfs (fiado_id int, linha_id uuid, party_id uuid, como text, status text) ON COMMIT DROP;
  TRUNCATE _cfs;
  INSERT INTO _cfs
  SELECT f.id, l.id, public.party_atual(l.party_id), 'linha_importada', f.status
    FROM cob_fiado_linhas l
    JOIN legado_fiados f ON f.vencimento = l.vencimento AND f.valor_cents = l.valor_cents
                         AND coalesce(f.parcela, 0) = coalesce(l.parcela, f.parcela, 0)
                         AND f.codcli = ANY (public.legado_codigos_da_pessoa(public.party_atual(l.party_id)))
   WHERE l.situacao = 'importada' AND l.party_id IS NOT NULL AND l.lote NOT IN ('maleta_perdida')
     AND NOT EXISTS (SELECT 1 FROM legado_fiado_vinculo v WHERE v.fiado_id = f.id OR v.linha_id = l.id);
  INSERT INTO _cfs
  SELECT f.id, l.id, public.party_atual(lc.party_id), 'pendente_resolvida', f.status
    FROM cob_fiado_linhas l
    JOIN legado_fiados f ON f.status = 'A' AND f.vencimento = l.vencimento AND f.valor_cents = l.valor_cents
                         AND coalesce(f.parcela, 0) = coalesce(l.parcela, f.parcela, 0)
                         AND (l.data_cobranca IS NULL OR f.data_cob IS NULL OR f.data_cob = l.data_cobranca)
    JOIN legado_consultoras lc ON lc.codcli = f.codcli AND lc.party_id IS NOT NULL
   WHERE l.situacao = 'pendente' AND l.party_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM legado_fiado_vinculo v WHERE v.fiado_id = f.id OR v.linha_id = l.id);
  DELETE FROM _cfs a WHERE (SELECT count(*) FROM _cfs b WHERE b.fiado_id = a.fiado_id) > 1
                        OR (SELECT count(*) FROM _cfs b WHERE b.linha_id = a.linha_id) > 1;

  res := jsonb_build_object(
    'linhas_importadas_ligadas', (SELECT count(*) FROM _cfs WHERE como = 'linha_importada'),
    'pendentes_resolvidas', (SELECT count(*) FROM _cfs WHERE como = 'pendente_resolvida'),
    'pendentes_resolvidas_cents', (SELECT coalesce(sum(l.valor_cents), 0) FROM _cfs c JOIN cob_fiado_linhas l ON l.id = c.linha_id
                                   WHERE c.como = 'pendente_resolvida'),
    'pendentes_sem_par', (SELECT count(*) FROM cob_fiado_linhas l WHERE l.situacao = 'pendente' AND l.party_id IS NULL
                           AND NOT EXISTS (SELECT 1 FROM _cfs c WHERE c.linha_id = l.id)
                           AND NOT EXISTS (SELECT 1 FROM legado_fiado_vinculo v WHERE v.linha_id = l.id)),
    'pendentes_sem_par_cents', (SELECT coalesce(sum(l.valor_cents), 0) FROM cob_fiado_linhas l WHERE l.situacao = 'pendente' AND l.party_id IS NULL
                           AND NOT EXISTS (SELECT 1 FROM _cfs c WHERE c.linha_id = l.id)
                           AND NOT EXISTS (SELECT 1 FROM legado_fiado_vinculo v WHERE v.linha_id = l.id)),
    'lardan_aberto_quitado_no_smalldata', (SELECT count(*) FROM _cfs c JOIN cob_fiado_linhas l ON l.id = c.linha_id
                           JOIN financial_installments i ON i.title_id = l.title_id
                           WHERE c.status = 'F' AND i.settlement_status IN ('nao_liquidado', 'parcial')),
    'smalldata_aberto_sem_lardan', (SELECT count(*) FROM legado_fiados f WHERE f.status = 'A'
                           AND NOT EXISTS (SELECT 1 FROM _cfs c WHERE c.fiado_id = f.id)
                           AND NOT EXISTS (SELECT 1 FROM legado_fiado_vinculo v WHERE v.fiado_id = f.id)),
    'smalldata_aberto_sem_lardan_cents', (SELECT coalesce(sum(f.valor_cents), 0) FROM legado_fiados f WHERE f.status = 'A'
                           AND NOT EXISTS (SELECT 1 FROM _cfs c WHERE c.fiado_id = f.id)
                           AND NOT EXISTS (SELECT 1 FROM legado_fiado_vinculo v WHERE v.fiado_id = f.id)),
    'smalldata_aberto_total_cents', (SELECT coalesce(sum(valor_cents), 0) FROM legado_fiados WHERE status = 'A'),
    'ja_ligados_antes', (SELECT count(*) FROM legado_fiado_vinculo));

  IF NOT coalesce(_aplicar, false) THEN RETURN res || jsonb_build_object('aplicado', false); END IF;

  v_lote := 'cfs-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 4);
  SELECT id, business_entity_id INTO v_conta, v_ent FROM chart_of_accounts WHERE codigo = 'FIADO-HIST' LIMIT 1;
  IF v_conta IS NULL AND EXISTS (SELECT 1 FROM _cfs WHERE como = 'pendente_resolvida') THEN
    RAISE EXCEPTION 'Conta FIADO-HIST não encontrada (ela nasce na importação da planilha de fiados).';
  END IF;
  SELECT id INTO v_bol FROM payment_methods WHERE codigo = 'boleto_banc_rio';

  FOR r IN SELECT c.*, l.lote, l.linha, l.vencimento, l.valor_cents, l.parcela, l.data_cobranca, l.praca_id, l.representante_party_id
             FROM _cfs c JOIN cob_fiado_linhas l ON l.id = c.linha_id WHERE c.como = 'pendente_resolvida' LOOP
    INSERT INTO financial_titles (direction, business_entity_id, party_id, pagador_party_id, descricao, emissao, competencia, valor_cents,
      chart_account_id, payment_method_id, origem, sistema_origem, id_externo, observacao, status)
    VALUES ('receivable', v_ent, r.party_id, r.party_id, 'Fiado histórico — parcela ' || coalesce(r.parcela, 1), current_date, current_date,
      r.valor_cents, v_conta, v_bol, 'importacao', 'fiado_historico', 'fiado:' || r.lote || ':' || r.linha,
      'Importado da planilha de fiados (linha ' || r.linha || '); pessoa achada pelo fiado ' || r.fiado_id || ' do SmallData; lote ' || v_lote,
      'ativo')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_title;
    IF v_title IS NULL THEN CONTINUE; END IF;
    INSERT INTO financial_installments (title_id, numero, total_parcelas, vencimento, valor_cents) VALUES (v_title, 1, 1, r.vencimento, r.valor_cents);
    INSERT INTO financial_title_events (title_id, evento, payload)
    VALUES (v_title, 'criado', jsonb_build_object('valor_cents', r.valor_cents, 'origem', 'fiado_historico', 'lote', r.lote, 'linha', r.linha,
            'smalldata_fiado', r.fiado_id, 'conciliacao', v_lote));
    UPDATE consultant_profiles SET praca_id = coalesce(praca_id, r.praca_id),
           representative_party_id = coalesce(representative_party_id, r.representante_party_id)
     WHERE party_id = r.party_id;
    INSERT INTO legado_fiado_vinculo (fiado_id, linha_id, party_id, title_id, como, lote, ator)
    VALUES (r.fiado_id, r.linha_id, r.party_id, v_title, 'pendente_resolvida', v_lote, uid);
    n_res := n_res + 1;
  END LOOP;

  INSERT INTO legado_fiado_vinculo (fiado_id, linha_id, party_id, title_id, como, lote, ator)
  SELECT c.fiado_id, c.linha_id, c.party_id, l.title_id, 'linha_importada', v_lote, uid
    FROM _cfs c JOIN cob_fiado_linhas l ON l.id = c.linha_id WHERE c.como = 'linha_importada'
  ON CONFLICT DO NOTHING;

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'cobranca.fiado_smalldata_conciliado', 'cob_fiado_linhas', v_lote, res || jsonb_build_object('titulos_criados', n_res));
  RETURN res || jsonb_build_object('aplicado', true, 'lote', v_lote, 'titulos_criados', n_res);
END $$;
REVOKE ALL ON FUNCTION public.cob_fiado_smalldata_conciliar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_fiado_smalldata_conciliar(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cob_fiado_smalldata_desfazer(_lote text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r record; n_cancel int := 0; n_mantidos int := 0; n_lig int := 0;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'master') THEN
    RAISE EXCEPTION 'Só o Master desfaz a conciliação.' USING errcode = '42501';
  END IF;
  FOR r IN SELECT * FROM legado_fiado_vinculo WHERE lote = _lote AND como = 'pendente_resolvida' LOOP
    IF EXISTS (SELECT 1 FROM financial_allocations a JOIN financial_installments i ON i.id = a.installment_id WHERE i.title_id = r.title_id) THEN
      n_mantidos := n_mantidos + 1; CONTINUE;
    END IF;
    UPDATE financial_titles SET status = 'cancelado', cancel_reason = 'Conciliação SmallData desfeita (' || _lote || ')', updated_at = now()
     WHERE id = r.title_id;
    INSERT INTO financial_title_events (title_id, evento, motivo, actor_id) VALUES (r.title_id, 'cancelado', 'Conciliação SmallData desfeita (' || _lote || ')', uid);
    DELETE FROM legado_fiado_vinculo WHERE fiado_id = r.fiado_id;
    n_cancel := n_cancel + 1;
  END LOOP;
  DELETE FROM legado_fiado_vinculo WHERE lote = _lote AND como = 'linha_importada';
  GET DIAGNOSTICS n_lig = ROW_COUNT;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'cobranca.fiado_smalldata_desfeito', 'cob_fiado_linhas', _lote,
          jsonb_build_object('titulos_cancelados', n_cancel, 'mantidos_com_baixa', n_mantidos, 'ligacoes_removidas', n_lig));
  RETURN jsonb_build_object('lote', _lote, 'titulos_cancelados', n_cancel, 'mantidos_com_baixa', n_mantidos, 'ligacoes_removidas', n_lig);
END $$;
REVOKE ALL ON FUNCTION public.cob_fiado_smalldata_desfazer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_fiado_smalldata_desfazer(text) TO authenticated, service_role;

-- ───────────────────────── 4. aba "Fiado — lastro" do cockpit ─────────────────────────
DO $ck$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.consultora_cockpit_financeiro(uuid)'::regprocedure);
  IF position('legado_fiado_vinculo' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def,
    $a$'situacao_titulo',(select i.settlement_status from financial_installments i where i.title_id=f.title_id limit 1),'title_id',f.title_id,'importado_em',f.created_at) order by f.vencimento) from cob_fiado_linhas f where f.party_id=_party)$a$,
    $b$'situacao_titulo',(select i.settlement_status from financial_installments i where i.title_id=coalesce(f.title_id,fv.title_id) limit 1),'title_id',coalesce(f.title_id,fv.title_id),'importado_em',f.created_at) order by f.vencimento) from cob_fiado_linhas f left join legado_fiado_vinculo fv on fv.linha_id=f.id and fv.como='pendente_resolvida' where f.party_id = any(public.party_e_unificadas(_party)) or fv.party_id=_party)$b$);
  IF novo = def THEN RAISE EXCEPTION 'consultora_cockpit_financeiro não tem o formato esperado (aba fiado).'; END IF;
  EXECUTE novo;
END $ck$;