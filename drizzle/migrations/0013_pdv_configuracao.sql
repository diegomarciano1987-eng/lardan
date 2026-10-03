CREATE OR REPLACE FUNCTION public.pdv_gestao(_u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  select public.has_any_role(_u, array['master','diretoria']::app_role[]) $$;

CREATE TABLE public.pdv_unidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  location_id uuid NOT NULL UNIQUE REFERENCES public.locations(id),
  business_entity_id uuid REFERENCES public.business_entities(id),
  conta_dinheiro_id uuid REFERENCES public.financial_accounts(id),
  conta_cartao_id uuid REFERENCES public.financial_accounts(id),
  conta_pix_id uuid REFERENCES public.financial_accounts(id),
  regra_preco text NOT NULL DEFAULT 'preco_venda' CHECK (regra_preco in ('preco_venda','preco_loja')),
  desconto_max_operadora_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (desconto_max_operadora_pct between 0 and 100),
  desconto_max_supervisora_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (desconto_max_supervisora_pct between 0 and 100),
  reserva_minutos int NOT NULL DEFAULT 15 CHECK (reserva_minutos between 2 and 120),
  comissao_libera_em text NOT NULL DEFAULT 'venda_concluida' CHECK (comissao_libera_em in ('venda_concluida','recebivel_liquidado')),
  texto_comprovante text NOT NULL DEFAULT '',
  ativo boolean NOT NULL DEFAULT true,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.pdv_membros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id uuid NOT NULL REFERENCES public.pdv_unidades(id),
  user_id uuid NOT NULL,
  papel text NOT NULL CHECK (papel in ('operadora','supervisora','gestao')),
  vende boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unidade_id, user_id));

CREATE TABLE public.pdv_comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id uuid NOT NULL REFERENCES public.pdv_membros(id),
  percentual numeric(5,2) NOT NULL CHECK (percentual between 0 and 100),
  base text NOT NULL DEFAULT 'liquido_desconto' CHECK (base in ('liquido_desconto','bruto')),
  vigente_de date NOT NULL, vigente_ate date,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.pdv_metas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id uuid NOT NULL REFERENCES public.pdv_membros(id),
  periodo_de date NOT NULL, periodo_ate date NOT NULL CHECK (periodo_ate >= periodo_de),
  meta_cents bigint NOT NULL CHECK (meta_cents > 0),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.pdv_maquininhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id uuid NOT NULL REFERENCES public.pdv_unidades(id),
  nome text NOT NULL, adquirente text NOT NULL,
  max_parcelas int NOT NULL DEFAULT 1 CHECK (max_parcelas between 1 and 24),
  taxa_debito_pct numeric(5,2), taxa_credito_pct numeric(5,2),
  ativo boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.pdv_terminais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id uuid NOT NULL REFERENCES public.pdv_unidades(id),
  nome text NOT NULL, ativo boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unidade_id, nome));

CREATE TABLE public.pdv_config_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id uuid REFERENCES public.pdv_unidades(id),
  tabela text NOT NULL, registro_id uuid, acao text NOT NULL, dados jsonb,
  autor_id uuid, created_at timestamptz NOT NULL DEFAULT now());

GRANT SELECT ON public.pdv_unidades, public.pdv_membros, public.pdv_comissoes, public.pdv_metas, public.pdv_maquininhas, public.pdv_terminais, public.pdv_config_eventos TO authenticated;
GRANT INSERT, UPDATE ON public.pdv_unidades, public.pdv_membros, public.pdv_maquininhas, public.pdv_terminais TO authenticated;
GRANT INSERT ON public.pdv_comissoes, public.pdv_metas TO authenticated;
GRANT UPDATE (vigente_ate) ON public.pdv_comissoes TO authenticated;
GRANT ALL ON public.pdv_unidades, public.pdv_membros, public.pdv_comissoes, public.pdv_metas, public.pdv_maquininhas, public.pdv_terminais, public.pdv_config_eventos TO service_role;

