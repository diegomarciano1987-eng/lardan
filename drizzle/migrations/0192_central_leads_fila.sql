CREATE TABLE public.central_leads_fila (
  id bigserial PRIMARY KEY,
  evento_id text NOT NULL UNIQUE,
  lead_id uuid NOT NULL,
  ocorrido_em timestamptz NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  tentativas integer NOT NULL DEFAULT 0,
  proxima_em timestamptz NOT NULL DEFAULT now(),
  ultimo_status_http integer,
  ultimo_erro text,
  enviado_em timestamptz,
  duplicado boolean,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.central_leads_fila TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.central_leads_fila_id_seq TO service_role;
ALTER TABLE public.central_leads_fila ENABLE ROW LEVEL SECURITY;
CREATE INDEX central_leads_fila_proxima ON public.central_leads_fila (status, proxima_em, ocorrido_em);

CREATE TABLE public.central_leads_estado (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  pausado_conexao boolean NOT NULL DEFAULT false,
  pausado_motivo text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.central_leads_estado TO service_role;
ALTER TABLE public.central_leads_estado ENABLE ROW LEVEL SECURITY;
INSERT INTO public.central_leads_estado (id) VALUES (true);

CREATE OR REPLACE FUNCTION public.central_leads_payload(l public.leads)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'evento_id', 'leads:' || l.id,
    'nome', nullif(trim(l.full_name), ''),
    'email', CASE WHEN l.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN lower(trim(l.email)) END,
    'telefone', nullif(coalesce(l.whatsapp_norm, l.whatsapp), ''),
    'mensagem', nullif(trim(l.motivation), ''),
    'campos', jsonb_strip_nulls(jsonb_build_object(
      'formulario', 'Seja Lardan (candidatura)',
      'protocolo', l.protocol,
      'objetivo_financeiro', l.financial_goal,
      'disponibilidade', l.availability,
      'experiencia', l.experience,
      'publico', l.audience,
      'sonho', l.dream,
      'valor_sonho_centavos', l.dream_value_cents,
      'indicado_por', l.indicado_por_texto,
      'consentimento_marketing', l.marketing_consent,
      'idioma', l.language,
      'sistema', l.os,
      'gclid', l.gclid, 'fbclid', l.fbclid, 'msclkid', l.msclkid,
      'primeira_origem', l.first_touch,
      'origem_no_envio', l.last_touch,
      'primeiro_referrer', l.first_referrer
    )),
    'origem', nullif(coalesce(l.source_normalized, l.source), ''),
    'ocorrido_em', to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'pagina_url', nullif(coalesce(l.landing_page, l.entry_url), ''),
    'referrer', nullif(l.referrer, ''),
    'utm', CASE WHEN l.utm IS NOT NULL AND l.utm <> '{}'::jsonb THEN jsonb_strip_nulls(jsonb_build_object(
      'source', l.utm->>'source', 'medium', l.utm->>'medium', 'campaign', l.utm->>'campaign',
      'term', l.utm->>'term', 'content', l.utm->>'content')) END,
    'navegador', nullif(l.browser, ''),
    'dispositivo', nullif(l.device_type, ''),
    'cidade', nullif(l.city, ''),
    'uf', nullif(trim(l.uf), ''),
    'crm_url', 'https://www.lardan.com.br/admin/candidaturas'
  ))
$$;
REVOKE ALL ON FUNCTION public.central_leads_payload(public.leads) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.central_leads_enfileirar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.central_leads_fila (evento_id, lead_id, ocorrido_em, payload)
    VALUES ('leads:' || NEW.id, NEW.id, NEW.created_at, public.central_leads_payload(NEW))
    ON CONFLICT (evento_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'central_leads_enfileirar: %', SQLERRM; -- nunca bloqueia o salvamento do lead
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.central_leads_enfileirar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER central_leads_espelho AFTER INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.central_leads_enfileirar();

-- Histórico: enfileira com a data original, do mais antigo ao mais recente
INSERT INTO public.central_leads_fila (evento_id, lead_id, ocorrido_em, payload)
SELECT 'leads:' || l.id, l.id, l.created_at, public.central_leads_payload(l)
FROM public.leads l ORDER BY l.created_at
ON CONFLICT (evento_id) DO NOTHING;