-- 0297 — pente fino Asaas x Lardan (Diego, 12/11/2026)
-- 1) Espelho: cobrança excluída no Asaas (deleted=true) passa a constar como DELETED.
-- 2) Alerta na hora quando cobrança ligada a parcela em aberto é excluída ou muda valor/vencimento no Asaas.
-- 3) Parcela fantasma (todas as cobranças excluídas no Asaas) cancelada só por ação humana, com motivo e desfazer.
-- 4) Mesa: lançamento cancelado não trava mais a mesma linha do extrato.
-- 5) Comparação por pessoa: em aberto no Asaas x em aberto no Lardan.

CREATE OR REPLACE FUNCTION public.asaas_espelho_upsert(_account_id uuid, _rows jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r jsonb; v_ins int := 0; v_upd int := 0; v_party uuid; v_old record;
        v_val bigint; v_net bigint; v_rec bigint; v_fee bigint; v_recebido boolean; v_st text;
begin
  perform set_config('lardann.asaas_link','on', true);
  for r in select * from jsonb_array_elements(_rows) loop
    -- 0297: o Asaas devolve a cobrança excluída com deleted=true e a situação antiga
    v_st := case when coalesce((r->>'deleted')::boolean, false) then 'DELETED' else r->>'status' end;
    v_val := round((r->>'value')::numeric*100);
    v_net := round(nullif(r->>'netValue','')::numeric*100);
    v_recebido := v_st in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH');
    v_rec := case when v_recebido then v_val else null end;
    v_fee := case when v_recebido and v_net is not null then v_val - v_net else null end;
    select party_id into v_party from asaas_customers where account_id=_account_id and external_id = r->>'customer';
    select * into v_old from asaas_charges where account_id=_account_id and external_id = r->>'id';
    if v_old.id is null then
      insert into asaas_charges(account_id, external_id, customer_external_id, party_id, value_cents, net_value_cents, received_cents, fee_cents,
        due_date, payment_date, credit_date, confirmed_date, billing_type, external_status, invoice_url, installment_external_id, installment_number, raw, reconcile_status)
      values (_account_id, r->>'id', r->>'customer', v_party, v_val, v_net, v_rec, v_fee,
        (r->>'dueDate')::date, nullif(r->>'paymentDate','')::date, nullif(r->>'creditDate','')::date, nullif(r->>'confirmedDate','')::date,
        r->>'billingType', v_st, r->>'invoiceUrl', r->>'installment', nullif(r->>'installmentNumber','')::int, r, 'pendente');
      v_ins := v_ins + 1;
    else
      update asaas_charges set value_cents = v_val, net_value_cents = v_net, received_cents = v_rec, fee_cents = v_fee,
        due_date=(r->>'dueDate')::date, payment_date=nullif(r->>'paymentDate','')::date, credit_date=nullif(r->>'creditDate','')::date,
        confirmed_date=nullif(r->>'confirmedDate','')::date, external_status=v_st, invoice_url=r->>'invoiceUrl', raw=r,
        party_id = coalesce(party_id, v_party)
      where id = v_old.id and (external_status is distinct from v_st or value_cents <> v_val
        or due_date is distinct from (r->>'dueDate')::date or payment_date is distinct from nullif(r->>'paymentDate','')::date
        or received_cents is distinct from v_rec or fee_cents is distinct from v_fee);
      if found then v_upd := v_upd + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('inseridas', v_ins, 'atualizadas', v_upd);
end $function$;

-- Alertas de divergência Asaas x Lardan
CREATE TABLE public.asaas_divergencia_alertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.asaas_charges(id),
  installment_id uuid REFERENCES public.financial_installments(id),
  title_id uuid REFERENCES public.financial_titles(id),
  party_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('cobranca_excluida','valor_alterado','vencimento_alterado')),
  antes jsonb NOT NULL DEFAULT '{}'::jsonb,
  depois jsonb NOT NULL DEFAULT '{}'::jsonb,
  saldo_cents bigint,
  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  resolvido_por uuid,
  resolucao text
);
GRANT SELECT ON public.asaas_divergencia_alertas TO authenticated;
GRANT ALL ON public.asaas_divergencia_alertas TO service_role;
ALTER TABLE public.asaas_divergencia_alertas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Financeiro vê alertas Asaas" ON public.asaas_divergencia_alertas FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'finance.receivable.view'));
CREATE UNIQUE INDEX asaas_divergencia_alertas_aberto ON public.asaas_divergencia_alertas (charge_id, tipo) WHERE resolvido_em IS NULL;
CREATE INDEX asaas_divergencia_alertas_inst ON public.asaas_divergencia_alertas (installment_id) WHERE resolvido_em IS NULL;

