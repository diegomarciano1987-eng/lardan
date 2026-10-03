CREATE TABLE IF NOT EXISTS public.vendedora_profiles (
  party_id uuid PRIMARY KEY REFERENCES public.parties(id) ON DELETE CASCADE,
  unidade_base_id uuid REFERENCES public.pdv_unidades(id),
  admitida_em date,
  situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa','treinamento','afastada','desligada')),
  vinculo text CHECK (vinculo IN ('clt','pj','temporaria','estagio','outro')),
  comissao_padrao_pct numeric(5,2) CHECK (comissao_padrao_pct IS NULL OR (comissao_padrao_pct >= 0 AND comissao_padrao_pct <= 100)),
  meta_mensal_cents integer CHECK (meta_mensal_cents IS NULL OR meta_mensal_cents >= 0),
  tamanho_uniforme text,
  contato_emergencia_nome text,
  contato_emergencia_fone text,
  pix_key_type text,
  pix_key text,
  pix_holder text,
  bank_info text,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendedora_profiles TO authenticated;
GRANT ALL ON public.vendedora_profiles TO service_role;
ALTER TABLE public.vendedora_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendedora_profiles_read ON public.vendedora_profiles FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'registry.view') OR public.pdv_gestao(auth.uid()));
CREATE POLICY vendedora_profiles_write ON public.vendedora_profiles FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'registry.manage'))
  WITH CHECK (public.has_capability(auth.uid(),'registry.manage'));
DROP TRIGGER IF EXISTS trg_vendedora_profiles_audit ON public.vendedora_profiles;
CREATE TRIGGER trg_vendedora_profiles_audit AFTER INSERT OR UPDATE OR DELETE ON public.vendedora_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- usuária é vendedora interna ativa?
CREATE OR REPLACE FUNCTION public.e_vendedora_interna(_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles pr
    JOIN parties p ON p.id = pr.party_id
    JOIN party_roles r ON r.party_id = p.id AND r.role = 'vendedora_interna'
    LEFT JOIN vendedora_profiles v ON v.party_id = p.id
    WHERE pr.id = _user AND pr.is_active
      AND r.ended_at IS NULL AND r.status NOT IN ('bloqueado','inativo','desligado')
      AND p.status NOT IN ('bloqueado','inativo','desligado')
      AND coalesce(v.situacao,'ativa') <> 'desligada')
$$;
GRANT EXECUTE ON FUNCTION public.e_vendedora_interna(uuid) TO authenticated, service_role;

-- trava: só vendedora interna entra na equipe que vende (gestão que não vende fica isenta)
CREATE OR REPLACE FUNCTION public.pdv_membro_exige_vendedora() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.ativo AND (NEW.papel <> 'gestao' OR NEW.vende) AND NOT public.e_vendedora_interna(NEW.user_id) THEN
    RAISE EXCEPTION 'Só vendedoras internas ativas podem fazer parte da equipe da loja. Cadastre a pessoa como Vendedora interna na Central de Cadastros.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pdv_membro_vendedora ON public.pdv_membros;
CREATE TRIGGER trg_pdv_membro_vendedora BEFORE INSERT OR UPDATE OF user_id, papel, vende, ativo ON public.pdv_membros
  FOR EACH ROW EXECUTE FUNCTION public.pdv_membro_exige_vendedora();

-- seletor da equipe lista apenas vendedoras internas com login
CREATE OR REPLACE FUNCTION public.pdv_usuarios_disponiveis() RETURNS TABLE(user_id uuid, nome text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.pdv_gestao(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN QUERY select p.id, coalesce(p.full_name,p.display_name,p.email)::text, p.email::text
    from profiles p where p.is_active and public.e_vendedora_interna(p.id) order by 2;
END $$;
GRANT EXECUTE ON FUNCTION public.pdv_usuarios_disponiveis() TO authenticated;