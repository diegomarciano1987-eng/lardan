-- Envio público de candidaturas e mensagens com retorno de protocolo.
-- O anônimo pode inserir, mas não pode ler a tabela; por isso o protocolo
-- é devolvido por funções SECURITY DEFINER com validação mínima.

CREATE OR REPLACE FUNCTION public.submit_lead(
  p_full_name text,
  p_whatsapp text,
  p_city text,
  p_uf text,
  p_street text DEFAULT NULL,
  p_street_number text DEFAULT NULL,
  p_no_number boolean DEFAULT false,
  p_postal_code text DEFAULT NULL,
  p_financial_goal text DEFAULT NULL,
  p_availability text DEFAULT NULL,
  p_experience text DEFAULT NULL,
  p_audience text DEFAULT NULL,
  p_motivation text DEFAULT NULL,
  p_source text DEFAULT 'site/seja-lardan',
  p_entry_url text DEFAULT NULL,
  p_utm jsonb DEFAULT '{}'::jsonb,
  p_privacy_version text DEFAULT NULL,
  p_marketing_consent boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_protocol text;
BEGIN
  IF length(btrim(coalesce(p_full_name,''))) < 2 THEN
    RAISE EXCEPTION 'nome_invalido';
  END IF;
  IF length(regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'whatsapp_invalido';
  END IF;
  IF length(btrim(coalesce(p_city,''))) < 2 THEN
    RAISE EXCEPTION 'cidade_invalida';
  END IF;
  IF upper(coalesce(p_uf,'')) !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'uf_invalida';
  END IF;
  IF coalesce(p_privacy_version,'') = '' THEN
    RAISE EXCEPTION 'privacidade_ausente';
  END IF;

  INSERT INTO public.leads (
    full_name, whatsapp, street, street_number, no_number, city, uf, postal_code,
    financial_goal, availability, experience, audience, motivation,
    source, entry_url, utm, privacy_version, marketing_consent
  ) VALUES (
    left(btrim(p_full_name), 160),
    left(btrim(p_whatsapp), 32),
    left(btrim(p_street), 200),
    CASE WHEN p_no_number THEN NULL ELSE left(btrim(p_street_number), 20) END,
    coalesce(p_no_number, false),
    left(btrim(p_city), 120),
    upper(p_uf),
    left(btrim(p_postal_code), 20),
    left(btrim(p_financial_goal), 200),
    left(btrim(p_availability), 200),
    left(btrim(p_experience), 400),
    left(btrim(p_audience), 400),
    left(btrim(p_motivation), 2000),
    left(coalesce(p_source, 'site/seja-lardan'), 120),
    left(p_entry_url, 500),
    coalesce(p_utm, '{}'::jsonb),
    left(p_privacy_version, 60),
    coalesce(p_marketing_consent, false)
  )
  RETURNING protocol INTO v_protocol;

  RETURN v_protocol;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_contact_request(
  p_full_name text,
  p_contact_channel text,
  p_contact_value text,
  p_subject text,
  p_message text,
  p_source text DEFAULT 'site/contato',
  p_entry_url text DEFAULT NULL,
  p_utm jsonb DEFAULT '{}'::jsonb,
  p_privacy_version text DEFAULT NULL,
  p_marketing_consent boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_protocol text;
BEGIN
  IF length(btrim(coalesce(p_full_name,''))) < 2 THEN
    RAISE EXCEPTION 'nome_invalido';
  END IF;
  IF length(btrim(coalesce(p_contact_value,''))) < 5 THEN
    RAISE EXCEPTION 'contato_invalido';
  END IF;
  IF length(btrim(coalesce(p_subject,''))) < 2 THEN
    RAISE EXCEPTION 'assunto_invalido';
  END IF;
  IF length(btrim(coalesce(p_message,''))) < 5 THEN
    RAISE EXCEPTION 'mensagem_invalida';
  END IF;
  IF coalesce(p_privacy_version,'') = '' THEN
    RAISE EXCEPTION 'privacidade_ausente';
  END IF;

  INSERT INTO public.contact_requests (
    full_name, contact_channel, contact_value, subject, message,
    source, entry_url, utm, privacy_version, marketing_consent
  ) VALUES (
    left(btrim(p_full_name), 160),
    left(btrim(p_contact_channel), 40),
    left(btrim(p_contact_value), 200),
    left(btrim(p_subject), 200),
    left(btrim(p_message), 4000),
    left(coalesce(p_source, 'site/contato'), 120),
    left(p_entry_url, 500),
    coalesce(p_utm, '{}'::jsonb),
    left(p_privacy_version, 60),
    coalesce(p_marketing_consent, false)
  )
  RETURNING protocol INTO v_protocol;

  RETURN v_protocol;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_lead(text,text,text,text,text,text,boolean,text,text,text,text,text,text,text,text,jsonb,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_contact_request(text,text,text,text,text,text,text,jsonb,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_lead(text,text,text,text,text,text,boolean,text,text,text,text,text,text,text,text,jsonb,text,boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_contact_request(text,text,text,text,text,text,text,jsonb,text,boolean) TO anon, authenticated;

-- Remove os registros de diagnóstico criados durante o teste técnico.
DELETE FROM public.contact_requests WHERE full_name IN ('diag anon','diag anon 2');