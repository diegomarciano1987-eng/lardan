CREATE TABLE IF NOT EXISTS public.consultora_status_ajuste_0390 (
  party_id uuid PRIMARY KEY,
  status_anterior text NOT NULL,
  is_active_anterior boolean NOT NULL,
  papel_status_anterior text,
  acao text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.consultora_status_ajuste_0390 TO service_role;
ALTER TABLE public.consultora_status_ajuste_0390 ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consultora_ativar_por_movimento(_party uuid, _actor uuid, _origem text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE st text; mudou boolean := false; n int;
BEGIN
  IF _party IS NULL THEN RETURN false; END IF;
  SELECT status::text INTO st FROM parties WHERE id = _party;
  IF st IS NULL OR st IN ('bloqueado', 'desligado') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM party_roles WHERE party_id = _party AND role = 'consultora') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM party_unificacoes WHERE duplicada_id = _party) THEN RETURN false; END IF;
  IF st = 'inativo' THEN
    UPDATE parties SET status = 'ativo', is_active = true, updated_at = now() WHERE id = _party AND status::text = 'inativo';
    GET DIAGNOSTICS n = ROW_COUNT; mudou := n > 0;
  ELSIF st IN ('em_analise', 'rascunho') THEN
    -- 0390: quem já recebe movimento (maleta etc.) está aprovada.
    UPDATE parties SET status = 'aprovado', is_active = true, updated_at = now() WHERE id = _party AND status::text IN ('em_analise', 'rascunho');
    GET DIAGNOSTICS n = ROW_COUNT; mudou := n > 0;
  END IF;
  UPDATE party_roles SET status = 'ativo', updated_at = now()
   WHERE party_id = _party AND role = 'consultora' AND status::text = 'inativo';
  GET DIAGNOSTICS n = ROW_COUNT; mudou := mudou OR n > 0;
  IF mudou THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (coalesce(_actor, auth.uid()), 'consultora.ativada_movimento', 'parties', _party::text,
            jsonb_build_object('origem', _origem, 'status_anterior', st, 'divida_cents', public.party_divida_aberta(_party)));
  END IF;
  RETURN mudou;
END $function$;

-- Backfill único (guardado para desfazer)
WITH alvo AS (
  SELECT p.id, p.status::text st, p.is_active, pr.status::text rs,
    EXISTS (SELECT 1 FROM kit_cycles k WHERE k.consultora_party_id = p.id
            AND k.status::text NOT IN ('encerrada','cancelada','rascunho')) maleta
  FROM parties p JOIN party_roles pr ON pr.party_id = p.id AND pr.role = 'consultora' AND pr.ended_at IS NULL
  WHERE p.status::text NOT IN ('bloqueado','desligado')
    AND NOT EXISTS (SELECT 1 FROM party_unificacoes u WHERE u.duplicada_id = p.id)
)
INSERT INTO public.consultora_status_ajuste_0390(party_id, status_anterior, is_active_anterior, papel_status_anterior, acao)
SELECT DISTINCT ON (id) id, st, is_active, rs,
  CASE WHEN maleta AND st = 'em_analise' THEN 'aprovar'
       WHEN maleta THEN 'manter'
       ELSE 'inativar' END
FROM alvo
WHERE (maleta AND st = 'em_analise') OR (NOT maleta AND (st <> 'inativo' OR is_active OR rs <> 'inativo'))
ON CONFLICT (party_id) DO NOTHING;

UPDATE parties p SET status = 'aprovado', updated_at = now()
FROM consultora_status_ajuste_0390 a WHERE a.party_id = p.id AND a.acao = 'aprovar';

UPDATE parties p SET status = 'inativo', is_active = false, updated_at = now()
FROM consultora_status_ajuste_0390 a WHERE a.party_id = p.id AND a.acao = 'inativar';

UPDATE party_roles r SET status = 'inativo', updated_at = now()
FROM consultora_status_ajuste_0390 a WHERE a.party_id = r.party_id AND a.acao = 'inativar' AND r.role = 'consultora' AND r.ended_at IS NULL;

INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
SELECT NULL, 'consultoras.ajuste_0390', 'consultora_status_ajuste_0390', NULL,
  jsonb_build_object('aprovadas', count(*) FILTER (WHERE acao='aprovar'), 'inativadas', count(*) FILTER (WHERE acao='inativar'))
FROM consultora_status_ajuste_0390;