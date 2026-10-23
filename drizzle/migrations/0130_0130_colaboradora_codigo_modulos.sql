CREATE TABLE public.colab_acessos(
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  party_id uuid NOT NULL UNIQUE REFERENCES public.parties(id),
  codigo text NOT NULL UNIQUE CHECK (codigo ~ '^[0-9]{3,8}$'),
  ativo boolean NOT NULL DEFAULT true,
  falhas integer NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  criado_por uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.colab_acessos TO authenticated;
GRANT ALL ON public.colab_acessos TO service_role;
ALTER TABLE public.colab_acessos ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_capabilities(
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability text NOT NULL,
  granted_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, capability));
GRANT SELECT ON public.user_capabilities TO authenticated;
GRANT ALL ON public.user_capabilities TO service_role;
ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.colab_caps_permitidas() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT ARRAY['catalog.view','catalog.manage','product.manage','catalog.publish','product.publish','catalog.cost.view','stock.cost.view',
 'kit.view','kit.view.all','kit.manage','kit.ship','kit.receive','kit.acrescimo','kit.accept',
 'registry.view','registry.manage','partners.view','partners.manage',
 'stock.view','stock.operate','stock.reservation.view','stock.reservation.create','stock.reservation.confirm','stock.reservation.cancel',
 'imports.run','candidaturas.view','leads.view','candidaturas.edit','candidaturas.move','candidaturas.notes','candidaturas.followups','candidaturas.tags','candidaturas.assign',
 'site.manage','showcase.view','showcase.publish','network.aggregate.view',
 'collection.view','collection.operate','collection.negotiate','audit.view']::text[] $$;
