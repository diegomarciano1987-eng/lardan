-- 0213 — Forma da venda também pelo que a consultora marcou em "Nova venda" (05/11/2026).
-- Na revisão do pedido o app pergunta a forma combinada com a cliente (Pix, crédito, débito, dinheiro, a prazo) e grava
-- em sales_orders.combinado_forma. A 0211 só olhava a cobrança pela Lardan (pay_method), então essas vendas apareciam
-- como "Sem forma definida" na Central de vendas e em "Vendidos" — inclusive as feitas por Pix.
-- Agora: cobrança Lardan (Asaas) continua com prioridade; sem ela, vale a forma combinada. Só leitura, nenhum dado muda.
CREATE OR REPLACE FUNCTION public.venda_forma(_o public.sales_orders)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _o.pay_method = 'pix' AND _o.pay_installment_id IS NOT NULL THEN 'pix'
    WHEN _o.pay_method = 'cartao' AND _o.pay_installment_id IS NOT NULL THEN 'cartao'
    WHEN _o.pay_method = 'depois' AND _o.pay_installment_id IS NOT NULL THEN 'boleto'
    WHEN _o.pay_method = 'dinheiro' THEN 'dinheiro'
    WHEN _o.pay_method = 'depois' THEN 'receber_depois'
    WHEN _o.combinado_forma = 'pix' THEN 'pix_combinado'
    WHEN _o.combinado_forma IN ('credito', 'debito') THEN 'cartao_combinado'
    WHEN _o.combinado_forma = 'dinheiro' THEN 'dinheiro'
    WHEN _o.combinado_forma = 'a_prazo' THEN 'receber_depois'
    WHEN _o.status = 'concluido' THEN 'marcada_feita'
    ELSE 'sem_forma' END
$$;
GRANT EXECUTE ON FUNCTION public.venda_forma(public.sales_orders) TO authenticated, service_role;