-- Parcelas fantasmas canceladas (com desfazer)
CREATE TABLE public.asaas_fantasmas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES public.financial_installments(id),
  title_id uuid NOT NULL REFERENCES public.financial_titles(id),
  party_id uuid,
  charge_ids uuid[] NOT NULL,
  valor_cents bigint NOT NULL,
  saldo_cents bigint NOT NULL,
  motivo text NOT NULL,
  actor_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz,
  desfeito_por uuid,
  desfeito_motivo text
);
GRANT SELECT ON public.asaas_fantasmas TO authenticated;
GRANT ALL ON public.asaas_fantasmas TO service_role;
ALTER TABLE public.asaas_fantasmas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Financeiro vê parcelas fantasmas" ON public.asaas_fantasmas FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'finance.receivable.view'));
CREATE UNIQUE INDEX asaas_fantasmas_ativo ON public.asaas_fantasmas (installment_id) WHERE desfeito_em IS NULL;

-- Detecta na hora (aviso do Asaas ou busca da manhã) a mudança que deixa a parcela do Lardan diferente
CREATE OR REPLACE FUNCTION public.asaas_divergencia_detectar()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_title uuid; v_party uuid; v_st text; v_saldo bigint; v_vivas int;
BEGIN
  IF OLD.external_status = 'DELETED' AND NEW.external_status IS DISTINCT FROM 'DELETED' THEN
    UPDATE public.asaas_divergencia_alertas SET resolvido_em = now(), resolucao = 'Cobrança restaurada no Asaas'
     WHERE charge_id = NEW.id AND tipo = 'cobranca_excluida' AND resolvido_em IS NULL;
  END IF;
  IF NEW.installment_id IS NULL THEN RETURN NEW; END IF;
  SELECT t.id, t.party_id, t.status::text INTO v_title, v_party, v_st
    FROM public.financial_installments i JOIN public.financial_titles t ON t.id = i.title_id
   WHERE i.id = NEW.installment_id AND t.direction = 'receivable';
  IF v_title IS NULL OR v_st <> 'ativo' THEN RETURN NEW; END IF;
  v_saldo := public.fin_installment_saldo(NEW.installment_id);
  IF coalesce(v_saldo, 0) <= 0 THEN RETURN NEW; END IF;
  IF NEW.external_status = 'DELETED' AND OLD.external_status IS DISTINCT FROM 'DELETED' THEN
    SELECT count(*) INTO v_vivas FROM public.asaas_charges
     WHERE installment_id = NEW.installment_id AND id <> NEW.id AND external_status <> 'DELETED';
    IF v_vivas = 0 THEN
      INSERT INTO public.asaas_divergencia_alertas (charge_id, installment_id, title_id, party_id, tipo, antes, depois, saldo_cents)
      VALUES (NEW.id, NEW.installment_id, v_title, v_party, 'cobranca_excluida',
              jsonb_build_object('status', OLD.external_status, 'valor_cents', OLD.value_cents, 'vencimento', OLD.due_date),
              jsonb_build_object('status', 'DELETED'), v_saldo)
      ON CONFLICT (charge_id, tipo) WHERE resolvido_em IS NULL DO NOTHING;
    END IF;
  ELSIF NEW.external_status IN ('PENDING','OVERDUE') AND NEW.value_cents IS DISTINCT FROM OLD.value_cents THEN
    INSERT INTO public.asaas_divergencia_alertas (charge_id, installment_id, title_id, party_id, tipo, antes, depois, saldo_cents)
    VALUES (NEW.id, NEW.installment_id, v_title, v_party, 'valor_alterado',
            jsonb_build_object('valor_cents', OLD.value_cents), jsonb_build_object('valor_cents', NEW.value_cents), v_saldo)
    ON CONFLICT (charge_id, tipo) WHERE resolvido_em IS NULL DO UPDATE SET depois = EXCLUDED.depois, saldo_cents = EXCLUDED.saldo_cents;
  ELSIF NEW.external_status IN ('PENDING','OVERDUE') AND NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO public.asaas_divergencia_alertas (charge_id, installment_id, title_id, party_id, tipo, antes, depois, saldo_cents)
    VALUES (NEW.id, NEW.installment_id, v_title, v_party, 'vencimento_alterado',
            jsonb_build_object('vencimento', OLD.due_date), jsonb_build_object('vencimento', NEW.due_date), v_saldo)
    ON CONFLICT (charge_id, tipo) WHERE resolvido_em IS NULL DO UPDATE SET depois = EXCLUDED.depois, saldo_cents = EXCLUDED.saldo_cents;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.asaas_divergencia_detectar() FROM public, anon, authenticated;

