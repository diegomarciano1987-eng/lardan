CREATE OR REPLACE FUNCTION public.legado_transferencia_identidade_autorizada(_legado integer, _remessa uuid, _representante uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
 SELECT _legado IN (924,925) AND EXISTS (
 SELECT 1 FROM public.audit_logs a JOIN public.parties p ON p.id=_representante
 WHERE a.action='legado_transferencia_identidade_autorizada' AND a.entity='remessas' AND a.entity_id=_remessa::text
 AND a.actor_id=auth.uid() AND public.has_role(auth.uid(),'master'::public.app_role)
 AND a.payload->>'legado'=_legado::text AND a.payload->>'representante_party_id'=_representante::text
 AND a.payload->>'nome'=p.display_name AND p.status='ativo'
 AND a.created_at > now()-interval '1 day'
 AND a.payload->>'expedir'='false' AND a.payload->>'preservar_vinculos'='true'
 AND p.doc_digits IS NULL
 AND EXISTS(SELECT 1 FROM public.party_roles pr WHERE pr.party_id=p.id AND pr.role='representante')
 AND (SELECT count(DISTINCT x.id) FROM public.parties x JOIN public.party_roles xr ON xr.party_id=x.id AND xr.role='representante' WHERE x.status='ativo' AND upper(btrim(x.display_name))=upper(btrim(p.display_name)))=1
 );
$f$;
REVOKE ALL ON FUNCTION public.legado_transferencia_identidade_autorizada(integer,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.legado_transferencia_identidade_autorizada(integer,uuid,uuid) TO service_role;
DO $do$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.legado_transferencia_previa(integer,uuid)'::regprocedure) INTO definition;
 IF position('public.legado_transferencia_identidade_autorizada' in definition)=0 THEN
   IF position('IF rem.id IS NULL THEN' in definition)=0 THEN RAISE EXCEPTION 'Prévia mudou; revisar antes de aplicar.'; END IF;
   definition:=replace(definition,'IF rem.id IS NULL THEN','rep_ok := rep_ok OR public.legado_transferencia_identidade_autorizada(_legado, rem.id, rem.representante_party_id);' || chr(10) || '  IF rem.id IS NULL THEN');
   EXECUTE definition;
 END IF;
END $do$;