-- 0328 — Segurança (verificação de 16/11/2026): duas rotinas internas que montam comandos por dentro
-- deixam de poder ser chamadas por conta logada. Nenhuma tela as usa; continuam disponíveis para o servidor.
--  * auditoria_integridade(): raio-X de integridade (só Master/servidor já podiam rodar).
--  * party_unificar(...): unificação de cadastros duplicados (prévia + execução atômica).
REVOKE EXECUTE ON FUNCTION public.auditoria_integridade() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auditoria_integridade() TO service_role;
REVOKE EXECUTE ON FUNCTION public.party_unificar(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_unificar(uuid, uuid, text, boolean) TO service_role;