ALTER TABLE public.consultant_clients
  ADD COLUMN IF NOT EXISTS etapa text NOT NULL DEFAULT 'nova',
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS encerrada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS encerrada_motivo text,
  ADD COLUMN IF NOT EXISTS ultima_interacao timestamptz;
ALTER TABLE public.consultant_clients DROP CONSTRAINT IF EXISTS consultant_clients_etapa_ck;
ALTER TABLE public.consultant_clients ADD CONSTRAINT consultant_clients_etapa_ck
  CHECK (etapa IN ('nova','conversa','escolhendo','combinado','cliente'));

-- Quem já comprou vira Cliente; quem já teve contato vai para "Em conversa".
UPDATE public.consultant_clients c SET etapa = 'cliente'
 WHERE EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.client_id = c.id AND o.status = 'concluido');
UPDATE public.consultant_clients c SET etapa = 'conversa',
  ultima_interacao = (SELECT max(created_at) FROM public.consultant_client_contacts k WHERE k.client_id = c.id)
 WHERE etapa = 'nova' AND EXISTS (SELECT 1 FROM public.consultant_client_contacts k WHERE k.client_id = c.id);

CREATE TABLE IF NOT EXISTS public.consultant_client_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.consultant_clients(id) ON DELETE CASCADE,
  consultora_party_id uuid NOT NULL,
  de text, para text NOT NULL, motivo text,
  autor uuid, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.consultant_client_stage_events TO authenticated;
GRANT ALL ON public.consultant_client_stage_events TO service_role;
ALTER TABLE public.consultant_client_stage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Consultora vê o histórico das próprias pessoas" ON public.consultant_client_stage_events FOR SELECT TO authenticated
  USING ((consultora_party_id = public.my_party_id() AND public.has_role(auth.uid(),'consultora'))
         OR public.has_capability(auth.uid(),'crm.view') IS TRUE);
CREATE INDEX IF NOT EXISTS ccse_client_idx ON public.consultant_client_stage_events(client_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.consultant_client_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ig text := lower(btrim(coalesce(NEW.instagram,'')));
BEGIN
  -- Instagram: aceita @usuario ou endereço do instagram.com; guarda só o usuário.
  IF ig <> '' THEN
    ig := regexp_replace(ig, '^(https?://)?(www\.|m\.)?instagram\.com/', '');
    ig := regexp_replace(ig, '^@', '');
    ig := regexp_replace(ig, '[/?#].*$', '');
    IF ig !~ '^[a-z0-9._]{1,30}$' THEN
      RAISE EXCEPTION 'Instagram inválido. Use @usuario ou o endereço do perfil no Instagram.' USING errcode = '22023';
    END IF;
    NEW.instagram := ig;
  ELSE NEW.instagram := NULL; END IF;

  -- "Cliente" só existe com venda registrada; não se marca na mão.
  IF NEW.etapa = 'cliente' AND (TG_OP = 'INSERT' OR OLD.etapa IS DISTINCT FROM 'cliente')
     AND NOT EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.client_id = NEW.id AND o.status = 'concluido') THEN
    RAISE EXCEPTION 'A etapa Cliente aparece sozinha quando uma venda é registrada.' USING errcode = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.etapa = 'cliente' AND NEW.etapa <> 'cliente' THEN
    RAISE EXCEPTION 'Quem já comprou continua como Cliente. Use Pausar se quiser arquivar.' USING errcode = '22023';
  END IF;
  IF NEW.encerrada AND coalesce(btrim(NEW.encerrada_motivo),'') = '' THEN
    RAISE EXCEPTION 'Escreva o motivo para pausar ou encerrar.' USING errcode = '22023';
  END IF;
  IF NOT NEW.encerrada THEN NEW.encerrada_motivo := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_consultant_client_guard ON public.consultant_clients;
CREATE TRIGGER trg_consultant_client_guard BEFORE INSERT OR UPDATE ON public.consultant_clients
  FOR EACH ROW EXECUTE FUNCTION public.consultant_client_guard();

CREATE OR REPLACE FUNCTION public.consultant_client_stage_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.consultant_client_stage_events(client_id, consultora_party_id, de, para, autor)
    VALUES (NEW.id, NEW.consultora_party_id, NULL, NEW.etapa, auth.uid());
  ELSIF OLD.etapa IS DISTINCT FROM NEW.etapa THEN
    INSERT INTO public.consultant_client_stage_events(client_id, consultora_party_id, de, para, autor)
    VALUES (NEW.id, NEW.consultora_party_id, OLD.etapa, NEW.etapa, auth.uid());
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.encerrada IS DISTINCT FROM NEW.encerrada THEN
    INSERT INTO public.consultant_client_stage_events(client_id, consultora_party_id, de, para, motivo, autor)
    VALUES (NEW.id, NEW.consultora_party_id, NEW.etapa, CASE WHEN NEW.encerrada THEN 'pausada' ELSE 'reativada' END, NEW.encerrada_motivo, auth.uid());
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_consultant_client_stage_log ON public.consultant_clients;
CREATE TRIGGER trg_consultant_client_stage_log AFTER INSERT OR UPDATE ON public.consultant_clients
  FOR EACH ROW EXECUTE FUNCTION public.consultant_client_stage_log();

-- Registrar contato: atualiza a última interação e tira de "Nova interessada".
CREATE OR REPLACE FUNCTION public.consultant_contact_touch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.consultant_clients SET ultima_interacao = NEW.created_at,
    etapa = CASE WHEN etapa = 'nova' THEN 'conversa' ELSE etapa END
  WHERE id = NEW.client_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_consultant_contact_touch ON public.consultant_client_contacts;
CREATE TRIGGER trg_consultant_contact_touch AFTER INSERT ON public.consultant_client_contacts
  FOR EACH ROW EXECUTE FUNCTION public.consultant_contact_touch();

-- Pedido criado para a pessoa: vai para "Pedido combinado" (ainda não é venda).
CREATE OR REPLACE FUNCTION public.consultant_order_touch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    IF NEW.status = 'concluido' THEN
      UPDATE public.consultant_clients SET etapa = 'cliente' WHERE id = NEW.client_id AND etapa <> 'cliente';
    ELSE
      UPDATE public.consultant_clients SET etapa = 'combinado' WHERE id = NEW.client_id AND etapa IN ('nova','conversa','escolhendo');
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_consultant_order_touch ON public.sales_orders;
CREATE TRIGGER trg_consultant_order_touch AFTER INSERT OR UPDATE OF status ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.consultant_order_touch();

REVOKE EXECUTE ON FUNCTION public.consultant_client_guard(), public.consultant_client_stage_log(),
  public.consultant_contact_touch(), public.consultant_order_touch() FROM PUBLIC, anon, authenticated;