CREATE OR REPLACE FUNCTION public.pdv_membro_de(_u uuid, _unidade uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  select exists(select 1 from pdv_membros where user_id=_u and unidade_id=_unidade and ativo) $$;

ALTER TABLE public.pdv_unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_membros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_comissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_maquininhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_terminais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_config_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY ler ON public.pdv_unidades FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()) or public.pdv_membro_de(auth.uid(), id));
CREATE POLICY gerir ON public.pdv_unidades FOR ALL TO authenticated USING (public.pdv_gestao(auth.uid())) WITH CHECK (public.pdv_gestao(auth.uid()));
CREATE POLICY ler ON public.pdv_membros FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()) or public.pdv_membro_de(auth.uid(), unidade_id));
CREATE POLICY gerir ON public.pdv_membros FOR ALL TO authenticated USING (public.pdv_gestao(auth.uid())) WITH CHECK (public.pdv_gestao(auth.uid()));
CREATE POLICY ler ON public.pdv_comissoes FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()) or exists(select 1 from pdv_membros m where m.id=membro_id and m.user_id=auth.uid()));
CREATE POLICY gerir ON public.pdv_comissoes FOR ALL TO authenticated USING (public.pdv_gestao(auth.uid())) WITH CHECK (public.pdv_gestao(auth.uid()));
CREATE POLICY ler ON public.pdv_metas FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()) or exists(select 1 from pdv_membros m where m.id=membro_id and m.user_id=auth.uid()));
CREATE POLICY gerir ON public.pdv_metas FOR ALL TO authenticated USING (public.pdv_gestao(auth.uid())) WITH CHECK (public.pdv_gestao(auth.uid()));
CREATE POLICY ler ON public.pdv_maquininhas FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()) or public.pdv_membro_de(auth.uid(), unidade_id));
CREATE POLICY gerir ON public.pdv_maquininhas FOR ALL TO authenticated USING (public.pdv_gestao(auth.uid())) WITH CHECK (public.pdv_gestao(auth.uid()));
CREATE POLICY ler ON public.pdv_terminais FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()) or public.pdv_membro_de(auth.uid(), unidade_id));
CREATE POLICY gerir ON public.pdv_terminais FOR ALL TO authenticated USING (public.pdv_gestao(auth.uid())) WITH CHECK (public.pdv_gestao(auth.uid()));
CREATE POLICY ler ON public.pdv_config_eventos FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()));

-- auditoria de toda alteração de configuração
CREATE OR REPLACE FUNCTION public.pdv_config_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb := to_jsonb(coalesce(NEW, OLD)); u uuid;
BEGIN
  u := coalesce((r->>'unidade_id')::uuid, case when TG_TABLE_NAME='pdv_unidades' then (r->>'id')::uuid end,
       (select m.unidade_id from pdv_membros m where m.id=(r->>'membro_id')::uuid));
  INSERT INTO pdv_config_eventos(unidade_id,tabela,registro_id,acao,dados,autor_id) VALUES(u,TG_TABLE_NAME,(r->>'id')::uuid,TG_OP,r,auth.uid());
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.pdv_unidades FOR EACH ROW EXECUTE FUNCTION public.pdv_config_audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.pdv_membros FOR EACH ROW EXECUTE FUNCTION public.pdv_config_audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.pdv_comissoes FOR EACH ROW EXECUTE FUNCTION public.pdv_config_audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.pdv_metas FOR EACH ROW EXECUTE FUNCTION public.pdv_config_audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.pdv_maquininhas FOR EACH ROW EXECUTE FUNCTION public.pdv_config_audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.pdv_terminais FOR EACH ROW EXECUTE FUNCTION public.pdv_config_audit();

-- lista de usuários do sistema para escolher (só gestão)
CREATE OR REPLACE FUNCTION public.pdv_usuarios_disponiveis() RETURNS TABLE(user_id uuid, nome text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.pdv_gestao(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN QUERY select p.id, coalesce(p.full_name,p.display_name,p.email)::text, p.email::text from profiles p where p.is_active order by 2;
END $$;
GRANT EXECUTE ON FUNCTION public.pdv_usuarios_disponiveis() TO authenticated;

-- estoque da unidade (somente leitura, gestão ou membros)
CREATE OR REPLACE FUNCTION public.pdv_estoque_resumo(_unidade uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE loc uuid; r jsonb;
BEGIN
  IF NOT (public.pdv_gestao(auth.uid()) or public.pdv_membro_de(auth.uid(), _unidade)) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  select location_id into loc from pdv_unidades where id=_unidade;
  select jsonb_build_object('skus', count(*) filter (where b.quantity>0), 'pecas', coalesce(sum(b.quantity) filter (where b.quantity>0),0)) into r
  from stock_balances b where b.location_id=loc;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.pdv_estoque_resumo(uuid) TO authenticated;

INSERT INTO public.pdv_unidades(nome, location_id) VALUES ('LOJA ETINERANTE', '0d3c8090-b9ec-4e51-b36c-3cc9609e1693') ON CONFLICT DO NOTHING;