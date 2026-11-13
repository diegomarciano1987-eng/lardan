-- 0313 — nota recusada pela SEFAZ depois do envio volta sozinha para a fila (13/11/2026).
-- Defeito: a fila marcava 'feito' quando a Focus respondia "processando"; se a SEFAZ recusava depois
-- (ex.: 635 número em processamento), a maleta ficava sem nota e sem nova tentativa (MAL-00474, MAL-00476).
-- Recusa (erro_autorizacao/erro_envio) não usa número: tentar de novo com nova referência é seguro.
-- Denegada não volta (número usado; exige análise). Nada é emitido se já houver outra nota viva.

CREATE OR REPLACE FUNCTION public.fiscal_recusa_reabre_fila_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_etapa text;
BEGIN
  IF NEW.ambiente <> 'producao' OR NEW.cycle_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('erro_autorizacao', 'erro_envio') OR OLD.status NOT IN ('pendente', 'processando_autorizacao') THEN RETURN NEW; END IF;
  v_etapa := CASE WHEN NEW.operacao = 'remessa' THEN 'remessa'
                  WHEN NEW.operacao IN ('devolucao', 'venda', 'perda') THEN 'acerto' END;
  IF v_etapa IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM fiscal_focus_envios o WHERE o.cycle_id = NEW.cycle_id AND o.ambiente = NEW.ambiente
              AND o.operacao = NEW.operacao AND o.ref <> NEW.ref AND o.status IN ('pendente', 'processando_autorizacao', 'autorizado')) THEN
    RETURN NEW;
  END IF;
  UPDATE fiscal_fila SET
    status = CASE WHEN tentativas >= 5 THEN 'erro' ELSE 'pendente' END,
    erro = left('SEFAZ recusou depois do envio: ' || coalesce(NEW.mensagem_sefaz, NEW.status), 500),
    proxima_em = now() + interval '2 minutes', atualizado_em = now()
  WHERE cycle_id = NEW.cycle_id AND etapa = v_etapa AND status = 'feito';
  IF FOUND THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'fiscal.fila_reaberta_recusa', 'fiscal_focus_envios', NEW.ref,
            jsonb_build_object('cycle_id', NEW.cycle_id, 'etapa', v_etapa, 'status', NEW.status, 'status_sefaz', NEW.status_sefaz));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_recusa_reabre_fila_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_fiscal_recusa_reabre_fila ON public.fiscal_focus_envios;
CREATE TRIGGER zz_fiscal_recusa_reabre_fila AFTER UPDATE OF status ON public.fiscal_focus_envios
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_recusa_reabre_fila_trg();

-- casos já presos: fila 'feito' sem nota viva e com última nota recusada (produção)
WITH presos AS (
  SELECT f.id, e.ref, e.mensagem_sefaz
    FROM fiscal_fila f
    JOIN LATERAL (SELECT * FROM fiscal_focus_envios x WHERE x.cycle_id = f.cycle_id AND x.ambiente = 'producao'
                   AND x.operacao = 'remessa' ORDER BY x.created_at DESC LIMIT 1) e ON true
   WHERE f.status = 'feito' AND f.etapa = 'remessa' AND e.status IN ('erro_autorizacao', 'erro_envio')
     AND NOT EXISTS (SELECT 1 FROM fiscal_focus_envios v WHERE v.cycle_id = f.cycle_id AND v.ambiente = 'producao'
                      AND v.operacao = 'remessa' AND v.status IN ('pendente', 'processando_autorizacao', 'autorizado'))
), upd AS (
  UPDATE fiscal_fila f SET status = 'pendente', erro = left('SEFAZ recusou depois do envio: ' || coalesce(p.mensagem_sefaz, ''), 500),
         proxima_em = now(), atualizado_em = now()
    FROM presos p WHERE f.id = p.id RETURNING f.id, f.cycle_id, p.ref
)
INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
SELECT NULL, 'fiscal.fila_reaberta_recusa', 'fiscal_focus_envios', ref, jsonb_build_object('cycle_id', cycle_id, 'retroativo', true) FROM upd;