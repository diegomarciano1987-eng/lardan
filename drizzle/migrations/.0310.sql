-- 0310 (pacote 0309 do Diego; renumerado porque a 0309 de 13/11 já existe) — Asaas × Lardan: espelho sem furo (revisão do Claude, 13/11/2026). Não lança dinheiro, não remove coluna.
-- 1) Quatro telas/consultas do financeiro liam vazio: a regra de leitura chamava asaas_ator_pode, que o usuário logado
--    não pode executar ("permission denied for function asaas_ator_pode"). Ex.: "Pago por outra forma" e o resultado do
--    botão "Levar o Lardan ao Asaas". Agora usam asaas_eu_posso (mesma regra, só para o próprio usuário).
-- 2) 225 clientes do Asaas (161 pessoas, 165 cobranças abertas) estavam ligadas à pessoa certa pelo CPF, mas com
--    match_status 'pendente' (o cadastro automático usava coalesce num campo que nunca é nulo). Para o sistema elas
--    "não tinham cadastro no Asaas": o celular/e-mail do Lardan não ia para o Asaas e a baixa parcial virava exceção
--    com o Asaas cobrando o valor antigo. Quem tem um único cadastro Asaas por conta passa a 'vinculado';
--    quem tem dois fica 'pendente' (duplicado, a equipe escolhe).
-- 3) Regra nova do espelho de saldo: o Asaas nunca cobra mais do que o Lardan diz que é devido. Se a cobrança nova
--    pelo saldo não puder nascer sozinha (cliente sem vínculo, duplicada, título não aprovado, judicial, conta),
--    a antiga é cancelada mesmo assim e a parcela fica na lista de exceções para a equipe gerar a nova pela tela.
-- 4) Cliente Asaas recém-vinculada entra como "primeira conferência": o Lardan não apaga do Asaas contato que ele não conhece.

-- 1) leitura das tabelas do Asaas ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asaas_eu_posso(_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.asaas_ator_pode(auth.uid(), _cap)
$$;
REVOKE ALL ON FUNCTION public.asaas_eu_posso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_eu_posso(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "financeiro le baixas outra forma" ON public.asaas_baixas_outra_forma;
CREATE POLICY "financeiro le baixas outra forma" ON public.asaas_baixas_outra_forma FOR SELECT TO authenticated
  USING ((SELECT public.asaas_eu_posso('finance.receivable.view')));
DROP POLICY IF EXISTS "financeiro le cancelamentos de cobranca" ON public.asaas_cobranca_cancelamentos;
CREATE POLICY "financeiro le cancelamentos de cobranca" ON public.asaas_cobranca_cancelamentos FOR SELECT TO authenticated
  USING ((SELECT public.asaas_eu_posso('finance.receivable.manage')));
DROP POLICY IF EXISTS "financeiro le pedidos do espelho" ON public.asaas_espelho_pedidos;
CREATE POLICY "financeiro le pedidos do espelho" ON public.asaas_espelho_pedidos FOR SELECT TO authenticated
  USING ((SELECT public.asaas_eu_posso('finance.receivable.view')));
DROP POLICY IF EXISTS "financeiro le espelho de saldo" ON public.asaas_saldo_sync;
CREATE POLICY "financeiro le espelho de saldo" ON public.asaas_saldo_sync FOR SELECT TO authenticated
  USING ((SELECT public.asaas_eu_posso('finance.receivable.view')));

-- 4) vínculo novo = primeira conferência ------------------------------------------------------------------------------------
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.asaas_cliente_espelho_gatilho()'::regprocedure); antes := def;
  def := replace(def, $a$v_party := NEW.party_id; v_motivo := 'cliente Asaas vinculada';$a$,
                      $b$v_party := NEW.party_id; v_motivo := 'primeira conferência (cliente Asaas vinculada)';$b$);
  IF def = antes AND position('primeira conferência (cliente Asaas vinculada)' IN def) = 0 THEN
    RAISE EXCEPTION '0309: ponto não encontrado em asaas_cliente_espelho_gatilho; revisar.';
  END IF;
  EXECUTE def;
END $do$;

-- 2) vínculo das clientes Asaas ----------------------------------------------------------------------------------------------
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.asaas_clientes_cadastrar(uuid)'::regprocedure); antes := def;
  def := replace(def, $a$match_status = coalesce(match_status,'vinculado')$a$,
    $b$match_status = CASE WHEN EXISTS (SELECT 1 FROM asaas_customers o WHERE o.party_id = pid AND o.account_id = cu.account_id
                                          AND o.id <> cu.id AND o.match_status IN ('vinculado','pendente'))
                          THEN 'pendente' ELSE 'vinculado' END$b$);
  IF def = antes AND position($c$THEN 'pendente' ELSE 'vinculado' END$c$ IN def) = 0 THEN
    RAISE EXCEPTION '0309: ponto não encontrado em asaas_clientes_cadastrar; revisar.';
  END IF;
  EXECUTE def;
