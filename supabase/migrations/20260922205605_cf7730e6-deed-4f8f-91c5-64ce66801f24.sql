-- A liberação de peças bloqueadas (garantia/defeito) exige stock.unblock e roda
-- dentro de stock_liberar_bloqueio, que já verifica essa permissão, o motivo e o
-- destino. A rotina de estoque, porém, também exigia stock.operate do usuário,
-- o que impedia Qualidade de liberar qualquer peça. A liberação passa a ser
-- reconhecida como operação interna, sem afrouxar nada para chamadas diretas.
DO $mig$
DECLARE def text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'register_stock_movement';
  IF def IS NULL THEN RAISE EXCEPTION 'register_stock_movement nao encontrada.'; END IF;

  novo := replace(def,
    'interno boolean := coalesce(current_setting(''lardan.kit_stock'', true), '''') = ''on'';',
    'interno boolean := coalesce(current_setting(''lardan.kit_stock'', true), '''') = ''on''' ||
    ' OR coalesce(current_setting(''lardan.stock_unblock'', true), '''') = ''on'';');

  IF novo = def THEN RAISE EXCEPTION 'Trecho esperado nao encontrado — correcao abortada.'; END IF;
  EXECUTE novo;
END
$mig$;