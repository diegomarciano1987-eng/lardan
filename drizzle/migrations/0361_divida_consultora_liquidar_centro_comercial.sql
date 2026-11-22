-- 1) Centro de custo Comercial automático nos recebimentos de consultora (3.1.1, FIADO-HIST, FIADO-PERDA)
CREATE OR REPLACE FUNCTION public.fin_titulo_centro_comercial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.direction::text = 'receivable' AND NEW.cost_center_id IS NULL AND NEW.chart_account_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.chart_of_accounts ca WHERE ca.id = NEW.chart_account_id AND ca.codigo IN ('3.1.1','FIADO-HIST','FIADO-PERDA')) THEN
    SELECT id INTO NEW.cost_center_id FROM public.cost_centers WHERE codigo = 'comercial' LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fin_titulo_centro_comercial() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_fin_titulo_centro_comercial ON public.financial_titles;
CREATE TRIGGER zz_fin_titulo_centro_comercial
  BEFORE INSERT OR UPDATE OF chart_account_id, cost_center_id ON public.financial_titles
  FOR EACH ROW EXECUTE FUNCTION public.fin_titulo_centro_comercial();

-- backfill (somente títulos ativos fora de mês fechado)
UPDATE public.financial_titles t
   SET cost_center_id = (SELECT id FROM public.cost_centers WHERE codigo = 'comercial' LIMIT 1)
 WHERE t.direction::text = 'receivable' AND t.status::text <> 'cancelado' AND t.cost_center_id IS NULL
   AND EXISTS (SELECT 1 FROM public.cost_centers WHERE codigo = 'comercial')
   AND EXISTS (SELECT 1 FROM public.chart_of_accounts ca WHERE ca.id = t.chart_account_id AND ca.codigo IN ('3.1.1','FIADO-HIST','FIADO-PERDA'))
   AND NOT public.fin_periodo_fechado(coalesce(t.competencia, t.emissao), t.business_entity_id);

