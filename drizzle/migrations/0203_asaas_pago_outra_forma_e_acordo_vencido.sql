CREATE TABLE public.asaas_baixas_outra_forma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL UNIQUE REFERENCES public.asaas_charges(id),
  installment_id uuid NOT NULL,
  settlement_id uuid,
  financial_account_id uuid NOT NULL,
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  data date NOT NULL,
  forma text NOT NULL CHECK (forma IN ('pix','dinheiro','transferencia','cartao_maquininha','outro')),
  comprovante_path text,
  observacao text,
  actor_id uuid NOT NULL,
  cancel_status text NOT NULL DEFAULT 'pendente' CHECK (cancel_status IN ('pendente','cancelado','falhou')),
  cancel_erro text,
  cancel_tentativas int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.asaas_baixas_outra_forma TO authenticated;
GRANT ALL ON public.asaas_baixas_outra_forma TO service_role;
ALTER TABLE public.asaas_baixas_outra_forma ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financeiro le baixas outra forma" ON public.asaas_baixas_outra_forma FOR SELECT TO authenticated
  USING (public.asaas_ator_pode(auth.uid(), 'finance.receivable.view'));

-- Baixa oficial "pago por outra forma": usa o motor de baixas com a permissão do próprio usuário.
CREATE OR REPLACE FUNCTION public.asaas_pago_outra_forma(_charge uuid, _conta uuid, _data date, _valor bigint, _forma text, _comprovante text, _obs text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; parcela uuid; saldo bigint; r jsonb; v_id uuid; chave text; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.asaas_ator_pode(auth.uid(), 'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem acesso ao financeiro para dar baixa.'; END IF;
  IF _forma NOT IN ('pix','dinheiro','transferencia','cartao_maquininha','outro') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
  IF _data IS NULL OR _data > hoje THEN RAISE EXCEPTION 'Informe a data do pagamento (não pode ser futura).'; END IF;
  IF _valor IS NULL OR _valor <= 0 THEN RAISE EXCEPTION 'Informe o valor recebido.'; END IF;
  IF _comprovante IS NOT NULL AND _comprovante NOT LIKE 'asaas-outra-forma/' || _charge || '/%' THEN RAISE EXCEPTION 'Comprovante inválido.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM financial_accounts WHERE id=_conta AND is_active AND excluida_em IS NULL) THEN RAISE EXCEPTION 'Escolha a conta onde o dinheiro entrou.'; END IF;
  SELECT * INTO c FROM asaas_charges WHERE id=_charge FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM asaas_baixas_outra_forma WHERE charge_id=_charge) THEN RAISE EXCEPTION 'Esta cobrança já foi marcada como paga por outra forma.'; END IF;
  IF c.external_status NOT IN ('PENDING','OVERDUE') THEN RAISE EXCEPTION 'Só cobranças em aberto ou vencidas podem ser marcadas como pagas por outra forma (situação atual: %).', c.external_status; END IF;
  IF EXISTS (SELECT 1 FROM asaas_charge_intents WHERE acordo_simulacao_id IS NOT NULL AND (charge_id=c.id OR (account_id=c.account_id AND external_id=c.external_id))) THEN
    RAISE EXCEPTION 'Cobrança de acordo: registre o pagamento pelo acordo, não por aqui.'; END IF;
  IF EXISTS (SELECT 1 FROM financial_settlements WHERE idempotency_key = 'asaas:baixa:' || c.account_id || ':' || c.external_id) THEN RAISE EXCEPTION 'Esta cobrança já foi baixada pelo Asaas.'; END IF;
  parcela := c.installment_id;
  IF parcela IS NULL THEN
    SELECT m.installment_id INTO parcela FROM asaas_charge_matches m WHERE m.charge_id=c.id AND m.status='confirmado' AND m.installment_id IS NOT NULL ORDER BY m.decidido_em DESC NULLS LAST LIMIT 1;
  END IF;
  IF parcela IS NULL THEN RAISE EXCEPTION 'Cobrança sem parcela vinculada: vincule antes de dar baixa.'; END IF;
  saldo := public.fin_installment_saldo(parcela);
  IF coalesce(saldo,0) <= 0 THEN RAISE EXCEPTION 'A parcela já está quitada.'; END IF;
  IF _valor > saldo THEN RAISE EXCEPTION 'Valor maior que o saldo da parcela (%).', to_char(saldo/100.0,'FM999G990D00'); END IF;
  chave := 'asaas:outra_forma:' || c.account_id || ':' || c.external_id;
  r := public.fin_settlement_create_ajustes(jsonb_build_object(
    'direction','receivable','financial_account_id',_conta,'data',_data::text,'valor_cents',_valor,
    'referencia','Pago por outra forma (' || _forma || ') — Asaas ' || c.external_id,
    'observacao', 'Pago por outra forma; cobrança Asaas cancelada para não cobrar de novo' || coalesce(' — ' || nullif(left(_obs,500),''),''),
    'idempotency_key', chave,
    'alocacoes', jsonb_build_array(jsonb_build_object('installment_id',parcela,'valor_cents',_valor))));
  INSERT INTO asaas_baixas_outra_forma(charge_id,installment_id,settlement_id,financial_account_id,valor_cents,data,forma,comprovante_path,observacao,actor_id)
  VALUES (_charge,parcela,(r->>'id')::uuid,_conta,_valor,_data,_forma,_comprovante,nullif(left(_obs,500),''),auth.uid()) RETURNING id INTO v_id;
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
  SELECT auth.uid(), 'asaas.pago_outra_forma', 'asaas_charges', _charge::text, jsonb_build_object('baixa',v_id,'settlement',r->>'id','valor',_valor,'forma',_forma)
  WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='payload');
  RETURN jsonb_build_object('id',v_id,'settlement_id',r->>'id');
