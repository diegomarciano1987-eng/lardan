-- ============================================================
-- CRM DE CANDIDATURAS — estrutura (aditiva)
-- ============================================================

-- 1. ETAPAS DO FUNIL -----------------------------------------
CREATE TABLE public.candidatura_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#8C7A5B',
  is_initial boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.candidatura_stages TO authenticated;
GRANT ALL ON public.candidatura_stages TO service_role;
ALTER TABLE public.candidatura_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stages_read" ON public.candidatura_stages FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.view'));

CREATE UNIQUE INDEX candidatura_stages_one_initial
  ON public.candidatura_stages ((is_initial)) WHERE is_initial;

-- 2. MOTIVOS DE PERDA ----------------------------------------
CREATE TABLE public.candidatura_lost_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  requires_note boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.candidatura_lost_reasons TO authenticated;
GRANT ALL ON public.candidatura_lost_reasons TO service_role;
ALTER TABLE public.candidatura_lost_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lost_reasons_read" ON public.candidatura_lost_reasons FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.view'));

-- 3. ETIQUETAS -----------------------------------------------
CREATE TABLE public.candidatura_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8C7A5B',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.candidatura_tags TO authenticated;
GRANT ALL ON public.candidatura_tags TO service_role;
ALTER TABLE public.candidatura_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags_read" ON public.candidatura_tags FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.view'));

-- 4. CANDIDATURA (evolução da tabela leads) ------------------
ALTER TABLE public.leads
  ADD COLUMN email text,
  ADD COLUMN whatsapp_norm text GENERATED ALWAYS AS (regexp_replace(coalesce(whatsapp,''), '\D', '', 'g')) STORED,
  ADD COLUMN email_norm text GENERATED ALWAYS AS (nullif(lower(btrim(coalesce(email,''))), '')) STORED,
  ADD COLUMN stage_id uuid REFERENCES public.candidatura_stages(id),
  ADD COLUMN stage_entered_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN outcome text NOT NULL DEFAULT 'aberta',
  ADD COLUMN lost_reason_id uuid REFERENCES public.candidatura_lost_reasons(id),
  ADD COLUMN lost_notes text,
  ADD COLUMN lost_at timestamptz,
  ADD COLUMN lost_by uuid,
  ADD COLUMN won_at timestamptz,
  ADD COLUMN won_by uuid,
  ADD COLUMN won_notes text,
  ADD COLUMN first_response_at timestamptz,
  ADD COLUMN last_contact_at timestamptz,
  ADD COLUMN next_followup_at timestamptz,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid,
  ADD COLUMN submissions_count integer NOT NULL DEFAULT 1,
  ADD COLUMN landing_page text,
  ADD COLUMN referrer text,
  ADD COLUMN first_referrer text,
  ADD COLUMN gclid text,
  ADD COLUMN fbclid text,
  ADD COLUMN msclkid text,
  ADD COLUMN ip inet,
  ADD COLUMN user_agent text,
  ADD COLUMN browser text,
  ADD COLUMN os text,
  ADD COLUMN device_type text,
  ADD COLUMN language text,
  ADD COLUMN source_normalized text NOT NULL DEFAULT 'nao_identificado',
  ADD COLUMN first_touch jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN last_touch jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_priority_ck CHECK (priority IN ('normal','alta','urgente')),
  ADD CONSTRAINT leads_outcome_ck CHECK (outcome IN ('aberta','ganha','perdida'));

CREATE INDEX leads_stage_idx ON public.leads (stage_id);
CREATE INDEX leads_outcome_idx ON public.leads (outcome);
CREATE INDEX leads_assigned_idx ON public.leads (assigned_to);
CREATE INDEX leads_created_desc_idx ON public.leads (created_at DESC);
CREATE INDEX leads_whatsapp_norm_idx ON public.leads (whatsapp_norm);
CREATE INDEX leads_email_norm_idx ON public.leads (email_norm);
CREATE INDEX leads_next_followup_idx ON public.leads (next_followup_at);
CREATE INDEX leads_source_idx ON public.leads (source_normalized);
CREATE INDEX leads_name_trgm_idx ON public.leads USING gin (full_name gin_trgm_ops);

