CREATE TABLE public.access_security_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mfa_obrigatorio boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.access_security_settings DEFAULT VALUES;
GRANT SELECT ON public.access_security_settings TO authenticated;
GRANT ALL ON public.access_security_settings TO service_role;
ALTER TABLE public.access_security_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seg_ler" ON public.access_security_settings FOR SELECT TO authenticated USING (true);

-- segundo fator: vale quando a exigência está ligada
CREATE OR REPLACE FUNCTION public.access_mfa_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT NOT coalesce((SELECT mfa_obrigatorio FROM public.access_security_settings), false)
      OR coalesce(auth.jwt()->>'aal','') = 'aal2'
$fn$;

CREATE OR REPLACE FUNCTION public.has_capability(_user_id uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT _user_id IS NOT NULL
     AND _user_id = auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.user_roles ur
       JOIN public.role_capabilities rc ON rc.role = ur.role
       JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.user_id = _user_id AND rc.capability = _cap AND p.is_active
     )
     AND (_cap !~ '^(finance\.|users\.|access\.)' OR public.access_mfa_ok());
$fn$;

-- Master liga/desliga a exigência; só liga se todos os administradores privilegiados já cadastraram
CREATE OR REPLACE FUNCTION public.access_mfa_exigir(_ligar boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE faltam text[];
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'Somente o Master.'; END IF;
  IF _ligar THEN
    IF coalesce(auth.jwt()->>'aal','') <> 'aal2' THEN RAISE EXCEPTION 'Entre com o autenticador antes de ligar a exigência.'; END IF;
    SELECT array_agg(DISTINCT coalesce(p.email,p.id::text)) INTO faltam
      FROM public.user_roles ur JOIN public.role_capabilities rc ON rc.role=ur.role
      JOIN public.profiles p ON p.id=ur.user_id AND p.is_active
     WHERE rc.capability ~ '^(finance\.|users\.|access\.)'
       AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=ur.user_id AND f.status='verified');
    IF faltam IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'faltam',faltam); END IF;
  END IF;
  UPDATE public.access_security_settings SET mfa_obrigatorio=_ligar, updated_by=auth.uid(), updated_at=now();
  INSERT INTO public.audit_logs(actor_id,action,entity,payload) VALUES (auth.uid(),'access.mfa.exigir','access_security_settings',jsonb_build_object('ligado',_ligar));
  RETURN jsonb_build_object('ok',true);
END $fn$;

-- quem administra acessos/financeiro e se já tem autenticador (visão do Master)
CREATE OR REPLACE FUNCTION public.access_mfa_situacao()
RETURNS TABLE(user_id uuid, email text, tem_autenticador boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'Somente o Master.'; END IF;
  RETURN QUERY SELECT DISTINCT p.id, p.email,
    EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=p.id AND f.status='verified')
  FROM public.user_roles ur JOIN public.role_capabilities rc ON rc.role=ur.role
  JOIN public.profiles p ON p.id=ur.user_id AND p.is_active
  WHERE rc.capability ~ '^(finance\.|users\.|access\.)';
END $fn$;

-- escopo: cada responsável vê só convites cujos papéis ele pode conceder
DROP POLICY IF EXISTS "convites_ver" ON public.access_invites;
CREATE POLICY "convites_ver" ON public.access_invites FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'master')
      OR (public.access_pode_ver_convites(auth.uid())
          AND NOT EXISTS (SELECT 1 FROM unnest(roles) r WHERE NOT public.access_pode_conceder(auth.uid(), r))));
DROP POLICY IF EXISTS "convite_eventos_ver" ON public.access_invite_events;
CREATE POLICY "convite_eventos_ver" ON public.access_invite_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.access_invites i WHERE i.id=invite_id));

