CREATE OR REPLACE FUNCTION public.consultora_acesso_situacao(_party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); conta text; ativa boolean; inv record; em text; nome text; zap text;
BEGIN
  IF uid IS NULL OR NOT public.access_pode_ver_convites(uid) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
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
END $$;

CREATE OR REPLACE FUNCTION public.candidata_acesso_situacao(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); le public.leads; pid uuid; n int; etapa text;
BEGIN
  IF uid IS NULL OR NOT public.access_pode_ver_convites(uid) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  SELECT * INTO le FROM public.leads WHERE id=_lead;
  IF le.id IS NULL THEN RAISE EXCEPTION 'Candidatura inexistente.'; END IF;
  SELECT key INTO etapa FROM public.candidatura_stages WHERE id=le.stage_id;
  pid := le.party_id;
  IF pid IS NULL AND length(coalesce(le.cpf_digits,''))=11 THEN
    SELECT count(*), min(id::text)::uuid INTO n, pid FROM public.parties WHERE doc_digits=le.cpf_digits;
    IF n <> 1 THEN pid := NULL; END IF;
  END IF;
  RETURN jsonb_build_object('lead_id',le.id,'nome',le.full_name,'email',le.email,'whatsapp',le.whatsapp,
    'aprovada', (le.outcome='ganha' OR etapa IN ('aprovada','onboarding')),
    'acesso', CASE WHEN pid IS NULL THEN NULL ELSE public.consultora_acesso_situacao(pid) END);
END $$;

CREATE OR REPLACE FUNCTION public.consultora_ativar(_party uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); st text;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid,'registry.manage') THEN RAISE EXCEPTION 'Sem permissão para ativar consultoras.'; END IF;
  SELECT status::text INTO st FROM public.parties WHERE id=_party FOR UPDATE;
  IF st IS NULL THEN RAISE EXCEPTION 'Cadastro inexistente.'; END IF;
  IF st IN ('bloqueado','desligado') THEN RAISE EXCEPTION 'Cadastro %: desbloqueie antes de ativar.', st; END IF;
  INSERT INTO public.party_roles(party_id, role, status, started_at, created_by)
  VALUES (_party,'consultora','ativo',current_date,uid)
  ON CONFLICT (party_id, role) DO UPDATE SET status='ativo';
  INSERT INTO public.consultant_profiles(party_id, joined_at) VALUES (_party, current_date) ON CONFLICT (party_id) DO NOTHING;
  UPDATE public.parties SET status='ativo' WHERE id=_party AND status <> 'ativo';
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (uid,'consultora.ativar','parties',_party::text,jsonb_build_object('status_anterior',st));
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.candidata_preparar_acesso(_lead uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); s jsonb; pid uuid;
BEGIN
  IF uid IS NULL OR NOT public.access_pode_ver_convites(uid) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  PERFORM 1 FROM public.leads WHERE id=_lead FOR UPDATE;
  s := public.candidata_acesso_situacao(_lead);
  IF NOT (s->>'aprovada')::boolean THEN RAISE EXCEPTION 'Só candidaturas aprovadas recebem convite.'; END IF;
  pid := public.convert_lead_to_consultant(_lead, (s->'acesso'->>'party_id')::uuid);
  PERFORM public.consultora_ativar(pid);
  RETURN pid;
END $$;

REVOKE ALL ON FUNCTION public.consultora_acesso_situacao(uuid), public.candidata_acesso_situacao(uuid),
  public.consultora_ativar(uuid), public.candidata_preparar_acesso(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_acesso_situacao(uuid), public.candidata_acesso_situacao(uuid),
  public.consultora_ativar(uuid), public.candidata_preparar_acesso(uuid) TO authenticated;