CREATE TRIGGER asaas_divergencia_detectar AFTER UPDATE OF external_status, value_cents, due_date ON public.asaas_charges
  FOR EACH ROW
  WHEN (OLD.external_status IS DISTINCT FROM NEW.external_status OR OLD.value_cents IS DISTINCT FROM NEW.value_cents OR OLD.due_date IS DISTINCT FROM NEW.due_date)
  EXECUTE FUNCTION public.asaas_divergencia_detectar();

-- Alertas para o que já está fantasma hoje (uma por parcela)
INSERT INTO public.asaas_divergencia_alertas (charge_id, installment_id, title_id, party_id, tipo, antes, depois, saldo_cents)
SELECT DISTINCT ON (i.id) c.id, i.id, t.id, t.party_id, 'cobranca_excluida',
       jsonb_build_object('valor_cents', c.value_cents, 'vencimento', c.due_date, 'detectado', 'pente_fino_0297'),
       jsonb_build_object('status', 'DELETED'), public.fin_installment_saldo(i.id)
  FROM public.asaas_charges c
  JOIN public.financial_installments i ON i.id = c.installment_id
  JOIN public.financial_titles t ON t.id = i.title_id
 WHERE c.external_status = 'DELETED' AND t.direction = 'receivable' AND t.status = 'ativo'
   AND NOT EXISTS (SELECT 1 FROM public.asaas_charges z WHERE z.installment_id = i.id AND z.external_status <> 'DELETED')
   AND public.fin_installment_saldo(i.id) > 0
 ORDER BY i.id, c.due_date DESC;

