CREATE TABLE public.pdv_login_codigos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id uuid NOT NULL REFERENCES public.pdv_unidades(id),
  membro_id uuid NOT NULL REFERENCES public.pdv_membros(id),
  codigo_hash text NOT NULL,
  tentativas int NOT NULL DEFAULT 0,
  expira_em timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  usado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.pdv_login_codigos(membro_id, created_at);
GRANT SELECT ON public.pdv_login_codigos TO authenticated;
GRANT ALL ON public.pdv_login_codigos TO service_role;
ALTER TABLE public.pdv_login_codigos ENABLE ROW LEVEL SECURITY;
CREATE POLICY gestao_le ON public.pdv_login_codigos FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()));
REVOKE SELECT (codigo_hash) ON public.pdv_login_codigos FROM authenticated;

ALTER TABLE public.pdv_sessoes ADD COLUMN IF NOT EXISTS login_membro_id uuid REFERENCES public.pdv_membros(id);

CREATE OR REPLACE FUNCTION public.pdv_entrar_iniciar(_numero text, _senha text, _email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE u pdv_unidades; m pdv_membros; em text; falhas int; envios int; cod text; did uuid;
BEGIN
  SELECT count(*) INTO falhas FROM pdv_login_tentativas WHERE numero=_numero AND NOT ok AND tipo='loja' AND created_at > now()-interval '15 minutes';
  IF falhas >= 5 THEN RAISE EXCEPTION 'Muitas tentativas. Aguarde 15 minutos.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE numero=_numero AND ativo;
  IF u.id IS NULL OR u.senha_hash IS NULL OR u.senha_hash <> crypt(coalesce(_senha,''), u.senha_hash) THEN
    INSERT INTO pdv_login_tentativas(numero,ok) VALUES (coalesce(_numero,''),false);
    RAISE EXCEPTION 'Número da loja ou senha incorretos.';
  END IF;
  SELECT pm.*, au.email INTO m.id, m.unidade_id, m.user_id, m.papel, m.vende, m.ativo, m.created_by, m.created_at, m.updated_at, em
    FROM pdv_membros pm JOIN auth.users au ON au.id=pm.user_id
   WHERE pm.unidade_id=u.id AND pm.ativo AND lower(au.email)=lower(trim(coalesce(_email,''))) LIMIT 1;
  IF m.id IS NULL THEN
    INSERT INTO pdv_login_tentativas(numero,ok) VALUES (_numero,false);
    RAISE EXCEPTION 'Este e-mail não faz parte da equipe desta loja.';
  END IF;
  SELECT count(*) INTO envios FROM pdv_login_codigos WHERE membro_id=m.id AND created_at > now()-interval '15 minutes';
  IF envios >= 5 THEN RAISE EXCEPTION 'Muitos códigos pedidos. Aguarde 15 minutos.'; END IF;
  UPDATE pdv_login_codigos SET usado_em=now() WHERE membro_id=m.id AND usado_em IS NULL;
  cod := lpad((floor(random()*1000000))::int::text, 6, '0');
  INSERT INTO pdv_login_codigos(unidade_id,membro_id,codigo_hash) VALUES (u.id,m.id,crypt(cod,gen_salt('bf'))) RETURNING id INTO did;
  RETURN jsonb_build_object('desafio',did,'codigo',cod,'email',em,'nome',public.pdv_nome_usuario(m.user_id),'unidade',u.nome,'numero',u.numero);
END $$;

CREATE OR REPLACE FUNCTION public.pdv_entrar_confirmar(_desafio uuid, _codigo text, _token_hash text, _ua text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE c pdv_login_codigos; u pdv_unidades; m pdv_membros;
BEGIN
  SELECT * INTO c FROM pdv_login_codigos WHERE id=_desafio FOR UPDATE;
  IF c.id IS NULL OR c.usado_em IS NOT NULL OR c.expira_em < now() THEN RAISE EXCEPTION 'Código expirado. Peça um novo.'; END IF;
  IF c.tentativas >= 5 THEN RAISE EXCEPTION 'Código bloqueado por tentativas. Peça um novo.'; END IF;
  IF c.codigo_hash <> crypt(coalesce(_codigo,''), c.codigo_hash) THEN
    UPDATE pdv_login_codigos SET tentativas=tentativas+1 WHERE id=c.id;
    RETURN jsonb_build_object('ok',false,'erro','Código incorreto.');
  END IF;
  SELECT * INTO u FROM pdv_unidades WHERE id=c.unidade_id AND ativo;
  SELECT * INTO m FROM pdv_membros WHERE id=c.membro_id AND ativo;
  IF u.id IS NULL OR m.id IS NULL THEN RAISE EXCEPTION 'Acesso não está mais liberado.'; END IF;
  UPDATE pdv_login_codigos SET usado_em=now() WHERE id=c.id;
  INSERT INTO pdv_login_tentativas(numero,ok) VALUES (u.numero,true);
  INSERT INTO pdv_sessoes(unidade_id,token_hash,user_agent,login_membro_id,membro_id)
    VALUES (u.id,_token_hash,left(_ua,300),m.id,CASE WHEN m.vende OR m.papel<>'gestao' THEN m.id END);
  RETURN jsonb_build_object('ok',true,'unidade',u.nome,'numero',u.numero);
END $$;

REVOKE ALL ON FUNCTION public.pdv_entrar_iniciar(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pdv_entrar_confirmar(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_entrar_iniciar(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pdv_entrar_confirmar(uuid,text,text,text) TO service_role;
-- entrada antiga (só número+senha) desligada: agora exige código por e-mail
REVOKE ALL ON FUNCTION public.pdv_entrar(text,text,text,text) FROM service_role;
COMMENT ON FUNCTION public.pdv_entrar(text,text,text,text) IS 'DEPRECATED: substituída por pdv_entrar_iniciar + pdv_entrar_confirmar';