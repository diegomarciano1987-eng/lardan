CREATE TABLE public.dossie_links (
  code text PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  representante_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  opened_count integer NOT NULL DEFAULT 0,
  last_opened_at timestamptz
);
CREATE INDEX dossie_links_lead_idx ON public.dossie_links(lead_id);
GRANT ALL ON public.dossie_links TO service_role;
ALTER TABLE public.dossie_links ENABLE ROW LEVEL SECURITY;