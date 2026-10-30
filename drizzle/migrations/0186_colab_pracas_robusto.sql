-- Praças de um representante: vínculo SmallData por cadastro OU pelo mesmo nome (cadastros duplicados), remessas e praças das consultoras dele.
CREATE OR REPLACE FUNCTION public.rep_praca_ids(_rep uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH nome AS (SELECT upper(trim(display_name)) n FROM parties WHERE id = _rep),
  codes AS (
    SELECT unnest(lr.pracas) c FROM legado_representantes lr, nome
     WHERE _rep IS NOT NULL AND (lr.party_id = _rep OR upper(trim(lr.nome)) = nome.n)
  ),
  ids AS (
    SELECT lp.praca_id id FROM legado_pracas lp WHERE lp.codigo IN (SELECT c FROM codes)
    UNION SELECT cp.id FROM cob_pracas cp WHERE cp.codigo IN (SELECT c FROM codes)
    UNION SELECT r.praca_id FROM remessas r WHERE _rep IS NOT NULL AND r.representante_party_id = _rep
    UNION SELECT c.praca_id FROM consultant_profiles c WHERE _rep IS NOT NULL AND c.representative_party_id = _rep
  )
  SELECT coalesce(array_agg(DISTINCT id) FILTER (WHERE id IS NOT NULL), '{}') FROM ids
$function$;
REVOKE ALL ON FUNCTION public.rep_praca_ids(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.colab_praca_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT public.rep_praca_ids(public.colab_rep()) $function$;