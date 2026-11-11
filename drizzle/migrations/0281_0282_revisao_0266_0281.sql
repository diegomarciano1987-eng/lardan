-- 0282: revisão dos pacotes 0266–0281 (11/11/2026). Nenhum dado de cliente alterado, nenhuma coluna removida.
-- 1) Raio-x: M3 dava falso alarme (maleta conferida guarda as peças na composição, não no saldo da maleta);
--    F6 só acusa aviso parado há mais de 36 h; novo F9 = dinheiro recebido no Asaas sem título no Lardan.
-- 2) Número de ABERTURA: duas aberturas ao mesmo tempo na mesma remessa não ficam com o mesmo número.
-- 3) Fila fiscal: maleta transferida com nota em nome da anterior não ganha nota nova automática
--    enquanto a pendência de nota estiver aberta (também quando a fila estava em "erro").
-- 4) Ativação por movimento: encerrar a maleta (volta sem venda, devolução) não reativa consultora inativa.
--    Acerto, pedido, maleta nova, contrato e troca continuam reativando.

-- 1) Raio-x ------------------------------------------------------------------------------------------
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.auditoria_integridade()'::regprocedure);
  antes := def;

  def := replace(def,
    $a$WHERE c.status IN ('conferida','expedida','transito','recebida','operacao') AND NOT EXISTS (SELECT 1 FROM kit_balances b WHERE b.cycle_id=c.id AND b.qty_allocated>0)$q$$a$,
    $b$WHERE (c.status='conferida' AND NOT EXISTS (SELECT 1 FROM kit_compositions kc JOIN kit_composition_items i ON i.composition_id=kc.id WHERE kc.cycle_id=c.id AND kc.version=(SELECT max(k2.version) FROM kit_compositions k2 WHERE k2.cycle_id=c.id) AND i.quantity>0)) OR (c.status IN ('expedida','transito','recebida','operacao') AND NOT EXISTS (SELECT 1 FROM kit_balances b WHERE b.cycle_id=c.id AND b.qty_allocated>0))$q$$b$);
  IF def = antes AND position('kit_composition_items i ON i.composition_id=kc.id WHERE kc.cycle_id=c.id' IN def) = 0 THEN
    RAISE EXCEPTION '0282: item M3 não encontrado na auditoria; revisar antes de aplicar.';
  END IF;
  antes := def;

  def := replace(def,
    $a$('financeiro','F6','alta','Aviso Asaas com erro não processado',$q$SELECT e.event||' · '||coalesce(e.charge_external_id,'') AS ref FROM asaas_events e WHERE e.processed_at IS NULL AND e.last_error IS NOT NULL$q$),$a$,
    $b$('financeiro','F6','alta','Aviso Asaas parado há mais de 36 h',$q$SELECT e.event||' · '||coalesce(e.charge_external_id,'')||' · '||to_char(e.received_at,'DD/MM') AS ref FROM asaas_events e WHERE e.processed_at IS NULL AND e.last_error IS NOT NULL AND e.received_at<now()-interval '36 hours' ORDER BY e.received_at DESC$q$),
 ('financeiro','F9','media','Recebido no Asaas sem título no Lardan (60 dias, ver Mesa de conciliação)',$q$SELECT c.external_id||' · '||to_char(c.payment_date,'DD/MM')||' · '||c.value_cents AS ref FROM asaas_charges c WHERE c.external_status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH') AND c.installment_id IS NULL AND c.title_id IS NULL AND c.reconcile_status='pendente' AND c.payment_date>=current_date-60 ORDER BY c.payment_date DESC$q$),$b$);
  IF def = antes AND position('''F9''' IN def) = 0 THEN
    RAISE EXCEPTION '0282: item F6 não encontrado na auditoria; revisar antes de aplicar.';
  END IF;

  EXECUTE def;
END $do$;

-- 2) Número de ABERTURA sem repetição ---------------------------------------------------------------
-- As funções calculam max()+1 sem trava. Este gatilho serializa por remessa+representante e, se outro
-- ciclo já tiver o número, dá o próximo livre e acerta a etiqueta "ABERTURA N · Remessa X".
CREATE OR REPLACE FUNCTION public.tg_abertura_numero_unico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_novo integer;
BEGIN
  IF NEW.abertura_numero IS NULL OR NEW.remessa_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.abertura_numero IS NOT DISTINCT FROM OLD.abertura_numero
     AND NEW.remessa_id IS NOT DISTINCT FROM OLD.remessa_id
     AND NEW.representante_party_id IS NOT DISTINCT FROM OLD.representante_party_id THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('abertura:' || NEW.remessa_id::text || ':' || coalesce(NEW.representante_party_id::text, '-')));
  IF EXISTS (SELECT 1 FROM kit_cycles o
              WHERE o.remessa_id = NEW.remessa_id AND o.id <> NEW.id
                AND o.representante_party_id IS NOT DISTINCT FROM NEW.representante_party_id
                AND o.abertura_numero = NEW.abertura_numero) THEN
    SELECT coalesce(max(o.abertura_numero), 0) + 1 INTO v_novo FROM kit_cycles o
     WHERE o.remessa_id = NEW.remessa_id AND o.id <> NEW.id
       AND o.representante_party_id IS NOT DISTINCT FROM NEW.representante_party_id;
    UPDATE kits SET label = regexp_replace(label, '^ABERTURA 0?' || NEW.abertura_numero || '( ·|$)', 'ABERTURA ' || v_novo || '\1')
     WHERE id = NEW.kit_id AND label ~ ('^ABERTURA 0?' || NEW.abertura_numero || '( ·|$)');
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'maleta.abertura_renumerada', 'kit_cycles', NEW.id::text,
            jsonb_build_object('de', NEW.abertura_numero, 'para', v_novo, 'remessa', NEW.remessa_id));
    NEW.abertura_numero := v_novo;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_abertura_numero_unico() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS aa_abertura_numero_unico ON public.kit_cycles;
