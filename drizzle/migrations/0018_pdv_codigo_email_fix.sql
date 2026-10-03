CREATE OR REPLACE FUNCTION public.pdv_entrar_iniciar(_numero text, _senha text, _email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE u pdv_unidades; mid uuid; muser uuid; em text; falhas int; envios int; cod text; did uuid;
BEGIN
  SELECT count(*) INTO falhas FROM pdv_login_tentativas WHERE numero=_numero AND NOT ok AND tipo='loja' AND created_at > now()-interval '15 minutes';
  IF falhas >= 5 THEN RAISE EXCEPTION 'Muitas tentativas. Aguarde 15 minutos.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE numero=_numero AND ativo;
  IF u.id IS NULL OR u.senha_hash IS NULL OR u.senha_hash <> crypt(coalesce(_senha,''), u.senha_hash) THEN
    INSERT INTO pdv_login_tentativas(numero,ok) VALUES (coalesce(_numero,''),false);
    RAISE EXCEPTION 'Número da loja ou senha incorretos.';
  END IF;
  SELECT pm.id, pm.user_id, au.email::text INTO mid, muser, em
    FROM pdv_membros pm JOIN auth.users au ON au.id=pm.user_id
   WHERE pm.unidade_id=u.id AND pm.ativo AND lower(au.email)=lower(trim(coalesce(_email,''))) LIMIT 1;
  IF mid IS NULL THEN
    INSERT INTO pdv_login_tentativas(numero,ok) VALUES (_numero,false);
    RAISE EXCEPTION 'Este e-mail não faz parte da equipe desta loja.';
  END IF;
  SELECT count(*) INTO envios FROM pdv_login_codigos WHERE membro_id=mid AND created_at > now()-interval '15 minutes';
  IF envios >= 5 THEN RAISE EXCEPTION 'Muitos códigos pedidos. Aguarde 15 minutos.'; END IF;
  UPDATE pdv_login_codigos SET usado_em=now() WHERE membro_id=mid AND usado_em IS NULL;
  cod := lpad((floor(random()*1000000))::int::text, 6, '0');
  INSERT INTO pdv_login_codigos(unidade_id,membro_id,codigo_hash) VALUES (u.id,mid,crypt(cod,gen_salt('bf'))) RETURNING id INTO did;
  RETURN jsonb_build_object('desafio',did,'codigo',cod,'email',em,'nome',public.pdv_nome_usuario(muser),'unidade',u.nome,'numero',u.numero);
END $$;
REVOKE ALL ON FUNCTION public.pdv_entrar_iniciar(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_entrar_iniciar(text,text,text) TO service_role;