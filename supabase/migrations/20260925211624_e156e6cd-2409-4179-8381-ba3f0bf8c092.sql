-- ===== Convites de acesso =====
CREATE TABLE public.access_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  email text NOT NULL,
  roles public.app_role[] NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aceito','revogado','falha_envio')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  envios int NOT NULL DEFAULT 0,
  ultimo_envio_at timestamptz,
  ultimo_erro text,
  tentativas int NOT NULL DEFAULT 0,
  aceito_por uuid,
  aceito_at timestamptz,
  revogado_por uuid,
  revogado_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX access_invites_um_pendente ON public.access_invites(party_id) WHERE status IN ('pendente','falha_envio');
CREATE INDEX access_invites_email ON public.access_invites(lower(email));
GRANT SELECT ON public.access_invites TO authenticated;
GRANT ALL ON public.access_invites TO service_role;
ALTER TABLE public.access_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.access_invite_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.access_invites(id),
  evento text NOT NULL,
  actor_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.access_invite_events TO authenticated;
GRANT ALL ON public.access_invite_events TO service_role;
ALTER TABLE public.access_invite_events ENABLE ROW LEVEL SECURITY;

-- papéis que o RH (access.invite.colaborador) pode conceder: configurado pelo Master
CREATE TABLE public.access_grantable_roles (
  role public.app_role PRIMARY KEY,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.access_grantable_roles TO authenticated;
GRANT ALL ON public.access_grantable_roles TO service_role;
ALTER TABLE public.access_grantable_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "grantable_ler" ON public.access_grantable_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "grantable_master" ON public.access_grantable_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'master')) WITH CHECK (public.has_role(auth.uid(),'master'));