CREATE TRIGGER aa_abertura_numero_unico BEFORE INSERT OR UPDATE OF abertura_numero, remessa_id, representante_party_id
  ON public.kit_cycles FOR EACH ROW EXECUTE FUNCTION public.tg_abertura_numero_unico();

-- 3) Fila fiscal x pendência de nota da transferência ----------------------------------------------
-- 0279 só apagava a linha criada na mesma transação (criado_em = now()). Uma linha antiga em "erro"
-- voltava para "pendente" pelo ON CONFLICT e a fila tentava nota nova para a consultora nova.
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.fiscal_fila_kit_trg()'::regprocedure);
  antes := def;
  def := replace(def, '  SELECT * INTO s FROM fiscal_settings WHERE id;',
    '  IF v_etapa = ''remessa'' AND EXISTS (SELECT 1 FROM maleta_troca_pendencias p WHERE p.cycle_id = NEW.id AND p.status = ''aberta'') THEN
    RETURN NEW; -- 0282: nota da anterior ainda em aberto; a montagem resolve a pendência
  END IF;
  SELECT * INTO s FROM fiscal_settings WHERE id;');
  IF def = antes AND position('0282: nota da anterior' IN def) = 0 THEN
    RAISE EXCEPTION '0282: ponto de inserção não encontrado em fiscal_fila_kit_trg; revisar.';
  END IF;
  IF position('0282: nota da anterior' IN antes) > 0 THEN def := antes; END IF;
  EXECUTE def;
END $do$;

CREATE OR REPLACE FUNCTION public.tg_pendencia_troca_tira_fila()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'aberta' THEN
    DELETE FROM fiscal_fila WHERE cycle_id = NEW.cycle_id AND etapa = 'remessa' AND status IN ('pendente', 'erro');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_pendencia_troca_tira_fila() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_pendencia_troca_tira_fila ON public.maleta_troca_pendencias;
CREATE TRIGGER zz_pendencia_troca_tira_fila AFTER INSERT OR UPDATE ON public.maleta_troca_pendencias
  FOR EACH ROW EXECUTE FUNCTION public.tg_pendencia_troca_tira_fila();

-- pendências já abertas hoje: tira da fila o que ainda pode virar nota nova
DELETE FROM public.fiscal_fila f USING public.maleta_troca_pendencias p
 WHERE p.cycle_id = f.cycle_id AND p.status = 'aberta' AND f.etapa = 'remessa' AND f.status IN ('pendente', 'erro');

-- 4) Encerrar maleta não reativa ---------------------------------------------------------------------
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.tg_consultora_movimento_ativa()'::regprocedure);
  antes := def;
  def := replace(def, $a$IF TG_TABLE_NAME = 'kit_cycles' AND novo ->> 'status' = 'cancelada' THEN RETURN NEW; END IF;$a$,
                      $b$IF TG_TABLE_NAME = 'kit_cycles' AND novo ->> 'status' IN ('cancelada', 'encerrada') THEN RETURN NEW; END IF;$b$);
  IF def = antes AND position($c$IN ('cancelada', 'encerrada')$c$ IN def) = 0 THEN
    RAISE EXCEPTION '0282: ponto não encontrado em tg_consultora_movimento_ativa; revisar.';
  END IF;
  EXECUTE def;
END $do$;