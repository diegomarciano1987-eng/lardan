-- 0372: login da colaboradora por nome de usuário + escopo de praças/representantes liberado pelo Master
ALTER TABLE public.colab_acessos ADD COLUMN IF NOT EXISTS usuario text;
CREATE UNIQUE INDEX IF NOT EXISTS colab_acessos_usuario_uk ON public.colab_acessos (usuario) WHERE usuario IS NOT NULL;
ALTER TABLE public.colab_acessos DROP CONSTRAINT IF EXISTS colab_acessos_usuario_fmt;
ALTER TABLE public.colab_acessos ADD CONSTRAINT colab_acessos_usuario_fmt CHECK (usuario IS NULL OR usuario ~ '^[a-z][a-z0-9]{3,29}$');

CREATE OR REPLACE FUNCTION public.colab_usuario_sugerir(_nome text, _user uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE w text[]; base text; cand text; n int := 1;
BEGIN
  w := array(SELECT x FROM unnest(regexp_split_to_array(lower(translate(coalesce(_nome,''),
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+')) x
       WHERE x <> '');
  IF coalesce(array_length(w,1),0) = 0 THEN RETURN NULL; END IF;
  base := w[1];
  IF array_length(w,1) >= 2 THEN
    IF w[2] IN ('de','da','do','dos','das','e') AND array_length(w,1) >= 3 THEN base := base || w[2] || w[3];
    ELSE base := base || w[2]; END IF;
  END IF;
  base := left(base, 28);
  IF base !~ '^[a-z]' THEN base := 'c' || base; END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM colab_acessos WHERE usuario = cand AND user_id IS DISTINCT FROM _user) LOOP
    n := n + 1; cand := left(base, 28) || n::text;
  END LOOP;
  RETURN cand;
END $$;
REVOKE ALL ON FUNCTION public.colab_usuario_sugerir(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_usuario_sugerir(text, uuid) TO service_role;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT ca.user_id, coalesce(p.display_name, p.legal_name) nome FROM colab_acessos ca
             JOIN parties p ON p.id = ca.party_id WHERE ca.usuario IS NULL ORDER BY ca.codigo LOOP
    UPDATE colab_acessos SET usuario = public.colab_usuario_sugerir(r.nome, r.user_id) WHERE user_id = r.user_id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.colab_login_reservar(_codigo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v uuid; t text := lower(btrim(coalesce(_codigo, '')));
BEGIN
  UPDATE colab_acessos ca SET
    falhas = CASE WHEN ca.bloqueado_ate IS NOT NULL THEN 1 ELSE ca.falhas + 1 END,
    bloqueado_ate = CASE WHEN (CASE WHEN ca.bloqueado_ate IS NOT NULL THEN 1 ELSE ca.falhas + 1 END) >= 5
                         THEN now() + interval '15 minutes' END,
    updated_at = now()
  WHERE (ca.codigo = t OR ca.usuario = t) AND t <> ''
    AND ca.ativo
    AND (ca.bloqueado_ate IS NULL OR ca.bloqueado_ate <= now())
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = ca.user_id AND p.is_active)
    AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = ca.user_id
                     AND ur.role::text NOT IN ('consultora', 'representante'))
  RETURNING ca.user_id INTO v;
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.colab_login_par(_t text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('codigo', ca.codigo, 'usuario', ca.usuario) FROM colab_acessos ca
   WHERE ca.ativo AND (ca.codigo = lower(btrim(_t)) OR ca.usuario = lower(btrim(_t))) LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.colab_login_par(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_login_par(text) TO service_role;

CREATE OR REPLACE FUNCTION public.colab_acesso_usuario_definir(_user_id uuid, _usuario text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE u text := lower(btrim(coalesce(_usuario,''))); antes text;
BEGIN
  PERFORM public.colab_exigir_master(_actor);
  IF u !~ '^[a-z][a-z0-9]{3,29}$' THEN
    RAISE EXCEPTION 'O nome de acesso precisa ter de 4 a 30 letras/números, tudo junto, sem espaço nem acento, começando com letra.';
  END IF;
  IF EXISTS (SELECT 1 FROM colab_acessos WHERE usuario = u AND user_id <> _user_id) THEN
    RAISE EXCEPTION 'Este nome de acesso já é de outra colaboradora.';
  END IF;
  SELECT usuario INTO antes FROM colab_acessos WHERE user_id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Crie o código antes do nome de acesso.'; END IF;
  UPDATE colab_acessos SET usuario = u, updated_at = now() WHERE user_id = _user_id;
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
  VALUES (_actor, 'colab.usuario.definir', 'colab_acessos', _user_id::text, jsonb_build_object('antes', antes, 'depois', u));
END $$;
REVOKE ALL ON FUNCTION public.colab_acesso_usuario_definir(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_acesso_usuario_definir(uuid, text, uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.colab_escopos (
  user_id uuid PRIMARY KEY,
  rede_toda boolean NOT NULL DEFAULT false,
  representantes uuid[] NOT NULL DEFAULT '{}',
  pracas uuid[] NOT NULL DEFAULT '{}',
  atualizado_por uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.colab_escopos TO service_role;
ALTER TABLE public.colab_escopos ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.colab_escopo_meu()
RETURNS public.colab_escopos LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT e.* FROM colab_escopos e JOIN colab_acessos ca ON ca.user_id = e.user_id AND ca.ativo
   WHERE e.user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.colab_reps()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(DISTINCT x) FILTER (WHERE x IS NOT NULL), '{}') FROM (
    SELECT public.colab_rep() x
    UNION ALL SELECT unnest(coalesce((public.colab_escopo_meu()).representantes, '{}'::uuid[]))) s
$$;

CREATE OR REPLACE FUNCTION public.colab_pracas_extra()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((public.colab_escopo_meu()).pracas, '{}'::uuid[])
$$;

CREATE OR REPLACE FUNCTION public.colab_tem_carteira()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT cardinality(public.colab_reps()) > 0 OR cardinality(public.colab_pracas_extra()) > 0
$$;

CREATE OR REPLACE FUNCTION public.colab_rede_toda()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM user_capabilities uc
                   JOIN colab_acessos ca ON ca.user_id = uc.user_id AND ca.ativo
                   JOIN profiles pf ON pf.id = uc.user_id AND pf.is_active
                  WHERE uc.user_id = auth.uid() AND uc.capability = 'quality.manage')
      OR EXISTS (SELECT 1 FROM colab_escopos e
                   JOIN colab_acessos ca ON ca.user_id = e.user_id AND ca.ativo
                   JOIN profiles pf ON pf.id = e.user_id AND pf.is_active
                  WHERE e.user_id = auth.uid() AND e.rede_toda)
$function$;

CREATE OR REPLACE FUNCTION public.colab_praca_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(DISTINCT x) FILTER (WHERE x IS NOT NULL), '{}') FROM (
    SELECT unnest(public.rep_praca_ids(r)) x FROM unnest(public.colab_reps()) r
    UNION ALL SELECT unnest(public.colab_pracas_extra())) s
$$;

CREATE OR REPLACE FUNCTION public.colab_party_ok(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT NOT public.colab_restrita()
      OR EXISTS (SELECT 1 FROM consultant_profiles cp WHERE cp.party_id = _id
                  AND (cp.representative_party_id = ANY (public.colab_reps())
                       OR cp.praca_id = ANY (public.colab_pracas_extra())))
      OR _id = ANY (public.colab_direta_party_ids())
$function$;

CREATE OR REPLACE FUNCTION public.colab_party_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(array_agg(cp.party_id), '{}') FROM consultant_profiles cp
   WHERE cp.representative_party_id = ANY ((SELECT public.colab_reps())::uuid[])
      OR cp.praca_id = ANY ((SELECT public.colab_pracas_extra())::uuid[])
      OR cp.party_id = ANY ((SELECT public.colab_direta_party_ids())::uuid[])
$function$;

CREATE OR REPLACE FUNCTION public.colab_rem_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(array_agg(r.id), '{}') FROM remessas r
   WHERE r.representante_party_id = ANY ((SELECT public.colab_reps())::uuid[])
      OR r.praca_id = ANY ((SELECT public.colab_pracas_extra())::uuid[])
      OR (r.direta AND r.representante_party_id IS NULL AND (SELECT public.colab_direta_pode()))
$function$;

CREATE OR REPLACE FUNCTION public.colab_rem_ok(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT NOT public.colab_restrita() OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = _id
    AND (r.representante_party_id = ANY (public.colab_reps())
      OR r.praca_id = ANY (public.colab_pracas_extra())
      OR (r.direta AND r.representante_party_id IS NULL AND public.colab_direta_pode())))
$function$;

CREATE OR REPLACE FUNCTION public.colab_cycle_ok(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT NOT public.colab_restrita() OR EXISTS (SELECT 1 FROM kit_cycles c WHERE c.id = _id
    AND (c.representante_party_id = ANY (public.colab_reps())
      OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = c.remessa_id
                  AND (r.representante_party_id = ANY (public.colab_reps())
                    OR r.praca_id = ANY (public.colab_pracas_extra())
                    OR (r.direta AND r.representante_party_id IS NULL AND public.colab_direta_pode())))))
$function$;

CREATE OR REPLACE FUNCTION public.colab_cycle_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(array_agg(c.id), '{}') FROM kit_cycles c
   WHERE c.representante_party_id = ANY ((SELECT public.colab_reps())::uuid[])
      OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = c.remessa_id
                  AND (r.representante_party_id = ANY ((SELECT public.colab_reps())::uuid[])
                    OR r.praca_id = ANY ((SELECT public.colab_pracas_extra())::uuid[])
                    OR (r.direta AND r.representante_party_id IS NULL AND (SELECT public.colab_direta_pode()))))
$function$;

CREATE OR REPLACE FUNCTION public.colab_legacy_rep_codigos()
RETURNS integer[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(array_agg(DISTINCT lr.codigo), '{}') FROM legado_representantes lr, unnest(public.colab_reps()) r
   WHERE lr.party_id = r OR upper(trim(lr.nome)) = (SELECT upper(trim(display_name)) FROM parties WHERE id = r)
$function$;

CREATE OR REPLACE FUNCTION public.colab_operacao_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF public.colab_restrita() THEN
    IF TG_TABLE_NAME = 'remessas' THEN
      IF NEW.representante_party_id IS NULL AND public.colab_direta_pode()
         AND (NEW.direta OR current_setting('lardan.maleta_direta', true) = 'on') THEN
        RETURN NEW;
      END IF;
      IF NOT ((NEW.representante_party_id = ANY (public.colab_reps()) AND public.colab_praca_ok(NEW.praca_id))
              OR NEW.praca_id = ANY (public.colab_pracas_extra())) THEN
        RAISE EXCEPTION 'Remessa fora da carteira.' USING errcode = '42501';
      END IF;
    ELSIF TG_TABLE_NAME = 'kit_cycles' THEN
      IF NEW.representante_party_id IS NULL AND public.colab_direta_pode()
         AND (current_setting('lardan.maleta_direta', true) = 'on'
              OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = NEW.remessa_id AND r.direta AND r.representante_party_id IS NULL)) THEN
        RETURN NEW;
      END IF;
      IF NOT coalesce(NEW.representante_party_id = ANY (public.colab_reps())
              OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = NEW.remessa_id AND r.praca_id = ANY (public.colab_pracas_extra())), false)
         OR (NEW.consultora_party_id IS NOT NULL AND NOT public.colab_party_ok(NEW.consultora_party_id)) THEN
        RAISE EXCEPTION 'Maleta fora da carteira.' USING errcode = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.colab_meu_escopo()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object('colaboradora', public.colab_conta(), 'rede_toda', public.colab_conta() AND public.colab_rede_toda(),
    'representante', public.colab_rep(), 'nome', (SELECT display_name FROM parties WHERE id = public.colab_rep()),
    'representantes', to_jsonb(public.colab_reps()), 'pracas_extra', to_jsonb(public.colab_pracas_extra()))
$function$;

DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.variantes_tipo_peca(uuid[])'::regprocedure);
  IF position('public.colab_rep() IS NOT NULL' in d) > 0 THEN
    EXECUTE replace(d, 'public.colab_rep() IS NOT NULL', 'public.colab_tem_carteira()');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.colab_escopo_definir(_user_id uuid, _rede_toda boolean, _reps uuid[], _pracas uuid[], _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE antes jsonb;
BEGIN
  PERFORM public.colab_exigir_master(_actor);
  IF NOT EXISTS (SELECT 1 FROM colab_acessos WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'Crie o acesso da colaboradora antes de liberar praças.';
  END IF;
  IF coalesce(cardinality(_reps),0) > 200 OR coalesce(cardinality(_pracas),0) > 500 THEN RAISE EXCEPTION 'Itens demais.'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(_reps,'{}'::uuid[])) r WHERE NOT EXISTS
      (SELECT 1 FROM party_roles pr WHERE pr.party_id = r AND pr.role = 'representante' AND pr.ended_at IS NULL)) THEN
    RAISE EXCEPTION 'Um dos representantes escolhidos não é representante ativo.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(_pracas,'{}'::uuid[])) p WHERE NOT EXISTS (SELECT 1 FROM cob_pracas c WHERE c.id = p)) THEN
    RAISE EXCEPTION 'Uma das praças escolhidas não existe.';
  END IF;
  SELECT to_jsonb(e) INTO antes FROM colab_escopos e WHERE user_id = _user_id;
  INSERT INTO colab_escopos(user_id, rede_toda, representantes, pracas, atualizado_por, updated_at)
  VALUES (_user_id, coalesce(_rede_toda,false),
          (SELECT coalesce(array_agg(DISTINCT x),'{}') FROM unnest(coalesce(_reps,'{}'::uuid[])) x),
          (SELECT coalesce(array_agg(DISTINCT x),'{}') FROM unnest(coalesce(_pracas,'{}'::uuid[])) x), _actor, now())
  ON CONFLICT (user_id) DO UPDATE SET rede_toda = excluded.rede_toda, representantes = excluded.representantes,
    pracas = excluded.pracas, atualizado_por = excluded.atualizado_por, updated_at = now();
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
  VALUES (_actor, 'colab.escopo.definir', 'colab_escopos', _user_id::text,
          jsonb_build_object('antes', antes, 'rede_toda', _rede_toda, 'representantes', _reps, 'pracas', _pracas));
END $$;
REVOKE ALL ON FUNCTION public.colab_escopo_definir(uuid, boolean, uuid[], uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.colab_escopo_definir(uuid, boolean, uuid[], uuid[], uuid) TO service_role;
REVOKE ALL ON FUNCTION public.colab_escopo_meu() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.colab_escopo_meu() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.colab_reps(), public.colab_pracas_extra(), public.colab_tem_carteira() TO authenticated, service_role;

INSERT INTO colab_escopos(user_id, rede_toda, updated_at)
SELECT user_id, true, now() FROM colab_acessos WHERE codigo IN ('1001','1003')
ON CONFLICT (user_id) DO UPDATE SET rede_toda = true, updated_at = now();
INSERT INTO audit_logs(action, entity, entity_id, payload)
SELECT 'colab.escopo.definir', 'colab_escopos', user_id::text, jsonb_build_object('rede_toda', true, 'motivo', 'Pedido Diego 24/11: Thalia e Ketllin veem toda a rede')
  FROM colab_acessos WHERE codigo IN ('1001','1003');