-- 5. LINHA DO TEMPO (evolução de lead_events) ----------------
ALTER TABLE public.lead_events
  ADD COLUMN title text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX lead_events_lead_created_idx ON public.lead_events (lead_id, created_at DESC);

-- 6. HISTÓRICO DE ETAPAS -------------------------------------
CREATE TABLE public.candidatura_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES public.candidatura_stages(id),
  to_stage_id uuid NOT NULL REFERENCES public.candidatura_stages(id),
  actor_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.candidatura_stage_history TO authenticated;
GRANT ALL ON public.candidatura_stage_history TO service_role;
ALTER TABLE public.candidatura_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stage_history_read" ON public.candidatura_stage_history FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.view'));
CREATE INDEX candidatura_stage_history_lead_idx ON public.candidatura_stage_history (lead_id, created_at DESC);

-- 7. NOTAS INTERNAS ------------------------------------------
CREATE TABLE public.candidatura_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  body text NOT NULL,
  author_id uuid NOT NULL,
  edits_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.candidatura_notes TO authenticated;
GRANT ALL ON public.candidatura_notes TO service_role;
ALTER TABLE public.candidatura_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_read" ON public.candidatura_notes FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.view'));
CREATE INDEX candidatura_notes_lead_idx ON public.candidatura_notes (lead_id, created_at DESC);

CREATE TABLE public.candidatura_note_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.candidatura_notes(id) ON DELETE CASCADE,
  previous_body text NOT NULL,
  edited_by uuid NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.candidatura_note_revisions TO authenticated;
GRANT ALL ON public.candidatura_note_revisions TO service_role;
ALTER TABLE public.candidatura_note_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "note_revisions_read" ON public.candidatura_note_revisions FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.view'));

-- 8. FOLLOW-UPS ----------------------------------------------
CREATE TABLE public.candidatura_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  kind text NOT NULL DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'pendente',
  assigned_to uuid,
  note text,
  outcome_note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT followup_kind_ck CHECK (kind IN ('ligacao','whatsapp','retorno','documentacao','entrevista','analise','outro')),
  CONSTRAINT followup_status_ck CHECK (status IN ('pendente','concluido','cancelado'))
);
GRANT SELECT ON public.candidatura_followups TO authenticated;
GRANT ALL ON public.candidatura_followups TO service_role;
ALTER TABLE public.candidatura_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "followups_read" ON public.candidatura_followups FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.view'));
CREATE INDEX candidatura_followups_due_idx ON public.candidatura_followups (status, due_at);
CREATE INDEX candidatura_followups_lead_idx ON public.candidatura_followups (lead_id, due_at);
CREATE INDEX candidatura_followups_assigned_idx ON public.candidatura_followups (assigned_to, status, due_at);

-- 9. VÍNCULO DE ETIQUETAS ------------------------------------
CREATE TABLE public.candidatura_tag_links (
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.candidatura_tags(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, tag_id)
);
GRANT SELECT ON public.candidatura_tag_links TO authenticated;
GRANT ALL ON public.candidatura_tag_links TO service_role;
ALTER TABLE public.candidatura_tag_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tag_links_read" ON public.candidatura_tag_links FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.view'));

-- 10. ENVIOS DO FORMULÁRIO (nada é apagado) ------------------
CREATE TABLE public.candidatura_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  protocol text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  tracking jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  user_agent text,
  is_duplicate boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.candidatura_submissions TO authenticated;
GRANT ALL ON public.candidatura_submissions TO service_role;
ALTER TABLE public.candidatura_submissions ENABLE ROW LEVEL SECURITY;
-- dados técnicos (IP, user-agent) só para perfil autorizado
CREATE POLICY "submissions_read_pii" ON public.candidatura_submissions FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.pii.view'));
CREATE INDEX candidatura_submissions_lead_idx ON public.candidatura_submissions (lead_id, created_at DESC);

