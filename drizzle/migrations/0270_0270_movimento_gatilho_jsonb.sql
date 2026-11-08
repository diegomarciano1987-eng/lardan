-- 0270: o gatilho de 0269 lê tudo pelo jsonb da linha (NEW.roles só existe em access_invites) e nunca impede o movimento.
CREATE OR REPLACE FUNCTION public.tg_consultora_movimento_ativa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE novo jsonb; pid uuid;
BEGIN
  BEGIN
    novo := to_jsonb(NEW);
    pid := nullif(novo ->> TG_ARGV[0], '')::uuid;
    IF pid IS NULL THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'kit_cycles' AND novo ->> 'status' = 'cancelada' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'qualidade_trocas' AND novo ->> 'origem' = 'legado_smalldata' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'access_invites' AND NOT coalesce((novo -> 'roles') ? 'consultora', false) THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> 'status') IS NOT DISTINCT FROM (novo ->> 'status')
       AND (to_jsonb(OLD) ->> TG_ARGV[0]) IS NOT DISTINCT FROM (novo ->> TG_ARGV[0]) THEN RETURN NEW; END IF;
    PERFORM public.consultora_ativar_por_movimento(pid, auth.uid(), TG_TABLE_NAME || ':' || lower(TG_OP));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ativação por movimento falhou (%): %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_consultora_movimento_ativa() FROM PUBLIC, anon, authenticated;