-- 0316 — auditoria 13/11/2026 (Claude): nota fiscal em dobro por recusa "em processamento/duplicidade" e espelho de vencimentos.
--
-- 1) NOTA RECUSADA QUE PODE TER SIDO AUTORIZADA. As recusas da SEFAZ 204 e 539 (duplicidade de NF-e) e 635 ("NF-e com mesmo
--    número e série já transmitida e aguardando processamento") NÃO são recusa de verdade: a nota original pode ter sido (ou
--    vir a ser) autorizada. A 0313 reabria a fila nesses casos e a maleta ganhava OUTRA nota com número novo. Em produção:
--    as refs de 12/11 com 635 viraram as notas 197, 213 e 214 em 13/11, e os números 179, 180 e 181 sumiram da sequência.
--    Agora essas recusas contam como "nota possivelmente viva": nada reemite (nem a fila, nem o botão) até alguém conferir
--    na Focus/SEFAZ e marcar o resultado (fiscal_recusa_conferir). "Não foi autorizada" libera a fila; "foi autorizada" segura.
-- 2) Raio-x: F10 = recusa incerta sem conferência; F11 = número de nota pulado na série (conferir ou inutilizar).
-- 3) Espelho Asaas: cobranças abertas com vencimento diferente do Lardan de antes da 0303 viram pedido de espelho
--    (a rotina de 1 minuto leva o vencimento do Lardan para o Asaas). Só vencimentos futuros, uma cobrança por parcela, fora de acordo.

-- 1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_recusas_conferidas (
  ref text PRIMARY KEY,
  resultado text NOT NULL CHECK (resultado IN ('nao_autorizada', 'autorizada')),
  numero_autorizado text,
  observacao text,
  conferido_por uuid NOT NULL,
  conferido_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fiscal_recusas_conferidas ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.fiscal_recusas_conferidas TO service_role;
COMMENT ON TABLE public.fiscal_recusas_conferidas IS '0316: conferência humana das recusas SEFAZ 204/539/635 (nota que pode ter sido autorizada).';

CREATE OR REPLACE FUNCTION public.fiscal_recusa_incerta(_status text, _status_sefaz text, _mensagem text, _ref text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(_status, '') IN ('erro_autorizacao', 'erro_envio')
     AND (coalesce(_status_sefaz, '') IN ('204', '539', '635')
          OR coalesce(_mensagem, '') ~* '(duplicidade de nf|aguardando processamento|mesmo n[uú]mero e s[eé]rie j[aá] transmitida)')
     AND NOT EXISTS (SELECT 1 FROM public.fiscal_recusas_conferidas r WHERE r.ref = _ref AND r.resultado = 'nao_autorizada')
$$;
REVOKE ALL ON FUNCTION public.fiscal_recusa_incerta(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_recusa_incerta(text, text, text, text) TO authenticated, service_role;

-- "nota viva" passa a incluir a recusa incerta, em todos os lugares que decidem se pode emitir outra
DO $do$
DECLARE f text; def text; antes text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fiscal_focus_maleta_dados(uuid)', 'public.fiscal_focus_envio_maleta_registrar(text,text,uuid,uuid,integer,jsonb,uuid,uuid[])',
                           'public.fiscal_focus_acerto_dados(uuid)', 'public.fiscal_focus_envio_acerto_registrar']
  LOOP
    IF f = 'public.fiscal_focus_envio_acerto_registrar' THEN
      SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'fiscal_focus_envio_acerto_registrar';
    ELSE
      def := pg_get_functiondef(f::regprocedure);
    END IF;
    IF def IS NULL THEN RAISE EXCEPTION '0316: função % não encontrada.', f; END IF;
    IF position('fiscal_recusa_incerta' IN def) > 0 THEN CONTINUE; END IF;
    antes := def;
    def := replace(def, $a$ status IN ('pendente', 'processando_autorizacao', 'autorizado')$a$,
                        $b$ (status IN ('pendente', 'processando_autorizacao', 'autorizado') OR public.fiscal_recusa_incerta(status, status_sefaz, mensagem_sefaz, ref))$b$);
    IF def = antes THEN RAISE EXCEPTION '0316: guarda de nota viva não encontrada em %; revisar.', f; END IF;
    EXECUTE def;
  END LOOP;
END $do$;

-- a fila: recusa incerta não reabre; fica em erro pedindo conferência
CREATE OR REPLACE FUNCTION public.fiscal_recusa_reabre_fila_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_etapa text;
BEGIN
  IF NEW.ambiente <> 'producao' OR NEW.cycle_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('erro_autorizacao', 'erro_envio') OR OLD.status NOT IN ('pendente', 'processando_autorizacao') THEN RETURN NEW; END IF;
  v_etapa := CASE WHEN NEW.operacao = 'remessa' THEN 'remessa'
                  WHEN NEW.operacao IN ('devolucao', 'venda', 'perda') THEN 'acerto' END;
  IF v_etapa IS NULL THEN RETURN NEW; END IF;
  IF public.fiscal_recusa_incerta(NEW.status, NEW.status_sefaz, NEW.mensagem_sefaz, NEW.ref) THEN
    UPDATE fiscal_fila SET status = 'erro',
           erro = left('CONFERIR NA FOCUS antes de emitir outra: a SEFAZ respondeu ' || coalesce(NEW.status_sefaz, '') || ' ('
                       || coalesce(NEW.mensagem_sefaz, '') || '). A nota ' || NEW.ref || ' pode ter sido autorizada.', 500),
           atualizado_em = now()
     WHERE cycle_id = NEW.cycle_id AND etapa = v_etapa AND status IN ('feito', 'pendente');
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'fiscal.recusa_incerta', 'fiscal_focus_envios', NEW.ref,
            jsonb_build_object('cycle_id', NEW.cycle_id, 'etapa', v_etapa, 'status_sefaz', NEW.status_sefaz, 'mensagem', NEW.mensagem_sefaz));
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_focus_envios o WHERE o.cycle_id = NEW.cycle_id AND o.ambiente = NEW.ambiente
              AND o.operacao = NEW.operacao AND o.ref <> NEW.ref
              AND (o.status IN ('pendente', 'processando_autorizacao', 'autorizado')
                   OR public.fiscal_recusa_incerta(o.status, o.status_sefaz, o.mensagem_sefaz, o.ref))) THEN
    RETURN NEW;
  END IF;
  UPDATE fiscal_fila SET
    status = CASE WHEN tentativas >= 5 THEN 'erro' ELSE 'pendente' END,
    erro = left('SEFAZ recusou depois do envio: ' || coalesce(NEW.mensagem_sefaz, NEW.status), 500),
    proxima_em = now() + interval '2 minutes', atualizado_em = now()
  WHERE cycle_id = NEW.cycle_id AND etapa = v_etapa AND status = 'feito';
  IF FOUND THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'fiscal.fila_reaberta_recusa', 'fiscal_focus_envios', NEW.ref,
            jsonb_build_object('cycle_id', NEW.cycle_id, 'etapa', v_etapa, 'status', NEW.status, 'status_sefaz', NEW.status_sefaz));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_recusa_reabre_fila_trg() FROM PUBLIC, anon, authenticated;