INSERT INTO public.role_capabilities(role, capability)
VALUES ('master','access.invite.consultora'),('master','access.invite.representante'),('master','access.invite.colaborador')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.access_pode_conceder(_uid uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT CASE
    WHEN public.has_role(_uid,'master') THEN true
    WHEN _role IN ('master','diretoria','financeiro','cobranca') THEN false
    WHEN _role = 'consultora' THEN public.has_capability(_uid,'access.invite.consultora')
    WHEN _role = 'representante' THEN public.has_capability(_uid,'access.invite.representante')
    ELSE public.has_capability(_uid,'access.invite.colaborador')
         AND EXISTS (SELECT 1 FROM public.access_grantable_roles g WHERE g.role = _role)
  END
$fn$;

CREATE OR REPLACE FUNCTION public.access_pode_ver_convites(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT public.has_role(_uid,'master') OR public.has_capability(_uid,'users.manage')
      OR public.has_capability(_uid,'access.invite.consultora')
      OR public.has_capability(_uid,'access.invite.representante')
      OR public.has_capability(_uid,'access.invite.colaborador')
$fn$;

CREATE POLICY "convites_ver" ON public.access_invites FOR SELECT TO authenticated
  USING (public.access_pode_ver_convites(auth.uid()));
CREATE POLICY "convite_eventos_ver" ON public.access_invite_events FOR SELECT TO authenticated
  USING (public.access_pode_ver_convites(auth.uid()));

-- ----- criar -----
CREATE OR REPLACE FUNCTION public.access_invite_create(_party uuid, _email text, _roles public.app_role[], _token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid := auth.uid(); r public.app_role; v_id uuid; em text := lower(btrim(coalesce(_email,'')));
  conflito text;
BEGIN
  IF uid IS NULL OR NOT public.access_pode_ver_convites(uid) THEN RAISE EXCEPTION 'Sem permissão para convidar.'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.'; END IF;
  IF _roles IS NULL OR array_length(_roles,1) IS NULL THEN RAISE EXCEPTION 'Escolha ao menos um papel.'; END IF;
  IF length(coalesce(_token_hash,'')) <> 64 THEN RAISE EXCEPTION 'Convite inválido.'; END IF;
  FOREACH r IN ARRAY _roles LOOP
    IF NOT public.access_pode_conceder(uid, r) THEN RAISE EXCEPTION 'Você não pode conceder o papel %.', r; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.parties WHERE id=_party) THEN RAISE EXCEPTION 'Cadastro inexistente.'; END IF;
  IF 'consultora' = ANY(_roles) AND NOT EXISTS (SELECT 1 FROM public.party_roles
       WHERE party_id=_party AND role='consultora') THEN
    RAISE EXCEPTION 'Só consultoras aprovadas (com papel de consultora no cadastro) podem ser convidadas como consultora.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('convite:' || _party));
  SELECT 'Esta pessoa já tem conta de acesso (' || coalesce(p.email,'sem e-mail') || ').' INTO conflito
    FROM public.profiles p WHERE p.party_id=_party;
  IF conflito IS NULL THEN
    SELECT 'Este e-mail já pertence à conta de outra pessoa.' INTO conflito
      FROM public.profiles p WHERE lower(p.email)=em AND p.party_id IS NOT NULL AND p.party_id<>_party
        AND NOT EXISTS (SELECT 1 FROM public.parties x WHERE x.id=p.party_id AND x.created_by=p.id);
  END IF;
  IF conflito IS NULL AND EXISTS (SELECT 1 FROM public.access_invites WHERE party_id=_party AND status IN ('pendente','falha_envio')) THEN
    conflito := 'Já existe convite pendente para esta pessoa. Use reenviar ou revogue antes.';
  END IF;
  IF conflito IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'conflito',conflito); END IF;
  INSERT INTO public.access_invites(party_id,email,roles,token_hash,created_by)
  VALUES (_party, em, _roles, _token_hash, uid) RETURNING id INTO v_id;
  INSERT INTO public.access_invite_events(invite_id,evento,actor_id,payload)
  VALUES (v_id,'criado',uid,jsonb_build_object('email',em,'roles',_roles,'party_id',_party));
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (uid,'access.invite.create','access_invites',v_id,jsonb_build_object('party_id',_party,'roles',_roles));
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $fn$;

-- ----- registrar envio (resultado real) -----
CREATE OR REPLACE FUNCTION public.access_invite_envio(_id uuid, _ok boolean, _erro text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.access_pode_ver_convites(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  UPDATE public.access_invites SET envios=envios+1, ultimo_envio_at=now(),
    status = CASE WHEN status IN ('pendente','falha_envio') THEN CASE WHEN _ok THEN 'pendente' ELSE 'falha_envio' END ELSE status END,
    ultimo_erro = CASE WHEN _ok THEN NULL ELSE left(_erro,300) END, updated_at=now()
   WHERE id=_id;
  INSERT INTO public.access_invite_events(invite_id,evento,actor_id,payload)
  VALUES (_id, CASE WHEN _ok THEN 'email_enviado' ELSE 'falha_envio' END, auth.uid(), jsonb_build_object('erro',left(_erro,300)));
END $fn$;

-- ----- reenviar: novo token invalida o anterior -----
CREATE OR REPLACE FUNCTION public.access_invite_resend(_id uuid, _token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE i public.access_invites; r public.app_role; uid uuid := auth.uid();
BEGIN
  SELECT * INTO i FROM public.access_invites WHERE id=_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Convite inexistente.'; END IF;
  FOREACH r IN ARRAY i.roles LOOP
    IF NOT public.access_pode_conceder(uid, r) THEN RAISE EXCEPTION 'Sem permissão para reenviar este convite.'; END IF;
  END LOOP;
  IF i.status NOT IN ('pendente','falha_envio') THEN RAISE EXCEPTION 'Convite já %.', i.status; END IF;
  IF i.envios >= 5 THEN RAISE EXCEPTION 'Limite de reenvios atingido. Revogue e crie um novo convite.'; END IF;
  IF i.ultimo_envio_at > now() - interval '1 minute' THEN RAISE EXCEPTION 'Aguarde um minuto para reenviar.'; END IF;
  IF length(coalesce(_token_hash,'')) <> 64 THEN RAISE EXCEPTION 'Convite inválido.'; END IF;
  UPDATE public.access_invites SET token_hash=_token_hash, expires_at=now()+interval '48 hours', tentativas=0, updated_at=now() WHERE id=_id;
  INSERT INTO public.access_invite_events(invite_id,evento,actor_id) VALUES (_id,'reenviado',uid);
  RETURN jsonb_build_object('id',_id,'email',i.email);
END $fn$;

-- ----- revogar -----
CREATE OR REPLACE FUNCTION public.access_invite_revoke(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE i public.access_invites; r public.app_role; uid uuid := auth.uid();
BEGIN
  SELECT * INTO i FROM public.access_invites WHERE id=_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Convite inexistente.'; END IF;
  FOREACH r IN ARRAY i.roles LOOP
    IF NOT public.access_pode_conceder(uid, r) THEN RAISE EXCEPTION 'Sem permissão para revogar este convite.'; END IF;
  END LOOP;
  IF i.status NOT IN ('pendente','falha_envio') THEN RAISE EXCEPTION 'Convite já %.', i.status; END IF;
  UPDATE public.access_invites SET status='revogado', revogado_por=uid, revogado_at=now(), updated_at=now() WHERE id=_id;
  INSERT INTO public.access_invite_events(invite_id,evento,actor_id) VALUES (_id,'revogado',uid);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload) VALUES (uid,'access.invite.revoke','access_invites',_id,'{}');
END $fn$;

-- ----- consulta pública pelo token (só dados mínimos) -----
CREATE OR REPLACE FUNCTION public.access_invite_preview(_token_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE i public.access_invites; nome text;
BEGIN
  SELECT * INTO i FROM public.access_invites WHERE token_hash=_token_hash;
  IF i.id IS NULL THEN RETURN jsonb_build_object('situacao','invalido'); END IF;
  SELECT display_name INTO nome FROM public.parties WHERE id=i.party_id;
  RETURN jsonb_build_object(
    'situacao', CASE WHEN i.status='aceito' THEN 'utilizado' WHEN i.status='revogado' THEN 'revogado'
                     WHEN i.expires_at < now() THEN 'expirado' WHEN i.tentativas >= 10 THEN 'bloqueado' ELSE 'valido' END,
    'nome', split_part(coalesce(nome,''),' ',1),
    'email_mascarado', left(split_part(i.email,'@',1),2) || '•••@' || split_part(i.email,'@',2),
    'papeis', i.roles, 'expira', i.expires_at);
END $fn$;

-- ----- aceite atômico -----
CREATE OR REPLACE FUNCTION public.access_invite_accept(_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid := auth.uid(); i public.access_invites; u record; pr public.profiles; r public.app_role;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Entre com sua conta para aceitar.'; END IF;
  SELECT * INTO i FROM public.access_invites WHERE token_hash=_token_hash FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Convite inválido.'; END IF;
  IF i.status='aceito' THEN
    IF i.aceito_por = uid THEN RETURN jsonb_build_object('ok',true,'repetido',true,'papeis',i.roles); END IF;
    RAISE EXCEPTION 'Este convite já foi utilizado.';
  END IF;
  IF i.status='revogado' THEN RAISE EXCEPTION 'Este convite foi revogado.'; END IF;
  IF i.expires_at < now() THEN RAISE EXCEPTION 'Este convite venceu. Peça um novo.'; END IF;
  IF i.tentativas >= 10 THEN RAISE EXCEPTION 'Convite bloqueado por tentativas. Peça um novo.'; END IF;
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

REVOKE ALL ON FUNCTION public.access_invite_create(uuid,text,public.app_role[],text), public.access_invite_envio(uuid,boolean,text),
  public.access_invite_resend(uuid,text), public.access_invite_revoke(uuid), public.access_invite_accept(text),
  public.access_invite_preview(text), public.access_pode_conceder(uuid,public.app_role), public.access_pode_ver_convites(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.access_invite_create(uuid,text,public.app_role[],text), public.access_invite_envio(uuid,boolean,text),
  public.access_invite_resend(uuid,text), public.access_invite_revoke(uuid), public.access_invite_accept(text),
  public.access_pode_conceder(uuid,public.app_role), public.access_pode_ver_convites(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.access_invite_preview(text) TO service_role;