CREATE OR REPLACE FUNCTION public.asaas_fantasma_cancelar(_inst uuid, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE i financial_installments%rowtype; t financial_titles%rowtype; v_n int; v_aloc bigint; v_cobs uuid[]; v_id uuid; v_saldo bigint; v_dup boolean;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão para cancelar contas a receber.'; END IF;
  IF length(coalesce(trim(_motivo), '')) < 5 THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  SELECT * INTO i FROM public.financial_installments WHERE id = _inst;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada.'; END IF;
  SELECT * INTO t FROM public.financial_titles WHERE id = i.title_id FOR UPDATE;
  IF t.direction <> 'receivable' OR t.status <> 'ativo' THEN RAISE EXCEPTION 'Só parcela a receber de título ativo.'; END IF;
  SELECT array_agg(id ORDER BY due_date) INTO v_cobs FROM public.asaas_charges WHERE installment_id = _inst;
  IF v_cobs IS NULL THEN RAISE EXCEPTION 'Esta parcela não tem cobrança no Asaas.'; END IF;
  IF EXISTS (SELECT 1 FROM public.asaas_charges WHERE installment_id = _inst AND external_status <> 'DELETED') THEN
    RAISE EXCEPTION 'A parcela ainda tem cobrança viva no Asaas: não é fantasma.';
  END IF;
  SELECT count(*) INTO v_n FROM public.financial_installments WHERE title_id = t.id;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Título com % parcelas: resolva pela tela do título.', v_n; END IF;
  SELECT coalesce(sum(a.valor_cents), 0) INTO v_aloc FROM public.financial_allocations a WHERE a.installment_id = _inst;
  IF v_aloc <> 0 THEN RAISE EXCEPTION 'A parcela já tem pagamento registrado: resolva pela tela do título.'; END IF;
  -- mesma fatura renegociada e já ligada a outra parcela do Lardan = dívida em dobro
  v_dup := EXISTS (SELECT 1 FROM public.asaas_charges d JOIN public.asaas_charges z
                     ON z.account_id = d.account_id AND z.raw->>'externalReference' = d.raw->>'externalReference'
                    WHERE d.installment_id = _inst AND coalesce(d.raw->>'externalReference', '') <> ''
                      AND z.installment_id IS NOT NULL AND z.installment_id <> _inst AND z.external_status <> 'DELETED');
  IF NOT v_dup AND EXISTS (SELECT 1 FROM public.cob_judicial_processos j WHERE j.party_id = t.party_id) THEN
    RAISE EXCEPTION 'Cliente com processo judicial: decisão manual (a cobrança pode ter saído do Asaas por causa do processo).';
  END IF;
  v_saldo := public.fin_installment_saldo(_inst);
  UPDATE public.financial_titles SET status = 'cancelado', cancel_reason = left('Cobrança excluída no Asaas: ' || trim(_motivo), 500)
   WHERE id = t.id;
  INSERT INTO public.asaas_fantasmas (installment_id, title_id, party_id, charge_ids, valor_cents, saldo_cents, motivo, actor_id)
  VALUES (_inst, t.id, t.party_id, v_cobs, i.valor_cents, v_saldo, trim(_motivo), auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.financial_title_events (title_id, evento, motivo, payload, actor_id)
  VALUES (t.id, 'cancelado', trim(_motivo), jsonb_build_object('origem', 'asaas_parcela_fantasma', 'fantasma_id', v_id,
          'cobrancas', (SELECT jsonb_agg(external_id) FROM public.asaas_charges WHERE id = ANY(v_cobs)), 'saldo_cents', v_saldo,
          'renegociada_em_outra_parcela', v_dup), auth.uid());
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'financeiro.asaas_fantasma_cancelada', 'financial_titles', t.id::text,
          jsonb_build_object('fantasma_id', v_id, 'installment_id', _inst, 'saldo_cents', v_saldo, 'motivo', trim(_motivo), 'antes', to_jsonb(t)));
  UPDATE public.asaas_divergencia_alertas SET resolvido_em = now(), resolvido_por = auth.uid(),
         resolucao = 'Parcela cancelada no Lardan (cobrança excluída no Asaas)'
   WHERE installment_id = _inst AND resolvido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'fantasma_id', v_id, 'title_id', t.id, 'numero', t.numero, 'saldo_cents', v_saldo, 'renegociada', v_dup);
END $function$;

CREATE OR REPLACE FUNCTION public.asaas_fantasma_desfazer(_id uuid, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE f asaas_fantasmas%rowtype; t financial_titles%rowtype;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão para reativar contas a receber.'; END IF;
  IF length(coalesce(trim(_motivo), '')) < 5 THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  SELECT * INTO f FROM public.asaas_fantasmas WHERE id = _id FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;
  IF f.desfeito_em IS NOT NULL THEN RAISE EXCEPTION 'Já foi desfeito.'; END IF;
  SELECT * INTO t FROM public.financial_titles WHERE id = f.title_id FOR UPDATE;
  IF t.status <> 'cancelado' THEN RAISE EXCEPTION 'O título não está mais cancelado.'; END IF;
  UPDATE public.financial_titles SET status = 'ativo', cancel_reason = NULL WHERE id = t.id;
  UPDATE public.asaas_fantasmas SET desfeito_em = now(), desfeito_por = auth.uid(), desfeito_motivo = trim(_motivo) WHERE id = f.id;
  INSERT INTO public.financial_title_events (title_id, evento, motivo, payload, actor_id)
  VALUES (t.id, 'reativado', trim(_motivo), jsonb_build_object('origem', 'asaas_parcela_fantasma_desfeita', 'fantasma_id', f.id), auth.uid());
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'financeiro.asaas_fantasma_desfeita', 'financial_titles', t.id::text,
          jsonb_build_object('fantasma_id', f.id, 'motivo', trim(_motivo)));
  RETURN jsonb_build_object('ok', true, 'title_id', t.id, 'numero', t.numero);