-- 11. AVALIAÇÕES (estrutura, sem motor) ----------------------
CREATE TABLE public.candidatura_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assessment_type text NOT NULL,
  status text NOT NULL DEFAULT 'nao_realizado',
  sent_at timestamptz,
  completed_at timestamptz,
  result_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_status_ck CHECK (status IN ('nao_realizado','enviado','em_andamento','concluido','cancelado'))
);
GRANT SELECT ON public.candidatura_assessments TO authenticated;
GRANT ALL ON public.candidatura_assessments TO service_role;
ALTER TABLE public.candidatura_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assessments_read" ON public.candidatura_assessments FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'candidaturas.view'));
CREATE INDEX candidatura_assessments_lead_idx ON public.candidatura_assessments (lead_id);

-- 12. VISÕES SALVAS ------------------------------------------
CREATE TABLE public.candidatura_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidatura_views TO authenticated;
GRANT ALL ON public.candidatura_views TO service_role;
ALTER TABLE public.candidatura_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "views_own" ON public.candidatura_views FOR ALL TO authenticated
  USING (user_id = auth.uid() OR (is_shared AND public.has_capability(auth.uid(), 'candidaturas.view')))
  WITH CHECK (user_id = auth.uid() AND public.has_capability(auth.uid(), 'candidaturas.view'));

-- 13. GATILHOS DE updated_at ---------------------------------
CREATE TRIGGER candidatura_stages_updated BEFORE UPDATE ON public.candidatura_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER candidatura_tags_updated BEFORE UPDATE ON public.candidatura_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER candidatura_lost_reasons_updated BEFORE UPDATE ON public.candidatura_lost_reasons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER candidatura_notes_updated BEFORE UPDATE ON public.candidatura_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER candidatura_followups_updated BEFORE UPDATE ON public.candidatura_followups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER candidatura_assessments_updated BEFORE UPDATE ON public.candidatura_assessments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER candidatura_views_updated BEFORE UPDATE ON public.candidatura_views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 14. DADOS INICIAIS -----------------------------------------
INSERT INTO public.candidatura_stages (key, name, sort_order, color, is_initial) VALUES
  ('nova',          'Nova candidatura', 10, '#2F6FED', true),
  ('primeiro',      'Primeiro contato', 20, '#0E9F9B', false),
  ('conversa',      'Em conversa',      30, '#8C7A5B', false),
  ('perfil',        'Perfil em análise',40, '#A96B2D', false),
  ('avaliacao',     'Avaliação',        50, '#7A4FB5', false),
  ('documentacao',  'Documentação',     60, '#C2872B', false),
  ('aprovada',      'Aprovada',         70, '#1F8A4C', false),
  ('onboarding',    'Onboarding',       80, '#0B7285', false);

INSERT INTO public.candidatura_lost_reasons (key, label, requires_note, sort_order) VALUES
  ('sem_retorno',      'Sem retorno',                        false, 10),
  ('desistiu',         'Desistiu',                           false, 20),
  ('sem_disp',         'Sem disponibilidade',                false, 30),
  ('perfil',           'Perfil não aderente',                false, 40),
  ('dados_invalidos',  'Dados inválidos',                    false, 50),
  ('regiao',           'Cidade/região ainda não atendida',   false, 60),
  ('nao_deseja',       'Não deseja mais',                    false, 70),
  ('duplicidade',      'Duplicidade',                        false, 80),
  ('outro',            'Outro',                              true,  90);

INSERT INTO public.candidatura_tags (slug, name, color) VALUES
  ('experiencia-vendas', 'Experiência em vendas', '#1F8A4C'),
  ('ja-vende-semijoias', 'Já vende semijoias',    '#A96B2D'),
  ('instagram',          'Instagram',             '#7A4FB5'),
  ('whatsapp',           'WhatsApp',              '#0E9F9B'),
  ('indicacao',          'Indicação',             '#2F6FED'),
  ('alta-prioridade',    'Alta prioridade',       '#C2402B'),
  ('retornar-depois',    'Retornar depois',       '#8C7A5B'),
  ('documentacao',       'Documentação',          '#C2872B'),
  ('perfil-comercial',   'Perfil comercial',      '#0B7285');

