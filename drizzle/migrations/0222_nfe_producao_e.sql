-- 0216e — trava de série, cópia ao escritório e fila automática
CREATE OR REPLACE FUNCTION public.fiscal_focus_serie_guarda_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record;
BEGIN
  IF NEW.ambiente = 'producao' AND NEW.status = 'autorizado' AND OLD.status IS DISTINCT FROM 'autorizado' THEN
    SELECT * INTO s FROM fiscal_settings WHERE id;
    IF NEW.serie IS DISTINCT FROM s.serie_producao THEN
      UPDATE fiscal_settings SET emission_active = false, producao_automatico = false,
             note = concat_ws(chr(10), note, 'Emissão desligada automaticamente: nota ' || NEW.ref || ' autorizada na série ' || coalesce(NEW.serie, '?') ||
                              ' (esperada ' || s.serie_producao || ') em ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'))
       WHERE id;
      INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
      VALUES (NULL, 'fiscal.serie_divergente', 'fiscal_focus_envios', NEW.ref,
              jsonb_build_object('serie', NEW.serie, 'esperada', s.serie_producao, 'numero', NEW.numero, 'chave', NEW.chave_nfe));
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_serie_guarda_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS fiscal_focus_serie_guarda ON public.fiscal_focus_envios;
CREATE TRIGGER fiscal_focus_serie_guarda AFTER UPDATE OF status ON public.fiscal_focus_envios
FOR EACH ROW EXECUTE FUNCTION public.fiscal_focus_serie_guarda_trg();

CREATE OR REPLACE FUNCTION public.fiscal_focus_email_pendentes(_limite int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE dest text;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  SELECT nullif(btrim(email_copia_xml), '') INTO dest FROM fiscal_settings WHERE id;
  IF dest IS NULL THEN RETURN jsonb_build_object('email', NULL, 'refs', '[]'::jsonb); END IF;
  RETURN jsonb_build_object('email', dest, 'refs', coalesce((SELECT jsonb_agg(jsonb_build_object('ref', ref, 'ambiente', ambiente))
    FROM (SELECT ref, ambiente FROM fiscal_focus_envios
           WHERE ambiente = 'producao' AND status IN ('autorizado', 'cancelado') AND email_enviado_em IS NULL AND email_tentativas < 5
           ORDER BY updated_at LIMIT least(greatest(coalesce(_limite, 20), 1), 100)) x), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_email_pendentes(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_email_pendentes(int) TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_focus_email_marcar(_ref text, _ok boolean, _email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  UPDATE fiscal_focus_envios SET email_enviado_em = CASE WHEN _ok THEN now() END, email_tentativas = email_tentativas + 1 WHERE ref = _ref;
  IF _ok THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (NULL, 'fiscal.focus_email', 'fiscal_focus_envios', _ref, jsonb_build_object('email', _email));
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_focus_email_marcar(text,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_focus_email_marcar(text,boolean,text) TO service_role;

CREATE TABLE IF NOT EXISTS public.fiscal_fila (
  id bigserial PRIMARY KEY,
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id),
  etapa text NOT NULL CHECK (etapa IN ('remessa', 'acerto')),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'feito', 'erro')),
  tentativas int NOT NULL DEFAULT 0,
  erro text,
  proxima_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, etapa)
);
ALTER TABLE public.fiscal_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_fila FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fiscal_fila TO service_role;
GRANT USAGE ON SEQUENCE public.fiscal_fila_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_fila_kit_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record; v_etapa text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  v_etapa := CASE NEW.status::text WHEN 'conferida' THEN 'remessa' WHEN 'encerrada' THEN 'acerto' END;
  IF v_etapa IS NULL OR NEW.consultora_party_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO s FROM fiscal_settings WHERE id;
  IF NOT (public.fiscal_focus_producao_ativa() AND s.producao_automatico AND (s.producao_todas OR s.producao_piloto_cycle_id = NEW.id)) THEN
    RETURN NEW;
  END IF;
  IF v_etapa = 'acerto' AND NOT EXISTS (SELECT 1 FROM fiscal_focus_envios e WHERE e.cycle_id = NEW.id AND e.operacao = 'remessa'
                                       AND e.ambiente = 'producao' AND e.status = 'autorizado') THEN
    RETURN NEW;
  END IF;
  INSERT INTO fiscal_fila (cycle_id, etapa) VALUES (NEW.id, v_etapa)
   ON CONFLICT (cycle_id, etapa) DO UPDATE SET status = 'pendente', proxima_em = now(), atualizado_em = now()
   WHERE fiscal_fila.status = 'erro';
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_fila_kit_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_fiscal_fila_kit ON public.kit_cycles;
CREATE TRIGGER zz_fiscal_fila_kit AFTER UPDATE OF status ON public.kit_cycles
FOR EACH ROW EXECUTE FUNCTION public.fiscal_fila_kit_trg();

CREATE OR REPLACE FUNCTION public.fiscal_fila_proximos(_limite int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF NOT public.fiscal_focus_producao_ativa() THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'cycle_id', f.cycle_id, 'etapa', f.etapa) ORDER BY f.id)
    FROM (SELECT * FROM fiscal_fila WHERE status = 'pendente' AND proxima_em <= now()
           ORDER BY id LIMIT least(greatest(coalesce(_limite, 5), 1), 20) FOR UPDATE SKIP LOCKED) f), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_fila_proximos(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_fila_proximos(int) TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_fila_resultado(_id bigint, _ok boolean, _erro text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  UPDATE fiscal_fila SET
    status = CASE WHEN _ok THEN 'feito' WHEN tentativas + 1 >= 5 THEN 'erro' ELSE 'pendente' END,
    tentativas = tentativas + 1, erro = CASE WHEN _ok THEN NULL ELSE left(_erro, 500) END,
    proxima_em = now() + make_interval(mins => least(60, 2 ^ (tentativas + 1))::int), atualizado_em = now()
  WHERE id = _id;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_fila_resultado(bigint,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_fila_resultado(bigint,boolean,text) TO service_role;