CREATE OR REPLACE FUNCTION public.access_pode_ver_convites(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT public.has_role(_uid,'master')
      OR public.has_capability(_uid,'access.invite.consultora')
      OR public.has_capability(_uid,'access.invite.representante')
      OR public.has_capability(_uid,'access.invite.colaborador')
$fn$;

-- link vazado: e-mail errado não bloqueia mais o convite; limita por conta que tenta
CREATE OR REPLACE FUNCTION public.access_invite_accept(_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid := auth.uid(); i public.access_invites; u record; pr public.profiles; r public.app_role;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Entre com sua conta para aceitar.'; END IF;
  IF (SELECT count(*) FROM public.access_invite_events WHERE actor_id=uid AND evento='email_divergente' AND created_at > now()-interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Muitas tentativas desta conta. Aguarde uma hora.';
  END IF;
  SELECT * INTO i FROM public.access_invites WHERE token_hash=_token_hash FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Convite inválido.'; END IF;
  IF i.status='aceito' THEN
    IF i.aceito_por = uid THEN RETURN jsonb_build_object('ok',true,'repetido',true,'papeis',i.roles); END IF;
    RAISE EXCEPTION 'Este convite já foi utilizado.';
  END IF;
  IF i.status='revogado' THEN RAISE EXCEPTION 'Este convite foi revogado.'; END IF;
  IF i.expires_at < now() THEN RAISE EXCEPTION 'Este convite venceu. Peça um novo.'; END IF;
  SELECT email, email_confirmed_at INTO u FROM auth.users WHERE id=uid;
  IF u.email_confirmed_at IS NULL THEN RAISE EXCEPTION 'Confirme seu e-mail antes de aceitar.'; END IF;
  IF lower(u.email) <> i.email THEN
    UPDATE public.access_invites SET tentativas=tentativas+1 WHERE id=i.id;
    INSERT INTO public.access_invite_events(invite_id,evento,actor_id) VALUES (i.id,'email_divergente',uid);
    RETURN jsonb_build_object('ok',false,'erro','Este convite foi enviado para outro e-mail.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE party_id=i.party_id AND id<>uid) THEN
    RAISE EXCEPTION 'Esta pessoa já está ligada a outra conta.';
  END IF;
  SELECT * INTO pr FROM public.profiles WHERE id=uid FOR UPDATE;
  PERFORM set_config('lardan.profile_link','on',true);
  IF pr.id IS NULL THEN
    INSERT INTO public.profiles(id,email,full_name,party_id)
    SELECT uid, u.email, display_name, i.party_id FROM public.parties WHERE id=i.party_id;
  ELSIF pr.party_id IS DISTINCT FROM i.party_id THEN
    IF pr.party_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.parties WHERE id=pr.party_id AND created_by=uid) THEN
      PERFORM set_config('lardan.profile_link','off',true);
      RAISE EXCEPTION 'Sua conta já está ligada a outro cadastro. Fale com a Lardan.';
    END IF;
    UPDATE public.profiles SET party_id=i.party_id WHERE id=uid;
  END IF;
  PERFORM set_config('lardan.profile_link','off',true);
  FOREACH r IN ARRAY i.roles LOOP
    INSERT INTO public.user_roles(user_id, role, granted_by) VALUES (uid, r, i.created_by) ON CONFLICT DO NOTHING;
  END LOOP;
  UPDATE public.access_invites SET status='aceito', aceito_por=uid, aceito_at=now(), updated_at=now() WHERE id=i.id;
  INSERT INTO public.access_invite_events(invite_id,evento,actor_id) VALUES (i.id,'aceito',uid);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (uid,'access.invite.accept','access_invites',i.id,jsonb_build_object('party_id',i.party_id,'roles',i.roles,'de_party',pr.party_id));
  RETURN jsonb_build_object('ok',true,'repetido',false,'papeis',i.roles);
END $fn$;

CREATE OR REPLACE FUNCTION public.access_invite_preview(_token_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE i public.access_invites; nome text;
BEGIN
  SELECT * INTO i FROM public.access_invites WHERE token_hash=_token_hash;
  IF i.id IS NULL THEN RETURN jsonb_build_object('situacao','invalido'); END IF;
  SELECT display_name INTO nome FROM public.parties WHERE id=i.party_id;
  RETURN jsonb_build_object(
    'situacao', CASE WHEN i.status='aceito' THEN 'utilizado' WHEN i.status='revogado' THEN 'revogado'
                     WHEN i.expires_at < now() THEN 'expirado' ELSE 'valido' END,
    'nome', split_part(coalesce(nome,''),' ',1),
    'email_mascarado', left(split_part(i.email,'@',1),2) || '•••@' || split_part(i.email,'@',2),
    'papeis', i.roles, 'expira', i.expires_at);
END $fn$;

REVOKE ALL ON FUNCTION public.access_mfa_exigir(boolean), public.access_mfa_situacao(), public.access_mfa_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.access_mfa_exigir(boolean), public.access_mfa_situacao(), public.access_mfa_ok() TO authenticated;
REVOKE ALL ON FUNCTION public.access_invite_preview(text) FROM PUBLIC, anon, authenticated;