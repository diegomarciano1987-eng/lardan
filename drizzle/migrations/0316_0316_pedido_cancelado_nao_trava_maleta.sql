-- 0316: pedido de cliente CANCELADO (ex.: venda de teste excluída) não trava mais transferir nem desfazer movimento da maleta.
-- Pedido ativo continua travando. Troca só a condição nas duas funções (o resto do corpo fica idêntico).
DO $mig$
DECLARE f text; def text; novo text;
  antigo constant text := 'EXISTS (SELECT 1 FROM sales_order_items i WHERE i.cycle_id = c.id)';
  troca constant text := 'EXISTS (SELECT 1 FROM sales_order_items i JOIN sales_orders so ON so.id = i.order_id WHERE i.cycle_id = c.id AND so.status <> ''cancelado'')';
BEGIN
  FOREACH f IN ARRAY ARRAY['public.maleta_transferir_situacao(uuid)', 'public.maleta_movimento_desfazer_nucleo(uuid,text,uuid,boolean)'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    IF (length(def) - length(replace(def, antigo, ''))) / length(antigo) <> 1 THEN
      RAISE EXCEPTION '0316: condição esperada não encontrada exatamente uma vez em %', f;
    END IF;
    novo := replace(def, antigo, troca);
    EXECUTE novo;
  END LOOP;
END $mig$;