REVOKE ALL ON FUNCTION public.colab_caps_permitidas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.colab_caps_permitidas() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_capability(_user_id uuid,_cap text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _user_id IS NOT NULL AND _user_id=auth.uid() AND EXISTS(SELECT 1 FROM profiles WHERE id=_user_id AND is_active)
 AND (EXISTS(SELECT 1 FROM user_roles ur JOIN role_capabilities rc ON rc.role=ur.role WHERE ur.user_id=_user_id AND rc.capability=_cap)
 OR (_cap LIKE 'finance.%' AND EXISTS(SELECT 1 FROM user_financial_access WHERE user_id=_user_id AND enabled) AND EXISTS(SELECT 1 FROM role_capabilities WHERE role='master' AND capability=_cap))
 OR (_cap = ANY(public.colab_caps_permitidas()) AND EXISTS(SELECT 1 FROM user_capabilities uc JOIN colab_acessos ca ON ca.user_id=uc.user_id AND ca.ativo WHERE uc.user_id=_user_id AND uc.capability=_cap)))
 AND (_cap !~ '^(finance\.|users\.|access\.)' OR public.access_mfa_ok()); $$;

CREATE POLICY colab_acessos_ler ON public.colab_acessos FOR SELECT TO authenticated
 USING (user_id = auth.uid() OR public.has_capability(auth.uid(),'users.manage'));
CREATE POLICY user_capabilities_ler ON public.user_capabilities FOR SELECT TO authenticated
 USING (user_id = auth.uid() OR public.has_capability(auth.uid(),'users.manage'));

CREATE OR REPLACE FUNCTION public.colab_exigir_master(_actor uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM user_roles ur JOIN profiles p ON p.id=ur.user_id AND p.is_active WHERE ur.user_id=_actor AND ur.role='master') THEN
  RAISE EXCEPTION 'Somente o Master pode criar acesso de colaboradora.';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.colab_exigir_master(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_exigir_master(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.colab_proximo_codigo() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT (greatest(1000, coalesce(max(codigo::bigint),1000)) + 1)::text FROM colab_acessos $$;
REVOKE ALL ON FUNCTION public.colab_proximo_codigo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_proximo_codigo() TO service_role;

CREATE OR REPLACE FUNCTION public.colab_acesso_registrar(_user_id uuid,_party_id uuid,_codigo text,_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE antes jsonb;
BEGIN
 PERFORM public.colab_exigir_master(_actor);
 IF NOT EXISTS(SELECT 1 FROM party_roles WHERE party_id=_party_id AND role='colaborador' AND ended_at IS NULL) THEN
  RAISE EXCEPTION 'Marque esta pessoa como colaboradora antes de criar o acesso.';
 END IF;
 IF EXISTS(SELECT 1 FROM colab_acessos WHERE codigo=_codigo AND user_id<>_user_id) THEN
  RAISE EXCEPTION 'Este código já é de outra colaboradora.';
 END IF;
 SELECT to_jsonb(c) INTO antes FROM colab_acessos c WHERE user_id=_user_id;
 INSERT INTO colab_acessos(user_id,party_id,codigo,criado_por) VALUES(_user_id,_party_id,_codigo,_actor)
 ON CONFLICT(user_id) DO UPDATE SET codigo=excluded.codigo, ativo=true, falhas=0, bloqueado_ate=NULL, updated_at=now();
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
 VALUES(_actor,'colab.acesso.salvar','colab_acessos',_user_id::text,jsonb_build_object('antes',antes,'codigo',_codigo,'party_id',_party_id));
END $$;
REVOKE ALL ON FUNCTION public.colab_acesso_registrar(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_acesso_registrar(uuid,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.colab_acesso_ativo_definir(_user_id uuid,_ativo boolean,_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.colab_exigir_master(_actor);
 UPDATE colab_acessos SET ativo=_ativo, falhas=0, bloqueado_ate=NULL, updated_at=now() WHERE user_id=_user_id;
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
 VALUES(_actor,'colab.acesso.ativo','colab_acessos',_user_id::text,jsonb_build_object('ativo',_ativo));
END $$;
REVOKE ALL ON FUNCTION public.colab_acesso_ativo_definir(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_acesso_ativo_definir(uuid,boolean,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.colab_modulos_definir(_user_id uuid,_caps text[],_financeiro boolean,_actor uuid) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE antes text[]; depois text[]; fora text[]; fin_antes boolean;
BEGIN
 PERFORM public.colab_exigir_master(_actor);
 IF NOT EXISTS(SELECT 1 FROM colab_acessos WHERE user_id=_user_id) THEN
  RAISE EXCEPTION 'Crie o código e a senha antes de escolher os módulos.';
 END IF;
 SELECT array_agg(c) INTO fora FROM unnest(coalesce(_caps,'{}')) c WHERE NOT (c = ANY(public.colab_caps_permitidas()));
 IF fora IS NOT NULL THEN RAISE EXCEPTION 'Permissão não liberável por módulo: %', array_to_string(fora,', '); END IF;
 SELECT coalesce(array_agg(capability ORDER BY capability),'{}') INTO antes FROM user_capabilities WHERE user_id=_user_id;
 DELETE FROM user_capabilities WHERE user_id=_user_id AND NOT (capability = ANY(coalesce(_caps,'{}')));
 INSERT INTO user_capabilities(user_id,capability,granted_by) SELECT DISTINCT _user_id,c,_actor FROM unnest(coalesce(_caps,'{}')) c ON CONFLICT DO NOTHING;
 SELECT coalesce(array_agg(capability ORDER BY capability),'{}') INTO depois FROM user_capabilities WHERE user_id=_user_id;
 SELECT coalesce((SELECT enabled FROM user_financial_access WHERE user_id=_user_id),false) INTO fin_antes;
 IF _financeiro IS NOT NULL AND _financeiro <> fin_antes THEN
  PERFORM public.access_financial_full_set(_user_id,_financeiro,_actor,'Módulo Financeiro no acesso da colaboradora');
 END IF;
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
 VALUES(_actor,'colab.modulos.definir','user_capabilities',_user_id::text,jsonb_build_object('antes',antes,'depois',depois,'financeiro',_financeiro));
 RETURN depois;
END $$;
REVOKE ALL ON FUNCTION public.colab_modulos_definir(uuid,text[],boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_modulos_definir(uuid,text[],boolean,uuid) TO service_role;