-- conferência humana (Master / quem emite nota)
CREATE OR REPLACE FUNCTION public.fiscal_recusa_conferir(_ref text, _resultado text, _numero text DEFAULT NULL, _observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e fiscal_focus_envios; v_etapa text; v_reaberta int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fiscal_focus_pode('emitir') THEN RAISE EXCEPTION 'Só quem emite nota.' USING errcode = '42501'; END IF;
  IF _resultado NOT IN ('nao_autorizada', 'autorizada') THEN RAISE EXCEPTION 'Resultado inválido.'; END IF;
  SELECT * INTO e FROM fiscal_focus_envios WHERE ref = _ref;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Nota não encontrada.'; END IF;
  IF NOT (coalesce(e.status, '') IN ('erro_autorizacao', 'erro_envio')
          AND (coalesce(e.status_sefaz, '') IN ('204', '539', '635') OR coalesce(e.mensagem_sefaz, '') ~* '(duplicidade de nf|aguardando processamento|mesmo n[uú]mero e s[eé]rie j[aá] transmitida)')) THEN
    RAISE EXCEPTION 'Esta nota não está entre as recusas que pedem conferência.';
  END IF;
  IF _resultado = 'autorizada' AND coalesce(btrim(_numero), '') = '' THEN RAISE EXCEPTION 'Informe o número da nota que a SEFAZ autorizou.'; END IF;
  IF length(btrim(coalesce(_observacao, ''))) < 10 THEN RAISE EXCEPTION 'Escreva como conferiu (mínimo 10 letras).'; END IF;
  INSERT INTO fiscal_recusas_conferidas (ref, resultado, numero_autorizado, observacao, conferido_por)
  VALUES (_ref, _resultado, nullif(btrim(_numero), ''), btrim(_observacao), auth.uid())
  ON CONFLICT (ref) DO UPDATE SET resultado = EXCLUDED.resultado, numero_autorizado = EXCLUDED.numero_autorizado,
         observacao = EXCLUDED.observacao, conferido_por = EXCLUDED.conferido_por, conferido_em = now();
  IF _resultado = 'nao_autorizada' AND e.cycle_id IS NOT NULL AND e.ambiente = 'producao' THEN
    v_etapa := CASE WHEN e.operacao = 'remessa' THEN 'remessa' WHEN e.operacao IN ('devolucao', 'venda', 'perda') THEN 'acerto' END;
    UPDATE fiscal_fila SET status = 'pendente', tentativas = 0, proxima_em = now(), atualizado_em = now(),
           erro = left('Conferido: a nota ' || _ref || ' não foi autorizada; pode emitir.', 500)
     WHERE cycle_id = e.cycle_id AND etapa = v_etapa AND status = 'erro' AND erro LIKE 'CONFERIR NA FOCUS%';
    GET DIAGNOSTICS v_reaberta = ROW_COUNT;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'fiscal.recusa_conferida', 'fiscal_focus_envios', _ref,
          jsonb_build_object('resultado', _resultado, 'numero', _numero, 'observacao', btrim(_observacao), 'fila_reaberta', v_reaberta));
  RETURN jsonb_build_object('ok', true, 'resultado', _resultado, 'fila_reaberta', v_reaberta > 0);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_recusa_conferir(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_recusa_conferir(text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fiscal_recusas_conferidas_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.fiscal_focus_pode('ver') OR public.fiscal_focus_pode('emitir')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_object_agg(r.ref, jsonb_build_object('resultado', r.resultado, 'numero', r.numero_autorizado,
                     'observacao', r.observacao, 'quando', r.conferido_em))
                     FROM fiscal_recusas_conferidas r), '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_recusas_conferidas_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_recusas_conferidas_lista() TO authenticated;

-- 2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.auditoria_integridade()'::regprocedure); antes := def;
  IF position('''F10''' IN def) > 0 THEN RETURN; END IF;
  def := replace(def, $a$ ('financeiro','F9',$a$,
    $b$ ('fiscal','F10','alta','Nota recusada como "em processamento/duplicada" sem conferência na Focus (pode existir nota autorizada)',$q$SELECT e.ref||' · SEFAZ '||coalesce(e.status_sefaz,'')||' · '||to_char(e.created_at,'DD/MM HH24:MI') AS ref FROM fiscal_focus_envios e WHERE e.ambiente='producao' AND public.fiscal_recusa_incerta(e.status,e.status_sefaz,e.mensagem_sefaz,e.ref) AND NOT EXISTS (SELECT 1 FROM fiscal_recusas_conferidas r WHERE r.ref=e.ref) ORDER BY e.created_at DESC$q$),
 ('fiscal','F11','media','Número de nota pulado na série (conferir na SEFAZ e inutilizar se não existir)',$q$SELECT 'série '||s.serie||' nº '||g.n AS ref FROM (SELECT serie, min(numero::bigint) mn, max(numero::bigint) mx FROM fiscal_focus_envios WHERE ambiente='producao' AND numero ~ '^[0-9]+$' GROUP BY serie) s CROSS JOIN LATERAL generate_series(s.mn, s.mx) g(n) WHERE NOT EXISTS (SELECT 1 FROM fiscal_focus_envios x WHERE x.ambiente='producao' AND x.serie IS NOT DISTINCT FROM s.serie AND x.numero = g.n::text) ORDER BY s.serie, g.n$q$),
 ('financeiro','F9',$b$);
  IF def = antes THEN RAISE EXCEPTION '0316: ponto F9 não encontrado na auditoria; revisar.'; END IF;
  EXECUTE def;
END $do$;

-- 3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
alvo AS (
  SELECT i.id AS installment_id, i.vencimento, i.valor_cents
    FROM public.asaas_charges c
    JOIN public.financial_installments i ON i.id = c.installment_id
    JOIN public.financial_titles t ON t.id = i.title_id
    CROSS JOIN hoje
    CROSS JOIN LATERAL (SELECT greatest(coalesce(public.fin_installment_saldo(i.id), 0), 0) AS saldo) d
   WHERE c.external_status IN ('PENDING', 'OVERDUE') AND t.direction = 'receivable' AND t.status = 'ativo'
     AND i.vencimento >= hoje.d AND d.saldo >= 500 AND c.due_date <> i.vencimento
     AND NOT EXISTS (SELECT 1 FROM public.asaas_baixas_outra_forma b WHERE b.charge_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.asaas_charge_intents x WHERE x.acordo_simulacao_id IS NOT NULL
                      AND (x.charge_id = c.id OR (x.account_id = c.account_id AND x.external_id = c.external_id)))
     AND (SELECT count(*) FROM public.asaas_charges c2 WHERE c2.installment_id = i.id AND c2.external_status IN ('PENDING', 'OVERDUE')) = 1
     AND NOT EXISTS (SELECT 1 FROM public.asaas_espelho_pedidos pe WHERE pe.installment_id = i.id AND pe.atendido_em IS NULL))
INSERT INTO public.asaas_espelho_pedidos (installment_id, origem, motivo, depois)
SELECT installment_id, 'manual', 'Auditoria 0316: vencimento do Lardan diferente do Asaas desde antes do espelho automático',
       jsonb_build_object('vencimento', vencimento, 'valor_cents', valor_cents)
  FROM alvo;