END $function$;

CREATE OR REPLACE FUNCTION public.asaas_alerta_resolver(_id uuid, _resolucao text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_capability(auth.uid(), 'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF length(coalesce(trim(_resolucao), '')) < 5 THEN RAISE EXCEPTION 'Informe o que foi feito.'; END IF;
  UPDATE public.asaas_divergencia_alertas SET resolvido_em = now(), resolvido_por = auth.uid(), resolucao = trim(_resolucao)
   WHERE id = _id AND resolvido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alerta não encontrado ou já resolvido.'; END IF;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'financeiro.asaas_alerta_resolvido', 'asaas_divergencia_alertas', _id::text, jsonb_build_object('resolucao', trim(_resolucao)));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Comparação por pessoa (só quem tem cobrança no Asaas): em aberto no Asaas x em aberto no Lardan
CREATE OR REPLACE FUNCTION public.asaas_pente_fino(_limite integer DEFAULT 300)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR public.has_capability(auth.uid(), 'finance.receivable.view')) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  WITH pes AS (SELECT DISTINCT party_id FROM public.asaas_charges WHERE party_id IS NOT NULL),
  inst AS (
    SELECT t.party_id, i.id, public.fin_installment_saldo(i.id) saldo,
           EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.installment_id = i.id AND c.external_status IN ('PENDING','OVERDUE','DUNNING_REQUESTED')) cob_aberta,
           (EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.installment_id = i.id)
            AND NOT EXISTS (SELECT 1 FROM public.asaas_charges c WHERE c.installment_id = i.id AND c.external_status <> 'DELETED')) so_excluidas
      FROM public.financial_installments i JOIN public.financial_titles t ON t.id = i.title_id JOIN pes ON pes.party_id = t.party_id
     WHERE t.direction = 'receivable' AND t.status = 'ativo' AND i.settlement_status IN ('nao_liquidado','parcial')),
  l AS (SELECT party_id, sum(saldo) aberto, coalesce(sum(saldo) FILTER (WHERE NOT cob_aberta), 0) sem_cob,
               coalesce(sum(saldo) FILTER (WHERE so_excluidas), 0) fantasma
          FROM inst WHERE saldo > 0 GROUP BY 1),
  a AS (SELECT party_id, sum(value_cents) aberto, coalesce(sum(value_cents) FILTER (WHERE installment_id IS NULL), 0) sem_parcela
          FROM public.asaas_charges WHERE external_status IN ('PENDING','OVERDUE','DUNNING_REQUESTED') AND party_id IS NOT NULL GROUP BY 1),
  j AS (SELECT p.id party_id, p.code codigo, p.display_name nome, coalesce(l.aberto, 0) lardan_cents, coalesce(a.aberto, 0) asaas_cents,
               coalesce(a.sem_parcela, 0) asaas_sem_parcela_cents, coalesce(l.sem_cob, 0) lardan_sem_cobranca_cents, coalesce(l.fantasma, 0) fantasma_cents
          FROM pes JOIN public.parties p ON p.id = pes.party_id LEFT JOIN l ON l.party_id = pes.party_id LEFT JOIN a ON a.party_id = pes.party_id
         WHERE coalesce(l.aberto, 0) > 0 OR coalesce(a.aberto, 0) > 0),
  k AS (SELECT j.*, CASE WHEN lardan_cents = asaas_cents AND asaas_sem_parcela_cents = 0 AND fantasma_cents = 0 THEN 'igual'
                         WHEN lardan_cents = 0 THEN 'so_asaas' WHEN asaas_cents = 0 THEN 'so_lardan'
                         WHEN lardan_cents > asaas_cents THEN 'lardan_maior' WHEN asaas_cents > lardan_cents THEN 'asaas_maior'
                         ELSE 'mesmo_total' END categoria FROM j)
  SELECT jsonb_build_object(
    'gerado_em', now(),
    'resumo', coalesce((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'pessoas', n, 'lardan_cents', sl, 'asaas_cents', sa) ORDER BY categoria)
                         FROM (SELECT categoria, count(*) n, sum(lardan_cents) sl, sum(asaas_cents) sa FROM k GROUP BY categoria) s), '[]'::jsonb),
    'pessoas', coalesce((SELECT jsonb_agg(to_jsonb(x) - 'party_id' ORDER BY abs(x.lardan_cents - x.asaas_cents) DESC, x.nome)
                          FROM (SELECT * FROM k WHERE categoria <> 'igual' ORDER BY abs(lardan_cents - asaas_cents) DESC, nome LIMIT greatest(coalesce(_limite, 300), 1)) x), '[]'::jsonb),
    'alertas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', al.id, 'tipo', al.tipo, 'criado_em', al.criado_em, 'antes', al.antes, 'depois', al.depois,
                           'saldo_cents', al.saldo_cents, 'installment_id', al.installment_id, 'pay', c.external_id, 'titulo_numero', t.numero,
                           'pessoa', p.display_name, 'pessoa_codigo', p.code,
                           'judicial', EXISTS (SELECT 1 FROM public.cob_judicial_processos jp WHERE jp.party_id = al.party_id)) ORDER BY al.saldo_cents DESC NULLS LAST)
                          FROM public.asaas_divergencia_alertas al JOIN public.asaas_charges c ON c.id = al.charge_id
                          LEFT JOIN public.financial_titles t ON t.id = al.title_id LEFT JOIN public.parties p ON p.id = al.party_id
                         WHERE al.resolvido_em IS NULL), '[]'::jsonb),
    'fantasmas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'criado_em', f.criado_em, 'saldo_cents', f.saldo_cents, 'motivo', f.motivo,
                             'desfeito_em', f.desfeito_em, 'desfeito_motivo', f.desfeito_motivo, 'titulo_numero', t.numero,
                             'pessoa', p.display_name, 'pessoa_codigo', p.code) ORDER BY f.criado_em DESC)
                           FROM (SELECT * FROM public.asaas_fantasmas ORDER BY criado_em DESC LIMIT 300) f
                           JOIN public.financial_titles t ON t.id = f.title_id LEFT JOIN public.parties p ON p.id = f.party_id), '[]'::jsonb)
  ) INTO v FROM (SELECT 1) z;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.asaas_fantasma_cancelar(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.asaas_fantasma_desfazer(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.asaas_alerta_resolver(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.asaas_pente_fino(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asaas_fantasma_cancelar(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asaas_fantasma_desfazer(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asaas_alerta_resolver(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asaas_pente_fino(integer) TO authenticated, service_role;

-- Mesa: lançamento cancelado (desfeito) com baixas zeradas não trava a mesma linha do extrato
DO $mig$
DECLARE d text; novo text;
BEGIN
  d := pg_get_functiondef('public.fin_mesa_novo_conciliar'::regproc);
  novo := replace(d,
    $a$  if exists (select 1 from financial_titles where sistema_origem = 'extrato' and id_externo = v_ext) then$a$,
    $b$  -- 0297: título desta linha já cancelado e com baixas zeradas libera a chave (fica guardado com sufixo)
  update financial_titles t set id_externo = v_ext || ':cancelado:' || t.id
   where t.sistema_origem = 'extrato' and t.id_externo = v_ext and t.status = 'cancelado'
     and coalesce((select sum(a.valor_cents) from financial_allocations a join financial_installments fi on fi.id = a.installment_id
                    where fi.title_id = t.id), 0) = 0;
  if exists (select 1 from financial_titles where sistema_origem = 'extrato' and id_externo = v_ext) then$b$);
  IF novo = d THEN RAISE EXCEPTION 'fin_mesa_novo_conciliar: ponto de troca não encontrado'; END IF;
  EXECUTE novo;
END $mig$;