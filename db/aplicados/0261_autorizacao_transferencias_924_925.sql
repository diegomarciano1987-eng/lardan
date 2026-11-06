-- Autorização pontual de Diego em 06/11/2026 21:49 UTC. Não altera CPF ou vínculos legados.
INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
VALUES
('934884cf-48c0-42ed-bb8f-d0f6ec330d7f','legado_transferencia_identidade_autorizada','remessas','3e89a055-d6d9-4130-b0bb-9818ec3160d8',
 '{"legado":924,"destino":926,"representante_party_id":"72a0a281-68e6-4846-81ca-716919b1d452","nome":"MARCELO MARLOS DE OLIVEIRA","autorizacao":"Autorizo a aplicação, só tem 2 representante Ativo com esses nomes","autorizado_em":"2026-11-06T21:49:00Z","aceitar_falta":true,"expedir":false,"preservar_vinculos":true}'::jsonb),
('934884cf-48c0-42ed-bb8f-d0f6ec330d7f','legado_transferencia_identidade_autorizada','remessas','404bb4c5-f84d-48be-9bc8-480cc29bc01d',
 '{"legado":925,"destino":925,"representante_party_id":"f38ce2e8-6973-43e6-bccf-0d2cdc1acc4f","nome":"GUILHERME AUGUSTO PELEGRINI DA SILVA","autorizacao":"Autorizo a aplicação, só tem 2 representante Ativo com esses nomes","autorizado_em":"2026-11-06T21:49:00Z","aceitar_falta":true,"expedir":false,"preservar_vinculos":true}'::jsonb);