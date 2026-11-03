CREATE OR REPLACE FUNCTION public.access_rep_da_carteira(_uid uuid, _party uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND _uid = auth.uid() AND public.has_role(_uid,'representante')
    AND EXISTS (SELECT 1 FROM public.consultant_profiles c JOIN public.party_roles pr ON pr.party_id=c.party_id AND pr.role='consultora'
                WHERE c.party_id=_party AND c.representative_party_id = public.my_party_id())
$$;
REVOKE EXECUTE ON FUNCTION public.access_rep_da_carteira(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consultora_acesso_situacao(_party uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); conta text; ativa boolean; inv record; em text; nome text; zap text;
BEGIN
  IF uid IS NULL OR NOT (public.access_pode_ver_convites(uid) OR public.access_rep_da_carteira(uid,_party)) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  SELECT display_name INTO nome FROM public.parties WHERE id=_party;
  IF nome IS NULL THEN RAISE EXCEPTION 'Cadastro inexistente.'; END IF;
  SELECT email INTO conta FROM public.profiles WHERE party_id=_party LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM public.party_roles WHERE party_id=_party AND role='consultora' AND status='ativo') INTO ativa;
  SELECT value INTO em FROM public.contact_points WHERE party_id=_party AND kind='email' ORDER BY is_primary DESC NULLS LAST LIMIT 1;
  SELECT value INTO zap FROM public.contact_points WHERE party_id=_party AND kind='whatsapp' ORDER BY is_primary DESC NULLS LAST LIMIT 1;
  SELECT id, email, CASE WHEN status IN ('pendente','falha_envio') AND expires_at < now() THEN 'expirado' ELSE status END AS status,
         expires_at, envios, ultimo_envio_at, ultimo_erro, aceito_at
    INTO inv FROM public.access_invites WHERE party_id=_party ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('party_id',_party,'nome',nome,'conta_email',conta,'consultora_ativa',ativa,
    'email',coalesce(inv.email, em),'whatsapp',zap,
    'convite', CASE WHEN inv.id IS NULL THEN NULL ELSE jsonb_build_object('id',inv.id,'email',inv.email,'status',inv.status,
      'expira',inv.expires_at,'envios',inv.envios,'ultimo_envio',inv.ultimo_envio_at,'erro',inv.ultimo_erro,'aceito_em',inv.aceito_at) END);
END $function$;

CREATE OR REPLACE FUNCTION public.access_invite_create(_party uuid, _email text, _roles app_role[], _token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); r public.app_role; v_id uuid; em text := lower(btrim(coalesce(_email,'')));
  conflito text;
BEGIN
  IF uid IS NULL OR NOT (public.access_pode_ver_convites(uid) OR public.access_rep_da_carteira(uid,_party)) THEN RAISE EXCEPTION 'Sem permissão para convidar.'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.'; END IF;
  IF _roles IS NULL OR array_length(_roles,1) IS NULL THEN RAISE EXCEPTION 'Escolha ao menos um papel.'; END IF;
  IF length(coalesce(_token_hash,'')) <> 64 THEN RAISE EXCEPTION 'Convite inválido.'; END IF;
  FOREACH r IN ARRAY _roles LOOP
    IF NOT (public.access_pode_conceder(uid, r) OR (r='consultora' AND public.access_rep_da_carteira(uid,_party))) THEN RAISE EXCEPTION 'Você não pode conceder o papel %.', r; END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.access_invite_resend(_id uuid, _token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i public.access_invites; r public.app_role; uid uuid := auth.uid();
BEGIN
  SELECT * INTO i FROM public.access_invites WHERE id=_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Convite inexistente.'; END IF;
  FOREACH r IN ARRAY i.roles LOOP
    IF NOT (public.access_pode_conceder(uid, r) OR (r='consultora' AND public.access_rep_da_carteira(uid,i.party_id))) THEN RAISE EXCEPTION 'Sem permissão para reenviar este convite.'; END IF;
  END LOOP;
  IF i.status NOT IN ('pendente','falha_envio') THEN RAISE EXCEPTION 'Convite já %.', i.status; END IF;
  IF i.envios >= 5 THEN RAISE EXCEPTION 'Limite de reenvios atingido. Revogue e crie um novo convite.'; END IF;
  IF i.ultimo_envio_at > now() - interval '1 minute' THEN RAISE EXCEPTION 'Aguarde um minuto para reenviar.'; END IF;
  IF length(coalesce(_token_hash,'')) <> 64 THEN RAISE EXCEPTION 'Convite inválido.'; END IF;
  UPDATE public.access_invites SET token_hash=_token_hash, expires_at=now()+interval '48 hours', tentativas=0, updated_at=now() WHERE id=_id;
  INSERT INTO public.access_invite_events(invite_id,evento,actor_id) VALUES (_id,'reenviado',uid);
  RETURN jsonb_build_object('id',_id,'email',i.email);
END $function$;

CREATE OR REPLACE FUNCTION public.access_invite_revoke(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i public.access_invites; r public.app_role; uid uuid := auth.uid();
BEGIN
  SELECT * INTO i FROM public.access_invites WHERE id=_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Convite inexistente.'; END IF;
  FOREACH r IN ARRAY i.roles LOOP
    IF NOT (public.access_pode_conceder(uid, r) OR (r='consultora' AND public.access_rep_da_carteira(uid,i.party_id))) THEN RAISE EXCEPTION 'Sem permissão para revogar este convite.'; END IF;
  END LOOP;
  IF i.status NOT IN ('pendente','falha_envio') THEN RAISE EXCEPTION 'Convite já %.', i.status; END IF;
  UPDATE public.access_invites SET status='revogado', revogado_por=uid, revogado_at=now(), updated_at=now() WHERE id=_id;
  INSERT INTO public.access_invite_events(invite_id,evento,actor_id) VALUES (_id,'revogado',uid);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload) VALUES (uid,'access.invite.revoke','access_invites',_id,'{}');
END $function$;

CREATE OR REPLACE FUNCTION public.access_invite_envio(_id uuid, _ok boolean, _erro text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.access_pode_ver_convites(auth.uid()) OR public.access_rep_da_carteira(auth.uid(), (SELECT x.party_id FROM public.access_invites x WHERE x.id=_id))) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  UPDATE public.access_invites SET envios=envios+1, ultimo_envio_at=now(),
    status = CASE WHEN status IN ('pendente','falha_envio') THEN CASE WHEN _ok THEN 'pendente' ELSE 'falha_envio' END ELSE status END,
    ultimo_erro = CASE WHEN _ok THEN NULL ELSE left(_erro,300) END, updated_at=now()
   WHERE id=_id;
  INSERT INTO public.access_invite_events(invite_id,evento,actor_id,payload)
  VALUES (_id, CASE WHEN _ok THEN 'email_enviado' ELSE 'falha_envio' END, auth.uid(), jsonb_build_object('erro',left(_erro,300)));
END $function$;

CREATE OR REPLACE FUNCTION public.rep_convites_lista(_rep uuid, _busca text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE termo text := nullif(btrim(coalesce(_busca,'')),''); r jsonb;
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem acesso a esta carteira.'; END IF;
  WITH base AS (
    SELECT p.id, p.code, p.display_name AS nome, p.status::text AS status,
      (SELECT a.city||'/'||a.uf FROM public.party_addresses a WHERE a.party_id=p.id ORDER BY a.is_primary DESC NULLS LAST LIMIT 1) AS cidade,
      (SELECT cp.value FROM public.contact_points cp WHERE cp.party_id=p.id AND cp.kind='whatsapp' ORDER BY cp.is_primary DESC NULLS LAST LIMIT 1) AS whatsapp,
      (SELECT pf.email FROM public.profiles pf WHERE pf.party_id=p.id LIMIT 1) AS conta_email,
      (SELECT CASE WHEN i.status IN ('pendente','falha_envio') AND i.expires_at < now() THEN 'expirado' ELSE i.status END
         FROM public.access_invites i WHERE i.party_id=p.id ORDER BY i.created_at DESC LIMIT 1) AS convite
    FROM public.consultant_profiles c JOIN public.parties p ON p.id=c.party_id
    WHERE c.representative_party_id=_rep
      AND EXISTS (SELECT 1 FROM public.party_roles pr WHERE pr.party_id=p.id AND pr.role='consultora')
      AND (termo IS NULL OR public.fin_unaccent_lower(p.display_name) LIKE '%'||public.fin_unaccent_lower(termo)||'%' OR p.code ILIKE '%'||termo||'%')
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM base),
    'com_acesso',(SELECT count(*) FROM base WHERE conta_email IS NOT NULL),
    'itens', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM base ORDER BY (conta_email IS NOT NULL), (status<>'ativo'), nome LIMIT 300) x),'[]'::jsonb)) INTO r;
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.rep_convites_lista(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_convites_lista(uuid,text) TO authenticated;