END $do$;

WITH unico AS (
  SELECT c.id FROM public.asaas_customers c
   WHERE c.match_status = 'pendente' AND c.party_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.asaas_customers o WHERE o.party_id = c.party_id AND o.account_id = c.account_id AND o.id <> c.id)
     -- seguram 'pendente' até o Diego decidir: nome ou celular no Asaas diferente do Lardan (leitura de 13/11/2026)
     AND c.external_id NOT IN ('cus_000202818332', 'cus_000207222673', 'cus_000208785967', 'cus_000214676400', 'cus_000215889967', 'cus_000216005632', 'cus_000216141706', 'cus_000216142052', 'cus_000216173860', 'cus_000216190346', 'cus_000216295720', 'cus_000216370228', 'cus_000216495259')
), promovido AS (
  UPDATE public.asaas_customers c SET match_status = 'vinculado', updated_at = now()
    FROM unico WHERE c.id = unico.id
  RETURNING c.id, c.party_id, c.external_id
), log AS (
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  SELECT NULL, 'asaas.cliente.vinculo_confirmado_0309', 'parties', p.party_id::text,
         jsonb_build_object('cliente', p.external_id, 'motivo', 'único cadastro Asaas da pessoa nesta conta, ligado pelo CPF')
    FROM promovido p
  RETURNING 1
)
SELECT count(*) FROM log;

-- 3) Asaas nunca cobra mais do que o Lardan deve ----------------------------------------------------------------------------
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.asaas_saldo_plano(uuid,boolean)'::regprocedure); antes := def;
  IF position('baixa_parcial_sem_reemissao' IN def) > 0 THEN RETURN; END IF; -- já aplicada
  def := replace(def,
    $a$  IF v_acao IN ('cancelar','excecao') THEN v_valor := CASE WHEN v_acao='excecao' THEN v_valor ELSE NULL END; END IF;$a$,
    $b$  -- 0309: cobrança aberta maior que o saldo e a nova não pode nascer sozinha: cancela a antiga mesmo assim;
  -- a parcela volta como exceção ("reabrir") para a equipe gerar a nova pela tela.
  IF v_acao = 'excecao' AND v_aberto > v_efetivo AND v_n = 1 AND NOT v_em_acordo
     AND v_motivo IN ('cliente_sem_vinculo','cliente_duplicado','conta_asaas','titulo_nao_aprovado','cliente_judicial') THEN
    v_acao := 'cancelar'; v_motivo := 'baixa_parcial_sem_reemissao';
  END IF;
  IF v_acao IN ('cancelar','excecao') THEN v_valor := CASE WHEN v_acao='excecao' THEN v_valor ELSE NULL END; END IF;$b$);
  IF def = antes AND position('baixa_parcial_sem_reemissao' IN def) = 0 THEN
    RAISE EXCEPTION '0309: ponto não encontrado em asaas_saldo_plano; revisar.';
  END IF;
  EXECUTE def;
END $do$;

-- exceções de hoje que agora têm saída: voltam para a fila (a rotina de 1 minuto replaneja)
UPDATE public.asaas_saldo_sync SET estado = 'substituida', updated_at = now()
 WHERE estado = 'excecao' AND NOT progresso AND aberto_cents > saldo_cents
   AND motivo IN ('cliente_sem_vinculo','cliente_duplicado','conta_asaas','titulo_nao_aprovado','cliente_judicial');
