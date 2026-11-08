-- 0268: correção do 0266/0267 — o ORDER BY do DISTINCT ON fica só no bloco das candidatas (entre parênteses).
CREATE OR REPLACE FUNCTION public.rep_maleta_destinatarias(_rep uuid, _busca text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t text := btrim(coalesce(_busca, ''));
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.tipo, x.nome) FROM (
    (SELECT 'consultora' tipo, p.id::text id, p.display_name nome, p.code codigo,
           (SELECT a.city FROM party_addresses a WHERE a.party_id = p.id ORDER BY a.is_primary DESC LIMIT 1) cidade
      FROM consultant_profiles cp JOIN parties p ON p.id = cp.party_id
     WHERE cp.representative_party_id = _rep AND p.is_active AND p.status::text NOT IN ('inativo', 'bloqueado', 'desligado')
       AND public.consultora_termo_casa(p.id, p.display_name, p.code, p.doc_digits, t)
     LIMIT 300)
    UNION ALL
    (SELECT DISTINCT ON (coalesce(l.party_id, l.id)) 'candidata', l.id::text, l.full_name, l.protocol, l.city
      FROM leads l LEFT JOIN parties p ON p.id = l.party_id
     WHERE l.representante_party_id = _rep AND l.archived_at IS NULL AND l.lost_at IS NULL
       AND (l.party_id IS NULL OR (
             NOT EXISTS (SELECT 1 FROM consultant_profiles cp2 WHERE cp2.party_id = l.party_id)
             AND coalesce(p.status::text, '') NOT IN ('bloqueado', 'desligado')))
       AND public.consultora_termo_casa(l.party_id, l.full_name || ' ' || coalesce(p.display_name, ''), l.protocol,
                                        coalesce(p.doc_digits, l.cpf_digits), t)
     ORDER BY coalesce(l.party_id, l.id), l.created_at DESC
     LIMIT 300)) x), '[]'::jsonb);
END $function$;