-- 15. MIGRAÇÃO DAS CANDIDATURAS EXISTENTES -------------------
-- Cada candidatura já registrada ganha etapa coerente com o status atual.
UPDATE public.leads SET
  stage_id = (SELECT id FROM public.candidatura_stages s WHERE s.key = CASE
      WHEN public.leads.status = 'novo' THEN 'nova'
      WHEN public.leads.status = 'em_analise' THEN 'perfil'
      WHEN public.leads.status = 'qualificado' THEN 'conversa'
      WHEN public.leads.status = 'aprovado' THEN 'aprovada'
      ELSE 'nova' END),
  outcome = CASE WHEN public.leads.status = 'aprovado' THEN 'ganha'
                 WHEN public.leads.status = 'recusado' THEN 'perdida'
                 ELSE 'aberta' END,
  archived_at = CASE WHEN public.leads.status = 'arquivado' THEN now() ELSE NULL END,
  stage_entered_at = created_at,
  landing_page = entry_url,
  source_normalized = CASE
      WHEN lower(coalesce(utm->>'utm_source','')) LIKE '%google%' THEN 'google'
      WHEN lower(coalesce(utm->>'utm_source','')) LIKE '%instagram%' THEN 'instagram'
      WHEN lower(coalesce(utm->>'utm_source','')) IN ('facebook','meta') THEN 'meta'
      WHEN lower(coalesce(utm->>'utm_source','')) IN ('chatgpt','openai') THEN 'chatgpt'
      WHEN coalesce(utm->>'utm_source','') <> '' THEN 'outro'
      ELSE 'nao_identificado' END,
  last_touch = jsonb_build_object('utm', utm, 'entry_url', entry_url)
WHERE stage_id IS NULL;

-- Registro de envio para cada candidatura já existente (sem perder nada)
INSERT INTO public.candidatura_submissions (lead_id, protocol, payload, tracking, created_at)
SELECT l.id, l.protocol,
       jsonb_build_object(
         'full_name', l.full_name, 'whatsapp', l.whatsapp, 'city', l.city, 'uf', l.uf,
         'financial_goal', l.financial_goal, 'availability', l.availability,
         'experience', l.experience, 'audience', l.audience, 'motivation', l.motivation),
       jsonb_build_object('utm', l.utm, 'entry_url', l.entry_url, 'source', l.source),
       l.created_at
FROM public.leads l
WHERE NOT EXISTS (SELECT 1 FROM public.candidatura_submissions s WHERE s.lead_id = l.id);

-- Etapa inicial obrigatória daqui em diante
ALTER TABLE public.leads ALTER COLUMN stage_id SET NOT NULL;

-- 16. PERMISSÕES ---------------------------------------------
INSERT INTO public.role_capabilities (role, capability)
SELECT r, c FROM unnest(ARRAY['master','diretoria']::app_role[]) r
CROSS JOIN unnest(ARRAY[
  'candidaturas.view','candidaturas.create','candidaturas.edit','candidaturas.move',
  'candidaturas.assign','candidaturas.notes','candidaturas.followups','candidaturas.tags',
  'candidaturas.mark_won','candidaturas.mark_lost','candidaturas.reopen','candidaturas.archive',
  'candidaturas.export','candidaturas.settings','candidaturas.pii.view'
]) c
ON CONFLICT DO NOTHING;

INSERT INTO public.role_capabilities (role, capability)
SELECT r, c FROM unnest(ARRAY['marketing','suporte']::app_role[]) r
CROSS JOIN unnest(ARRAY[
  'candidaturas.view','candidaturas.edit','candidaturas.move','candidaturas.assign',
  'candidaturas.notes','candidaturas.followups','candidaturas.tags',
  'candidaturas.mark_won','candidaturas.mark_lost'
]) c
ON CONFLICT DO NOTHING;