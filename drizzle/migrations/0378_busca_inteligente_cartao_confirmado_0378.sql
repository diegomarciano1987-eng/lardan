CREATE OR REPLACE FUNCTION public.busca_norm(_t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $f$
  SELECT btrim(regexp_replace(lower(translate(coalesce(_t,''),
    'áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ',
    'aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY')), '\s+', ' ', 'g'))
$f$;
COMMENT ON FUNCTION public.busca_norm(text) IS '0378: texto para busca — sem acento, minúsculo, espaços únicos.';

CREATE OR REPLACE FUNCTION public.busca_casa(_alvo text, _termo text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $f$
  SELECT CASE WHEN public.busca_norm(_termo) = '' THEN true
              WHEN _alvo IS NULL THEN false
              ELSE NOT EXISTS (SELECT 1 FROM unnest(string_to_array(public.busca_norm(_termo), ' ')) w
                                WHERE w <> '' AND position(w IN public.busca_norm(_alvo)) = 0) END
$f$;
COMMENT ON FUNCTION public.busca_casa(text,text) IS '0378: busca inteligente — ignora acento e maiúsculas, todas as palavras do termo em qualquer ordem.';
GRANT EXECUTE ON FUNCTION public.busca_norm(text), public.busca_casa(text,text) TO authenticated, service_role;

-- Reescreve "X ILIKE '%'||termo||'%'" por public.busca_casa(X, termo) nas buscas de pessoas/financeiro (corpo atual preservado, só a comparação muda).
DO $do$
DECLARE r record; novo text;
BEGIN
  FOR r IN SELECT p.oid, p.proname, pg_get_functiondef(p.oid) d FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname = ANY (ARRAY['list_parties','fin_mesa_contrapartes','asaas_mesa_candidatas','asaas_mesa_pendentes',
                'asaas_receber_parcelas','fin_installments_list','fin_pagar_receber','fin_titles_list','partners_list',
                'search_registry','fin_cheques_lista','consultoras_acessos'])
  LOOP
    novo := regexp_replace(r.d,
      '((?:coalesce\([^()]*(?:\([^()]*\))?[^()]*\))|[A-Za-z_][A-Za-z0-9_.]*(?:::text)?)\s+ilike\s+''%''\s*\|\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|\|\s*''%''',
      'public.busca_casa(\1, \2)', 'gi');
    IF novo <> r.d THEN EXECUTE novo; END IF;
  END LOOP;
END $do$;

-- Cartão confirmado/antecipado: baixa automática pelo motor oficial (idempotente pela mesma chave asaas:baixa).
DO $do$
DECLARE d text; marca text := E'      b := public.asaas_baixa_automatica(c.id);\n    END IF;\n';
BEGIN
  d := pg_get_functiondef('public.asaas_evento_processar(uuid)'::regprocedure);
  IF position('0378' IN d) > 0 THEN RETURN; END IF;
  IF position(marca IN d) = 0 THEN RAISE EXCEPTION 'asaas_evento_processar: ponto de inserção não encontrado'; END IF;
  d := overlay(d PLACING marca || E'\n    -- 0378: cartão confirmado/antecipado = cliente já pagou; baixa no mesmo motor oficial (idempotente).\n'
    || E'    IF b IS NULL AND c.billing_type = ''CREDIT_CARD''\n'
    || E'       AND tipo.event IN (''PAYMENT_CONFIRMED'',''PAYMENT_ANTICIPATED'') THEN\n'
    || E'      UPDATE public.asaas_charges SET\n'
    || E'        payment_date = coalesce(payment_date, nullif(p->>''confirmedDate'','''')::date, nullif(p->>''paymentDate'','''')::date, (e.event_at AT TIME ZONE ''America/Sao_Paulo'')::date),\n'
    || E'        received_cents = coalesce(received_cents, value_cents)\n'
    || E'      WHERE id = c.id AND external_status IN (''CONFIRMED'',''RECEIVED'',''PENDING'');\n'
    || E'      b := public.asaas_baixa_automatica(c.id);\n'
    || E'    END IF;\n'
    FROM position(marca IN d) FOR length(marca));
  EXECUTE d;
END $do$;