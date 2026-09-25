CREATE OR REPLACE FUNCTION public.guard_profile_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE is_service boolean := auth.uid() IS NULL
  AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
BEGIN
  IF coalesce(current_setting('lardan.profile_link', true), 'off') = 'on' OR is_service THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- usuário comum não escolhe pessoa: o sistema cria uma pessoa própria
    NEW.party_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.party_id IS DISTINCT FROM OLD.party_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Vínculo entre usuário e pessoa só muda pela rotina administrativa.';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS aa_profiles_identity_ins ON public.profiles;
CREATE TRIGGER aa_profiles_identity_ins BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_identity();
DROP TRIGGER IF EXISTS aa_profiles_identity_upd ON public.profiles;
CREATE TRIGGER aa_profiles_identity_upd BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_identity();

CREATE OR REPLACE FUNCTION public.admin_vincular_usuario_pessoa(_user uuid, _party uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE antigo uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'Somente o Master pode vincular usuário a pessoa.';
  END IF;
  IF coalesce(length(trim(_motivo)),0) < 5 THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.parties WHERE id=_party) THEN RAISE EXCEPTION 'Pessoa inexistente.'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE party_id=_party AND id<>_user) THEN
    RAISE EXCEPTION 'Esta pessoa já está vinculada a outro usuário.';
  END IF;
  SELECT party_id INTO antigo FROM public.profiles WHERE id=_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário inexistente.'; END IF;
  PERFORM set_config('lardan.profile_link','on',true);
  UPDATE public.profiles SET party_id=_party WHERE id=_user;
  PERFORM set_config('lardan.profile_link','off',true);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (auth.uid(),'profile.vincular_pessoa','profiles',_user,
    jsonb_build_object('de',antigo,'para',_party,'motivo',_motivo));
  RETURN jsonb_build_object('usuario',_user,'de',antigo,'para',_party);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_vincular_usuario_pessoa(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vincular_usuario_pessoa(uuid,uuid,text) TO authenticated;