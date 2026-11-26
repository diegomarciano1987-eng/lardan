CREATE OR REPLACE FUNCTION public.caps_individuais_permitidas()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ SELECT ARRAY['candidaturas.mark_lost']::text[] $$;

CREATE OR REPLACE FUNCTION public.has_capability(_user_id uuid, _cap text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT _user_id IS NOT NULL AND _user_id=auth.uid() AND EXISTS(SELECT 1 FROM profiles WHERE id=_user_id AND is_active)
 AND (NOT public.colab_conta() OR (_cap NOT LIKE 'stock.%' AND EXISTS(SELECT 1 FROM colab_acessos WHERE user_id=_user_id AND ativo)))
 AND (EXISTS(SELECT 1 FROM user_roles ur JOIN role_capabilities rc ON rc.role=ur.role WHERE ur.user_id=_user_id AND rc.capability=_cap)
 OR (_cap LIKE 'finance.%' AND EXISTS(SELECT 1 FROM user_financial_access WHERE user_id=_user_id AND enabled) AND EXISTS(SELECT 1 FROM role_capabilities WHERE role='master' AND capability=_cap))
 OR (_cap = ANY(public.colab_caps_permitidas()) AND EXISTS(SELECT 1 FROM user_capabilities uc JOIN colab_acessos ca ON ca.user_id=uc.user_id AND ca.ativo WHERE uc.user_id=_user_id AND uc.capability=_cap))
 OR (_cap = ANY(public.caps_individuais_permitidas()) AND EXISTS(SELECT 1 FROM user_capabilities uc WHERE uc.user_id=_user_id AND uc.capability=_cap)))
 AND (_cap !~ '^(finance\.|users\.|access\.)' OR public.access_mfa_ok()); $function$;

-- Deixa _cap somente com _user: primeiro concede individual, depois retira de perfis e de outros usuários. Auditado.
CREATE OR REPLACE FUNCTION public.cap_exclusiva_definir(_cap text, _user uuid, _actor uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE antes jsonb; depois jsonb;
BEGIN
  IF NOT (_cap = ANY(public.caps_individuais_permitidas())) THEN RAISE EXCEPTION 'Permissão não liberável individualmente: %', _cap; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id=_actor AND role='master') THEN RAISE EXCEPTION 'Somente Master.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=_user AND is_active) THEN RAISE EXCEPTION 'Usuário inativo ou inexistente.'; END IF;
  IF coalesce(btrim(_motivo),'')='' THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  antes := jsonb_build_object(
    'perfis', (SELECT coalesce(jsonb_agg(role::text ORDER BY role::text),'[]') FROM role_capabilities WHERE capability=_cap),
    'usuarios', (SELECT coalesce(jsonb_agg(user_id ORDER BY user_id),'[]') FROM user_capabilities WHERE capability=_cap));
  INSERT INTO user_capabilities(user_id,capability,granted_by) VALUES (_user,_cap,_actor) ON CONFLICT DO NOTHING;
  DELETE FROM role_capabilities WHERE capability=_cap;
  DELETE FROM user_capabilities WHERE capability=_cap AND user_id<>_user;
  depois := jsonb_build_object(
    'perfis', (SELECT coalesce(jsonb_agg(role::text ORDER BY role::text),'[]') FROM role_capabilities WHERE capability=_cap),
    'usuarios', (SELECT coalesce(jsonb_agg(user_id ORDER BY user_id),'[]') FROM user_capabilities WHERE capability=_cap));
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (_actor,'access.cap_exclusiva','capability',_cap,jsonb_build_object('usuario',_user,'motivo',_motivo,'antes',antes,'depois',depois));
  RETURN jsonb_build_object('antes',antes,'depois',depois);
END $$;
REVOKE ALL ON FUNCTION public.cap_exclusiva_definir(text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cap_exclusiva_definir(text,uuid,uuid,text) TO service_role;