-- 2) Parcela com devido zerado (abatimento integral, sem pagamento) conta como liquidada
CREATE OR REPLACE FUNCTION public.fin_installment_refresh(_installment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_valor bigint; v_ajuste bigint; v_aloc bigint; v_devido bigint; v_st fin_settlement_status;
begin
  select valor_cents into v_valor from financial_installments where id = _installment;
  if v_valor is null then return; end if;
  select coalesce(sum(case when kind in ('juros','multa') then valor_cents
                           when kind in ('desconto','abatimento') then -valor_cents
                           else 0 end),0)
    into v_ajuste from financial_adjustments where installment_id = _installment;
  select coalesce(sum(valor_cents),0) into v_aloc from financial_allocations where installment_id = _installment;
  v_devido := v_valor + v_ajuste;
  v_st := case when v_devido <= 0 and v_aloc <= 0 then 'liquidado'
               when v_aloc <= 0 then 'nao_liquidado'
               when v_aloc < v_devido then 'parcial'
               when v_aloc = v_devido then 'liquidado'
               else 'excedente' end;
  update financial_installments set settlement_status = v_st, updated_at = now() where id = _installment;
end $$;

-- 3) Liquidar dívida (título inteiro ou uma parcela), com motivo e registro
CREATE OR REPLACE FUNCTION public.fin_divida_liquidar(_title uuid, _installment uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t record; v_motivo text := btrim(coalesce(_motivo, '')); v_pago bigint; v_alvos uuid[]; v_todas uuid[];
  v_total bigint := 0; v_modo text; r record; v_saldo bigint; v_cobrancas jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Sem permissão para liquidar dívida.' USING errcode = '42501';
  END IF;
  IF length(v_motivo) < 5 THEN RAISE EXCEPTION 'Escreva o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO t FROM public.financial_titles WHERE id = _title FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Título não encontrado.'; END IF;
  IF t.direction::text <> 'receivable' THEN RAISE EXCEPTION 'Só dívidas a receber podem ser liquidadas aqui.'; END IF;
  IF _installment IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.financial_installments WHERE id = _installment AND title_id = _title) THEN
    RAISE EXCEPTION 'Parcela não pertence a este título.';
  END IF;

  SELECT array_agg(i.id ORDER BY i.numero) INTO v_todas FROM public.financial_installments i WHERE i.title_id = _title;
  v_alvos := CASE WHEN _installment IS NULL THEN v_todas ELSE ARRAY[_installment] END;

  -- parcela dentro de acordo de cobrança: cancela-se pelo acordo
  IF EXISTS (SELECT 1 FROM public.asaas_charge_intents x
              WHERE x.acordo_simulacao_id IS NOT NULL AND x.installment_id = ANY (v_alvos)
                AND x.state IN ('criada','conciliacao')) THEN
    RAISE EXCEPTION 'Esta dívida está em um acordo de cobrança. Cancele pelo acordo na Central de Cobranças.';
  END IF;

  IF t.status::text = 'cancelado' THEN
    v_modo := 'ja_liquidada';
  ELSE
    SELECT coalesce(sum(a.valor_cents), 0) INTO v_pago
      FROM public.financial_allocations a JOIN public.financial_installments i ON i.id = a.installment_id
     WHERE i.title_id = _title;
    SELECT coalesce(sum(greatest(s.saldo_cents, 0)), 0) INTO v_total
      FROM public.fin_installment_saldos s WHERE s.installment_id = ANY (v_alvos);

    IF v_total <= 0 THEN
      v_modo := 'ja_liquidada';
    ELSIF v_pago = 0 AND (_installment IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.fin_installment_saldos s WHERE s.installment_id = ANY (v_todas)
               AND s.installment_id <> _installment AND s.saldo_cents > 0)) THEN
      -- nada pago no título: cancela o título inteiro
      UPDATE public.financial_titles SET status = 'cancelado', cancel_reason = 'Dívida liquidada: ' || v_motivo, updated_at = now()
       WHERE id = _title;
      v_modo := 'cancelado';
    ELSE
      FOR r IN SELECT s.installment_id, s.saldo_cents FROM public.fin_installment_saldos s
                WHERE s.installment_id = ANY (v_alvos) AND s.saldo_cents > 0 LOOP
        INSERT INTO public.financial_adjustments (installment_id, kind, valor_cents, motivo, approved_by, created_by)
        VALUES (r.installment_id, 'abatimento', r.saldo_cents, left('Dívida liquidada: ' || v_motivo, 500), auth.uid(), auth.uid());
        PERFORM public.fin_installment_refresh(r.installment_id);
      END LOOP;
      v_modo := 'abatido';
    END IF;

    IF v_modo IN ('cancelado','abatido') THEN
      INSERT INTO public.financial_title_events (title_id, evento, motivo, payload, actor_id)
      VALUES (_title, 'divida_liquidada', v_motivo,
              jsonb_build_object('modo', v_modo, 'valor_cents', v_total, 'parcela', _installment, 'parcelas', to_jsonb(v_alvos)), auth.uid());
      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
      VALUES (auth.uid(), 'fin.divida.liquidar', 'financial_titles', _title::text,
              jsonb_build_object('numero', t.numero, 'party_id', t.party_id, 'modo', v_modo, 'valor_cents', v_total,
                                 'parcela', _installment, 'motivo', v_motivo));
    END IF;
  END IF;

  -- cobranças ainda abertas no Asaas destas parcelas (o servidor cancela na hora; a varredura de 1 min é a rede de segurança)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'external_id', c.external_id, 'valor_cents', c.value_cents)), '[]'::jsonb)
    INTO v_cobrancas
    FROM public.asaas_charges c
   WHERE c.installment_id = ANY (v_alvos) AND c.external_status IN ('PENDING','OVERDUE')
     AND NOT EXISTS (SELECT 1 FROM public.asaas_charge_intents x WHERE x.acordo_simulacao_id IS NOT NULL
                      AND (x.charge_id = c.id OR (x.account_id = c.account_id AND x.external_id = c.external_id)));

  RETURN jsonb_build_object('modo', v_modo, 'valor_cents', v_total, 'numero', t.numero, 'cobrancas', v_cobrancas);
END $$;
REVOKE ALL ON FUNCTION public.fin_divida_liquidar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_divida_liquidar(uuid, uuid, text) TO authenticated, service_role;