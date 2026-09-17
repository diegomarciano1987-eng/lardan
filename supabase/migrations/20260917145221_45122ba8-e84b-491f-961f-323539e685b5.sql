-- O formulário público agora entra apenas por submit_candidatura (SECURITY DEFINER).
DROP POLICY IF EXISTS "leads_public_insert" ON public.leads;
REVOKE INSERT ON public.leads FROM anon;

-- Atualização automática do quadro (a RLS continua valendo para cada usuário).
ALTER TABLE public.leads REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'leads'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.leads';
  END IF;
END $$;