END $$;
REVOKE ALL ON FUNCTION public.asaas_pago_outra_forma(uuid,uuid,date,bigint,text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asaas_pago_outra_forma(uuid,uuid,date,bigint,text,text,text) TO authenticated;

-- Resultado do cancelamento no Asaas (somente servidor).
CREATE OR REPLACE FUNCTION public.asaas_outra_forma_cancelamento(_id uuid, _ok boolean, _erro text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM asaas_baixas_outra_forma WHERE id=_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Baixa inexistente.'; END IF;
  UPDATE asaas_baixas_outra_forma SET cancel_status = CASE WHEN _ok THEN 'cancelado' ELSE 'falhou' END,
    cancel_erro = CASE WHEN _ok THEN NULL ELSE left(_erro,500) END, cancel_tentativas = cancel_tentativas+1, updated_at=now() WHERE id=_id;
  IF _ok THEN UPDATE asaas_charges SET external_status='DELETED' WHERE id=b.charge_id AND external_status IN ('PENDING','OVERDUE'); END IF;
END $$;
REVOKE ALL ON FUNCTION public.asaas_outra_forma_cancelamento(uuid,boolean,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_outra_forma_cancelamento(uuid,boolean,text) TO service_role;

-- Baixa automática nunca baixa de novo uma cobrança já paga por outra forma (cliente pagou duas vezes = revisão manual).
DO $do$
DECLARE d text := pg_get_functiondef('public.asaas_baixa_automatica(uuid)'::regprocedure); marca text := '  parcela := c.installment_id;';
BEGIN
  IF position('pago_por_outra_forma' in d) > 0 THEN RETURN; END IF;
  IF position(marca in d) = 0 THEN RAISE EXCEPTION 'asaas_baixa_automatica mudou: ponto de inserção não encontrado'; END IF;
  d := replace(d, marca, '  IF EXISTS (SELECT 1 FROM public.asaas_baixas_outra_forma WHERE charge_id = c.id) THEN' || chr(10) ||
    '    RETURN jsonb_build_object(''baixa'', false, ''motivo'', ''pago_por_outra_forma'', ''revisao_manual'', true);' || chr(10) ||
    '  END IF;' || chr(10) || marca);
  EXECUTE d;
END $do$;

-- Acordos aguardando 1º pagamento com a 1ª cobrança vencida há mais de 5 dias (somente servidor).
CREATE OR REPLACE FUNCTION public.cob_acordo_vencidos_listar()
RETURNS TABLE(simulacao_id uuid, charge_id uuid, external_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH prim AS (
    SELECT DISTINCT ON (s.id) s.id sim, i.due_date
      FROM cob_simulacoes s JOIN asaas_charge_intents i ON i.acordo_simulacao_id=s.id
     WHERE s.status IN ('simulada','aguardando_entrada')
     ORDER BY s.id, i.acordo_parcela, i.created_at DESC),
  alvo AS (
    SELECT p.sim FROM prim p
     WHERE p.due_date + 5 < (now() AT TIME ZONE 'America/Sao_Paulo')::date
       AND NOT EXISTS (SELECT 1 FROM asaas_charge_intents i JOIN asaas_charges c ON c.id=i.charge_id
                        WHERE i.acordo_simulacao_id=p.sim AND c.external_status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')))
  SELECT a.sim, c.id, c.external_id FROM alvo a
    LEFT JOIN asaas_charge_intents i ON i.acordo_simulacao_id=a.sim
    LEFT JOIN asaas_charges c ON c.id=i.charge_id AND c.external_status IN ('PENDING','OVERDUE')
$$;
REVOKE ALL ON FUNCTION public.cob_acordo_vencidos_listar() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cob_acordo_vencidos_listar() TO service_role;

CREATE OR REPLACE FUNCTION public.cob_acordo_vencido_encerrar(_sim uuid, _canceladas uuid[], _falhas text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s cob_simulacoes; tudo boolean := coalesce(array_length(_falhas,1),0) = 0; t uuid;
BEGIN
  SELECT * INTO s FROM cob_simulacoes WHERE id=_sim FOR UPDATE;
  IF s.id IS NULL OR s.status NOT IN ('simulada','aguardando_entrada') THEN RETURN jsonb_build_object('ok',false,'motivo','acordo_nao_aguardando'); END IF;
  UPDATE asaas_charges SET external_status='DELETED' WHERE id = ANY(coalesce(_canceladas,'{}')) AND external_status IN ('PENDING','OVERDUE');
  IF tudo THEN
    UPDATE cob_simulacoes SET status='cancelada', updated_at=now() WHERE id=_sim;
    INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
    VALUES (s.party_id,'negociacao','cancelada','Acordo cancelado automaticamente: 1º pagamento não feito até 5 dias após o vencimento. Cobranças canceladas no Asaas; dívidas originais voltam a valer.', s.installment_ids, s.autor_id);
  END IF;
  INSERT INTO cob_tarefas(party_id,origem,chave,titulo,installment_ids,vence_em,responsavel_id,autor_id)
  VALUES (s.party_id,'manual','acordo-vencido:'||_sim||CASE WHEN tudo THEN '' ELSE ':falha:'||to_char(now(),'YYYYMMDD') END,
    CASE WHEN tudo THEN 'Acordo cancelado: cliente não pagou a 1ª parcela até venc. + 5 dias. Retomar contato.'
         ELSE 'Acordo venceu (+5 dias) mas não consegui cancelar todas as cobranças no Asaas: ' || array_to_string(_falhas,'; ') END,
    s.installment_ids,(now() AT TIME ZONE 'America/Sao_Paulo')::date,s.autor_id,s.autor_id)
  ON CONFLICT (chave) DO NOTHING RETURNING id INTO t;
  RETURN jsonb_build_object('ok',tudo,'tarefa',t);
END $$;
REVOKE ALL ON FUNCTION public.cob_acordo_vencido_encerrar(uuid,uuid[],text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cob_acordo_vencido_encerrar(uuid,uuid[],text[]) TO service_role;